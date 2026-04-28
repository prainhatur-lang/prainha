// POST /api/excecoes/aceitar-todos
// Body: { filialId, tipo, processo?, severidade? }
// Aceita em batch todas as exceções ABERTAS do tipo informado.
// Filtra opcionalmente por severidade (BAIXA = forma divergente / autoAceita,
// MEDIA = diff fora de tolerancia pequena, ALTA = orfa).
// Pra DIVERGENCIA_VALOR_OPERADORA: popula formaEfetiva/bandeiraEfetiva +
// cria match_pdv_cielo manual + remove duplicatas.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MOTIVOS = [
  'FORA_DO_TEF',
  'FORMA_ERRADA_GARCOM',
  'VENDA_DA_CASA',
  'GORJETA',
  'DESCONTO_OU_AJUSTE',
  'ESTORNO',
  'AUDITORIA_PENDENTE',
  'OUTRO',
] as const;

const Body = z.object({
  filialId: z.string().uuid(),
  tipo: z.string().min(1).max(50),
  processo: z.string().min(1).max(20).optional(),
  severidade: z.enum(['BAIXA', 'MEDIA', 'ALTA']).optional(),
  motivo: z.enum(MOTIVOS).optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { filialId, tipo, processo, severidade, motivo } = parsed.data;

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Carrega todas as exceções abertas do tipo na filial
  const excecoes = await db
    .select({
      id: schema.excecao.id,
      filialId: schema.excecao.filialId,
      tipo: schema.excecao.tipo,
      processo: schema.excecao.processo,
      pagamentoId: schema.excecao.pagamentoId,
      vendaAdquirenteId: schema.excecao.vendaAdquirenteId,
    })
    .from(schema.excecao)
    .where(
      and(
        eq(schema.excecao.filialId, filialId),
        eq(schema.excecao.tipo, tipo),
        processo ? eq(schema.excecao.processo, processo) : undefined,
        severidade ? eq(schema.excecao.severidade, severidade) : undefined,
        isNull(schema.excecao.aceitaEm),
      ),
    );

  if (excecoes.length === 0) {
    return NextResponse.json({ ok: true, aceitas: 0 });
  }

  let aceitas = 0;
  let comFormaEfetiva = 0;

  for (const exc of excecoes) {
    // Marca como aceita
    await db
      .update(schema.excecao)
      .set({
        aceitaEm: new Date(),
        aceitaPor: user.id,
        ...(motivo ? { motivo } : {}),
      })
      .where(eq(schema.excecao.id, exc.id));
    aceitas++;

    // Pra divergência OPERADORA, propaga forma+bandeira da Cielo +
    // grava match firme manual + remove duplicatas.
    if (
      exc.processo === 'OPERADORA' &&
      exc.tipo === 'DIVERGENCIA_VALOR_OPERADORA' &&
      exc.pagamentoId &&
      exc.vendaAdquirenteId
    ) {
      const [venda] = await db
        .select({
          formaPagamento: schema.vendaAdquirente.formaPagamento,
          bandeira: schema.vendaAdquirente.bandeira,
          valorBruto: schema.vendaAdquirente.valorBruto,
        })
        .from(schema.vendaAdquirente)
        .where(eq(schema.vendaAdquirente.id, exc.vendaAdquirenteId))
        .limit(1);
      if (!venda) continue;

      await db
        .update(schema.pagamento)
        .set({
          formaEfetiva: venda.formaPagamento ?? null,
          bandeiraEfetiva: venda.bandeira ?? null,
        })
        .where(eq(schema.pagamento.id, exc.pagamentoId));

      const [pag] = await db
        .select({ valor: schema.pagamento.valor })
        .from(schema.pagamento)
        .where(eq(schema.pagamento.id, exc.pagamentoId))
        .limit(1);
      const diff = pag
        ? +(Number(venda.valorBruto) - Number(pag.valor)).toFixed(2)
        : 0;

      await db
        .insert(schema.matchPdvCielo)
        .values({
          filialId: exc.filialId,
          pagamentoId: exc.pagamentoId,
          vendaAdquirenteId: exc.vendaAdquirenteId,
          nivelMatch: '1',
          criadoPor: user.id,
          diffValor: diff.toFixed(2),
          observacao:
            'Aceito em batch (Aceitar todos): forma/bandeira da Cielo aplicadas como efetivas.',
        })
        .onConflictDoNothing({ target: [schema.matchPdvCielo.pagamentoId] });

      // Remove outras exceções abertas pro mesmo pagamento
      await db
        .delete(schema.excecao)
        .where(
          and(
            eq(schema.excecao.filialId, exc.filialId),
            eq(schema.excecao.pagamentoId, exc.pagamentoId),
            eq(schema.excecao.tipo, 'DIVERGENCIA_VALOR_OPERADORA'),
            isNull(schema.excecao.aceitaEm),
          ),
        );
      comFormaEfetiva++;
    }
  }

  return NextResponse.json({
    ok: true,
    aceitas,
    comFormaEfetiva,
  });
}

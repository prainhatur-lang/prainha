// PATCH /api/excecoes/[id]
// Body: { observacao?: string }
// Marca excecao como aceita/resolvida (aceita_em = now).
// Quando a excecao e DIVERGENCIA_VALOR de OPERADORA com vendaAdquirente
// vinculada, propaga forma + bandeira da Cielo pra pagamento.formaEfetiva
// e pagamento.bandeiraEfetiva (corrige caso garcom errou categoria no PDV
// — taxa correta sera aplicada em auditoria/dashboard com a forma da Cielo).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MOTIVOS = [
  'FORA_DO_TEF',
  'VENDA_DA_CASA',
  'GORJETA',
  'DESCONTO_OU_AJUSTE',
  'ESTORNO',
  'AUDITORIA_PENDENTE',
  'OUTRO',
] as const;

const Body = z.object({
  observacao: z.string().max(500).optional(),
  motivo: z.enum(MOTIVOS).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido' }, { status: 400 });
  }

  // RBAC: verifica que a excecao pertence a uma filial do usuario
  const [exc] = await db
    .select({
      id: schema.excecao.id,
      filialId: schema.excecao.filialId,
      tipo: schema.excecao.tipo,
      processo: schema.excecao.processo,
      pagamentoId: schema.excecao.pagamentoId,
      vendaAdquirenteId: schema.excecao.vendaAdquirenteId,
    })
    .from(schema.excecao)
    .where(eq(schema.excecao.id, id))
    .limit(1);
  if (!exc) return NextResponse.json({ error: 'nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, exc.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const [updated] = await db
    .update(schema.excecao)
    .set({
      aceitaEm: new Date(),
      aceitaPor: user.id,
      observacao: parsed.data.observacao ?? null,
      motivo: parsed.data.motivo ?? null,
    })
    .where(eq(schema.excecao.id, id))
    .returning({ id: schema.excecao.id, aceitaEm: schema.excecao.aceitaEm });

  // Propaga forma+bandeira da Cielo pro pagamento quando aceitar divergencia
  // OPERADORA com venda vinculada. Cobre o caso "garcom marcou Debito mas era
  // Credito" — auditoria de taxa e dashboard ja usam vendaAdquirente.formaPagamento,
  // mas relatorios baseados em pagamento.formaPagamento agora sabem usar
  // formaEfetiva/bandeiraEfetiva quando setadas.
  // Tipo no banco e 'DIVERGENCIA_VALOR_OPERADORA' (com sufixo).
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
    if (venda) {
      await db
        .update(schema.pagamento)
        .set({
          formaEfetiva: venda.formaPagamento ?? null,
          bandeiraEfetiva: venda.bandeira ?? null,
        })
        .where(eq(schema.pagamento.id, exc.pagamentoId));

      // Persiste match firme manual em match_pdv_cielo. Sem isso a engine
      // reroda e gera divergencia de novo (vimos no banco varias linhas
      // duplicadas pro mesmo pedido). Como manual, NUNCA e auto-revogavel.
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
            'Aceito de divergencia OPERADORA: forma/bandeira da Cielo aplicadas como efetivas.',
        })
        .onConflictDoNothing({ target: [schema.matchPdvCielo.pagamentoId] });

      // Limpa excecoes abertas duplicadas pro mesmo pagamento (a engine
      // recriou a cada rodada antes do match firme existir). Mantem a atual
      // (que acabamos de aceitar).
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
    }
  }

  return NextResponse.json(updated);
}

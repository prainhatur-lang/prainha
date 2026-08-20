// POST /api/financeiro/contas — lança conta a pagar MANUAL na nuvem.
//
// Body:
//   {
//     filialId: uuid,
//     descricao: string,            // "histórico" do lançamento
//     valor: number,
//     dataVencimento: 'YYYY-MM-DD',
//     dataLancamento?: 'YYYY-MM-DD',   // default hoje (vira data_cadastro)
//     dataPagamento?: 'YYYY-MM-DD',    // presente = já nasce PAGA (gera baixa)
//     fornecedorId?: uuid,
//     categoriaId?: uuid,              // categoria OU subcategoria do plano
//     observacao?: string,
//   }
//
// origem='MANUAL'; codigo_externo fica NULL (não existe no Consumer).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const Body = z.object({
  filialId: z.string().uuid(),
  descricao: z.string().trim().min(2, 'histórico obrigatório').max(500),
  valor: z.number().positive(),
  dataVencimento: z.string().regex(YMD),
  dataLancamento: z.string().regex(YMD).optional(),
  dataPagamento: z.string().regex(YMD).nullable().optional(),
  fornecedorId: z.string().uuid().nullable().optional(),
  categoriaId: z.string().uuid().nullable().optional(),
  observacao: z.string().trim().max(1000).nullable().optional(),
});

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.create');
  if (error) return error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const b = parsed.data;

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, b.filialId),
      ),
    )
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });

  if (b.categoriaId) {
    const [cat] = await db
      .select({ id: schema.categoriaConta.id })
      .from(schema.categoriaConta)
      .where(
        and(
          eq(schema.categoriaConta.id, b.categoriaId),
          eq(schema.categoriaConta.filialId, b.filialId),
        ),
      )
      .limit(1);
    if (!cat) return NextResponse.json({ error: 'categoria não é da filial' }, { status: 400 });
  }
  if (b.fornecedorId) {
    const [forn] = await db
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .where(
        and(
          eq(schema.fornecedor.id, b.fornecedorId),
          eq(schema.fornecedor.filialId, b.filialId),
        ),
      )
      .limit(1);
    if (!forn) return NextResponse.json({ error: 'fornecedor não é da filial' }, { status: 400 });
  }

  const lancamento = b.dataLancamento ?? hojeBr();
  const paga = !!b.dataPagamento;

  const [conta] = await db
    .insert(schema.contaPagar)
    .values({
      filialId: b.filialId,
      fornecedorId: b.fornecedorId ?? null,
      categoriaId: b.categoriaId ?? null,
      descricao: b.descricao,
      observacao: b.observacao ?? null,
      valor: b.valor.toFixed(2),
      dataVencimento: b.dataVencimento,
      dataPagamento: b.dataPagamento ?? null,
      valorPago: paga ? b.valor.toFixed(2) : null,
      competencia: b.dataVencimento.slice(0, 7),
      origem: 'MANUAL',
      // meio-dia BRT: evita o -1 dia da conversão UTC no timestamptz
      dataCadastro: new Date(`${lancamento}T12:00:00-03:00`),
    })
    .returning({ id: schema.contaPagar.id });

  // Nasceu paga → registra a baixa cheia no histórico também
  if (paga && conta) {
    await db.insert(schema.contaPagarBaixa).values({
      filialId: b.filialId,
      contaPagarId: conta.id,
      data: b.dataPagamento!,
      valor: b.valor.toFixed(2),
      observacao: 'Lançada já paga',
      criadoPor: user.id,
    });
  }

  return NextResponse.json({ id: conta?.id }, { status: 201 });
}

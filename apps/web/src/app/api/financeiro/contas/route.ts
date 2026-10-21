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
//     forcar?: boolean,               // lança mesmo com o aviso "nota de outra casa"
//   }
//
// 409 { casaErrada } quando o histórico/observação traz o número de uma NF-e
// do mesmo fornecedor que está em OUTRA casa (lib/conta-casa-errada, 21/10).
//
// origem='MANUAL'; codigo_externo fica NULL (não existe no Consumer).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { hojeBr } from '@/lib/datas';
import { garantirFornecedorNaFilial } from '@/lib/fornecedor-unico';
import { notaDeOutraCasa } from '@/lib/conta-casa-errada';

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
  forcar: z.boolean().optional(),
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
  let fornecedorId = b.fornecedorId ?? null;
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
    if (!forn) {
      // Cadastro único: fornecedor de outra casa da organização → cria/acha a
      // linha desta casa e lança nela (sem pôr na lista de compras).
      try {
        fornecedorId = await garantirFornecedorNaFilial(b.fornecedorId, b.filialId, db, { ativarCompras: false });
      } catch {
        return NextResponse.json({ error: 'fornecedor não é da filial' }, { status: 400 });
      }
    }
  }

  // Trava "nota de outra casa" — só avisa; com forcar=true lança igual.
  if (!b.forcar) {
    const outra = await notaDeOutraCasa({
      filialId: b.filialId,
      fornecedorId,
      textos: [b.descricao, b.observacao],
    }).catch(() => null);
    if (outra) {
      const v = Number(outra.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return NextResponse.json(
        {
          error: `A NF-e ${outra.numero} de ${outra.fornecedor ?? 'este fornecedor'} (R$ ${v}) está na ${outra.casa}. Conta de nota de outra casa vira despesa em dobro: lance lá, ou confirme se esta casa pagou mesmo.`,
          casaErrada: outra,
        },
        { status: 409 },
      );
    }
  }

  const lancamento = b.dataLancamento ?? hojeBr();
  const paga = !!b.dataPagamento;

  const [conta] = await db
    .insert(schema.contaPagar)
    .values({
      filialId: b.filialId,
      fornecedorId,
      categoriaId: b.categoriaId ?? null,
      descricao: b.descricao,
      observacao: b.observacao ?? null,
      valor: b.valor.toFixed(2),
      dataVencimento: b.dataVencimento,
      dataPagamento: b.dataPagamento ?? null,
      valorPago: paga ? b.valor.toFixed(2) : null,
      competencia: b.dataVencimento.slice(0, 7),
      origem: 'MANUAL',
      criadoPor: user.id,
      criadoEm: new Date(),
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

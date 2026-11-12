// Nota de entrada paga no CARTÃO DE CRÉDITO da empresa (dono, 12/11/2026):
// ao lançar a nota informa qual cartão e em quantas vezes; a nota guarda isso
// (nota_compra.cartao_*) e não gera conta a pagar — quem paga é a fatura.
// Aqui: a lista de cartões (os das faturas enviadas em /financeiro/cartoes),
// a gravação e o encontro com as parcelas que já apareceram nas faturas.

import { db, schema } from '@concilia/db';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

export interface CartaoOpcao {
  banco: string;
  final: string;
}

export interface ParcelaCartaoAchada {
  id: string;
  parcela: number | null;
  totalParcelas: number | null;
  valor: number;
  dataCompra: string | null;
  estabelecimento: string;
  /** Final do cartão que passou a compra (titular ou adicional). */
  cartaoFinal: string | null;
  vencimentoFatura: string | null;
}

async function orgDaFilial(filialId: string): Promise<string | null> {
  const [f] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  return f?.organizacaoId ?? null;
}

/** Cartões da empresa: banco + final de cada fatura já enviada. */
export async function cartoesDaEmpresa(filialId: string): Promise<CartaoOpcao[]> {
  const org = await orgDaFilial(filialId);
  if (!org) return [];
  const rows = await db
    .selectDistinct({ banco: schema.cartaoFatura.banco, final: schema.cartaoFatura.cartaoFinal })
    .from(schema.cartaoFatura)
    .where(
      and(
        eq(schema.cartaoFatura.organizacaoId, org),
        isNull(schema.cartaoFatura.excluidoEm),
        isNotNull(schema.cartaoFatura.banco),
        isNotNull(schema.cartaoFatura.cartaoFinal),
      ),
    )
    .orderBy(asc(schema.cartaoFatura.banco), asc(schema.cartaoFatura.cartaoFinal));
  return rows
    .filter((r) => r.banco && r.final)
    .map((r) => ({ banco: r.banco as string, final: r.final as string }));
}

/** Grava (ou limpa, com null) o cartão da nota. Confere que o cartão existe. */
export async function gravarCartaoDaNota(p: {
  notaId: string;
  filialId: string;
  cartao: { banco: string; final: string; parcelas: number } | null;
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!p.cartao) {
    await db
      .update(schema.notaCompra)
      .set({ cartaoBanco: null, cartaoFinal: null, cartaoParcelas: null, atualizadoEm: new Date() })
      .where(eq(schema.notaCompra.id, p.notaId));
    return { ok: true };
  }
  const { banco, final, parcelas } = p.cartao;
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 36) {
    return { ok: false, erro: 'Número de parcelas inválido (1 a 36).' };
  }
  const lista = await cartoesDaEmpresa(p.filialId);
  if (!lista.some((c) => c.banco === banco && c.final === final)) {
    return { ok: false, erro: 'Cartão não encontrado nas faturas enviadas.' };
  }
  await db
    .update(schema.notaCompra)
    .set({ cartaoBanco: banco, cartaoFinal: final, cartaoParcelas: parcelas, atualizadoEm: new Date() })
    .where(eq(schema.notaCompra.id, p.notaId));
  return { ok: true };
}

/**
 * Parcelas desta compra que já apareceram nas faturas do cartão informado:
 * mesma fatura (banco + final), mesmo número de parcelas, valor da parcela =
 * total ÷ parcelas (tolerância de centavos do arredondamento) e data da compra
 * perto da emissão da nota (3 dias antes a 10 depois).
 */
export async function parcelasDaNotaNoCartao(p: {
  filialId: string;
  banco: string;
  final: string;
  parcelas: number;
  valorTotal: number;
  /** YYYY-MM-DD (BRT) */
  dataEmissao: string | null;
}): Promise<ParcelaCartaoAchada[]> {
  if (!(p.valorTotal > 0) || !p.dataEmissao || p.parcelas < 1) return [];
  const org = await orgDaFilial(p.filialId);
  if (!org) return [];
  const valorParcela = (p.valorTotal / p.parcelas).toFixed(2);
  const tolerancia = p.parcelas > 1 ? '0.10' : '0.02';
  const rows = await db
    .select({
      id: schema.cartaoLancamento.id,
      parcela: schema.cartaoLancamento.parcela,
      totalParcelas: schema.cartaoLancamento.totalParcelas,
      valor: schema.cartaoLancamento.valor,
      dataCompra: sql<string | null>`${schema.cartaoLancamento.dataCompra}::text`,
      estabelecimento: schema.cartaoLancamento.estabelecimento,
      cartaoFinal: schema.cartaoLancamento.cartaoFinal,
      vencimentoFatura: sql<string | null>`${schema.cartaoFatura.vencimento}::text`,
    })
    .from(schema.cartaoLancamento)
    .innerJoin(schema.cartaoFatura, eq(schema.cartaoFatura.id, schema.cartaoLancamento.faturaId))
    .where(
      and(
        eq(schema.cartaoFatura.organizacaoId, org),
        isNull(schema.cartaoFatura.excluidoEm),
        eq(schema.cartaoFatura.banco, p.banco),
        eq(schema.cartaoFatura.cartaoFinal, p.final),
        sql`coalesce(${schema.cartaoLancamento.totalParcelas}, 1) = ${p.parcelas}`,
        sql`abs(${schema.cartaoLancamento.valor} - ${valorParcela}::numeric) <= ${tolerancia}::numeric`,
        sql`${schema.cartaoLancamento.dataCompra} between ${p.dataEmissao}::date - 3 and ${p.dataEmissao}::date + 10`,
      ),
    )
    .orderBy(asc(schema.cartaoFatura.vencimento), asc(schema.cartaoLancamento.parcela));
  return rows.map((r) => ({ ...r, valor: Number(r.valor) }));
}

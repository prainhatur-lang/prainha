// Fator de conversão (embalagem da nota → unidade de estoque) de um item de
// nota de compra. Antes o lançamento só olhava (fornecedor, produto); quando
// o vínculo não existia caía em 1 — caso real 14/10/2026: a CRBS mandou a
// Corona Zero e a Corona Extra com o MESMO código (0027866), o vínculo do
// código ficou com a Extra, o da Zero não foi gravado (unique do código) e a
// caixa com 24 entrou como 1 garrafa a R$ 167,20.
//
// Ordem:
//   1. vínculo do produto com o mesmo código do item
//   2. vínculo do produto com o mesmo EAN
//   3. qualquer vínculo do produto com o fornecedor (o jeito antigo)
//   4. vínculo do mesmo código com OUTRO produto da mesma unidade de estoque
//      (mesma embalagem do fornecedor)
//   5. idem pelo EAN
//   6. 1
// Só os casos 1–3 devolvem `pfId` (vínculo do próprio produto, onde o
// lançamento grava o último preço).

import { db, schema } from '@concilia/db';
import { and, eq, ne } from 'drizzle-orm';
import type { ExecDb } from '@/lib/custo-medio';

export type OrigemFator = 'codigo' | 'ean' | 'produto' | 'codigo-outro' | 'ean-outro' | 'nenhum';

export interface FatorItem {
  fator: number;
  pfId: string | null;
  origem: OrigemFator;
  /** produto dono do vínculo usado quando origem = *-outro */
  produtoOutroId?: string;
}

export async function fatorDoItemNota(opts: {
  fornecedorId: string | null;
  produtoId: string;
  codigo: string | null;
  ean: string | null;
  exec?: ExecDb;
}): Promise<FatorItem> {
  const exec = opts.exec ?? db;
  const nenhum: FatorItem = { fator: 1, pfId: null, origem: 'nenhum' };
  if (!opts.fornecedorId) return nenhum;
  const pf = schema.produtoFornecedor;
  const codigo = opts.codigo?.trim() || null;
  const ean = opts.ean?.trim() || null;

  const doProduto = await exec
    .select({
      id: pf.id,
      fator: pf.fatorConversao,
      codigo: pf.codigoFornecedor,
      ean: pf.ean,
    })
    .from(pf)
    .where(and(eq(pf.fornecedorId, opts.fornecedorId), eq(pf.produtoId, opts.produtoId)));
  const fatorDe = (v: string | null) => Number(v) || 1;
  if (doProduto.length > 0) {
    const porCodigo = codigo ? doProduto.find((v) => v.codigo === codigo) : undefined;
    if (porCodigo) return { fator: fatorDe(porCodigo.fator), pfId: porCodigo.id, origem: 'codigo' };
    const porEan = ean ? doProduto.find((v) => v.ean === ean) : undefined;
    if (porEan) return { fator: fatorDe(porEan.fator), pfId: porEan.id, origem: 'ean' };
    const v = doProduto[0]!;
    return { fator: fatorDe(v.fator), pfId: v.id, origem: 'produto' };
  }

  // Sem vínculo do produto: aproveita o da mesma embalagem em outro produto,
  // desde que a unidade de estoque seja a mesma (24 un ≠ 24 ml).
  const [prod] = await exec
    .select({ unidade: schema.produto.unidadeEstoque })
    .from(schema.produto)
    .where(eq(schema.produto.id, opts.produtoId))
    .limit(1);
  const unidade = (prod?.unidade ?? 'un').toLowerCase();
  const outro = async (campo: 'codigo' | 'ean', valor: string) => {
    const rows = await exec
      .select({ fator: pf.fatorConversao, produtoId: pf.produtoId, unidade: schema.produto.unidadeEstoque })
      .from(pf)
      .innerJoin(schema.produto, eq(schema.produto.id, pf.produtoId))
      .where(
        and(
          eq(pf.fornecedorId, opts.fornecedorId!),
          campo === 'codigo' ? eq(pf.codigoFornecedor, valor) : eq(pf.ean, valor),
          ne(pf.produtoId, opts.produtoId),
        ),
      )
      .limit(5);
    return rows.find((r) => (r.unidade ?? 'un').toLowerCase() === unidade);
  };
  if (codigo) {
    const r = await outro('codigo', codigo);
    if (r) return { fator: fatorDe(r.fator), pfId: null, origem: 'codigo-outro', produtoOutroId: r.produtoId };
  }
  if (ean) {
    const r = await outro('ean', ean);
    if (r) return { fator: fatorDe(r.fator), pfId: null, origem: 'ean-outro', produtoOutroId: r.produtoId };
  }
  return nenhum;
}

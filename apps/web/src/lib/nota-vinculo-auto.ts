// Vínculo automático item da entrada → produto interno, com o que a casa já
// ensinou. Regra do dono (13/10/2026): vinculou uma vez, a próxima entrada do
// mesmo item já vem com o último vínculo.
//  1) EAN do item ↔ produto_fornecedor.ean (mesma filial)
//  2) EAN do item ↔ produto.codigoEtiqueta (mesma filial)
//  3) código do item ↔ produto_fornecedor.codigoFornecedor (fornecedor da nota)
//  4) mesma descrição numa entrada anterior do mesmo fornecedor (ou do mesmo
//     CNPJ/nome no papel, quando a nota ainda não tem fornecedor ligado) — o
//     vínculo mais recente ganha. É o que serve pro pedido sem nota, que não
//     traz código nem EAN.
// Só mexe em item SEM produto; nunca troca vínculo feito, nunca lança estoque.

import { db, schema } from '@concilia/db';
import { and, desc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { chaveDescricao } from '@/lib/pedido-sem-nota';

export async function vincularItensConhecidos(nota: {
  id: string;
  filialId: string;
  fornecedorId: string | null;
}): Promise<number> {
  const itens = await db
    .select({
      id: schema.notaCompraItem.id,
      ean: schema.notaCompraItem.ean,
      codigoProdutoFornecedor: schema.notaCompraItem.codigoProdutoFornecedor,
      descricao: schema.notaCompraItem.descricao,
    })
    .from(schema.notaCompraItem)
    .where(
      and(
        eq(schema.notaCompraItem.notaCompraId, nota.id),
        isNull(schema.notaCompraItem.produtoId),
        // desvinculado na mão: não insiste
        eq(schema.notaCompraItem.semVinculoAuto, false),
      ),
    );
  if (itens.length === 0) return 0;

  let porDescricao: Map<string, string> | null = null;
  async function aprendido(): Promise<Map<string, string>> {
    if (porDescricao) return porDescricao;
    const mapa = new Map<string, string>();
    const [cab] = await db
      .select({ emitCnpj: schema.notaCompra.emitCnpj, emitNome: schema.notaCompra.emitNome })
      .from(schema.notaCompra)
      .where(eq(schema.notaCompra.id, nota.id))
      .limit(1);
    const mesmoEmitente = [
      nota.fornecedorId ? eq(schema.notaCompra.fornecedorId, nota.fornecedorId) : undefined,
      cab?.emitCnpj ? eq(schema.notaCompra.emitCnpj, cab.emitCnpj) : undefined,
      cab?.emitNome?.trim()
        ? sql`upper(trim(${schema.notaCompra.emitNome})) = upper(trim(${cab.emitNome}))`
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => !!c);
    if (mesmoEmitente.length > 0) {
      const anteriores = await db
        .select({ descricao: schema.notaCompraItem.descricao, produtoId: schema.notaCompraItem.produtoId })
        .from(schema.notaCompraItem)
        .innerJoin(schema.notaCompra, eq(schema.notaCompra.id, schema.notaCompraItem.notaCompraId))
        .where(
          and(
            eq(schema.notaCompra.filialId, nota.filialId),
            ne(schema.notaCompra.id, nota.id),
            isNotNull(schema.notaCompraItem.produtoId),
            or(...mesmoEmitente),
          ),
        )
        .orderBy(desc(schema.notaCompra.dataEmissao))
        .limit(3000);
      for (const a of anteriores) {
        const k = chaveDescricao(a.descricao);
        if (k && a.produtoId && !mapa.has(k)) mapa.set(k, a.produtoId);
      }
    }
    // Vínculo feito na mão fica em produto_fornecedor mesmo se a entrada for excluída
    if (nota.fornecedorId) {
      const pfs = await db
        .select({
          produtoId: schema.produtoFornecedor.produtoId,
          descricao: schema.produtoFornecedor.descricaoFornecedor,
        })
        .from(schema.produtoFornecedor)
        .where(eq(schema.produtoFornecedor.fornecedorId, nota.fornecedorId))
        .orderBy(desc(schema.produtoFornecedor.atualizadoEm));
      for (const pf of pfs) {
        const k = chaveDescricao(pf.descricao);
        if (k && !mapa.has(k)) mapa.set(k, pf.produtoId);
      }
    }
    porDescricao = mapa;
    return mapa;
  }

  let mapeados = 0;
  for (const item of itens) {
    let produtoId: string | null = null;

    if (item.ean) {
      const [pf] = await db
        .select({ produtoId: schema.produtoFornecedor.produtoId })
        .from(schema.produtoFornecedor)
        .where(and(eq(schema.produtoFornecedor.filialId, nota.filialId), eq(schema.produtoFornecedor.ean, item.ean)))
        .limit(1);
      if (pf) produtoId = pf.produtoId;
    }

    if (!produtoId && item.ean) {
      const [p] = await db
        .select({ id: schema.produto.id })
        .from(schema.produto)
        .where(and(eq(schema.produto.filialId, nota.filialId), eq(schema.produto.codigoEtiqueta, item.ean)))
        .limit(1);
      if (p) produtoId = p.id;
    }

    if (!produtoId && item.codigoProdutoFornecedor && nota.fornecedorId) {
      const [pf] = await db
        .select({ produtoId: schema.produtoFornecedor.produtoId })
        .from(schema.produtoFornecedor)
        .where(
          and(
            eq(schema.produtoFornecedor.fornecedorId, nota.fornecedorId),
            eq(schema.produtoFornecedor.codigoFornecedor, item.codigoProdutoFornecedor),
          ),
        )
        .limit(1);
      if (pf) produtoId = pf.produtoId;
    }

    if (!produtoId) {
      const k = chaveDescricao(item.descricao);
      if (k) produtoId = (await aprendido()).get(k) ?? null;
    }

    if (produtoId) {
      await db
        .update(schema.notaCompraItem)
        .set({ produtoId })
        .where(and(eq(schema.notaCompraItem.id, item.id), isNull(schema.notaCompraItem.produtoId)));
      mapeados++;
    }
  }
  return mapeados;
}

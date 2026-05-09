// Auto-vincula NF de entrada a um Pedido de Compra que a originou.
//
// Estrategia:
//   1. Busca pedido_compra do mesmo fornecedor + filial com status pendente
//      (GERADO / ENVIADO / ENTREGUE_PARCIAL), criado nos ultimos 60 dias,
//      que ainda nao tem nota_compra_id setado.
//   2. Se exatamente 1 candidato -> reconcilia automaticamente.
//      Se varios -> nao vincula automaticamente (gestor escolhe via UI).
//   3. Pra cada pedido_compra_item, busca nota_compra_item com mesmo produto_id.
//      Liga nota_compra_item_id e copia quantidade pra quantidade_recebida.
//   4. Atualiza status do pedido_compra:
//      - todos itens com NF item linkado E qty recebida == qty pedida -> RECONCILIADO
//      - alguns itens com NF item linkado -> ENTREGUE_PARCIAL
//      - nenhum item linkado -> mantem GERADO/ENVIADO

import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';

export async function tentarMatchPedidoComNota(opts: {
  notaCompraId: string;
  filialId: string;
  fornecedorId: string;
  dataEmissao: Date | null;
}): Promise<{ matched: false } | { matched: true; pedidoId: string; status: string; itensLinkados: number }> {
  // Janela de 60 dias antes da emissao da nota — pedido tem que ter sido
  // criado antes da NF (logico) e nao muito antigo (provavel se passa de 60d).
  const dataLimite = new Date(
    (opts.dataEmissao?.getTime() ?? Date.now()) - 60 * 24 * 60 * 60 * 1000,
  );

  // Candidatos: pedidos pendentes desse fornecedor+filial sem NF vinculada
  const candidatos = await db
    .select({ id: schema.pedidoCompra.id, status: schema.pedidoCompra.status })
    .from(schema.pedidoCompra)
    .where(
      and(
        eq(schema.pedidoCompra.filialId, opts.filialId),
        eq(schema.pedidoCompra.fornecedorId, opts.fornecedorId),
        isNull(schema.pedidoCompra.notaCompraId),
        inArray(schema.pedidoCompra.status, ['GERADO', 'ENVIADO', 'ENTREGUE_PARCIAL']),
        gte(schema.pedidoCompra.criadoEm, dataLimite),
      ),
    )
    .orderBy(desc(schema.pedidoCompra.criadoEm))
    .limit(2);

  if (candidatos.length === 0) return { matched: false };
  // 2 ou mais candidatos: ambiguo, deixa pro gestor escolher manualmente
  if (candidatos.length > 1) return { matched: false };

  const pedidoId = candidatos[0].id;

  // Vincula NF ao pedido
  await db
    .update(schema.pedidoCompra)
    .set({ notaCompraId: opts.notaCompraId })
    .where(eq(schema.pedidoCompra.id, pedidoId));

  // Pega itens do pedido + itens da NF e tenta linkar por produto_id
  const itensPedido = await db
    .select({
      id: schema.pedidoCompraItem.id,
      produtoId: schema.pedidoCompraItem.produtoId,
      quantidade: schema.pedidoCompraItem.quantidade,
    })
    .from(schema.pedidoCompraItem)
    .where(eq(schema.pedidoCompraItem.pedidoCompraId, pedidoId));

  const itensNF = await db
    .select({
      id: schema.notaCompraItem.id,
      produtoId: schema.notaCompraItem.produtoId,
      quantidade: schema.notaCompraItem.quantidade,
    })
    .from(schema.notaCompraItem)
    .where(eq(schema.notaCompraItem.notaCompraId, opts.notaCompraId));

  let linkados = 0;
  let totalEsperado = itensPedido.length;
  let totalRecebidoCompleto = 0;

  for (const ip of itensPedido) {
    if (!ip.produtoId) continue;
    // Acha NF item com mesmo produto_id que ainda nao foi linkado
    const inf = itensNF.find((i) => i.produtoId === ip.produtoId);
    if (!inf) continue;

    await db
      .update(schema.pedidoCompraItem)
      .set({
        notaCompraItemId: inf.id,
        quantidadeRecebida: inf.quantidade,
      })
      .where(eq(schema.pedidoCompraItem.id, ip.id));
    linkados++;

    if (Number(inf.quantidade) >= Number(ip.quantidade)) totalRecebidoCompleto++;
  }

  // Determina novo status
  let novoStatus = 'ENTREGUE_PARCIAL';
  let reconciliadoEm: Date | null = null;
  if (linkados === 0) {
    // Nenhum item bateu — desfaz vinculo (provavelmente NF nao corresponde a esse pedido)
    await db
      .update(schema.pedidoCompra)
      .set({ notaCompraId: null })
      .where(eq(schema.pedidoCompra.id, pedidoId));
    return { matched: false };
  }
  if (linkados === totalEsperado && totalRecebidoCompleto === totalEsperado) {
    novoStatus = 'RECONCILIADO';
    reconciliadoEm = new Date();
  }

  await db
    .update(schema.pedidoCompra)
    .set({
      status: novoStatus,
      reconciliadoEm,
      atualizadoEm: new Date(),
    })
    .where(eq(schema.pedidoCompra.id, pedidoId));

  return { matched: true, pedidoId, status: novoStatus, itensLinkados: linkados };
}

// Baixa automática de estoque quando pedido_item chega do Consumer.
//
// Regras:
//  1) Se o produto tem ficha_tecnica, gera SAIDA_FICHA_TECNICA pra cada linha
//     com baixaEstoque=true e insumo.controlaEstoque=true.
//     Qtd consumida = pedido_item.quantidade × ficha.quantidade.
//  2) Senão, se o produto em si tem controlaEstoque=true, gera SAIDA_VENDA
//     direto no próprio produto (revenda direta tipo lata de Coca).
//  3) Cancelamento: se pedido_item tem dataDelete preenchida E já tem
//     movimentos ligados, grava ENTRADA_DEVOLUCAO pra cada movimento (com
//     movimentoPaiId apontando pro original) pra reverter o efeito no saldo.
//
// Idempotência: nunca cria movimento novo se já existe um SAIDA_VENDA ou
// SAIDA_FICHA_TECNICA pra aquele pedido_item_id; nunca cria reversão se
// já existe ENTRADA_DEVOLUCAO com movimentoPaiId apontando pro original.

import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

const TIPOS_SAIDA = ['SAIDA_VENDA', 'SAIDA_FICHA_TECNICA'] as const;

/** Processa baixa de estoque pra um conjunto de pedido_items recém-ingeridos.
 *  Chamada após upsert + resolução de FKs.
 */
export async function processarBaixaEstoque(
  filialId: string,
  codigosExternos: number[],
): Promise<{
  baixados: number;
  revertidos: number;
  pulados: number;
}> {
  if (codigosExternos.length === 0) {
    return { baixados: 0, revertidos: 0, pulados: 0 };
  }

  const itens = await db
    .select({
      id: schema.pedidoItem.id,
      produtoId: schema.pedidoItem.produtoId,
      quantidade: schema.pedidoItem.quantidade,
      precoCusto: schema.pedidoItem.precoCusto,
      dataDelete: schema.pedidoItem.dataDelete,
      dataHoraCadastro: schema.pedidoItem.dataHoraCadastro,
      produtoControla: schema.produto.controlaEstoque,
      produtoPrecoCusto: schema.produto.precoCusto,
      produtoTipo: schema.produto.tipo,
    })
    .from(schema.pedidoItem)
    .leftJoin(schema.produto, eq(schema.produto.id, schema.pedidoItem.produtoId))
    .where(
      and(
        eq(schema.pedidoItem.filialId, filialId),
        inArray(schema.pedidoItem.codigoExterno, codigosExternos),
      ),
    );

  let baixados = 0;
  let revertidos = 0;
  let pulados = 0;

  for (const item of itens) {
    if (!item.produtoId) {
      pulados++;
      continue;
    }

    const movsExistentes = await db
      .select({
        id: schema.movimentoEstoque.id,
        produtoId: schema.movimentoEstoque.produtoId,
        quantidade: schema.movimentoEstoque.quantidade,
        precoUnitario: schema.movimentoEstoque.precoUnitario,
        valorTotal: schema.movimentoEstoque.valorTotal,
        tipo: schema.movimentoEstoque.tipo,
      })
      .from(schema.movimentoEstoque)
      .where(
        and(
          eq(schema.movimentoEstoque.pedidoItemId, item.id),
          inArray(schema.movimentoEstoque.tipo, [...TIPOS_SAIDA]),
        ),
      );

    if (item.dataDelete) {
      // Item deletado no Consumer → reverter movimentos existentes
      if (movsExistentes.length === 0) {
        pulados++;
        continue;
      }
      const foiRevertido = await reverterMovimentos(filialId, item.id, movsExistentes);
      if (foiRevertido) revertidos++;
      else pulados++;
      continue;
    }

    if (movsExistentes.length > 0) {
      // Já foi baixado — idempotente
      pulados++;
      continue;
    }

    const qtdItem = Number(item.quantidade ?? 0);
    if (qtdItem <= 0) {
      pulados++;
      continue;
    }

    const dataMov = item.dataHoraCadastro ?? new Date();

    // 1) Ficha técnica (só linhas com baixaEstoque + insumo controla)
    const insumo = schema.produto;
    const ficha = await db
      .select({
        insumoId: schema.fichaTecnica.insumoId,
        quantidade: schema.fichaTecnica.quantidade,
        baixaEstoque: schema.fichaTecnica.baixaEstoque,
        insumoControla: insumo.controlaEstoque,
        insumoPrecoCusto: insumo.precoCusto,
      })
      .from(schema.fichaTecnica)
      .innerJoin(insumo, eq(insumo.id, schema.fichaTecnica.insumoId))
      .where(eq(schema.fichaTecnica.produtoId, item.produtoId));

    const fichaEfetiva = ficha.filter((f) => f.baixaEstoque && f.insumoControla);

    if (fichaEfetiva.length > 0) {
      for (const f of fichaEfetiva) {
        const qtdConsumida = qtdItem * Number(f.quantidade);
        const precoUnit = f.insumoPrecoCusto ? Number(f.insumoPrecoCusto) : 0;
        const valor = qtdConsumida * precoUnit;
        await db.insert(schema.movimentoEstoque).values({
          filialId,
          produtoId: f.insumoId,
          tipo: 'SAIDA_FICHA_TECNICA',
          quantidade: (-qtdConsumida).toFixed(4),
          precoUnitario: precoUnit.toFixed(6),
          valorTotal: valor.toFixed(2),
          dataHora: dataMov,
          pedidoItemId: item.id,
        });
        await db
          .update(schema.produto)
          .set({
            estoqueAtual: sql`COALESCE(${schema.produto.estoqueAtual}, 0) - ${qtdConsumida.toFixed(4)}`,
          })
          .where(eq(schema.produto.id, f.insumoId));
      }
      baixados++;
      continue;
    }

    // 2) Sem ficha: se produto controla estoque próprio, baixa nele mesmo
    if (item.produtoControla) {
      const preco =
        item.precoCusto !== null
          ? Number(item.precoCusto)
          : item.produtoPrecoCusto
            ? Number(item.produtoPrecoCusto)
            : 0;
      await db.insert(schema.movimentoEstoque).values({
        filialId,
        produtoId: item.produtoId,
        tipo: 'SAIDA_VENDA',
        quantidade: (-qtdItem).toFixed(4),
        precoUnitario: preco.toFixed(6),
        valorTotal: (qtdItem * preco).toFixed(2),
        dataHora: dataMov,
        pedidoItemId: item.id,
      });
      await db
        .update(schema.produto)
        .set({
          estoqueAtual: sql`COALESCE(${schema.produto.estoqueAtual}, 0) - ${qtdItem.toFixed(4)}`,
        })
        .where(eq(schema.produto.id, item.produtoId));
      baixados++;
      continue;
    }

    // Produto não controla estoque e não tem ficha → nada a baixar (ex: SERVICO)
    pulados++;
  }

  return { baixados, revertidos, pulados };
}

async function reverterMovimentos(
  filialId: string,
  pedidoItemId: string,
  movs: Array<{
    id: string;
    produtoId: string;
    quantidade: string;
    precoUnitario: string | null;
    valorTotal: string | null;
    tipo: string;
  }>,
): Promise<boolean> {
  // Verifica se já existe reversão pra cada movimento (via movimento_pai_id)
  const idsOriginais = movs.map((m) => m.id);
  const reversoesExistentes = await db
    .select({ movimentoPaiId: schema.movimentoEstoque.movimentoPaiId })
    .from(schema.movimentoEstoque)
    .where(
      and(
        eq(schema.movimentoEstoque.filialId, filialId),
        eq(schema.movimentoEstoque.tipo, 'ENTRADA_DEVOLUCAO'),
        inArray(schema.movimentoEstoque.movimentoPaiId, idsOriginais),
      ),
    );
  const idsJaRevertidos = new Set(
    reversoesExistentes.map((r) => r.movimentoPaiId).filter(Boolean) as string[],
  );

  let criouAlguma = false;
  for (const m of movs) {
    if (idsJaRevertidos.has(m.id)) continue;
    const qtdOriginal = Number(m.quantidade); // negativo (saída)
    const qtdReversa = Math.abs(qtdOriginal);
    const valorReversa = m.valorTotal ? Number(m.valorTotal) : 0;

    await db.insert(schema.movimentoEstoque).values({
      filialId,
      produtoId: m.produtoId,
      tipo: 'ENTRADA_DEVOLUCAO',
      quantidade: qtdReversa.toFixed(4),
      precoUnitario: m.precoUnitario,
      valorTotal: valorReversa.toFixed(2),
      dataHora: new Date(),
      pedidoItemId,
      movimentoPaiId: m.id,
      observacao: 'Estorno automatico: pedido_item deletado no Consumer',
    });
    await db
      .update(schema.produto)
      .set({
        estoqueAtual: sql`COALESCE(${schema.produto.estoqueAtual}, 0) + ${qtdReversa.toFixed(4)}`,
      })
      .where(eq(schema.produto.id, m.produtoId));
    criouAlguma = true;
  }

  return criouAlguma;
}

// Envio de um pedido de compra pro fornecedor via WhatsApp (template UTILIDADE
// WHATSAPP_PEDIDO_TEMPLATE). Usado tanto pelo botão manual (rota enviar-auto)
// quanto pela aprovação da cotação (envio automático ao gerar os pedidos).

import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { pedidoCompraConfigurado, enviarPedidoCompra } from '@/lib/whatsapp-otp';
import { dadosFaturamentoLinha } from '@/lib/dados-faturamento';

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normTelefone(v: string | null): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

export type EnvioPedidoResultado = { ok: boolean; error?: string };

/** Envia 1 pedido de compra pro fornecedor e marca ENVIADO. Não lança —
 *  devolve {ok:false, error} pra quem chama decidir (ex.: aprovar em lote). */
export async function enviarPedidoAuto(pedidoId: string): Promise<EnvioPedidoResultado> {
  if (!pedidoCompraConfigurado()) {
    return { ok: false, error: 'envio automático não configurado (falta WHATSAPP_PEDIDO_TEMPLATE)' };
  }

  const [p] = await db
    .select({
      id: schema.pedidoCompra.id,
      numero: schema.pedidoCompra.numero,
      status: schema.pedidoCompra.status,
      valorTotal: schema.pedidoCompra.valorTotal,
      filialId: schema.pedidoCompra.filialId,
      filialNome: schema.filial.nome,
      fornecedorNome: schema.fornecedor.nome,
      fornecedorFone: schema.fornecedor.fonePrincipal,
    })
    .from(schema.pedidoCompra)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.pedidoCompra.filialId))
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.pedidoCompra.fornecedorId))
    .where(eq(schema.pedidoCompra.id, pedidoId))
    .limit(1);
  if (!p) return { ok: false, error: 'pedido não encontrado' };
  if (p.status === 'CANCELADO') return { ok: false, error: 'pedido cancelado' };

  const tel = normTelefone(p.fornecedorFone);
  if (!tel) return { ok: false, error: 'fornecedor sem telefone' };

  const itens = await db
    .select({
      quantidade: schema.pedidoCompraItem.quantidade,
      valorTotal: schema.pedidoCompraItem.valorTotal,
      produtoNome: schema.produto.nome,
      // Unidade DO ITEM do pedido, não a de estoque do produto — fornecedor
      // pode vender em cx/pct enquanto o estoque controla em kg.
      unidade: schema.pedidoCompraItem.unidade,
    })
    .from(schema.pedidoCompraItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.pedidoCompraItem.produtoId))
    .where(eq(schema.pedidoCompraItem.pedidoCompraId, pedidoId));

  const itensStr = itens
    .map((i) => `${i.produtoNome} ${Number(i.quantidade).toLocaleString('pt-BR')} ${i.unidade} = ${brl(Number(i.valorTotal))}`)
    .join('; ');

  // Dados de faturamento JUNTO com o pedido — o fornecedor não precisa
  // perguntar "qual CNPJ pra tirar o pedido?" (linha única: parâmetro de
  // template da Meta não aceita quebra de linha).
  const faturamento = await dadosFaturamentoLinha(p.filialId).catch(() => null);

  try {
    await enviarPedidoCompra(tel, {
      fornecedor: (p.fornecedorNome ?? '').split(' ')[0] || 'tudo bem',
      filial: p.filialNome ?? 'Prainha',
      numero: String(p.numero),
      itens: `${itensStr || '(itens no sistema)'}${faturamento ? `; ${faturamento}` : ''}`,
      total: p.valorTotal != null ? brl(Number(p.valorTotal)) : '—',
      pedidoId, // p/ o payload dos botões Confirmar/Não consigo
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  await db
    .update(schema.pedidoCompra)
    .set({ status: 'ENVIADO', enviadoEm: sql`now()` })
    .where(and(eq(schema.pedidoCompra.id, pedidoId), sql`${schema.pedidoCompra.status} <> 'CANCELADO'`));

  return { ok: true };
}

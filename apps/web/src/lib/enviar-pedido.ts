// Envio de um pedido de compra pro fornecedor via WhatsApp (template UTILIDADE
// WHATSAPP_PEDIDO_TEMPLATE). Usado tanto pelo botão manual (rota enviar-auto)
// quanto pela aprovação da cotação (envio automático ao gerar os pedidos).

import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { pedidoCompraConfigurado, enviarPedidoCompra } from '@/lib/whatsapp-otp';
import { foneParaWhatsapp } from '@/lib/vendedor-fone';
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
      // ⚠️ NUNCA fonePrincipal aqui: ele vem do Consumer e é o FIXO da empresa.
      // Foi assim que o pedido 24 (R$ 4.880) saiu 2x pro (79) 3322-1035 e o
      // Alex nunca recebeu. O número certo é o do VENDEDOR.
      fornecedorFone: foneParaWhatsapp(),
      vendedorNome: sql<string | null>`(
        SELECT v.nome FROM vendedor_fornecedor vf
        JOIN vendedor v ON v.id = vf.vendedor_id
        WHERE vf.fornecedor_id = ${schema.fornecedor.id}
          AND v.ativo AND COALESCE(v.whatsapp, '') <> ''
        ORDER BY vf.principal DESC, v.atualizado_em DESC LIMIT 1)`,
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
      observacao: schema.pedidoCompraItem.observacao,
    })
    .from(schema.pedidoCompraItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.pedidoCompraItem.produtoId))
    .where(eq(schema.pedidoCompraItem.pedidoCompraId, pedidoId));

  const itensStr = itens
    .map(
      (i) =>
        `${i.produtoNome}${i.observacao ? ` (${i.observacao})` : ''} ${Number(i.quantidade).toLocaleString('pt-BR')} ${i.unidade} = ${brl(Number(i.valorTotal))}`,
    )
    .join('; ');

  // Dados de faturamento JUNTO com o pedido — o fornecedor não precisa
  // perguntar "qual CNPJ pra tirar o pedido?" (linha única: parâmetro de
  // template da Meta não aceita quebra de linha).
  const faturamento = await dadosFaturamentoLinha(p.filialId).catch(() => null);

  // Link público com o pedido inteiro (itens, observações, valores e dados de
  // faturamento). A mensagem de modelo da Meta tem teto de 1024 caracteres
  // (#132005): o pedido 59 da Mega (12 itens com observação de estoque, 09/10)
  // ficou GERADO sem sair por isso. Em vez de cortar item, a lista vai no link.
  // "Preço final com impostos" vai junto do link — regra do dono (09/10).
  const link = `Preços FINAIS, com impostos. Pedido completo: https://app.prainhabar.com/cotacao/preencher/pedido/${pedidoId}`;
  const lista = itensStr || '(itens no sistema)';
  const fat = faturamento ? `; ${faturamento}` : '';
  const resumo = `${itens.length} ${itens.length === 1 ? 'item' : 'itens'}, lista com quantidades e valores no link`;

  const enviar = (itensTexto: string) =>
    enviarPedidoCompra(tel, {
      // Cumprimenta a PESSOA; o nome da empresa vai no corpo do pedido.
      fornecedor: (p.vendedorNome ?? p.fornecedorNome ?? '').split(/[\s(/-]/)[0] || 'tudo bem',
      filial: p.filialNome ?? 'Prainha',
      numero: String(p.numero),
      itens: itensTexto,
      total: p.valorTotal != null ? brl(Number(p.valorTotal)) : '—',
      pedidoId, // p/ o payload dos botões Confirmar/Não consigo
    });
  try {
    // Só passa pra próxima quando a Meta recusa por TAMANHO:
    // 1) a mensagem de sempre + o link; 2) a mensagem de sempre, sem o link
    // (quando só o link fez estourar); 3) pedido grande: resumo + link;
    // 4) o mesmo sem os dados de faturamento (estão na página do link).
    const tentativas = [`${lista}${fat}; ${link}`, `${lista}${fat}`, `${resumo}. ${link}${fat}`, `${resumo}. ${link}`];
    for (let t = 0; t < tentativas.length; t++) {
      try {
        await enviar(tentativas[t]!);
        break;
      } catch (e) {
        const longo = /132005|too long/i.test((e as Error).message);
        if (!longo || t === tentativas.length - 1) throw e;
      }
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  await db
    .update(schema.pedidoCompra)
    .set({ status: 'ENVIADO', enviadoEm: sql`now()` })
    .where(and(eq(schema.pedidoCompra.id, pedidoId), sql`${schema.pedidoCompra.status} <> 'CANCELADO'`));

  return { ok: true };
}

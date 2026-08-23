// CONTA A RECEBER DE CANAL — o pedido de um canal que já cobra do cliente
// (iFood, e no futuro outros) vira um lançamento a receber em vez de ficar
// pendurado no caixa como "aberto, R$ 0,00 pago". Pedido do dono, 23/08/2026:
// o cliente paga o iFood, o iFood libera o pedido pra loja, e é o iFood quem
// deve a casa — não o cliente.
//
// ⚠️ CANAL_POR_ORIGEM é o que sabemos HOJE, não um contrato fixo do iFood: o
// código de origem 7 é do DeliveryHub (o Consumer chama assim o integrador),
// e o que está plugado nele hoje na Tabuará é o iFood (confirmado pelo dono).
// Se amanhã outro app entrar no mesmo hub, ou uma filial plugar outro canal,
// este mapa é o lugar de ajustar — não precisa mexer no resto do fluxo.
import { db, schema } from '@concilia/db';
import { sql } from 'drizzle-orm';

const CANAL_POR_ORIGEM: Record<number, string> = {
  4: 'ifood', // integração própria do vendas-local (desligada hoje)
  7: 'ifood', // DeliveryHub via Consumer — é o iFood, hoje, na Tabuará
};

type PedidoRow = {
  filialId: string;
  codigoExterno: number;
  numero: number | null;
  nomeCliente: string | null;
  dataAbertura: Date | null;
  valorTotal: string | null;
  codigoPedidoOrigem: number | null;
  dataDelete: Date | null;
};

export async function sincronizarContaReceberCanal(filialId: string, rows: PedidoRow[]) {
  for (const p of rows) {
    const canal = p.codigoPedidoOrigem != null ? CANAL_POR_ORIGEM[p.codigoPedidoOrigem] : null;
    if (!canal) continue;

    if (p.dataDelete) {
      // pedido caiu (cancelado no canal) — some com a expectativa de receber,
      // mas só se ainda estava aberta: já recebido/cancelado na mão, preserva
      await db.execute(sql`
        UPDATE conta_receber_canal SET status = 'cancelado', atualizado_em = now()
        WHERE filial_id = ${filialId} AND pedido_codigo_externo = ${p.codigoExterno} AND status = 'aberto'`);
      continue;
    }
    if (!p.dataAbertura || p.valorTotal == null) continue;

    // upsert que NUNCA reabre nem sobrescreve um lançamento já baixado/cancelado
    // na mão — só atualiza os dados enquanto o lançamento seguir 'aberto'.
    await db.execute(sql`
      INSERT INTO conta_receber_canal
        (filial_id, canal, pedido_codigo_externo, pedido_numero, nome_cliente, data_pedido, valor_bruto)
      VALUES (${filialId}, ${canal}, ${p.codigoExterno}, ${p.numero}, ${p.nomeCliente}, ${p.dataAbertura}, ${p.valorTotal})
      ON CONFLICT (filial_id, pedido_codigo_externo) DO UPDATE SET
        pedido_numero = excluded.pedido_numero,
        nome_cliente = excluded.nome_cliente,
        data_pedido = excluded.data_pedido,
        valor_bruto = excluded.valor_bruto,
        atualizado_em = now()
      WHERE conta_receber_canal.status = 'aberto'`);
  }
}

// Evento da entrega do iFood (módulo Shipping) → ifood_entrega.
//
// Saiu de dentro de /api/loja/ifood-fila (igual, linha por linha) pra ser usado
// também pelo puxador da homologação do Shipping. A fila da loja continua
// chamando isto do mesmo jeito.

import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { configIfood, credShipping } from '@/lib/ifood-credenciais';
import { confirmarPedido, detalhePedido } from '@/lib/ifood-shipping';
import { comLogHomolog } from '@/lib/ifood-homolog-log';

/** Credencial pra falar do pedido externo: a de teste quando a homologação do
 *  Shipping está ligada; senão a config da casa, como sempre foi. */
async function credEntrega(filialId: string) {
  const cfg = await configIfood(filialId);
  const h = credShipping(cfg);
  return h?.homologacao ? comLogHomolog(filialId, 'shipping', h) : cfg;
}

// Evento do pedido externo (Shipping) → status do entregador no pedido do site.
// Aceita o código longo e o curto do polling.
const STATUS_ENTREGA: Record<string, string> = {
  CONFIRMED: 'CONFIRMADO', CFM: 'CONFIRMADO',
  ASSIGNED_DRIVER: 'A_CAMINHO', ADR: 'A_CAMINHO',
  GOING_TO_ORIGIN: 'A_CAMINHO', GTO: 'A_CAMINHO',
  ARRIVED_AT_ORIGIN: 'A_CAMINHO', AAO: 'A_CAMINHO',
  DISPATCHED: 'A_CAMINHO', DSP: 'A_CAMINHO',
  ARRIVED_AT_DESTINATION: 'A_CAMINHO', AAD: 'A_CAMINHO',
  DELIVERY_DROP_CODE_REQUESTED: 'CODIGO', DDCR: 'CODIGO',
  CONCLUDED: 'ENTREGUE', CON: 'ENTREGUE',
  CANCELLED: 'CANCELADO', CAN: 'CANCELADO',
};
const FINAIS = ['ENTREGUE', 'CANCELADO'];
/** Cliente mudou o endereço depois do entregador chamado: a loja aceita ou recusa. */
const TROCA_ENDERECO = ['DAR', 'DELIVERY_ADDRESS_CHANGE_REQUESTED'];

/** Guarda o pedido de troca de endereço (com o endereço novo, quando o iFood
 *  manda no `metadata` do evento) pra tela do pedido mostrar Aceitar/Recusar. */
async function trocaDeEndereco(
  filialId: string,
  e: typeof schema.ifoodEntrega.$inferSelect,
  orderId: string,
  metadataLoja: unknown,
) {
  let metadata: unknown = metadataLoja && typeof metadataLoja === 'object' ? metadataLoja : null;
  if (!metadata) {
    // Modo nuvem: o puxador gravou o evento inteiro aqui.
    const [ev] = await db
      .select({ metadata: schema.ifoodNuvemEvento.metadata })
      .from(schema.ifoodNuvemEvento)
      .where(and(
        eq(schema.ifoodNuvemEvento.orderId, orderId),
        inArray(schema.ifoodNuvemEvento.codigo, TROCA_ENDERECO),
      ))
      .orderBy(desc(schema.ifoodNuvemEvento.criadoEm))
      .limit(1);
    metadata = ev?.metadata ?? null;
  }
  let enderecoAtual: unknown = null;
  const c = await credEntrega(filialId);
  if (c.clientId && c.clientSecret) {
    const det = await detalhePedido(c, orderId);
    enderecoAtual = (det as { delivery?: { deliveryAddress?: unknown } } | null)?.delivery?.deliveryAddress ?? null;
  }
  await db
    .update(schema.ifoodEntrega)
    .set({
      trocaEndereco: { pedidoEm: new Date().toISOString(), metadata, enderecoAtual } as unknown as Record<string, unknown>,
      trocaEnderecoStatus: 'PENDENTE',
      trocaEnderecoRespondidaEm: null,
      trocaEnderecoRespondidaPor: null,
      atualizadoEm: sql`now()`,
    })
    .where(eq(schema.ifoodEntrega.id, e.id));
  console.log('[ifood-shipping] troca de endereço pedida', { orderId, entrega: e.id, temMetadata: !!metadata });
}

export async function aplicarEventoEntrega(
  filialId: string,
  orderId: string,
  codigo: string,
  metadata?: unknown,
): Promise<{ achou: boolean; status?: string }> {
  const [e] = await db
    .select()
    .from(schema.ifoodEntrega)
    .where(and(eq(schema.ifoodEntrega.ifoodOrderId, orderId), eq(schema.ifoodEntrega.filialId, filialId)))
    .limit(1);
  if (!e) return { achou: false };
  const novo = STATUS_ENTREGA[codigo];
  // Status final não volta atrás (evento atrasado depois do CONCLUDED).
  const status = novo && !FINAIS.includes(e.status) ? novo : e.status;
  await db
    .update(schema.ifoodEntrega)
    .set({
      status,
      statusIfood: codigo,
      atualizadoEm: sql`now()`,
      ...(status === 'CANCELADO' && !e.canceladoEm ? { canceladoEm: sql`now()` } : {}),
    })
    .where(eq(schema.ifoodEntrega.id, e.id));
  if (TROCA_ENDERECO.includes(codigo) && !FINAIS.includes(e.status)) {
    try {
      await trocaDeEndereco(filialId, e, orderId, metadata);
    } catch (err) {
      console.error('[ifood-shipping] troca de endereço:', (err as Error).message);
    }
  }
  // Chegou o PLACED e ainda não confirmamos: confirma agora (a confirmação
  // logo depois de criar pode ter chegado antes do pedido existir no iFood).
  if ((codigo === 'PLACED' || codigo === 'PLC') && e.status === 'SOLICITADO') {
    const c = await credEntrega(filialId);
    if (c.clientId && c.clientSecret) {
      try {
        await confirmarPedido(c, orderId);
        await db.update(schema.ifoodEntrega)
          .set({ status: 'CONFIRMADO', atualizadoEm: sql`now()` })
          .where(eq(schema.ifoodEntrega.id, e.id));
      } catch (err) {
        console.error('[ifood-shipping] confirmar pelo evento:', (err as Error).message);
      }
    }
  }
  return { achou: true, status };
}

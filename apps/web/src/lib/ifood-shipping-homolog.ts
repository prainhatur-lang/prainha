// Homologação do Shipping (entregador do iFood) com o app e a loja de TESTE.
//
// Em produção os eventos do pedido chegam pelo puxador da nuvem, que só olha
// a credencial dos pedidos. O app de teste tem fila própria — ninguém puxa —,
// então aqui a tela do entregador puxa essa fila ao abrir/atualizar, grava,
// aplica (mesma regra do evento de produção) e dá ack. Também guarda cada
// chamada em ifood_homolog_log: é o arquivo de logs que o chamado pede.
//
// Nada disto roda com o modo homologação do Shipping desligado.

import { db, schema } from '@concilia/db';
import { inArray } from 'drizzle-orm';
import { ifoodApi, IFOOD_ST, type CredIfood } from '@/lib/ifood-api';
import { aplicarEventoEntrega } from '@/lib/ifood-entrega-evento';

interface EventoIfood {
  id?: string;
  code?: string;
  fullCode?: string;
  orderId?: string;
  merchantId?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

/** Último polling por filial: a tela atualiza sozinha e o iFood pede ~30 s
 *  entre pollings. */
const ultimo = new Map<string, number>();
const INTERVALO_MS = 25_000;

export async function puxarEventosShippingHomolog(
  filialId: string,
  c: CredIfood & { merchantId: string },
): Promise<{ eventos: number; pulou?: boolean }> {
  const agora = Date.now();
  if (agora - (ultimo.get(filialId) ?? 0) < INTERVALO_MS) return { eventos: 0, pulou: true };
  ultimo.set(filialId, agora);

  const r = (await ifoodApi(c, '/order/v1.0/events:polling', {
    headers: { 'x-polling-merchants': c.merchantId },
    cru: true,
  })) as Response;
  if (!r.ok && r.status !== 204) throw new Error('polling ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const eventos: EventoIfood[] = r.status === 204 ? [] : await r.json();
  if (!eventos?.length) return { eventos: 0 };

  const paraAck: Array<{ id: string }> = [];
  for (const ev of eventos) {
    if (!ev?.id) continue;
    paraAck.push({ id: ev.id });
    const orderId = String(ev.orderId || '');
    if (!orderId) continue;
    const codigo = IFOOD_ST[ev.code || ''] || ev.code || ev.fullCode || '';
    try {
      // Grava antes do ack. entregueEm já preenchido: nenhuma loja consome
      // evento da loja de teste.
      const inseriu = await db
        .insert(schema.ifoodNuvemEvento)
        .values({
          id: ev.id.slice(0, 80),
          filialId,
          merchantId: String(ev.merchantId || c.merchantId).slice(0, 80),
          orderId: orderId.slice(0, 80),
          codigo: String(codigo).slice(0, 40),
          fullCode: ev.fullCode ? String(ev.fullCode).slice(0, 60) : null,
          ocorridoEm: ev.createdAt ? new Date(ev.createdAt) : null,
          metadata: ev.metadata && typeof ev.metadata === 'object' ? ev.metadata : null,
          entregueEm: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: schema.ifoodNuvemEvento.id });
      if (!inseriu.length) continue; // repetido: só confirma o ack de novo
      await aplicarEventoEntrega(filialId, orderId, String(codigo), ev.metadata);
    } catch (e) {
      console.error('[ifood-shipping-homolog]', codigo, orderId, '—', (e as Error).message);
    }
  }

  for (let t = 1; t <= 3; t++) {
    try {
      await ifoodApi(c, '/order/v1.0/events/acknowledgment', { metodo: 'POST', corpo: paraAck });
      await db
        .update(schema.ifoodNuvemEvento)
        .set({ ackEm: new Date() })
        .where(inArray(schema.ifoodNuvemEvento.id, paraAck.map((a) => a.id)));
      break;
    } catch (e) {
      console.error('[ifood-shipping-homolog] ack ' + t + '/3:', (e as Error).message);
      if (t === 3) throw e;
      await new Promise((res) => setTimeout(res, t * 700));
    }
  }
  return { eventos: paraAck.length };
}

// O puxador único: um ciclo de polling do iFood pela NUVEM, roteando cada
// evento pra filial dona do merchant.
//
// Por que existe: a fila de eventos do iFood é por CREDENCIAL (device), não
// por loja. As três casas estão no mesmo app homologado (Concilia PDV
// Central), então se cada máquina puxasse com o mesmo client_id elas
// dividiriam a fila e sumiria pedido — foi o que aconteceu em ago/2026 com a
// Prainha Mar. Aqui quem puxa é UM só, e o `x-polling-merchants` traz os
// merchants de todas as casas do grupo de uma vez.
//
// Regras que não se quebra:
//  1. PERSISTE PRIMEIRO, ACK DEPOIS. Morrendo no meio, o iFood reentrega e o
//     PK impede duplicar.
//  2. ACK EM 100% DOS EVENTOS RECEBIDOS, inclusive os que falharem ao gravar.
//     O Firefly Audit reprova a homologação quando falta ack (custou o ponto
//     em 25/08/2026). Quem garante que o pedido não some é a nossa fila, não a
//     reentrega do iFood.
//  3. UM CONSUMIDOR SÓ por client_id (lease). Duas invocações do cron ao mesmo
//     tempo repetiriam exatamente o erro que este desenho existe pra evitar.
//  4. Grupo com casa em `puxador: loja` NÃO é puxado. Metade na loja e metade
//     na nuvem é o mesmo que duas máquinas puxando: divide a fila.

import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { configsIfoodTodas } from '@/lib/ifood-credenciais';
import { ifoodApi, IFOOD_ST, type CredIfood } from '@/lib/ifood-api';

/** Quanto tempo a trava vale. Menor que o maxDuration da rota: invocação que
 *  morre sem soltar a trava não pode travar o próximo minuto inteiro. */
const LEASE_SEGUNDOS = 50;

export interface ResumoGrupo {
  clientId: string;
  merchants: number;
  eventos: number;
  pedidos: number;
  pulado?: string;
  erro?: string;
}

interface EventoIfood {
  id?: string;
  code?: string;
  fullCode?: string;
  orderId?: string;
  merchantId?: string;
  createdAt?: string;
}

/** Pega a trava do client_id. `false` = outra invocação está puxando agora. */
async function pegarLease(chave: string, dono: string): Promise<boolean> {
  const r = await db.execute(sql`
    INSERT INTO ifood_nuvem_lease (chave, dono, expira_em)
    VALUES (${chave}, ${dono}, now() + interval '${sql.raw(String(LEASE_SEGUNDOS))} seconds')
    ON CONFLICT (chave) DO UPDATE
      SET dono = EXCLUDED.dono, expira_em = EXCLUDED.expira_em
      WHERE ifood_nuvem_lease.expira_em < now()
    RETURNING chave
  `);
  return (r as unknown as unknown[]).length > 0;
}

async function anotarLease(chave: string, campos: { ok?: boolean; erro?: string | null; eventos?: number }) {
  await db.execute(sql`
    UPDATE ifood_nuvem_lease SET
      ultimo_ok = ${campos.ok ? sql`now()` : sql`ultimo_ok`},
      ultimo_erro = ${campos.erro ?? null},
      eventos = eventos + ${campos.eventos ?? 0}
    WHERE chave = ${chave}
  `);
}

/** Baixa o pedido inteiro e guarda o payload — a loja lê daqui e não precisa
 *  falar com o iFood. Já baixado não baixa de novo. */
async function baixarPedido(cred: CredIfood, orderId: string, filialId: string | null, merchantId: string) {
  const [ja] = await db
    .select({ orderId: schema.ifoodNuvemPedido.orderId })
    .from(schema.ifoodNuvemPedido)
    .where(eq(schema.ifoodNuvemPedido.orderId, orderId))
    .limit(1);
  if (ja) return false;

  const o = (await ifoodApi(cred, '/order/v1.0/orders/' + encodeURIComponent(orderId))) as Record<string, unknown>;
  await db
    .insert(schema.ifoodNuvemPedido)
    .values({
      orderId,
      filialId,
      merchantId: String((o.merchant as { id?: string } | undefined)?.id || merchantId).slice(0, 80),
      displayId: o.displayId ? String(o.displayId).slice(0, 20) : null,
      payload: o,
    })
    .onConflictDoNothing();
  return true;
}

/** Um ciclo de polling de UM grupo de credencial. */
async function ciclarGrupo(
  clientId: string,
  cred: CredIfood,
  porMerchant: Map<string, string>,
): Promise<{ eventos: number; pedidos: number }> {
  // O filtro aceita até 100 merchants. Três casas cabem folgado.
  const merchants = [...porMerchant.keys()].slice(0, 100);
  const r = (await ifoodApi(cred, '/order/v1.0/events:polling', {
    headers: merchants.length ? { 'x-polling-merchants': merchants.join(',') } : {},
    cru: true,
  })) as Response;
  if (!r.ok && r.status !== 204) {
    throw new Error('polling ' + r.status + ': ' + (await r.text()).slice(0, 200));
  }
  // 204 = nada novo, e é o caso NORMAL.
  const eventos: EventoIfood[] = r.status === 204 ? [] : await r.json();
  if (!eventos?.length) return { eventos: 0, pedidos: 0 };

  const paraAck: Array<{ id: string }> = [];
  let pedidos = 0;
  for (const ev of eventos) {
    if (!ev?.id) continue;
    paraAck.push({ id: ev.id }); // TODO evento recebido é ackeado — ver nota 2
    const orderId = String(ev.orderId || '');
    const merchantId = String(ev.merchantId || '');
    if (!orderId) continue;
    const codigo = IFOOD_ST[ev.code || ''] || ev.code || ev.fullCode || '';
    // Merchant sem credencial cadastrada: grava com filial NULL e segue. Não
    // dá pra travar a fila por causa de uma loja que ninguém configurou —
    // mas também não pode sumir, então fica visível na tabela.
    const filialId = porMerchant.get(merchantId) ?? null;

    try {
      // PERSISTE PRIMEIRO, ack DEPOIS (nota 1).
      const inseriu = await db
        .insert(schema.ifoodNuvemEvento)
        .values({
          id: ev.id.slice(0, 80),
          filialId,
          merchantId: merchantId.slice(0, 80),
          orderId: orderId.slice(0, 80),
          codigo: String(codigo).slice(0, 40),
          fullCode: ev.fullCode ? String(ev.fullCode).slice(0, 60) : null,
          ocorridoEm: ev.createdAt ? new Date(ev.createdAt) : null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.ifoodNuvemEvento.id });
      if (!inseriu.length) continue; // já tratado num ciclo anterior

      if (await baixarPedido(cred, orderId, filialId, merchantId)) pedidos++;
    } catch (e) {
      // O ack vai do mesmo jeito (nota 2). O evento fica sem `ack_em` e sem
      // pedido baixado; o próximo ciclo tenta de novo pelo reprocesso.
      console.error('[ifood-puxador]', codigo, orderId, '—', (e as Error).message);
    }
  }

  if (paraAck.length) {
    // O ack é o que a auditoria conta. Insiste antes de desistir; falhando,
    // o iFood reentrega e o PK confirma de novo no ciclo seguinte.
    for (let t = 1; t <= 3; t++) {
      try {
        await ifoodApi(cred, '/order/v1.0/events/acknowledgment', { metodo: 'POST', corpo: paraAck });
        await db
          .update(schema.ifoodNuvemEvento)
          .set({ ackEm: new Date() })
          .where(inArray(schema.ifoodNuvemEvento.id, paraAck.map((a) => a.id)));
        break;
      } catch (e) {
        console.error('[ifood-puxador] ack ' + t + '/3:', (e as Error).message);
        if (t === 3) throw e;
        await new Promise((res) => setTimeout(res, t * 700));
      }
    }
  }
  return { eventos: paraAck.length, pedidos };
}

/** Reprocessa o que ficou pra trás: evento gravado cujo pedido não baixou. */
async function repescarPedidos(cred: CredIfood, porMerchant: Map<string, string>): Promise<number> {
  const pendentes = await db.execute(sql`
    SELECT e.order_id, e.merchant_id, e.filial_id
      FROM ifood_nuvem_evento e
      LEFT JOIN ifood_nuvem_pedido p ON p.order_id = e.order_id
     WHERE p.order_id IS NULL
       AND e.criado_em > now() - interval '2 days'
       AND e.merchant_id = ANY(${sql`ARRAY[${sql.join([...porMerchant.keys()].map((m) => sql`${m}`), sql`, `)}]::text[]`})
     GROUP BY e.order_id, e.merchant_id, e.filial_id
     LIMIT 10
  `);
  let n = 0;
  for (const linha of pendentes as unknown as Array<{ order_id: string; merchant_id: string; filial_id: string | null }>) {
    try {
      if (await baixarPedido(cred, linha.order_id, linha.filial_id, linha.merchant_id)) n++;
    } catch (e) {
      console.error('[ifood-puxador] repesca', linha.order_id, '—', (e as Error).message);
    }
  }
  return n;
}

/** Um ciclo completo: todos os grupos de credencial que estão em `nuvem`. */
export async function cicloPuxador(dono: string): Promise<ResumoGrupo[]> {
  const todas = await configsIfoodTodas();
  const ativas = todas.filter((c) => c.ativo && c.clientId && c.clientSecret && c.merchantId);

  const grupos = new Map<string, typeof ativas>();
  for (const c of ativas) {
    grupos.set(c.clientId, [...(grupos.get(c.clientId) ?? []), c]);
  }

  const resumo: ResumoGrupo[] = [];
  for (const [clientId, casas] of grupos) {
    const naNuvem = casas.filter((c) => c.puxador === 'nuvem');
    if (!naNuvem.length) continue; // grupo inteiro puxa na loja: não é problema nosso
    if (naNuvem.length !== casas.length) {
      // Regra 4: metade na loja e metade na nuvem divide a fila. Melhor não
      // puxar nada e gritar do que puxar e sumir pedido da outra casa.
      const msg = 'grupo misto: ' + casas.filter((c) => c.puxador === 'loja').length + ' casa(s) ainda em puxador=loja';
      resumo.push({ clientId, merchants: casas.length, eventos: 0, pedidos: 0, pulado: msg });
      continue;
    }

    if (!(await pegarLease(clientId, dono))) {
      resumo.push({ clientId, merchants: casas.length, eventos: 0, pedidos: 0, pulado: 'outra invocação está puxando' });
      continue;
    }

    const cred: CredIfood = { clientId, clientSecret: naNuvem[0].clientSecret };
    const porMerchant = new Map(naNuvem.map((c) => [c.merchantId, c.filialId]));
    try {
      const { eventos, pedidos } = await ciclarGrupo(clientId, cred, porMerchant);
      const repescados = await repescarPedidos(cred, porMerchant);
      await anotarLease(clientId, { ok: true, erro: null, eventos });
      resumo.push({ clientId, merchants: porMerchant.size, eventos, pedidos: pedidos + repescados });
    } catch (e) {
      const erro = String((e as Error).message).slice(0, 300);
      await anotarLease(clientId, { erro });
      resumo.push({ clientId, merchants: porMerchant.size, eventos: 0, pedidos: 0, erro });
    }
  }
  return resumo;
}

/** Solta a trava antes da hora: o próximo minuto não espera o lease vencer. */
export async function soltarLeases(dono: string) {
  await db.execute(sql`UPDATE ifood_nuvem_lease SET expira_em = now() WHERE dono = ${dono}`);
}

/** Marca eventos como entregues pra loja. */
export async function marcarEntregues(filialId: string, ids: string[]) {
  if (!ids.length) return;
  await db
    .update(schema.ifoodNuvemEvento)
    .set({ entregueEm: new Date() })
    .where(and(
      eq(schema.ifoodNuvemEvento.filialId, filialId),
      inArray(schema.ifoodNuvemEvento.id, ids.slice(0, 200)),
    ));
}

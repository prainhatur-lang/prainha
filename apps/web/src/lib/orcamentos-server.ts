// Helpers server-side do módulo de orçamentos.

import { db, schema } from '@concilia/db';
import { eq, inArray, sql } from 'drizzle-orm';
import type { LocalOpt } from '@/lib/orcamentos';

/**
 * Monta as opções de local do evento: cada filial acessível + os ambientes
 * marcados somenteEventos na reservaConfig dela (ex: Terraço no Prainha Bar).
 * Hoje dá 4 opções: Prainha Bar, Terraço, Prainha Mar e Tabuará.
 */
export async function montarLocaisEvento(
  filiais: Array<{ id: string; nome: string }>,
): Promise<LocalOpt[]> {
  if (filiais.length === 0) return [];
  const configs = await db
    .select({ id: schema.filial.id, reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(inArray(schema.filial.id, filiais.map((f) => f.id)));
  const areasPorFilial = new Map(configs.map((c) => [c.id, c.reservaConfig?.areas ?? []]));

  const locais: LocalOpt[] = [];
  for (const f of filiais) {
    locais.push({ filialId: f.id, local: null, label: f.nome });
    for (const a of areasPorFilial.get(f.id) ?? []) {
      if (a.somenteEventos) {
        locais.push({ filialId: f.id, local: a.nome, label: `${a.nome} (${f.nome})` });
      }
    }
  }
  return locais;
}

/**
 * Marca a entrada do orçamento como paga (Pix Cielo confirmado). Pagar a
 * entrada VALE como aceite: registra o aceite se ainda não tinha e muda o
 * status pra 'aceito'. Idempotente. Usada pelo polling público e pelo
 * webhook da Cielo.
 */
export async function marcarOrcamentoEntradaPaga(orcamentoId: string): Promise<void> {
  const [o] = await db
    .select()
    .from(schema.orcamentoEvento)
    .where(eq(schema.orcamentoEvento.id, orcamentoId))
    .limit(1);
  if (!o || o.pagamentoStatus === 'pago') return;

  await db
    .update(schema.orcamentoEvento)
    .set({
      pagamentoStatus: 'pago',
      pagoEm: new Date(),
      status: 'aceito',
      aceiteEm: o.aceiteEm ?? new Date(),
      aceiteNome: o.aceiteNome ?? o.clienteNome,
      atualizadoEm: sql`now()`,
    })
    .where(eq(schema.orcamentoEvento.id, orcamentoId));
}

/**
 * ENTRADA PAGA = DATA FECHADA (regra do Elison, 16/08). O espaço de evento é
 * um só: quando alguém paga a entrada, aquele espaço naquele dia sai do
 * mercado. Devolve o orçamento que já segurou a data, ou null.
 *
 * O campo `local` é texto livre ("Terraço (Prainha Bar) + Varandinha"), então
 * a comparação é pela primeira palavra do espaço — que é o que distingue
 * Terraço de Gramado, Tablado e das casas inteiras.
 */
export async function eventoQueSeguraData(params: {
  filialId: string;
  local: string;
  data: string; // YYYY-MM-DD
  ignorarId?: string;
}): Promise<{ id: string; numero: number; clienteNome: string } | null> {
  const chave = (params.local || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .trim()
    .split(/\s+/)[0];
  if (!chave) return null;

  const rows = await db
    .select({
      id: schema.orcamentoEvento.id,
      numero: schema.orcamentoEvento.numero,
      clienteNome: schema.orcamentoEvento.clienteNome,
      local: schema.orcamentoEvento.local,
    })
    .from(schema.orcamentoEvento)
    .where(
      sql`${schema.orcamentoEvento.filialId} = ${params.filialId}
          AND ${schema.orcamentoEvento.dataEvento} = ${params.data}::date
          AND ${schema.orcamentoEvento.pagamentoStatus} = 'pago'
          ${params.ignorarId ? sql`AND ${schema.orcamentoEvento.id} <> ${params.ignorarId}` : sql``}`,
    );

  const bate = rows.find((r) =>
    (r.local ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .includes(chave),
  );
  return bate ? { id: bate.id, numero: bate.numero, clienteNome: bate.clienteNome } : null;
}

/** Datas já fechadas por entrada paga, daqui pra frente (pra não oferecer). */
export async function datasFechadasPorEntrada(filialId: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT data_evento::text AS d
    FROM orcamento_evento
    WHERE filial_id = ${filialId}
      AND pagamento_status = 'pago'
      AND data_evento >= (now() AT TIME ZONE 'America/Maceio')::date
    ORDER BY d
    LIMIT 60
  `)) as unknown as Array<{ d: string }>;
  return rows.map((r) => r.d);
}

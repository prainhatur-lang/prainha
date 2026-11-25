// Helpers server-side do módulo de orçamentos.

import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { calcularTotais, type LocalOpt } from '@/lib/orcamentos';

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
  // Tabuará "Mesas reservadas sem fechar": não fecha espaço — vários grupos de
  // mesas cabem no mesmo dia (a casa toda paga já é barrada no orçamento).
  if (/sem fechar/i.test(params.local)) return null;

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

/** O que já entrou de um orçamento de evento e quanto falta. */
export interface RecebimentosOrcamento {
  /** Total do orçamento. Null = a combinar (sem valor por pessoa nem taxas). */
  total: number | null;
  /** Entrada paga por Pix pelo link de aceite (0 se não pagou). */
  entradaPaga: number;
  entradaPagaEm: string | null;
  /** Links de cartão pagos, do mais antigo pro mais novo. */
  cartoes: Array<{ numero: number; valor: number; pagoEm: string | null; bandeira: string | null; cartaoFinal: string | null }>;
  recebido: number;
  /** total − recebido (nunca negativo). Null quando o total é a combinar. */
  saldo: number | null;
}

/**
 * Recebido × saldo do orçamento (dono 25/11/2026): a entrada paga por Pix +
 * cada link de cartão PAGO ligado ao orçamento. O link pago é a própria baixa:
 * aprovou no cartão, já conta aqui — ninguém lança nada à mão.
 */
export async function recebimentosDoOrcamento(
  o: typeof schema.orcamentoEvento.$inferSelect,
): Promise<RecebimentosOrcamento> {
  const num = (v: string | null) => (v == null ? null : Number(v));
  const { total } = calcularTotais({
    pessoas: o.pessoas,
    valorPessoa: num(o.valorPessoa),
    taxaEspaco: num(o.taxaEspaco),
    taxaExclusividade: num(o.taxaExclusividade),
    descontoEspaco: num(o.descontoEspaco),
  });
  const entradaPaga = o.pagamentoStatus === 'pago' ? Number(o.entradaValor ?? 0) : 0;
  const links = await db
    .select({
      numero: schema.linkPagamento.numero,
      valor: schema.linkPagamento.valor,
      pagoEm: schema.linkPagamento.pagoEm,
      bandeira: schema.linkPagamento.bandeira,
      cartaoFinal: schema.linkPagamento.cartaoFinal,
    })
    .from(schema.linkPagamento)
    .where(and(eq(schema.linkPagamento.orcamentoId, o.id), eq(schema.linkPagamento.status, 'pago')))
    .orderBy(schema.linkPagamento.pagoEm);
  const cartoes = links.map((l) => ({
    numero: l.numero,
    valor: Number(l.valor),
    pagoEm: l.pagoEm ? l.pagoEm.toISOString() : null,
    bandeira: l.bandeira,
    cartaoFinal: l.cartaoFinal,
  }));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const recebido = r2(entradaPaga + cartoes.reduce((s, c) => s + c.valor, 0));
  return {
    total: total == null ? null : r2(total),
    entradaPaga,
    entradaPagaEm: entradaPaga > 0 && o.pagoEm ? o.pagoEm.toISOString() : null,
    cartoes,
    recebido,
    saldo: total == null ? null : Math.max(r2(total - recebido), 0),
  };
}

/**
 * Link de cartão do orçamento aprovado: pagar VALE como aceite (igual à
 * entrada por Pix). Não mexe em pagamentoStatus — esse campo é só da entrada
 * por Pix; o recebido do cartão sai do próprio link pago.
 */
export async function registrarCartaoNoOrcamento(orcamentoId: string): Promise<void> {
  const [o] = await db
    .select()
    .from(schema.orcamentoEvento)
    .where(eq(schema.orcamentoEvento.id, orcamentoId))
    .limit(1);
  if (!o) return;
  await db
    .update(schema.orcamentoEvento)
    .set({
      status: 'aceito',
      aceiteEm: o.aceiteEm ?? new Date(),
      aceiteNome: o.aceiteNome ?? o.clienteNome,
      atualizadoEm: sql`now()`,
    })
    .where(eq(schema.orcamentoEvento.id, orcamentoId));
}

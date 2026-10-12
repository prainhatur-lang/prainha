// "Caixa × banco" pra casa que NÃO tem a agenda da Cielo no sistema (hoje a
// Prainha Mar: o EC 3002916694 não vem no extrato eletrônico da Cielo). Sem a
// agenda não dá pra conferir venda a venda, então a conferência é:
//   - Cartão: o que o caixa registrou no dia X × o depósito da Cielo no dia
//     X+1 (ela paga um Pix por dia com o líquido do dia anterior).
//   - Pix: cada crédito de Pix da Cielo no extrato × um pagamento do caixa de
//     valor idêntico (cheio ou já sem a taxa cadastrada), no mesmo dia.
// Pedido do dono em 12/10/2026 ("importa o extrato da Prainha Mar e faz a
// conciliação"). Na dúvida mostra "não achei": não casa valor aproximado.
// Só leitura: não grava nada.

import { db, schema } from '@concilia/db';
import type { TaxasFilial, TaxasPorBandeira } from '@concilia/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { brDateStart, dateToBrYmd, diasAtrasBr, hojeBr } from './datas';

export const DIAS_JANELA_PDV_BANCO = 60;

export type StatusDiaCartao = 'OK' | 'A_MENOS' | 'NADA' | 'SEM_EXTRATO' | 'AGUARDANDO';

export interface DiaCartao {
  /** dia da venda (calendário, BRT) */
  data: string;
  qtd: number;
  bruto: number;
  /** bruto menos a taxa cadastrada (à vista; o caixa não sabe o parcelamento) */
  previsto: number;
  /** dia em que a Cielo deposita (venda + 1) */
  depositoEm: string;
  deposito: number | null;
  status: StatusDiaCartao;
  /** previsto − depósito, quando faltou */
  falta: number;
}

export interface PdvBanco {
  desde: string;
  ate: string;
  /** a casa não tem EC cadastrado: a prevista usou a taxa padrão */
  semEcCadastrado: boolean;
  cartao: {
    dias: DiaCartao[];
    /** só dias já conferidos (OK, A_MENOS, NADA) */
    bruto: number;
    previsto: number;
    depositado: number;
    /** soma do que faltou nos dias A_MENOS e NADA */
    falta: number;
    faltaNada: number;
    faltaAMenos: number;
  };
  pix: {
    /** pagamentos em Pix no caixa */
    vendidoQtd: number;
    vendido: number;
    /** créditos de Pix da Cielo no extrato */
    creditoQtd: number;
    credito: number;
    /** Pix do caixa sem crédito de valor idêntico */
    semCredito: Array<{ data: string; hora: string; valor: number }>;
    semCreditoValor: number;
    /** crédito de Pix cujo pagamento no caixa está lançado como cartão */
    comoCartao: { qtd: number; valor: number };
    /** crédito de Pix sem nenhum pagamento de valor idêntico no caixa */
    semVenda: Array<{ data: string; valor: number }>;
    semVendaValor: number;
  };
}

const semAcento = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
const r2 = (n: number) => +n.toFixed(2);
const maisDias = (ymd: string, n: number) =>
  dateToBrYmd(new Date(brDateStart(ymd).getTime() + n * 86400000 + 12 * 3600000));

type Forma = 'PIX' | 'CREDITO' | 'DEBITO';
function formaDe(f: string | null): Forma | null {
  const s = semAcento(f);
  if (s.includes('pix')) return 'PIX';
  if (s.includes('credito')) return 'CREDITO';
  if (s.includes('debito')) return 'DEBITO';
  return null;
}

function taxaPct(t: TaxasPorBandeira | undefined, forma: Forma, bandeira: string | null): number {
  if (!t) return 0;
  if (forma === 'PIX') return Number(t.pix ?? 0);
  let b = semAcento(bandeira);
  // "PREPAGO VISA" é cartão pré-pago: a Cielo cobra como débito da bandeira
  const prepago = b.startsWith('prepago');
  b = b.replace('prepago', '').trim();
  if (b === 'master') b = 'mastercard';
  const tab = forma === 'DEBITO' || prepago ? t.debito : t.credito_a_vista;
  // caixa sem bandeira: usa a da Visa (a mais comum)
  const v = tab?.[b] ?? tab?.visa ?? tab?.mastercard;
  return v != null ? Number(v) : 0;
}

/** Null quando a conferência não se aplica: a casa tem a agenda da Cielo (aí
 *  valem os quadros de sempre) ou não tem depósito da Cielo no extrato. */
export async function pdvContraBanco(
  filialId: string,
  /** só pra ensaio fora da tela */
  taxasEnsaio?: TaxasFilial,
): Promise<PdvBanco | null> {
  const desde = diasAtrasBr(DIAS_JANELA_PDV_BANCO);
  const hoje = hojeBr();

  const [[fil], [temAgenda], lancs] = await Promise.all([
    db.select({ taxas: schema.filial.taxas }).from(schema.filial).where(eq(schema.filial.id, filialId)).limit(1),
    db
      .select({ id: schema.recebivelAdquirente.id })
      .from(schema.recebivelAdquirente)
      .where(
        and(
          eq(schema.recebivelAdquirente.filialId, filialId),
          gte(schema.recebivelAdquirente.dataPagamento, desde),
        ),
      )
      .limit(1),
    db
      .select({
        id: schema.lancamentoBanco.id,
        data: schema.lancamentoBanco.dataMovimento,
        tipo: schema.lancamentoBanco.tipo,
        valor: schema.lancamentoBanco.valor,
        descricao: schema.lancamentoBanco.descricao,
      })
      .from(schema.lancamentoBanco)
      .where(and(eq(schema.lancamentoBanco.filialId, filialId), gte(schema.lancamentoBanco.dataMovimento, desde))),
  ]);
  if (temAgenda) return null;

  // Depósito de cartão: "…CIELO S.A - INSTITUICAO DE PAGAMENTO", um por dia.
  // Pix da maquininha: um crédito por venda, vindo do banco da Cielo (ISPB
  // 01027058) em nome da própria empresa. Os de R$ 0,01 são teste de chave.
  const depositoDia = new Map<string, number>();
  const creditosPix: Array<{ id: string; data: string; valor: number }> = [];
  for (const l of lancs) {
    if (l.tipo !== 'C') continue;
    const d = l.descricao ?? '';
    const v = Number(l.valor);
    if (/cielo s\.?a/i.test(d)) depositoDia.set(l.data, (depositoDia.get(l.data) ?? 0) + v);
    else if (d.includes('01027058') && v > 0.05) creditosPix.push({ id: l.id, data: l.data, valor: v });
  }
  if (depositoDia.size === 0 && creditosPix.length === 0) return null;
  const diasComExtrato = new Set(lancs.map((l) => l.data));

  const pags = await db
    .select({
      id: schema.pagamento.id,
      forma: schema.pagamento.formaPagamento,
      valor: schema.pagamento.valor,
      quando: schema.pagamento.dataPagamento,
      bandeira: schema.pagamento.bandeiraMfe,
    })
    .from(schema.pagamento)
    .where(
      and(
        eq(schema.pagamento.filialId, filialId),
        gte(schema.pagamento.dataPagamento, brDateStart(desde)),
        sql`${schema.pagamento.valor} > 0`,
      ),
    );

  const taxas = taxasEnsaio ?? (fil?.taxas as TaxasFilial | null) ?? null;
  const umEc = taxas?.ecs?.length === 1 ? taxas.ecs[0] : undefined;
  const t: TaxasPorBandeira | undefined = umEc ?? taxas?.default ?? undefined;
  const taxasPix = [...new Set([0, ...(taxas?.ecs ?? []).map((e) => Number(e.pix)), Number(taxas?.default?.pix ?? 0)])];

  const vendas = pags.flatMap((p) => {
    const forma = formaDe(p.forma);
    if (!forma || !p.quando) return [];
    const br = new Date(p.quando.getTime() - 3 * 3600 * 1000).toISOString();
    return [{ id: p.id, forma, valor: Number(p.valor), data: br.slice(0, 10), hora: br.slice(11, 16), bandeira: p.bandeira }];
  });

  // ---- Pix: crédito × pagamento de valor idêntico (cheio ou sem a taxa) ----
  const usado = new Set<string>();
  const batePix = (credito: number, bruto: number) =>
    taxasPix.some((tx) => Math.abs(r2(bruto * (1 - tx / 100)) - credito) <= 0.011);
  const comoCartao = { qtd: 0, valor: 0 };
  const semVenda: Array<{ data: string; valor: number }> = [];
  // primeiro quem está como Pix no caixa no mesmo dia; depois dia vizinho
  // (venda de madrugada); por último pagamento lançado como cartão.
  const passos: Array<(c: { data: string }, v: (typeof vendas)[number]) => boolean> = [
    (c, v) => v.forma === 'PIX' && v.data === c.data,
    (c, v) => v.forma === 'PIX' && (v.data === maisDias(c.data, -1) || v.data === maisDias(c.data, 1)),
    (c, v) => v.forma !== 'PIX' && v.data === c.data,
  ];
  const casado = new Set<string>();
  passos.forEach((passo, i) => {
    for (const c of creditosPix) {
      if (casado.has(c.id)) continue;
      const v = vendas.find((x) => !usado.has(x.id) && passo(c, x) && batePix(c.valor, x.valor));
      if (!v) continue;
      usado.add(v.id);
      casado.add(c.id);
      if (i === 2) {
        comoCartao.qtd += 1;
        comoCartao.valor += v.valor;
      }
    }
  });
  for (const c of creditosPix) if (!casado.has(c.id)) semVenda.push({ data: c.data, valor: c.valor });

  const ontem = diasAtrasBr(1);
  const pixCaixa = vendas.filter((v) => v.forma === 'PIX');
  const semCredito = pixCaixa
    // o de hoje pode ainda não estar no extrato
    .filter((v) => !usado.has(v.id) && v.data <= ontem && diasComExtrato.has(v.data))
    .map((v) => ({ data: v.data, hora: v.hora, valor: v.valor }))
    .sort((a, b) => b.data.localeCompare(a.data) || b.hora.localeCompare(a.hora));

  // ---- Cartão: caixa do dia X × depósito da Cielo em X+1 ----
  const porDia = new Map<string, { qtd: number; bruto: number; previsto: number }>();
  for (const v of vendas) {
    if (v.forma === 'PIX' || usado.has(v.id)) continue; // usado = era Pix
    const d = porDia.get(v.data) ?? { qtd: 0, bruto: 0, previsto: 0 };
    d.qtd += 1;
    d.bruto += v.valor;
    d.previsto += v.valor * (1 - taxaPct(t, v.forma, v.bandeira) / 100);
    porDia.set(v.data, d);
  }
  for (const dep of depositoDia.keys()) {
    const venda = maisDias(dep, -1);
    if (venda >= desde && !porDia.has(venda)) porDia.set(venda, { qtd: 0, bruto: 0, previsto: 0 });
  }

  const dias: DiaCartao[] = [...porDia.entries()]
    .filter(([data]) => data < hoje)
    .map(([data, d]): DiaCartao => {
      const depositoEm = maisDias(data, 1);
      const dep = depositoDia.get(depositoEm);
      const previsto = r2(d.previsto);
      const base = { data, qtd: d.qtd, bruto: r2(d.bruto), previsto, depositoEm };
      if (dep == null) {
        // sem depósito: só é falta se o extrato daquele dia está carregado e o dia já acabou
        if (depositoEm >= hoje) return { ...base, deposito: null, status: 'AGUARDANDO', falta: 0 };
        if (!diasComExtrato.has(depositoEm)) return { ...base, deposito: null, status: 'SEM_EXTRATO', falta: 0 };
        return { ...base, deposito: null, status: 'NADA', falta: previsto };
      }
      const falta = r2(previsto - dep);
      // folga: parcelado e bandeira que o caixa não informa custam mais que a taxa à vista
      const aMenos = falta > Math.max(20, d.bruto * 0.01);
      return { ...base, deposito: r2(dep), status: aMenos ? 'A_MENOS' : 'OK', falta: aMenos ? falta : 0 };
    })
    .sort((a, b) => b.data.localeCompare(a.data));

  const conferidos = dias.filter((d) => d.status === 'OK' || d.status === 'A_MENOS' || d.status === 'NADA');
  const soma = (xs: DiaCartao[], f: (d: DiaCartao) => number) => r2(xs.reduce((s, d) => s + f(d), 0));

  return {
    desde,
    ate: ontem,
    semEcCadastrado: !umEc,
    cartao: {
      dias,
      bruto: soma(conferidos, (d) => d.bruto),
      previsto: soma(conferidos, (d) => d.previsto),
      depositado: soma(conferidos, (d) => d.deposito ?? 0),
      falta: soma(conferidos, (d) => d.falta),
      faltaNada: soma(conferidos.filter((d) => d.status === 'NADA'), (d) => d.falta),
      faltaAMenos: soma(conferidos.filter((d) => d.status === 'A_MENOS'), (d) => d.falta),
    },
    pix: {
      vendidoQtd: pixCaixa.length,
      vendido: r2(pixCaixa.reduce((s, v) => s + v.valor, 0)),
      creditoQtd: creditosPix.length,
      credito: r2(creditosPix.reduce((s, c) => s + c.valor, 0)),
      semCredito,
      semCreditoValor: r2(semCredito.reduce((s, v) => s + v.valor, 0)),
      comoCartao: { qtd: comoCartao.qtd, valor: r2(comoCartao.valor) },
      semVenda: semVenda.sort((a, b) => b.data.localeCompare(a.data)),
      semVendaValor: r2(semVenda.reduce((s, c) => s + c.valor, 0)),
    },
  };
}

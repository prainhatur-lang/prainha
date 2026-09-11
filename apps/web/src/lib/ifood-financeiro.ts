// Módulo FINANCEIRO do iFood na nuvem: quanto o iFood realmente vai repassar.
//
// Até aqui o Concilia só sabia o valor BRUTO do pedido (é o que o pedido traz).
// A conta a receber de canal nascia com esse bruto e a baixa era na mão — o
// financeiro batia o repasse que caiu no banco contra um bolo de lançamentos,
// sem saber quanto DEVERIA cair. É esse buraco que aqui se fecha.
//
// Três leituras, três perguntas diferentes:
//
//   vendasIfood      (v2.1)  "deste pedido, quanto sobra pra casa?"
//                            comissão, taxa do cartão, entrega, promoção —
//                            item por item, com a data prevista do repasse.
//   repassesIfood    (v3.0)  "o que caiu (ou vai cair) no banco, e quando?"
//                            é o que se bate contra o extrato.
//   eventosIfood     (v3.0)  "por que o repasse veio menor?"
//                            taxa de serviço, ocorrência, cancelamento…
//
// ⚠️ Este módulo é separado no Portal do Desenvolvedor. Enquanto não estiver
// liberado, toda chamada volta 403 — a rota traduz isso em recado de tela, e
// não em erro de sistema.

import { ifoodApi, type CredIfood } from '@/lib/ifood-api';

const V21 = '/financial/v2.1/merchants/';
const V3 = '/financial/v3.0/merchants/';

/** Número que pode vir string ('-0.99') ou number, e pode não vir. */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function txt(v: unknown): string {
  return v == null ? '' : String(v);
}

export interface VendaIfood {
  orderId: string;
  displayId: string;
  /** yyyy-mm-dd do pedido (orderDate). */
  data: string;
  dataHora: string;
  status: string;
  /** Período de fechamento do iFood — é por ele que o repasse é agrupado. */
  periodId: string;
  /** ONLINE = iFood cobrou e vai repassar. OFFLINE = cliente pagou na entrega,
   *  então NÃO entra em repasse nenhum (o dinheiro já está na casa). */
  tipoPagamento: string;
  metodo: string;
  bandeira: string;
  /** totalBag + deliveryFee. */
  bruto: number;
  itens: number;
  taxaEntrega: number;
  comissao: number;
  taxaCartao: number;
  comissaoEntrega: number;
  taxaAntecipacao: number;
  promoIfood: number;
  promoLoja: number;
  totalDebito: number;
  totalCredito: number;
  /** O que sobra: crédito − débito. Mostramos as duas pontas na tela de
   *  propósito — é assim que se confere a conta contra o Portal no primeiro
   *  fechamento, em vez de confiar num número derivado. */
  liquido: number;
  repasseEm: string;
  entregaPor: string;
}

/** Vendas (conciliação por pedido) num intervalo de DATA DO PEDIDO.
 *
 *  A resposta documentada é um objeto só, mas o endpoint devolve a lista do
 *  período; aceitamos as três formas que a API já mostrou (array cru, objeto
 *  único, envelope com `sales`) pra uma mudança de formato não derrubar a tela. */
export async function vendasIfood(
  c: CredIfood,
  merchantId: string,
  de: string,
  ate: string,
): Promise<VendaIfood[]> {
  const q = new URLSearchParams({ beginOrderDate: de, endOrderDate: ate });
  const r = (await ifoodApi(c, V21 + merchantId + '/sales?' + q.toString(), { timeoutMs: 60000 })) as unknown;
  const lista: Record<string, unknown>[] = Array.isArray(r)
    ? (r as Record<string, unknown>[])
    : Array.isArray((r as { sales?: unknown })?.sales)
      ? ((r as { sales: Record<string, unknown>[] }).sales)
      : r && typeof r === 'object' && 'orderDate' in (r as object)
        ? [r as Record<string, unknown>]
        : [];

  return lista.map((s) => {
    const b = (s.billing ?? {}) as Record<string, unknown>;
    const p = (s.payment ?? {}) as Record<string, unknown>;
    const t = (s.transfer ?? {}) as Record<string, unknown>;
    const credito = num(b.totalCredit);
    const debito = num(b.totalDebit);
    return {
      orderId: txt(s.orderId),
      displayId: txt(s.displayId),
      data: txt(s.orderDate),
      dataHora: txt(s.orderDateTime),
      status: txt(s.orderStatus),
      periodId: txt(s.periodId),
      tipoPagamento: txt(p.type),
      metodo: txt(p.method),
      bandeira: txt(p.brand),
      bruto: num(b.gmv),
      itens: num(b.totalBag),
      taxaEntrega: num(b.deliveryFee),
      comissao: num(b.commission),
      taxaCartao: num(b.acquirerFee),
      comissaoEntrega: num(b.deliveryCommission),
      taxaAntecipacao: num(b.anticipationFee),
      promoIfood: num(b.benefitIfood),
      promoLoja: num(b.benefitMerchant),
      totalDebito: debito,
      totalCredito: credito,
      liquido: Number((credito - debito).toFixed(2)),
      repasseEm: txt(t.expectedTransferDate),
      entregaPor: txt(s.deliveryProviderType),
    };
  });
}

export interface RepasseIfood {
  /** Semana de cálculo a que o item pertence. */
  calculoDe: string;
  calculoAte: string;
  id: string;
  tipo: string;
  produto: string;
  valor: number;
  situacao: string;
  transacaoId: string;
  pagoEm: string;
  banco: string;
  conta: string;
}

/** Repasses por DATA DE PAGAMENTO — o que bate com o extrato do banco. */
export async function repassesIfood(
  c: CredIfood,
  merchantId: string,
  de: string,
  ate: string,
): Promise<{ saldo: number; itens: RepasseIfood[] }> {
  const q = new URLSearchParams({ beginPaymentDate: de, endPaymentDate: ate });
  const r = (await ifoodApi(c, V3 + merchantId + '/settlements?' + q.toString(), { timeoutMs: 60000 })) as {
    balance?: unknown;
    settlements?: Array<Record<string, unknown>>;
  };

  const itens: RepasseIfood[] = [];
  for (const s of r?.settlements ?? []) {
    const ci = (s.closingItems ?? []) as Array<Record<string, unknown>>;
    for (const i of ci) {
      const ac = (i.accountDetails ?? {}) as Record<string, unknown>;
      itens.push({
        calculoDe: txt(s.startDateCalculation),
        calculoAte: txt(s.endDateCalculation),
        id: txt(i.id),
        tipo: txt(i.type),
        produto: txt(i.product),
        valor: num(i.amount),
        situacao: txt(i.status),
        transacaoId: txt(i.transactionId),
        pagoEm: txt(i.paymentDate),
        banco: txt(ac.bankName) || txt(ac.bankNumber),
        conta: [txt(ac.branchCode), txt(ac.accountNumber)].filter(Boolean).join('/'),
      });
    }
  }
  itens.sort((a, b) => (a.pagoEm < b.pagoEm ? 1 : a.pagoEm > b.pagoEm ? -1 : 0));
  return { saldo: num(r?.balance), itens };
}

export interface EventoFinanceiroIfood {
  nome: string;
  descricao: string;
  produto: string;
  gatilho: string;
  quando: string;
  competencia: string;
  periodoDe: string;
  periodoAte: string;
  refTipo: string;
  refId: string;
  /** false = é informativo, não muda o que cai no banco. */
  mexeNoRepasse: boolean;
  valor: number;
  baseCalculo: number;
  percentual: string;
  repasseEm: string;
  metodo: string;
}

/** Eventos financeiros — a explicação linha a linha do repasse. Paginado;
 *  puxa até `maxPaginas` pra uma casa movimentada não estourar o timeout da
 *  função serverless. */
export async function eventosIfood(
  c: CredIfood,
  merchantId: string,
  de: string,
  ate: string,
  maxPaginas = 5,
): Promise<{ eventos: EventoFinanceiroIfood[]; temMais: boolean }> {
  const eventos: EventoFinanceiroIfood[] = [];
  let pagina = 1;
  let temMais = false;

  for (; pagina <= maxPaginas; pagina++) {
    const q = new URLSearchParams({ beginDate: de, endDate: ate, page: String(pagina), size: '100' });
    const r = (await ifoodApi(c, V3 + merchantId + '/financial-events?' + q.toString(), { timeoutMs: 60000 })) as {
      hasNextPage?: boolean;
      financialEvents?: Array<Record<string, unknown>>;
    };
    for (const e of r?.financialEvents ?? []) {
      const per = (e.period ?? {}) as Record<string, unknown>;
      const ref = (e.reference ?? {}) as Record<string, unknown>;
      const am = (e.amount ?? {}) as Record<string, unknown>;
      const bi = (e.billing ?? {}) as Record<string, unknown>;
      const se = (e.settlement ?? {}) as Record<string, unknown>;
      const pa = (e.payment ?? {}) as Record<string, unknown>;
      eventos.push({
        nome: txt(e.name),
        descricao: txt(e.description),
        produto: txt(e.product),
        gatilho: txt(e.trigger),
        quando: txt(e.dateTime),
        competencia: txt(e.competence),
        periodoDe: txt(per.beginDate),
        periodoAte: txt(per.endDate),
        refTipo: txt(ref.type),
        refId: txt(ref.id),
        mexeNoRepasse: e.hasTransferImpact === true,
        valor: num(am.value),
        baseCalculo: num(bi.baseValue),
        percentual: txt(bi.feePercentage),
        repasseEm: txt(se.expectedDate),
        metodo: txt(pa.method),
      });
    }
    temMais = r?.hasNextPage === true;
    if (!temMais) break;
  }
  return { eventos, temMais };
}

/** Soma o que interessa num fechamento. `OFFLINE` fica de fora do repasse:
 *  pagamento na entrega já está no caixa da casa, e somar os dois contaria o
 *  mesmo dinheiro duas vezes. */
export function resumoVendas(vendas: VendaIfood[]) {
  const online = vendas.filter((v) => v.tipoPagamento !== 'OFFLINE' && v.status !== 'CANCELLED');
  const soma = (f: (v: VendaIfood) => number) => Number(online.reduce((a, v) => a + f(v), 0).toFixed(2));
  return {
    pedidos: vendas.length,
    pedidosOnline: online.length,
    cancelados: vendas.filter((v) => v.status === 'CANCELLED').length,
    naEntrega: vendas.filter((v) => v.tipoPagamento === 'OFFLINE').length,
    bruto: soma((v) => v.bruto),
    comissao: soma((v) => v.comissao + v.comissaoEntrega),
    taxaCartao: soma((v) => v.taxaCartao),
    promoLoja: soma((v) => v.promoLoja),
    liquido: soma((v) => v.liquido),
  };
}

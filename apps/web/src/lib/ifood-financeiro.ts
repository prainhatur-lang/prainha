// Módulo FINANCEIRO do iFood na nuvem: quanto o iFood realmente vai repassar.
//
// Até aqui o Concilia só sabia o valor BRUTO do pedido (é o que o pedido traz).
// A conta a receber de canal nascia com esse bruto e a baixa era na mão — o
// financeiro batia o repasse que caiu no banco contra um bolo de lançamentos,
// sem saber quanto DEVERIA cair. É esse buraco que aqui se fecha.
//
// Uma leitura por pergunta (todas na API Financial v3.0):
//
//   vendasIfood          "deste pedido, quanto sobra pra casa?"
//   repassesIfood        "o que caiu (ou vai cair) no banco, e quando?"
//   eventosIfood         "por que o repasse veio menor?"
//   antecipacoesIfood    "quanto custou receber antes?"
//   conciliação (CSV)    "o mês fechado, linha a linha" — é o documento que o
//                        iFood usa pra bater tudo; mensal (sai às segundas)
//                        ou sob demanda (D-1, gerado na hora).
//
// ⚠️ A API Financial NÃO existe em app de categoria PDV: precisa de um app de
// categoria Finanças no Portal do Desenvolvedor (ver credFinanceiro). Sem ele
// toda chamada volta 403 — a rota traduz isso em recado de tela.

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { ifoodApi, IfoodErro, type CredIfood } from '@/lib/ifood-api';
import { dateToBrYmd } from '@/lib/datas';

const V3 = '/financial/v3.0/merchants/';

/** Credencial do app do Financeiro. `homologacao` liga o header que o iFood
 *  exige no ambiente de teste da homologação do módulo Financial. */
export type CredFin = CredIfood & { homologacao?: boolean };

function api(c: CredFin, caminho: string, o: Parameters<typeof ifoodApi>[2] = {}) {
  const headers = c.homologacao ? { 'x-request-homologation': 'true', ...(o.headers ?? {}) } : o.headers;
  return ifoodApi(c, caminho, { ...o, headers });
}

type Obj = Record<string, unknown>;

/** Número que pode vir string ('-0.99') ou number, e pode não vir. Aceita o
 *  formato brasileiro ('1.234,56') que aparece no CSV. */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').trim();
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function txt(v: unknown): string {
  return v == null ? '' : String(v);
}
function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}
function lista(v: unknown): Obj[] {
  return Array.isArray(v) ? (v as Obj[]) : [];
}
const r2 = (n: number) => Number(n.toFixed(2));
/** Sem acento e minúsculo — o CSV do iFood vem com "Retenção", "Subsídio"… */
function chave(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/** Aritmética de DATA pura (yyyy-mm-dd), em UTC de propósito: não há hora
 *  nenhuma envolvida, então não há fuso pra errar. */
export function somarDias(ymd: string, n: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / 86400000);
}
/** Parte [de, ate] em pedaços de até `n` dias (contando as duas pontas). */
export function janelas(de: string, ate: string, n: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let ini = de; ini <= ate; ini = somarDias(ini, n)) {
    const fim = somarDias(ini, n - 1);
    out.push([ini, fim < ate ? fim : ate]);
  }
  return out;
}
export function ultimoDiaDoMes(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** 404 do iFood é resposta ("não tem"), não falha, em várias leituras daqui. */
function e404(e: unknown): boolean {
  return e instanceof IfoodErro && e.status === 404;
}

function contaBancaria(ac: Obj) {
  const comDigito = (n: unknown, d: unknown) => [txt(n), txt(d)].filter(Boolean).join('-');
  return {
    banco: [txt(ac.bankNumber), txt(ac.bankName)].filter(Boolean).join(' '),
    agencia: comDigito(ac.branchCode, ac.branchDigit),
    conta: comDigito(ac.accountNumber, ac.accountDigit),
    documento: txt(ac.documentNumber),
  };
}

// ─── Vendas ─────────────────────────────────────────────────────────────────

export interface LancamentoVenda {
  nome: string;
  valor: number;
}

export interface VendaIfood {
  orderId: string;
  displayId: string;
  /** yyyy-mm-dd do pedido, em BRT (createdAt vem em UTC). */
  data: string;
  dataHora: string;
  status: string;
  canal: string;
  /** ONLINE = iFood cobrou e vai repassar. OFFLINE = a casa recebeu direto
   *  (na entrega), então NÃO entra em repasse nenhum. */
  tipoPagamento: 'ONLINE' | 'OFFLINE';
  metodo: string;
  bandeira: string;
  /** Quem recebe o pagamento (`liability`): IFOOD ou MERCHANT. */
  responsavel: string;
  /** Itens + entrega — o que o cliente pagou pela comida. */
  bruto: number;
  itens: number;
  taxaEntrega: number;
  /** Taxa de serviço cobrada do cliente; é do iFood, fica fora do bruto. */
  taxaServico: number;
  promoLoja: number;
  promoIfood: number;
  comissao: number;
  comissaoEntrega: number;
  taxaCartao: number;
  taxaAntecipacao: number;
  /** O resto que o iFood desconta (positivo) ou credita (negativo), de modo
   *  que bruto − taxas − outras = líquido. Inclui a promoção da casa. */
  outras: number;
  /** `billingSummary.saleBalance`: o que o iFood diz que sobra da venda. */
  liquido: number;
  /** A lista crua do iFood — é por ela que se confere o número derivado. */
  lancamentos: LancamentoVenda[];
  entregaPor: string;
}

type ClasseLancamento = 'comissao' | 'comissaoEntrega' | 'taxaCartao' | 'taxaAntecipacao' | 'servico' | 'outras';

function classeLancamento(nome: string): ClasseLancamento {
  const n = nome.toUpperCase();
  if (/ANTICIPATION/.test(n)) return 'taxaAntecipacao';
  if (/DELIVERY/.test(n) && /COMMISSION/.test(n)) return 'comissaoEntrega';
  if (/COMMISSION/.test(n)) return 'comissao';
  // Não casar "PAYMENT" solto: ORDER_PAYMENT é o que o cliente pagou.
  if (/TRANSACTION_FEE|ACQUIRER|CARD_FEE/.test(n)) return 'taxaCartao';
  // Taxa de serviço do cliente: entra no ORDER_PAYMENT e sai aqui, é do iFood.
  if (/SERVICE_FEE/.test(n)) return 'servico';
  return 'outras';
}

function venda(s: Obj): VendaIfood {
  const bruto = obj(s.saleGrossValue);
  const pag = obj(s.payments);
  const metodos = lista(pag.methods);
  const cobranca = obj(s.billingSummary);
  const entrega = obj(s.delivery);
  const criado = txt(s.createdAt);
  const t = Date.parse(criado);

  const lancamentos = lista(cobranca.billingEntries).map((b) => ({ nome: txt(b.name), valor: num(b.value) }));
  // Cobrado = o NEGATIVO do lançamento. O saldo da venda é a soma com sinal
  // (ORDER_PAYMENT e IFOOD_SUBSIDY entram positivos) e estorno (REFUND_*,
  // positivo) abate da própria classe. Taxa em módulo fazia o pagamento do
  // cliente virar "taxa de cartão".
  const cobrado: Record<ClasseLancamento, number> = {
    comissao: 0, comissaoEntrega: 0, taxaCartao: 0, taxaAntecipacao: 0, servico: 0, outras: 0,
  };
  for (const l of lancamentos) cobrado[classeLancamento(l.nome)] -= l.valor;

  let promoLoja = 0;
  let promoIfood = 0;
  for (const b of lista(obj(s.benefits).benefits)) {
    for (const p of lista(b.sponsorships)) {
      if (/MERCHANT|LOJA/i.test(txt(p.name))) promoLoja += num(p.value);
      else if (/IFOOD/i.test(txt(p.name))) promoIfood += num(p.value);
    }
  }

  const responsaveis = [...new Set(metodos.map((m) => txt(m.liability).toUpperCase()).filter(Boolean))];
  const offline =
    metodos.some((m) => /OFFLINE/i.test(txt(m.type))) ||
    (responsaveis.length === 1 && responsaveis[0] === 'MERCHANT');
  const itens = num(bruto.bag);
  const taxaEntrega = num(bruto.deliveryFee);
  const liquido = num(cobranca.saleBalance);
  const taxas = cobrado.comissao + cobrado.comissaoEntrega + cobrado.taxaCartao + cobrado.taxaAntecipacao;
  // "Outras" fecha a conta bruto − taxas − outras = sobra: promoção da casa,
  // entrega sob demanda, anúncio… o que o iFood desconta sem classe própria.
  // Na entrega o bruto não passa pelo iFood — lá só contam os lançamentos.
  const outras = offline ? cobrado.outras : itens + taxaEntrega - taxas - liquido;

  return {
    orderId: txt(s.id),
    displayId: txt(s.shortId),
    data: Number.isFinite(t) ? dateToBrYmd(new Date(t)) : criado.slice(0, 10),
    dataHora: criado,
    status: txt(s.currentStatus),
    canal: txt(s.salesChannel),
    tipoPagamento: offline ? 'OFFLINE' : 'ONLINE',
    metodo: metodos.map((m) => txt(m.method)).filter(Boolean).join(' + '),
    bandeira: metodos.map((m) => txt(obj(m.card).brand)).filter(Boolean).join(' + '),
    responsavel: responsaveis.join(' + '),
    bruto: r2(itens + taxaEntrega),
    itens,
    taxaEntrega,
    taxaServico: Math.abs(num(bruto.serviceFee)),
    promoLoja: r2(promoLoja),
    promoIfood: r2(promoIfood),
    comissao: r2(cobrado.comissao),
    comissaoEntrega: r2(cobrado.comissaoEntrega),
    taxaCartao: r2(cobrado.taxaCartao),
    taxaAntecipacao: r2(cobrado.taxaAntecipacao),
    outras: r2(outras),
    liquido,
    lancamentos,
    entregaPor: txt(obj(obj(entrega.deliveryParameters)).logisticProvider),
  };
}

/** Vendas por DATA DA VENDA (máx. 90 dias por consulta, 100 por página).
 *  Pagina até o fim ou até `maxPaginas`; `total` do iFood serve pra conferir
 *  que nada ficou pra trás. */
export async function vendasIfood(
  c: CredFin,
  merchantId: string,
  de: string,
  ate: string,
  maxPaginas = 20,
): Promise<{ vendas: VendaIfood[]; total: number; recebidas: number; paginas: number; incompleto: boolean }> {
  const porId = new Map<string, VendaIfood>();
  let total = 0;
  let recebidas = 0;
  let paginas = 0;
  let pageCount = 1;
  for (let page = 1; page <= pageCount && page <= maxPaginas; page++) {
    const q = new URLSearchParams({ beginSalesDate: de, endSalesDate: ate, page: String(page) });
    const r = obj(await api(c, V3 + merchantId + '/sales?' + q.toString(), { timeoutMs: 60000 }));
    paginas = page;
    total = Math.max(total, num(r.total));
    pageCount = Math.max(1, num(r.pageCount));
    const vendas = lista(r.sales);
    recebidas += vendas.length;
    // Mesma venda em duas páginas (lista mudou no meio da leitura) não duplica.
    for (const s of vendas) {
      const v = venda(s);
      if (v.orderId) porId.set(v.orderId, v);
    }
    if (!vendas.length) break;
  }
  const vendas = [...porId.values()].sort((a, b) => (a.dataHora < b.dataHora ? 1 : -1));
  // Incompleto = parou no teto de páginas. `total` maior que o recebido lendo
  // tudo é o iFood contando diferente da própria lista (visto na homologação:
  // total 2, uma venda) — a tela avisa à parte, sem mandar apertar o período.
  return { vendas, total, recebidas, paginas, incompleto: paginas >= maxPaginas && paginas < pageCount };
}

/** Soma o que interessa num fechamento. Pagamento na entrega fica de fora do
 *  repasse: o dinheiro já está no caixa da casa, somar contaria duas vezes. */
export function resumoVendas(vendas: VendaIfood[]) {
  const cancelada = (v: VendaIfood) => /CANCEL/i.test(v.status);
  const online = vendas.filter((v) => v.tipoPagamento !== 'OFFLINE' && !cancelada(v));
  const soma = (f: (v: VendaIfood) => number) => r2(online.reduce((a, v) => a + f(v), 0));
  return {
    pedidos: vendas.length,
    pedidosOnline: online.length,
    cancelados: vendas.filter(cancelada).length,
    naEntrega: vendas.filter((v) => v.tipoPagamento === 'OFFLINE').length,
    bruto: soma((v) => v.bruto),
    comissao: soma((v) => v.comissao + v.comissaoEntrega),
    taxaCartao: soma((v) => v.taxaCartao),
    outrasTaxas: soma((v) => v.taxaAntecipacao + v.outras),
    promoLoja: soma((v) => v.promoLoja),
    liquido: soma((v) => v.liquido),
  };
}

// ─── Repasses (settlements) ─────────────────────────────────────────────────

export interface RepasseIfood {
  /** Semana de cálculo a que o título pertence. */
  calculoDe: string;
  calculoAte: string;
  /** Número do título — é o `id_saldo` do CSV de conciliação. */
  id: string;
  /** REPASSE, BOLETO (casa devendo), REGISTRO_RECEBIVEIS, RENEGOCIADA. */
  tipo: string;
  produto: string;
  valor: number;
  situacao: string;
  transacaoId: string;
  pagoEm: string;
  banco: string;
  agencia: string;
  conta: string;
  documento: string;
}

/** Títulos de repasse por DATA DE PAGAMENTO (o que bate com o extrato) ou
 *  por PERÍODO DE CÁLCULO (o que bate com a semana de vendas). */
/** Título com mais de 31 dias por consulta volta 5xx do iFood (testado na
 *  homologação: 31 dias passa, 38 não). Lê em partes. */
const JANELA_TITULOS = 30;

export async function repassesIfood(
  c: CredFin,
  merchantId: string,
  de: string,
  ate: string,
  base: 'pagamento' | 'calculo' = 'pagamento',
): Promise<{ saldo: number; itens: RepasseIfood[] }> {
  const porChave = new Map<string, RepasseIfood>();
  let saldo = 0;
  for (const [ini, fim] of janelas(de, ate, JANELA_TITULOS)) {
    const q = new URLSearchParams(
      base === 'calculo'
        ? { beginCalculationDate: ini, endCalculationDate: fim }
        : { beginPaymentDate: ini, endPaymentDate: fim },
    );
    let r: Obj;
    try {
      r = obj(await api(c, V3 + merchantId + '/settlements?' + q.toString(), { timeoutMs: 60000 }));
    } catch (e) {
      // NO_SETTLEMENTS_FOUND: período sem título ainda não é erro.
      if (e404(e)) continue;
      throw e;
    }
    // Saldo é o do momento da leitura: vale o da última parte, não se soma.
    saldo = num(r.balance);
    for (const s of lista(r.settlements)) {
      for (const i of lista(s.closingItems)) {
        const item: RepasseIfood = {
          calculoDe: txt(s.startDateCalculation),
          calculoAte: txt(s.endDateCalculation),
          id: txt(i.id),
          tipo: txt(i.type),
          produto: txt(i.product),
          valor: num(i.amount),
          situacao: txt(i.status),
          transacaoId: txt(i.transactionId),
          pagoEm: txt(i.paymentDate),
          ...contaBancaria(obj(i.accountDetails)),
        };
        // Semana de cálculo que atravessa duas partes volta nas duas.
        porChave.set(item.id || [item.transacaoId, item.pagoEm, item.tipo, item.valor].join('|'), item);
      }
    }
  }
  const itens = [...porChave.values()];
  itens.sort((a, b) => (a.pagoEm < b.pagoEm ? 1 : a.pagoEm > b.pagoEm ? -1 : 0));
  return { saldo, itens };
}

// ─── Eventos financeiros ────────────────────────────────────────────────────

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
  bandeira: string;
  /** Quem recebeu o pagamento (`payment.liability`). */
  responsavel: string;
  /** Quem recebe o valor do evento (`receiver`). */
  recebedor: string;
}

/** O iFood entrega no máximo 33 dias por consulta. 31 põe um mês inteiro numa
 *  leitura só — em duas, a homologação devolve os mesmos eventos nas duas. */
const JANELA_EVENTOS = 31;

/** Eventos financeiros — a explicação linha a linha do repasse. Períodos
 *  maiores que a janela são lidos em partes; cada parte é paginada (500 por
 *  página). `maxPaginas` é o teto TOTAL, pra uma casa movimentada não estourar
 *  o prazo da função serverless — `temMais` avisa a tela quando cortou. */
export async function eventosIfood(
  c: CredFin,
  merchantId: string,
  de: string,
  ate: string,
  maxPaginas = 10,
): Promise<{ eventos: EventoFinanceiroIfood[]; temMais: boolean; leituras: number }> {
  const eventos: EventoFinanceiroIfood[] = [];
  let leituras = 0;

  for (const [ini, fim] of janelas(de, ate, JANELA_EVENTOS)) {
    for (let page = 1; ; page++) {
      if (leituras >= maxPaginas) return { eventos, temMais: true, leituras };
      const q = new URLSearchParams({ beginDate: ini, endDate: fim, page: String(page), size: '500' });
      const r = obj(await api(c, V3 + merchantId + '/financial-events?' + q.toString(), { timeoutMs: 60000 }));
      leituras++;
      for (const e of lista(r.financialEvents)) {
        const per = obj(e.period);
        const ref = obj(e.reference);
        const bi = obj(e.billing);
        const pa = obj(e.payment);
        const rc = obj(e.receiver);
        eventos.push({
          nome: txt(e.name),
          descricao: txt(e.description),
          produto: txt(e.product),
          gatilho: txt(e.trigger),
          // A homologação manda sem dateTime; a data da referência é o que sobra.
          quando: txt(e.dateTime) || txt(ref.date),
          competencia: txt(e.competence),
          periodoDe: txt(per.beginDate),
          periodoAte: txt(per.endDate),
          refTipo: txt(ref.type),
          refId: txt(ref.id),
          mexeNoRepasse: e.hasTransferImpact === true,
          valor: num(obj(e.amount).value),
          baseCalculo: num(bi.baseValue),
          percentual: txt(bi.feePercentage),
          repasseEm: txt(obj(e.settlement).expectedDate),
          metodo: txt(pa.method),
          bandeira: txt(pa.brand),
          responsavel: txt(pa.liability),
          recebedor: [txt(rc.businessType), txt(rc.businessDocument)].filter(Boolean).join(' '),
        });
      }
      if (r.hasNextPage !== true) break;
    }
  }
  eventos.sort((a, b) => (a.quando < b.quando ? 1 : -1));
  return { eventos, temMais: false, leituras };
}

// ─── Antecipações ───────────────────────────────────────────────────────────

export interface AntecipacaoIfood {
  calculoDe: string;
  calculoAte: string;
  /** REPASSE_ANTECIPADO_SEMANAL ou REPASSE_ANTECIPADO_DIARIO. */
  tipo: string;
  valorOriginal: number;
  taxaPercentual: number;
  taxaValor: number;
  valorAntecipado: number;
  /** SUCCEED ou FAILED. */
  situacao: string;
  /** Quando cairia sem antecipar. */
  dataOriginal: string;
  dataAntecipada: string;
  diasAntes: number;
  banco: string;
  agencia: string;
  conta: string;
  documento: string;
}

/** Antecipações de repasse. 404 aqui quer dizer "a casa não tem plano de
 *  antecipação" — é resposta, não erro. */
export async function antecipacoesIfood(
  c: CredFin,
  merchantId: string,
  de: string,
  ate: string,
  base: 'calculo' | 'pagamento' = 'calculo',
  maxPaginas = 10,
): Promise<{ semPlano: boolean; saldo: number; itens: AntecipacaoIfood[] }> {
  const TAM = 500;
  const itens: AntecipacaoIfood[] = [];
  let saldo = 0;
  for (let page = 1; page <= maxPaginas; page++) {
    const q = new URLSearchParams({
      ...(base === 'calculo'
        ? { beginCalculationDate: de, endCalculationDate: ate }
        : { beginAnticipatedPaymentDate: de, endAnticipatedPaymentDate: ate }),
      page: String(page),
      size: String(TAM),
    });
    let r: Obj;
    try {
      r = obj(await api(c, V3 + merchantId + '/anticipations?' + q.toString(), { timeoutMs: 60000 }));
    } catch (e) {
      if (e404(e) && page === 1) return { semPlano: true, saldo: 0, itens: [] };
      if (e404(e)) break;
      throw e;
    }
    saldo += num(r.balance);
    let nestaPagina = 0;
    for (const s of lista(r.settlements)) {
      for (const i of lista(s.closingItems)) {
        nestaPagina++;
        const dataOriginal = txt(i.originalPaymentDate);
        const dataAntecipada = txt(i.anticipatedPaymentDate);
        itens.push({
          calculoDe: txt(s.startDateCalculation),
          calculoAte: txt(s.endDateCalculation),
          tipo: txt(i.type),
          valorOriginal: num(i.originalPaymentAmount),
          taxaPercentual: num(i.feePercentage),
          taxaValor: num(i.feeAmount),
          valorAntecipado: num(i.anticipatedPaymentAmount),
          situacao: txt(i.status),
          dataOriginal,
          dataAntecipada,
          diasAntes: dataOriginal && dataAntecipada ? Math.max(0, diasEntre(dataAntecipada, dataOriginal)) : 0,
          ...contaBancaria(obj(i.accountDetails)),
        });
      }
    }
    if (nestaPagina < TAM) break;
  }
  itens.sort((a, b) => (a.dataAntecipada < b.dataAntecipada ? 1 : -1));
  return { semPlano: false, saldo: r2(saldo), itens };
}

// ─── Conciliação (arquivo CSV) ──────────────────────────────────────────────

export interface LinhaConciliacao {
  competencia: string;
  fatoGerador: string;
  tipoLancamento: string;
  descricao: string;
  valor: number;
  baseCalculo: number;
  percentual: string;
  pedido: string;
  pedidoCurto: string;
  motivoCancelamento: string;
  ocorrencia: string;
  pedidoCriadoEm: string;
  repasseEm: string;
  /** Valor do título inteiro; null enquanto o período está aberto. */
  valorTransacao: number | null;
  periodoAberto: boolean;
  lojaId: string;
  lojaCurto: string;
  cnpj: string;
  impacto: boolean;
  idSaldo: string;
  apuracaoDe: string;
  apuracaoAte: string;
}

/** Link do arquivo mensal (atualizado toda segunda). O link expira: pede-se
 *  um novo a cada leitura, nunca se guarda. */
export async function arquivoConciliacaoMensal(
  c: CredFin,
  merchantId: string,
  competencia: string,
): Promise<{ url: string; criadoEm: string; linhasEsperadas: number | null; sha256: string }> {
  const q = new URLSearchParams({ competence: competencia });
  const r0 = await api(c, V3 + merchantId + '/reconciliation?' + q.toString(), { timeoutMs: 30000 });
  // A spec diz objeto; o exemplo da doc mostra lista. Aceita as duas.
  const r = obj(Array.isArray(r0) ? r0[0] : r0);
  const meta = obj(r.metadata);
  const url = txt(r.downloadPath);
  if (!url) throw new Error('o iFood não devolveu o link do arquivo de conciliação de ' + competencia);
  return {
    url,
    criadoEm: txt(r.createdAt),
    linhasEsperadas: meta.total_linhas != null ? num(meta.total_linhas) : null,
    sha256: txt(meta.sha256).toLowerCase(),
  };
}

/** Baixa o arquivo (vem .csv.gz ou .csv, conforme a origem) e lê as linhas.
 *  O link é pré-assinado do S3: vai SEM o token do iFood. */
export async function baixarConciliacao(
  url: string,
  sha256Esperado = '',
): Promise<{ linhas: LinhaConciliacao[]; sha256Confere: boolean | null }> {
  const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!r.ok) {
    throw new Error(
      r.status === 403
        ? 'o link do arquivo do iFood expirou — carregue de novo pra pedir um link novo'
        : 'não consegui baixar o arquivo de conciliação do iFood (HTTP ' + r.status + ')',
    );
  }
  const cru = Buffer.from(await r.arrayBuffer());
  const gz = cru[0] === 0x1f && cru[1] === 0x8b;
  const csv = gz ? gunzipSync(cru) : cru;
  let sha256Confere: boolean | null = null;
  if (sha256Esperado) {
    const h = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    sha256Confere = h(cru) === sha256Esperado || h(csv) === sha256Esperado;
  }
  return { linhas: lerCsvConciliacao(csv.toString('utf8')), sha256Confere };
}

/** CSV com aspas e quebra de linha dentro de campo. */
function partirCsv(texto: string, sep: string): string[][] {
  const out: string[][] = [];
  let linha: string[] = [];
  let cel = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { cel += '"'; i++; } else aspas = false;
      } else cel += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(cel); cel = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      linha.push(cel);
      cel = '';
      if (linha.length > 1 || linha[0] !== '') out.push(linha);
      linha = [];
    } else cel += ch;
  }
  if (cel !== '' || linha.length) { linha.push(cel); out.push(linha); }
  return out;
}

/** Lê pelo NOME da coluna, não pela posição: o iFood já descontinuou colunas
 *  sem tirá-las do arquivo ("Discontinued column") e pode reordenar. */
export function lerCsvConciliacao(texto: string): LinhaConciliacao[] {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.slice(0, t.indexOf('\n') > 0 ? t.indexOf('\n') : t.length);
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const [cab, ...corpo] = partirCsv(t, sep);
  if (!cab) return [];
  const idx = new Map(cab.map((h, i) => [chave(h), i]));
  if (!idx.has('valor') || !idx.has('impacto_no_repasse')) {
    throw new Error('o arquivo de conciliação veio num formato que o Concilia não reconhece (sem as colunas valor/impacto_no_repasse)');
  }
  const pega = (l: string[], nome: string) => {
    const i = idx.get(nome);
    const v = i == null ? '' : (l[i] ?? '').trim();
    return /^discontinued column$/i.test(v) ? '' : v;
  };

  return corpo.map((l) => {
    const vt = pega(l, 'valor_transacao');
    const aberto = /open settlement period/i.test(vt);
    return {
      competencia: pega(l, 'competencia'),
      fatoGerador: pega(l, 'fato_gerador'),
      tipoLancamento: pega(l, 'tipo_lancamento'),
      descricao: pega(l, 'descricao_lancamento'),
      valor: num(pega(l, 'valor')),
      baseCalculo: num(pega(l, 'base_calculo')),
      percentual: pega(l, 'percentual_taxa'),
      pedido: pega(l, 'pedido_associado_ifood'),
      pedidoCurto: pega(l, 'pedido_associado_ifood_curto'),
      motivoCancelamento: pega(l, 'motivo_cancelamento'),
      ocorrencia: pega(l, 'descricao_ocorrencia'),
      pedidoCriadoEm: pega(l, 'data_criacao_pedido_associado'),
      repasseEm: pega(l, 'data_repasse_esperada').slice(0, 10),
      valorTransacao: aberto || vt === '' ? null : num(vt),
      periodoAberto: aberto,
      lojaId: pega(l, 'loja_id'),
      lojaCurto: pega(l, 'loja_id_curto'),
      cnpj: pega(l, 'cnpj'),
      impacto: chave(pega(l, 'impacto_no_repasse')) === 'sim',
      idSaldo: pega(l, 'id_saldo'),
      apuracaoDe: pega(l, 'data_apuracao_inicio').slice(0, 10),
      apuracaoAte: pega(l, 'data_apuracao_fim').slice(0, 10),
    };
  });
}

export interface GrupoConciliacao {
  fatoGerador: string;
  tipoLancamento: string;
  descricao: string;
  impacto: boolean;
  qtd: number;
  valor: number;
}

export interface SaldoConciliacao {
  idSaldo: string;
  repasseEm: string;
  apuracaoDe: string;
  apuracaoAte: string;
  /** Soma das linhas com impacto deste título. */
  valor: number;
  /** O que o iFood diz que o título vale; null com período aberto. */
  valorTransacao: number | null;
  periodoAberto: boolean;
  /** valor ≈ valorTransacao. null = período aberto, ainda não dá pra saber. */
  confere: boolean | null;
  linhas: number;
}

/** O mês em números. Regra do iFood: o que a casa recebe é a soma de `valor`
 *  onde `impacto_no_repasse = SIM`; o resto é informativo. */
export function resumoConciliacao(linhas: LinhaConciliacao[]) {
  const t = { liquido: 0, informativo: 0, entradas: 0, saidas: 0, vendas: 0, cancelamentos: 0, comissoesTaxas: 0, subsidios: 0 };
  const pedidos = new Set<string>();
  const grupos = new Map<string, GrupoConciliacao>();
  const saldos = new Map<string, SaldoConciliacao>();

  for (const l of linhas) {
    if (l.pedido) pedidos.add(l.pedido);
    const kg = [l.fatoGerador, l.tipoLancamento, l.descricao, l.impacto ? 1 : 0].join('|');
    const g = grupos.get(kg) ?? { fatoGerador: l.fatoGerador, tipoLancamento: l.tipoLancamento, descricao: l.descricao, impacto: l.impacto, qtd: 0, valor: 0 };
    g.qtd++;
    g.valor += l.valor;
    grupos.set(kg, g);

    if (!l.impacto) { t.informativo += l.valor; continue; }
    t.liquido += l.valor;
    if (l.valor >= 0) t.entradas += l.valor; else t.saidas += l.valor;
    const fato = chave(l.fatoGerador);
    const tipo = chave(l.tipoLancamento);
    if (fato === 'venda' && l.valor > 0) t.vendas += l.valor;
    if (fato.startsWith('cancelamento')) t.cancelamentos += l.valor;
    if (tipo === 'retencao' || tipo === 'cobranca') t.comissoesTaxas += l.valor;
    if (tipo === 'subsidio') t.subsidios += l.valor;

    const ks = l.idSaldo || 'sem título ' + l.repasseEm;
    const s = saldos.get(ks) ?? {
      idSaldo: l.idSaldo, repasseEm: l.repasseEm, apuracaoDe: l.apuracaoDe, apuracaoAte: l.apuracaoAte,
      valor: 0, valorTransacao: null, periodoAberto: false, confere: null, linhas: 0,
    };
    s.valor += l.valor;
    s.linhas++;
    if (s.valorTransacao == null && l.valorTransacao != null) s.valorTransacao = l.valorTransacao;
    if (l.periodoAberto) s.periodoAberto = true;
    if (!s.repasseEm && l.repasseEm) s.repasseEm = l.repasseEm;
    saldos.set(ks, s);
  }

  const listaSaldos = [...saldos.values()].map((s) => ({
    ...s,
    valor: r2(s.valor),
    confere: s.periodoAberto || s.valorTransacao == null ? null : Math.abs(s.valor - s.valorTransacao) <= 0.05,
  }));
  listaSaldos.sort((a, b) => (a.repasseEm < b.repasseEm ? -1 : a.repasseEm > b.repasseEm ? 1 : 0));

  return {
    linhas: linhas.length,
    pedidos: pedidos.size,
    liquido: r2(t.liquido),
    informativo: r2(t.informativo),
    entradas: r2(t.entradas),
    saidas: r2(t.saidas),
    vendas: r2(t.vendas),
    cancelamentos: r2(t.cancelamentos),
    comissoesTaxas: r2(t.comissoesTaxas),
    subsidios: r2(t.subsidios),
    grupos: [...grupos.values()]
      .map((g) => ({ ...g, valor: r2(g.valor) }))
      .sort((a, b) => Number(b.impacto) - Number(a.impacto) || a.fatoGerador.localeCompare(b.fatoGerador) || Math.abs(b.valor) - Math.abs(a.valor)),
    saldos: listaSaldos,
  };
}

/** Célula de CSV no jeito que o Excel em português abre sem assistente:
 *  `;` separa, vírgula é decimal. */
function celula(v: string | number | boolean | null): string {
  const s = v == null ? '' : typeof v === 'number' ? v.toFixed(2).replace('.', ',') : typeof v === 'boolean' ? (v ? 'SIM' : 'NAO') : v;
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function csvDe(cabecalho: string[], linhas: Array<Array<string | number | boolean | null>>): string {
  return '﻿' + [cabecalho.join(';'), ...linhas.map((l) => l.map(celula).join(';'))].join('\r\n') + '\r\n';
}

export function csvConciliacao(linhas: LinhaConciliacao[]): string {
  return csvDe(
    ['competencia', 'fato_gerador', 'tipo_lancamento', 'descricao_lancamento', 'valor', 'base_calculo', 'percentual_taxa',
      'pedido_associado_ifood', 'pedido_associado_ifood_curto', 'motivo_cancelamento', 'descricao_ocorrencia',
      'data_criacao_pedido_associado', 'data_repasse_esperada', 'valor_transacao', 'loja_id', 'loja_id_curto', 'cnpj',
      'impacto_no_repasse', 'id_saldo', 'data_apuracao_inicio', 'data_apuracao_fim'],
    linhas.map((l) => [
      l.competencia, l.fatoGerador, l.tipoLancamento, l.descricao, l.valor, l.baseCalculo, l.percentual,
      l.pedido, l.pedidoCurto, l.motivoCancelamento, l.ocorrencia,
      l.pedidoCriadoEm, l.repasseEm, l.periodoAberto ? 'periodo aberto' : l.valorTransacao, l.lojaId, l.lojaCurto, l.cnpj,
      l.impacto, l.idSaldo, l.apuracaoDe, l.apuracaoAte,
    ]),
  );
}

// ─── Conciliação sob demanda ────────────────────────────────────────────────

/** Pede o arquivo do mês gerado agora (dados até D-1). O iFood aceita UM
 *  pedido por loja+competência a cada 6 h: o 409 volta como `conflito` pra
 *  quem chamou reaproveitar o requestId que já tem. */
export async function pedirConciliacaoSobDemanda(
  c: CredFin,
  merchantId: string,
  competencia: string,
): Promise<{ requestId: string; conflito: false } | { requestId: string | null; conflito: true }> {
  const caminho = V3 + merchantId + '/reconciliation/on-demand';
  // Resposta crua: o wrapper devolve {} em 202 e o requestId se perdia (11/09,
  // homologação: "aceitou mas não devolveu o requestId").
  const r = (await api(c, caminho, {
    metodo: 'POST',
    corpo: { competence: competencia },
    timeoutMs: 30000,
    cru: true,
  })) as Response;
  const corpo = await r.text();
  let j: Obj = {};
  try {
    j = obj(JSON.parse(corpo));
  } catch {
    // corpo vazio ou texto
  }
  const erro = obj(j.error);
  const codigo = txt(j.code) || txt(erro.code);
  const mensagem = txt(j.message) || txt(erro.message);
  const requestId = txt(j.requestId) || txt(j.id) || txt(obj(j.data).requestId);

  // Pedido recente ainda válido: a spec documenta 409 e também 400 com
  // code "409" ("There is already a recent and valid request").
  if (r.status === 409 || (r.status === 400 && (codigo === '409' || /recent and valid request/i.test(mensagem)))) {
    return { requestId: requestId || null, conflito: true };
  }
  if (!r.ok) {
    throw new IfoodErro('iFood POST ' + caminho + ' → ' + r.status + ': ' + corpo.slice(0, 300), r.status, codigo, corpo.slice(0, 2000));
  }
  if (!requestId) {
    throw new Error(`o iFood aceitou o pedido (HTTP ${r.status}) mas não devolveu o requestId: ${corpo.slice(0, 300) || 'corpo vazio'}`);
  }
  return { requestId, conflito: false };
}

export type FaseSobDemanda = 'processando' | 'pronto' | 'erro' | 'expirado';

export interface StatusSobDemanda {
  /** created, enqueue, processed, error… (texto do iFood). */
  status: string;
  fase: FaseSobDemanda;
  erro: string;
  /** Link pré-assinado; só existe com fase `pronto`. Não se guarda. */
  url: string;
}

/** Situação do pedido sob demanda. 404 = requestId vencido (vale 24 h). */
export async function statusConciliacaoSobDemanda(
  c: CredFin,
  merchantId: string,
  requestId: string,
): Promise<StatusSobDemanda> {
  let r: Obj;
  try {
    r = obj(await api(c, V3 + merchantId + '/reconciliation/on-demand/' + encodeURIComponent(requestId), { timeoutMs: 20000 }));
  } catch (e) {
    if (e404(e)) return { status: 'not_found', fase: 'expirado', erro: 'o pedido venceu (vale 24 h) — gere de novo', url: '' };
    throw e;
  }
  const status = txt(r.status) || 'processing';
  const url = txt(r.downloadPath) || txt(r.filePath);
  const erro = txt(r.errorMessage) || txt(r.message);
  if (url) return { status, fase: 'pronto', erro: '', url };
  // Spec: errorMessage só vem quando falhou ("File generation failed: No financial entries exist").
  if (/error|fail/i.test(status) || erro) return { status, fase: 'erro', erro: erro || 'o iFood não conseguiu gerar o arquivo', url: '' };
  // 202, created, enqueue, processing: ainda na fila.
  return { status, fase: 'processando', erro: '', url: '' };
}

/** Resposta CRUA do iFood (só leitura, só os recursos daqui) — pra conferir
 *  o contrato quando um número não bate e pra anexar como log na homologação. */
export async function leituraCrua(
  c: CredFin,
  merchantId: string,
  recurso: 'sales' | 'financial-events' | 'settlements' | 'anticipations',
  params: Record<string, string>,
): Promise<{ caminho: string; homologacao: boolean; resposta: unknown }> {
  const caminho = V3 + merchantId + '/' + recurso + '?' + new URLSearchParams(params).toString();
  return { caminho, homologacao: Boolean(c.homologacao), resposta: await api(c, caminho, { timeoutMs: 60000 }) };
}

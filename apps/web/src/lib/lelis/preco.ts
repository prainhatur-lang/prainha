// Formação de preço de revenda da Lelis (01/11/2026). Conta pura, sem banco:
// a tela usa a mesma função no navegador pra recalcular enquanto digita.
//
//   custo  = valor unit. + IPI + carga do Decreto 40.949 + frete
//   preço  = custo ÷ (1 − %operacional − %margem − %impostos da venda)
//
// Os percentuais são "por dentro" (sobre o preço de venda): com 10% operacional
// e 15% de margem, de cada R$ 100 vendidos R$ 10 pagam a operação e R$ 15 ficam.

/** Carga efetiva do atacadista (Decreto 40.949/2021) pela alíquota de origem. */
export function cargaPorOrigem(aliqOrigem: number | null | undefined): number {
  if (aliqOrigem == null || !Number.isFinite(aliqOrigem)) return 3.17;
  if (aliqOrigem <= 4) return 10.56;
  if (aliqOrigem <= 7) return 6.34;
  return 3.17; // 12% ou compra interna
}

export interface EntradaPreco {
  custoUnit: number;
  pctIpi: number;
  aliqOrigem: number | null;
  pctCarga: number | null;
  cargaComIpi: boolean;
  freteUnit: number;
  pctOperacional: number;
  pctMargem: number;
  pctImpostosVenda: number;
  precoManual: number | null;
}

export interface ResultadoPreco {
  ipi: number;
  pctCarga: number;
  carga: number;
  custo: number;
  /** soma dos % por dentro */
  pctTotal: number;
  precoCalculado: number | null;
  /** o que vale: manual se tiver, senão o calculado */
  preco: number | null;
  operacional: number;
  impostos: number;
  lucro: number;
  /** lucro ÷ preço (%) */
  margemReal: number;
  /** preço ÷ custo − 1 (%) */
  markup: number;
  erro: string | null;
}

const n = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

export function calcularPreco(e: EntradaPreco): ResultadoPreco {
  const v = n(e.custoUnit);
  const ipi = (v * n(e.pctIpi)) / 100;
  const pctCarga = e.pctCarga != null && Number.isFinite(e.pctCarga) ? e.pctCarga : cargaPorOrigem(e.aliqOrigem);
  const carga = ((e.cargaComIpi ? v + ipi : v) * pctCarga) / 100;
  const custo = v + ipi + carga + n(e.freteUnit);
  const pctTotal = n(e.pctOperacional) + n(e.pctMargem) + n(e.pctImpostosVenda);
  let erro: string | null = null;
  let precoCalculado: number | null = null;
  if (pctTotal >= 100) erro = 'A soma dos percentuais passou de 100%';
  else precoCalculado = r2(custo / (1 - pctTotal / 100));
  const preco = e.precoManual != null && e.precoManual > 0 ? e.precoManual : precoCalculado;
  const operacional = preco != null ? (preco * n(e.pctOperacional)) / 100 : 0;
  const impostos = preco != null ? (preco * n(e.pctImpostosVenda)) / 100 : 0;
  const lucro = preco != null ? preco - custo - operacional - impostos : 0;
  return {
    ipi,
    pctCarga,
    carga,
    custo,
    pctTotal,
    precoCalculado,
    preco,
    operacional,
    impostos,
    lucro,
    margemReal: preco ? (lucro / preco) * 100 : 0,
    markup: custo > 0 && preco ? (preco / custo - 1) * 100 : 0,
    erro,
  };
}

// ── Preço por destino (06/11/2026) ──────────────────────────────────────────
// A Lelis é Lucro Real com Termo de Acordo (Decreto 40.949/2021). Mesmo custo da
// nota, dois destinos:
//
//   EMPRESA (contribuinte, não varejista): o ICMS da carga já foi pago na
//   entrada; o ICMS destacado na nota é só pro comprador se creditar, não custa
//   nada a mais. Sem o adicional do art. 4º (comprador não é varejista).
//
//   CONSUMIDOR FINAL (pessoa física): o art. 1º §2 diz que venda a pessoa
//   natural não é atividade de atacado → sem o benefício. Conta conservadora:
//   ICMS cheio da alíquota interna sobre o preço, abatendo só o ICMS destacado na
//   nota de compra (alíquota de origem); a carga do decreto fica como custo.
//   CONFIRMAR COM O CONTADOR.
//
// Nos dois: PIS/COFINS não cumulativo (Lucro Real) por dentro no preço, com
// crédito sobre a compra (valor + IPI). IRPJ/CSLL saem do lucro (dentro da margem).
//   preço = (custo − créditos) ÷ (1 − %oper − %margem − %PIS/COFINS − %ICMS venda)

export interface EntradaDestino {
  /** PIS + COFINS da venda (ex.: 1,65 + 7,6). 0 quando o produto é alíquota zero/monofásico. */
  pctPisCofins: number;
  /** Alíquota interna cheia pra consumidor final (SE: 19% + 1% FECOEP = 20%). */
  pctIcmsConsumidor: number;
}

export interface ResultadoDestino {
  /** custo da nota − créditos: o que a mercadoria custa de fato pra esse destino */
  custoLiquido: number;
  creditoPisCofins: number;
  creditoIcms: number;
  pisCofins: number;
  icms: number;
  preco: number | null;
  lucro: number;
  margemReal: number;
  erro: string | null;
}

function destino(base: ResultadoPreco, e: EntradaPreco, pctPc: number, pctIcms: number, creditoIcms: number): ResultadoDestino {
  const v = n(e.custoUnit);
  const creditoPisCofins = ((v + base.ipi) * pctPc) / 100;
  const custoLiquido = base.custo - creditoPisCofins - creditoIcms;
  const pct = n(e.pctOperacional) + n(e.pctMargem) + pctPc + pctIcms;
  if (pct >= 100) {
    return { custoLiquido, creditoPisCofins, creditoIcms, pisCofins: 0, icms: 0, preco: null, lucro: 0, margemReal: 0, erro: 'A soma dos percentuais passou de 100%' };
  }
  const preco = r2(custoLiquido / (1 - pct / 100));
  const pisCofins = (preco * pctPc) / 100;
  const icms = (preco * pctIcms) / 100;
  const operacional = (preco * n(e.pctOperacional)) / 100;
  const lucro = preco - custoLiquido - pisCofins - icms - operacional;
  return { custoLiquido, creditoPisCofins, creditoIcms, pisCofins, icms, preco, lucro, margemReal: preco ? (lucro / preco) * 100 : 0, erro: null };
}

export function calcularDestinos(e: EntradaPreco, d: EntradaDestino): { empresa: ResultadoDestino; consumidor: ResultadoDestino } {
  const base = calcularPreco(e);
  const pc = n(d.pctPisCofins);
  const creditoOrigem = (n(e.custoUnit) * (e.aliqOrigem != null && Number.isFinite(e.aliqOrigem) ? Math.min(e.aliqOrigem, n(d.pctIcmsConsumidor)) : 0)) / 100;
  return {
    empresa: destino(base, e, pc, 0, 0),
    consumidor: destino(base, e, pc, n(d.pctIcmsConsumidor), creditoOrigem),
  };
}

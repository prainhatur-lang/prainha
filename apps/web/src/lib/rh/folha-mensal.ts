// Folha mensal calculada pelo próprio sistema (29/10/2026), pra comparar com
// a do contador (folha_contador). Cálculo puro, sem banco.
//
// Regras tiradas da folha de setembro/2026 do contador e conferidas
// centavo a centavo nos contracheques:
// - CLT: DIAS NORMAIS = salário/30 × dias no mês (30 no mês inteiro; mês
//   pela metade conta da admissão ao fim). Adicional noturno 20% sobre a hora
//   noturna real, hora noturna reduzida (ficta) a hora × 1,2 × 1,5, e reflexo
//   no DSR = domingos e feriados ÷ dias úteis do mês.
// - Intermitente: horas × valor-hora, DSR 1/6, férias 1/12, 1/3 de férias,
//   13º 1/12. O INSS do mês sai sem o 13º; o 13º tem INSS próprio.
// - INSS progressivo 2026, cada faixa truncada no centavo. FGTS 8% truncado,
//   com o 13º separado.
// Salário-família e ajuda de custo vêm da última folha do contador.
// O que o sistema não sabe (plano de saúde,
// afastamento, rescisão, IRRF) fica de fora e aparece como diferença.

/**
 * Decisão do dono 05/11/2026 ("só retira o add noturno, pode deixar o ponto
 * normal", "não avisa nada"): a nossa folha mensal não paga adicional noturno
 * nem avisa horas noturnas. O ponto continua igual (o espelho ainda mostra a
 * hora noturna). Mesma linha da folha semanal (PAGAR_NOTURNO_NA_FOLHA_SEMANAL,
 * 27/10). Voltar = true.
 */
export const PAGAR_NOTURNO_NA_FOLHA_MENSAL = false;
/**
 * Dono 06/11/2026: "a partir do próximo mês ... gerar o adicional noturno para
 * quem for celetista. Intermitente não tem adicional noturno." O CLT volta a
 * receber noturno da competência 2026-11 em diante (outubro fica como foi
 * lançado). Intermitente continua sem.
 */
export const NOTURNO_CLT_A_PARTIR = '2026-11';
const pagaNoturnoClt = (comp: string) => PAGAR_NOTURNO_NA_FOLHA_MENSAL || comp >= NOTURNO_CLT_A_PARTIR;

export type RegimeFolha = 'clt_mensal' | 'intermitente_hora';

export interface DiaHoras {
  dia: string; // YYYY-MM-DD (dia operacional)
  min: number; // minutos trabalhados
  noturnoMin: number; // minutos reais entre 22h e 5h
  fonte: 'ponto' | 'stelanto';
}

export interface RubricaCalc {
  codigo: string;
  descricao: string;
  referencia: number;
  valor: number;
  tipo: 'P' | 'D';
}

export interface FolhaCalc {
  regime: RegimeFolha;
  horas: number;
  horasNoturnas: number;
  diasNoMes: number;
  diasComPonto: number;
  rubricas: RubricaCalc[];
  proventos: number;
  descontos: number;
  liquido: number;
  baseInss: number;
  fgts: number;
  avisos: string[];
}

/** Faixas do INSS 2026 (teto de cada faixa, alíquota). */
export const FAIXAS_INSS_2026: [number, number][] = [
  [1621.0, 0.075],
  [2902.84, 0.09],
  [4354.27, 0.12],
  [8475.55, 0.14],
];

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const tr2 = (x: number) => Math.floor(x * 100 + 1e-6) / 100;

/** INSS progressivo, faixa por faixa truncada no centavo (como o contador). */
export function calcularInss(base: number, faixas = FAIXAS_INSS_2026): number {
  let total = 0;
  let anterior = 0;
  for (const [teto, aliq] of faixas) {
    if (base > anterior) total += tr2((Math.min(base, teto) - anterior) * aliq);
    anterior = teto;
  }
  return r2(total);
}

function ultimoDia(comp: string): number {
  const [a, m] = comp.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Domingos + feriados ÷ dias úteis do mês (fator do reflexo no DSR). */
export function fatorDsr(comp: string, feriados: string[]): number {
  const [a, m] = comp.split('-').map(Number);
  const n = ultimoDia(comp);
  const fer = new Set(feriados.filter((f) => f.startsWith(comp)));
  let descanso = 0;
  for (let d = 1; d <= n; d++) {
    const ymd = `${comp}-${String(d).padStart(2, '0')}`;
    if (new Date(Date.UTC(a, m - 1, d)).getUTCDay() === 0 || fer.has(ymd)) descanso++;
  }
  return descanso / (n - descanso);
}

const somaDias = (ymd: string, k: number) => {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(a!, m! - 1, d! + k)).toISOString().slice(0, 10);
};

/** Dias de afastamento no mês, em mês comercial de 30 dias (dia 31 não conta; fevereiro
 *  completa até 30). Atestados colados (o seguinte começa até o dia depois do fim) viram um
 *  afastamento só. `casa` = até o 15º dia; `inss` = do 16º em diante. */
export function diasDeAfastamento(
  periodos: { inicio: string; fim: string }[],
  ini: string,
  fim: string,
  n: number,
): { casa: number; inss: number; casaLongo: number } {
  const ord = [...periodos].filter((p) => p.inicio <= p.fim).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const juntos: { inicio: string; fim: string }[] = [];
  for (const p of ord) {
    const u = juntos[juntos.length - 1];
    if (u && p.inicio <= somaDias(u.fim, 1)) {
      if (p.fim > u.fim) u.fim = p.fim;
    } else juntos.push({ ...p });
  }
  const fimMes = `${ini.slice(0, 7)}-${String(n).padStart(2, '0')}`;
  let casa = 0;
  let inss = 0;
  let casaLongo = 0;
  for (const p of juntos) {
    const inssDesde = somaDias(p.inicio, 15);
    // Afastamento que passa do 15º dia: os dias pagos pela casa saem em rubrica
    // própria e não entram na base do INSS (dono 06/11/2026: "só tributa sob 12 dias
    // trabalhados, devido o afastamento superior a 15 dias").
    const longo = p.fim >= inssDesde;
    const casaAntes = casa;
    for (let d = p.inicio > ini ? p.inicio : ini; d <= p.fim && d <= fim; d = somaDias(d, 1)) {
      if (Number(d.slice(8, 10)) > 30) continue;
      if (d >= inssDesde) inss++;
      else casa++;
    }
    // Fevereiro: afastado no último dia completa o mês comercial.
    if (n < 30 && p.fim >= fimMes && fim === fimMes && fimMes >= p.inicio) {
      if (fimMes >= inssDesde) inss += 30 - n;
      else casa += 30 - n;
    }
    if (longo) casaLongo += casa - casaAntes;
  }
  return { casa, inss, casaLongo };
}

export function calcularFolhaMensal(input: {
  regime: RegimeFolha;
  /** R$/mês (CLT) ou R$/hora (intermitente). */
  salario: number;
  comp: string; // YYYY-MM
  admissao: string | null;
  desligamento: string | null;
  dias: DiaHoras[];
  feriados: string[];
  /** Cotas de salário-família (copiadas da última folha do contador). Não entra no INSS nem no FGTS. */
  salarioFamilia?: { cotas: number; valorCota: number } | null;
  /** Ajuda de custo fixa (copiada da última folha do contador). Não entra no INSS nem no FGTS. */
  ajudaCusto?: { codigo: string; descricao: string; valor: number }[] | null;
  /** Atestados (afastamento) da pessoa, YYYY-MM-DD. CLT: até o 15º dia seguido a casa
   *  paga; do 16º em diante é o INSS e sai do salário (05/11/2026, caso Máxima). */
  afastamentos?: { inicio: string; fim: string }[] | null;
  /** Quebra de caixa (copiada da última folha do contador, ex. 221 CLT 6% / 8907
   *  intermitente). Entra no INSS e no FGTS (06/11/2026, faltou na da Arleide).
   *  CLT: referência % sobre os dias pagos; intermitente: valor fixo do contador. */
  quebraCaixa?: { codigo: string; descricao: string; referencia: number; valor: number } | null;
}): FolhaCalc {
  const { regime, salario, comp } = input;
  const n = ultimoDia(comp);
  const inicioMes = `${comp}-01`;
  const fimMes = `${comp}-${String(n).padStart(2, '0')}`;
  const ini = input.admissao && input.admissao > inicioMes ? input.admissao : inicioMes;
  const fim = input.desligamento && input.desligamento < fimMes ? input.desligamento : fimMes;
  const avisos: string[] = [];
  const dias = input.dias.filter((d) => d.dia >= ini && d.dia <= fim);
  const min = dias.reduce((s, d) => s + d.min, 0);
  const noturnoMin = dias.reduce((s, d) => s + d.noturnoMin, 0);
  const horas = r2(min / 60);
  const horasNoturnas = r2(noturnoMin / 60);
  const rub: RubricaCalc[] = [];
  const P = (codigo: string, descricao: string, referencia: number, valor: number) => {
    if (valor > 0) rub.push({ codigo, descricao, referencia, valor: r2(valor), tipo: 'P' });
  };
  const D = (codigo: string, descricao: string, referencia: number, valor: number) => {
    if (valor > 0) rub.push({ codigo, descricao, referencia, valor: r2(valor), tipo: 'D' });
  };

  let diasNoMes = 0;
  let baseInss = 0;
  let fgts = 0;

  if (ini > fim) {
    avisos.push('Fora do período do mês (admissão depois ou desligamento antes).');
  } else if (regime === 'clt_mensal') {
    const [, , dIni] = ini.split('-').map(Number);
    const [, , dFim] = fim.split('-').map(Number);
    diasNoMes = ini === inicioMes && fim === fimMes ? 30 : Math.min(30, dFim - dIni + 1);
    const af = input.afastamentos?.length ? diasDeAfastamento(input.afastamentos, ini, fim, n) : null;
    const diasInss = af ? Math.min(diasNoMes, af.inss) : 0;
    const diasAfastCasa = af ? Math.min(diasNoMes - diasInss, af.casaLongo) : 0;
    const salDias = r2((salario / 30) * (diasNoMes - diasInss - diasAfastCasa));
    P('8781', 'DIAS NORMAIS', diasNoMes - diasInss - diasAfastCasa, salDias);
    if (input.quebraCaixa) {
      const q = input.quebraCaixa;
      P(q.codigo, q.descricao, q.referencia, q.referencia > 0 ? salDias * (q.referencia / 100) : q.valor);
    }
    if (af && af.casa > 0) avisos.push(`Atestado: ${af.casa} dia(s) no mês até o 15º dia de afastamento, pagos pela casa.`);
    if (diasInss > 0) avisos.push(`Afastado: ${diasInss} dia(s) do 16º dia em diante ficam com o INSS e saem do salário.`);

    if (pagaNoturnoClt(comp) && noturnoMin > 0) {
      const hora = r2(salario / 220);
      const hn = noturnoMin / 60;
      const adic = r2(r2(hn) * hora * 0.2);
      const ficta = hn * (60 / 52.5 - 1);
      const vFicta = r2(ficta * r2(hora * 1.2 * 1.5));
      const fator = fatorDsr(comp, input.feriados);
      P('25', 'ADICIONAL NOTURNO (INFOR)', horasNoturnas, adic);
      P('219', 'HORA NOTURNA REDUZIDA', r2(ficta), vFicta);
      P('250', 'REFLEXO EXTRAS DSR', 0, vFicta * fator);
      P('854', 'REFLEXO ADIC. NOTURNO DSR', 0, adic * fator);
    }
    baseInss = r2(rub.filter((x) => x.tipo === 'P').reduce((s, x) => s + x.valor, 0));
    D('998', 'I.N.S.S.', 0, calcularInss(baseInss));
    // Até o 15º dia de afastamento longo: paga a casa, sem INSS, com FGTS.
    const vAfastCasa = diasAfastCasa > 0 ? r2((salario / 30) * diasAfastCasa) : 0;
    P('9523', 'DIAS AFAST IGUAL/INF 15 DIA', diasAfastCasa, vAfastCasa);
    fgts = tr2((baseInss + vAfastCasa) * 0.08);
    if (dias.length === 0) avisos.push('Sem ponto no mês: salário sai inteiro pelos dias de contrato.');
  } else {
    const h = r2(horas * salario);
    const dsr = r2(h / 6);
    const ferias = r2((h + dsr) / 12);
    const terco = r2(ferias / 3);
    const dec = r2((h + dsr) / 12);
    P('9435', 'HORAS TRAB INTERMITENTE', horas, h);
    P('9438', 'DSR HORISTA INTERMITENTE 1/6', 16.67, dsr);
    P('9442', 'FERIAS PROPORC TRAB INTERMITENTE', 0, ferias);
    P('9443', '1/3 FERIAS PROPORC TRAB INTERMITENTE', 0, terco);
    P('9441', '13 SALARIO TRAB INTERMITENTE', 0, dec);
    const quebra = input.quebraCaixa && h > 0 ? r2(input.quebraCaixa.valor) : 0;
    if (input.quebraCaixa) P(input.quebraCaixa.codigo, input.quebraCaixa.descricao, input.quebraCaixa.referencia, quebra);
    const semDec = r2(h + dsr + ferias + terco + quebra);
    baseInss = r2(semDec + dec);
    D('998', 'I.N.S.S.', 0, calcularInss(semDec));
    D('825', 'INSS 13o SALARIO', 0, calcularInss(dec));
    fgts = r2(tr2(semDec * 0.08) + tr2(dec * 0.08));
    if (PAGAR_NOTURNO_NA_FOLHA_MENSAL && horasNoturnas > 0) avisos.push(`${horasNoturnas.toLocaleString('pt-BR')} h noturnas no ponto — o contador não paga noturno no intermitente.`);
    if (dias.length === 0) avisos.push('Sem ponto no mês: intermitente sem horas não recebe.');
  }

  if (ini <= fim && input.salarioFamilia && input.salarioFamilia.cotas > 0) {
    const sf = input.salarioFamilia;
    P('995', 'SALARIO FAMILIA', sf.cotas, sf.cotas * sf.valorCota);
  }
  if (ini <= fim && input.ajudaCusto) {
    for (const a of input.ajudaCusto) P(a.codigo, a.descricao, a.valor, a.valor);
  }
  if (input.desligamento && input.desligamento >= inicioMes && input.desligamento <= fimMes) {
    avisos.push(`Desligado em ${input.desligamento.split('-').reverse().join('/')}: o contador paga o mês pela rescisão.`);
  }

  const proventos = r2(rub.filter((x) => x.tipo === 'P').reduce((s, x) => s + x.valor, 0));
  const descontos = r2(rub.filter((x) => x.tipo === 'D').reduce((s, x) => s + x.valor, 0));
  return {
    regime,
    horas,
    // Desligado (05/11/2026): a tela não mostra mais "h noturnas".
    // CLT de 2026-11 em diante mostra as horas noturnas pagas.
    horasNoturnas: PAGAR_NOTURNO_NA_FOLHA_MENSAL || (regime === 'clt_mensal' && pagaNoturnoClt(comp)) ? horasNoturnas : 0,
    diasNoMes,
    diasComPonto: dias.filter((d) => d.min > 0).length,
    rubricas: rub,
    proventos,
    descontos,
    liquido: r2(proventos - descontos),
    baseInss,
    fgts,
    avisos,
  };
}

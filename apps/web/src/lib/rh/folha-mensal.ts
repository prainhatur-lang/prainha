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
// O que o sistema não sabe (salário-família, plano de saúde, ajuda de custo,
// afastamento, rescisão, IRRF) fica de fora e aparece como diferença.

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

export function calcularFolhaMensal(input: {
  regime: RegimeFolha;
  /** R$/mês (CLT) ou R$/hora (intermitente). */
  salario: number;
  comp: string; // YYYY-MM
  admissao: string | null;
  desligamento: string | null;
  dias: DiaHoras[];
  feriados: string[];
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
    const salDias = r2((salario / 30) * diasNoMes);
    P('8781', 'DIAS NORMAIS', diasNoMes, salDias);

    if (noturnoMin > 0) {
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
    fgts = tr2(baseInss * 0.08);
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
    const semDec = r2(h + dsr + ferias + terco);
    baseInss = r2(semDec + dec);
    D('998', 'I.N.S.S.', 0, calcularInss(semDec));
    D('825', 'INSS 13o SALARIO', 0, calcularInss(dec));
    fgts = r2(tr2(semDec * 0.08) + tr2(dec * 0.08));
    if (horasNoturnas > 0) avisos.push(`${horasNoturnas.toLocaleString('pt-BR')} h noturnas no ponto — o contador não paga noturno no intermitente.`);
    if (dias.length === 0) avisos.push('Sem ponto no mês: intermitente sem horas não recebe.');
  }

  const proventos = r2(rub.filter((x) => x.tipo === 'P').reduce((s, x) => s + x.valor, 0));
  const descontos = r2(rub.filter((x) => x.tipo === 'D').reduce((s, x) => s + x.valor, 0));
  return {
    regime,
    horas,
    horasNoturnas,
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

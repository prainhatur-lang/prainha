// Cálculo do TRCT (termo de rescisão) pelo próprio sistema (04/11/2026).
// Cálculo puro, sem banco. Usa o mesmo INSS da folha mensal (lib/rh/folha-mensal).
//
// Regras (CLT):
// - Saldo de salário: salário/30 × dias trabalhados no mês do afastamento
//   (mês inteiro = 30, como a folha do contador).
// - Aviso prévio (dispensa sem justa causa): 30 dias + 3 por ano completo,
//   até 90 (Lei 12.506). Indenizado projeta o fim do contrato pro 13º e férias.
//   Acordo (art. 484-A): metade do aviso indenizado e multa do FGTS de 20%.
//   Pedido de demissão sem cumprir o aviso: pode descontar 30 dias (art. 487 §2).
// - Contrato de experiência: no prazo, sem aviso; antes do prazo pelo
//   empregador paga metade dos dias que faltam (art. 479); pelo empregado,
//   pode descontar até essa metade (art. 480).
// - 13º proporcional: 1/12 por mês do ano com 15 dias ou mais.
// - Férias proporcionais: 1/12 por mês do período aquisitivo com 15 dias ou
//   mais, mais 1/3. Justa causa perde 13º e férias proporcionais.
// - INSS sobre saldo (e 13º à parte); aviso indenizado, férias indenizadas e
//   1/3 não têm INSS nem IR. FGTS 8% sobre saldo, aviso e 13º.
// - IRRF tabela 2026 com a redução da Lei 15.270/2025 (isento até R$ 5.000).

import { calcularInss } from './folha-mensal';

export type TipoRescisao =
  | 'sem_justa_causa'
  | 'pedido_demissao'
  | 'acordo'
  | 'justa_causa'
  | 'experiencia_fim'
  | 'experiencia_empregador'
  | 'experiencia_empregado';

export type AvisoPrevio = 'indenizado' | 'trabalhado' | 'nao_cumprido' | 'dispensado';

export const TIPO_LABEL: Record<TipoRescisao, string> = {
  sem_justa_causa: 'Dispensa sem justa causa (pela empresa)',
  pedido_demissao: 'Pedido de demissão',
  acordo: 'Acordo entre as partes (art. 484-A)',
  justa_causa: 'Dispensa por justa causa',
  experiencia_fim: 'Fim do contrato de experiência no prazo',
  experiencia_empregador: 'Experiência encerrada antes do prazo pela empresa (art. 479)',
  experiencia_empregado: 'Experiência encerrada antes do prazo pelo empregado (art. 480)',
};

/** Código de afastamento do TRCT / eSocial (campo 26/27 do termo). */
export const CODIGO_AFASTAMENTO: Record<TipoRescisao, string> = {
  sem_justa_causa: 'SJ2',
  pedido_demissao: 'PD0',
  acordo: 'SJ1',
  justa_causa: 'JC2',
  experiencia_fim: 'RA2',
  experiencia_empregador: 'RA1',
  experiencia_empregado: 'PD0',
};

export const AVISO_LABEL: Record<AvisoPrevio, string> = {
  indenizado: 'Indenizado',
  trabalhado: 'Trabalhado',
  nao_cumprido: 'Não cumprido (descontar do empregado)',
  dispensado: 'Dispensado pela empresa (sem desconto)',
};

export function tipoTemAviso(t: TipoRescisao): boolean {
  return t === 'sem_justa_causa' || t === 'pedido_demissao' || t === 'acordo';
}
export function tipoEhExperiencia(t: TipoRescisao): boolean {
  return t === 'experiencia_fim' || t === 'experiencia_empregador' || t === 'experiencia_empregado';
}

export interface VerbaTrct {
  codigo: string;
  descricao: string;
  referencia: string;
  valor: number;
  tipo: 'P' | 'D';
}

export interface ExtraTrct {
  descricao: string;
  valor: number;
  tipo: 'P' | 'D';
  /** Provento que entra no INSS, FGTS e IR (ex.: adicional noturno do mês). */
  tributavel?: boolean;
}

export interface TrctInput {
  salario: number;
  admissao: string; // YYYY-MM-DD
  afastamento: string; // último dia trabalhado
  tipo: TipoRescisao;
  aviso: AvisoPrevio;
  /** Fim previsto do contrato de experiência. */
  fimExperiencia?: string | null;
  /** Experiência encerrada pelo empregado: descontar a indenização do art. 480. */
  descontarArt480?: boolean;
  /** Períodos de férias vencidas não gozadas (0, 1 ou 2). */
  feriasVencidas?: number;
  /** 13º já adiantado no ano (1ª parcela). */
  adiantamento13?: number;
  dependentesIr?: number;
  /** Saldo do FGTS na conta pra multa (se não souber, o sistema estima). */
  saldoFgts?: number | null;
  extras?: ExtraTrct[];
}

export interface TrctCalc {
  verbas: VerbaTrct[];
  proventos: number;
  descontos: number;
  liquido: number;
  diasAviso: number;
  fimProjetado: string;
  avos13: number;
  avosFerias: number;
  diasSaldo: number;
  baseInss: number;
  baseInss13: number;
  fgtsMes: number;
  fgts13: number;
  saldoFgtsEstimado: number;
  multaFgtsPct: number;
  multaFgts: number;
  dataLimite: string;
  avisos: string[];
}

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const tr2 = (x: number) => Math.floor(x * 100 + 1e-6) / 100;

function toUtc(ymd: string): Date {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function somarDiasYmd(data: string, n: number): string {
  const d = toUtc(data);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function diasEntre(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86400000);
}
function ultimoDiaMes(a: number, m: number): number {
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}
/** Mesma data N meses depois (dia 31 cai no último dia do mês). */
function somarMeses(data: string, n: number): string {
  const [a, m, d] = data.split('-').map(Number);
  const tot = m - 1 + n;
  const na = a + Math.floor(tot / 12);
  const nm = (tot % 12 + 12) % 12 + 1;
  const nd = Math.min(d, ultimoDiaMes(na, nm));
  return `${na}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}
export function anosCompletos(admissao: string, fim: string): number {
  let n = 0;
  while (somarMeses(admissao, 12 * (n + 1)) <= somarDiasYmd(fim, 1)) n++;
  return n;
}

/** Avos do 13º: meses do ano do fim com 15 dias ou mais de contrato. */
export function avos13(admissao: string, fim: string): number {
  const [a] = fim.split('-').map(Number);
  let n = 0;
  for (let m = 1; m <= 12; m++) {
    const ini = `${a}-${String(m).padStart(2, '0')}-01`;
    const ult = `${a}-${String(m).padStart(2, '0')}-${String(ultimoDiaMes(a, m)).padStart(2, '0')}`;
    const de = admissao > ini ? admissao : ini;
    const ate = fim < ult ? fim : ult;
    if (de > ate) continue;
    if (diasEntre(de, ate) + 1 >= 15) n++;
  }
  return n;
}

/** Avos de férias proporcionais no período aquisitivo em curso. */
export function avosFerias(admissao: string, fim: string): { avos: number; inicioPeriodo: string } {
  const anos = anosCompletos(admissao, fim);
  const inicioPeriodo = somarMeses(admissao, 12 * anos);
  let n = 0;
  for (let k = 0; k < 12; k++) {
    const de = somarMeses(inicioPeriodo, k);
    if (de > fim) break;
    const ateMes = somarDiasYmd(somarMeses(inicioPeriodo, k + 1), -1);
    const ate = fim < ateMes ? fim : ateMes;
    if (diasEntre(de, ate) + 1 >= 15) n++;
  }
  return { avos: Math.min(n, 12), inicioPeriodo };
}

/** IRRF mensal 2026 (tabela + redução da Lei 15.270/2025). Base já sem INSS. */
export function calcularIrrf(rendimento: number, inss: number, dependentes = 0): number {
  const legal = inss + dependentes * 189.59;
  const deducao = Math.max(legal, 607.2);
  const base = Math.max(0, rendimento - deducao);
  const faixas: [number, number, number][] = [
    [2428.8, 0, 0],
    [2826.65, 0.075, 182.16],
    [3751.05, 0.15, 394.16],
    [4664.68, 0.225, 675.49],
    [Infinity, 0.275, 908.73],
  ];
  let imposto = 0;
  for (const [teto, aliq, ded] of faixas) {
    if (base <= teto) {
      imposto = base * aliq - ded;
      break;
    }
  }
  imposto = Math.max(0, imposto);
  let reducao = 0;
  if (rendimento <= 5000) reducao = 312.89;
  else if (rendimento <= 7350) reducao = 978.62 - 0.133145 * rendimento;
  return r2(Math.max(0, imposto - Math.min(imposto, reducao)));
}

export function calcularTrct(input: TrctInput): TrctCalc {
  const { salario, admissao, afastamento, tipo } = input;
  const avisos: string[] = [];
  const verbas: VerbaTrct[] = [];
  const P = (codigo: string, descricao: string, referencia: string, valor: number) => {
    if (valor > 0) verbas.push({ codigo, descricao, referencia, valor: r2(valor), tipo: 'P' });
  };
  const D = (codigo: string, descricao: string, referencia: string, valor: number) => {
    if (valor > 0) verbas.push({ codigo, descricao, referencia, valor: r2(valor), tipo: 'D' });
  };
  const diaria = salario / 30;

  // Saldo de salário.
  const [aa, mm, dd] = afastamento.split('-').map(Number);
  const inicioMes = `${aa}-${String(mm).padStart(2, '0')}-01`;
  const deSaldo = admissao > inicioMes ? admissao : inicioMes;
  const mesInteiro = deSaldo === inicioMes && dd === ultimoDiaMes(aa, mm);
  const diasSaldo = mesInteiro ? 30 : Math.min(30, diasEntre(deSaldo, afastamento) + 1);
  const saldo = r2(diaria * diasSaldo);
  P('50', 'Saldo de salário', `${diasSaldo} dias`, saldo);

  // Extras tributáveis entram no saldo (INSS/FGTS/IR).
  let extrasTrib = 0;
  for (const e of input.extras ?? []) {
    if (!(e.valor > 0)) continue;
    if (e.tipo === 'P') {
      P('95', e.descricao || 'Outros proventos', e.tributavel ? 'tributável' : '', e.valor);
      if (e.tributavel) extrasTrib += r2(e.valor);
    }
  }

  // Aviso prévio.
  const anos = anosCompletos(admissao, afastamento);
  let diasAviso = 0;
  let fimProjetado = afastamento;
  let avisoIndenizado = 0;
  if (tipoTemAviso(tipo)) {
    if (tipo === 'pedido_demissao') {
      diasAviso = 30;
      if (input.aviso === 'nao_cumprido') D('103', 'Aviso prévio não cumprido (art. 487 §2)', '30 dias', salario);
      if (input.aviso === 'indenizado') avisos.push('No pedido de demissão a empresa não paga aviso: use "não cumprido" ou "dispensado".');
    } else {
      diasAviso = Math.min(90, 30 + 3 * anos);
      if (input.aviso === 'indenizado') {
        const dias = tipo === 'acordo' ? Math.round(diasAviso / 2) : diasAviso;
        avisoIndenizado = r2(diaria * dias);
        P('69', tipo === 'acordo' ? 'Aviso prévio indenizado (metade, art. 484-A)' : 'Aviso prévio indenizado', `${dias} dias`, avisoIndenizado);
        fimProjetado = somarDiasYmd(afastamento, diasAviso);
      }
    }
  }

  // Contrato de experiência antes do prazo.
  if (tipo === 'experiencia_empregador' || tipo === 'experiencia_empregado') {
    if (!input.fimExperiencia || input.fimExperiencia <= afastamento) {
      avisos.push('Informe o fim previsto do contrato de experiência (depois da saída).');
    } else {
      const faltam = diasEntre(afastamento, input.fimExperiencia);
      const metade = r2(diaria * faltam / 2);
      if (tipo === 'experiencia_empregador') {
        P('95', 'Indenização art. 479 CLT (metade dos dias restantes)', `${faltam}/2 dias`, metade);
      } else if (input.descontarArt480) {
        D('115', 'Indenização art. 480 CLT (metade dos dias restantes)', `${faltam}/2 dias`, metade);
      }
    }
  }

  // 13º e férias.
  const perdeProporcionais = tipo === 'justa_causa';
  const a13Trab = perdeProporcionais ? 0 : avos13(admissao, afastamento);
  const a13Proj = perdeProporcionais ? 0 : avos13(admissao, fimProjetado);
  const dec = r2((salario / 12) * a13Trab);
  const decAviso = r2((salario / 12) * Math.max(0, a13Proj - a13Trab));
  P('63', '13º salário proporcional', `${a13Trab}/12`, dec);
  P('70', '13º salário (aviso prévio indenizado)', `${a13Proj - a13Trab}/12`, decAviso);

  const fer = perdeProporcionais ? { avos: 0, inicioPeriodo: admissao } : avosFerias(admissao, afastamento);
  const ferProj = perdeProporcionais ? fer : avosFerias(admissao, fimProjetado);
  const feriasProp = r2((salario / 12) * fer.avos);
  const avosProjExtra = ferProj.inicioPeriodo === fer.inicioPeriodo ? Math.max(0, ferProj.avos - fer.avos) : 12 - fer.avos + ferProj.avos;
  const feriasAviso = r2((salario / 12) * avosProjExtra);
  const venc = Math.max(0, Math.min(2, input.feriasVencidas ?? 0));
  const feriasVenc = r2(salario * venc);
  P('66', 'Férias vencidas', `${venc} período(s)`, feriasVenc);
  P('65', 'Férias proporcionais', `${fer.avos}/12`, feriasProp);
  P('71', 'Férias (aviso prévio indenizado)', `${avosProjExtra}/12`, feriasAviso);
  P('68', 'Terço constitucional de férias', '1/3', r2((feriasVenc + feriasProp + feriasAviso) / 3));
  if (tipo === 'justa_causa' && venc === 0 && anos >= 1) avisos.push('Justa causa ainda paga férias vencidas, se houver: confira se tem período não gozado.');
  if (anos >= 1 && venc === 0 && !perdeProporcionais) avisos.push(`Tem ${anos} ano(s) de casa: confira se há férias vencidas não gozadas.`);

  // Descontos legais.
  const baseInss = r2(saldo + extrasTrib);
  const inss = calcularInss(baseInss);
  D('112.1', 'Previdência social', '', inss);
  const baseInss13 = dec;
  const inss13 = calcularInss(baseInss13);
  D('112.2', 'Previdência social 13º salário', '', inss13);
  const ir = calcularIrrf(baseInss, inss, input.dependentesIr ?? 0);
  D('114.1', 'IRRF', '', ir);
  const ir13 = calcularIrrf(r2(dec + decAviso), inss13, input.dependentesIr ?? 0);
  D('114.2', 'IRRF sobre 13º salário', '', ir13);
  if (input.adiantamento13 && input.adiantamento13 > 0) D('102', 'Adiantamento de 13º salário', '', input.adiantamento13);
  for (const e of input.extras ?? []) {
    if (e.valor > 0 && e.tipo === 'D') D('115', e.descricao || 'Outros descontos', '', e.valor);
  }

  // FGTS.
  const fgtsMes = tr2((baseInss + avisoIndenizado) * 0.08);
  const fgts13 = tr2((dec + decAviso) * 0.08);
  const meses = Math.max(0, Math.round(diasEntre(admissao, afastamento) / 30.4375));
  const saldoFgtsEstimado = r2(salario * 0.08 * Math.max(0, meses - 1) + (salario / 12) * 0.08 * Math.max(0, meses - 1) + fgtsMes + fgts13);
  const multaFgtsPct =
    tipo === 'sem_justa_causa' || tipo === 'experiencia_empregador' ? 0.4 : tipo === 'acordo' ? 0.2 : 0;
  const baseMulta = input.saldoFgts && input.saldoFgts > 0 ? input.saldoFgts : saldoFgtsEstimado;
  const multaFgts = r2(baseMulta * multaFgtsPct);
  if (multaFgtsPct > 0 && !(input.saldoFgts && input.saldoFgts > 0)) {
    avisos.push('Multa do FGTS calculada sobre saldo ESTIMADO: confira o extrato do FGTS da pessoa (sai na guia GRRF/FGTS Digital, fora do TRCT).');
  }

  const proventos = r2(verbas.filter((v) => v.tipo === 'P').reduce((s, v) => s + v.valor, 0));
  let descontos = r2(verbas.filter((v) => v.tipo === 'D').reduce((s, v) => s + v.valor, 0));
  // Desconto não passa do que a pessoa tem a receber (art. 477 §5 limita a compensação).
  if (descontos > proventos) {
    avisos.push(`Descontos (${descontos.toFixed(2)}) passam dos proventos: o termo fecha em zero, a diferença não é cobrada.`);
    verbas.push({ codigo: '99', descricao: 'Ajuste do saldo devedor', referencia: '', valor: r2(descontos - proventos), tipo: 'P' });
  }
  const provFinal = r2(verbas.filter((v) => v.tipo === 'P').reduce((s, v) => s + v.valor, 0));
  descontos = r2(verbas.filter((v) => v.tipo === 'D').reduce((s, v) => s + v.valor, 0));

  return {
    verbas,
    proventos: provFinal,
    descontos,
    liquido: r2(provFinal - descontos),
    diasAviso,
    fimProjetado,
    avos13: a13Proj,
    avosFerias: fer.avos + avosProjExtra,
    diasSaldo,
    baseInss,
    baseInss13,
    fgtsMes,
    fgts13,
    saldoFgtsEstimado,
    multaFgtsPct,
    multaFgts,
    // Pagamento em até 10 dias do fim do contrato (art. 477 §6).
    dataLimite: somarDiasYmd(afastamento, 10),
    avisos,
  };
}

// Cálculo puro de horas a partir de batidas de ponto. Sem DB — mesma
// disciplina de lib/folha/calcular.ts.

export interface Batida {
  quando: Date;
  tipo: 'entrada' | 'saida';
}

export interface ParFechado {
  entrada: string;
  saida: string;
  min: number;
}

export interface DiaCalculado {
  totalMin: number;
  status: 'ok' | 'incompleto' | 'sem_batida';
  pares: ParFechado[];
  orfas: number;
}

/** Pareia batidas ordenadas cronologicamente: entrada→saída sequencial (N
 *  pares por dia — já suporta intervalo/almoço sem mudança de schema).
 *  Entrada sem saída correspondente contribui 0: nunca chuta hora de saída,
 *  o gestor corrige manualmente com justificativa (ponto_batida_ajuste).
 *  Saída sem entrada prévia é ignorada no total (orfã). */
export function calcularDia(batidas: Batida[]): DiaCalculado {
  const ordenadas = [...batidas].sort((a, b) => a.quando.getTime() - b.quando.getTime());
  if (ordenadas.length === 0) return { totalMin: 0, status: 'sem_batida', pares: [], orfas: 0 };

  const pares: ParFechado[] = [];
  let totalMin = 0;
  let entradaAberta: Date | null = null;
  let orfas = 0;
  let incompleta = false;

  for (const b of ordenadas) {
    if (b.tipo === 'entrada') {
      if (entradaAberta) incompleta = true; // duas entradas seguidas: a primeira fica sem par
      entradaAberta = b.quando;
    } else {
      if (!entradaAberta) { orfas++; continue; }
      const min = Math.round((b.quando.getTime() - entradaAberta.getTime()) / 60000);
      pares.push({ entrada: entradaAberta.toISOString(), saida: b.quando.toISOString(), min });
      totalMin += min;
      entradaAberta = null;
    }
  }
  if (entradaAberta) incompleta = true; // dia terminou com entrada aberta (esqueceu de bater saída)

  return { totalMin, status: incompleta ? 'incompleto' : 'ok', pares, orfas };
}

/** Adicional noturno (CLT art. 73): minutos trabalhados entre 22:00 e 05:00
 *  no horário de Brasília. `reais` = minutos de relógio; `fictos` = hora
 *  noturna reduzida de 52min30s (reais × 60/52,5), que é o que se paga. */
export function minutosNoturnos(pares: { entrada: string; saida: string }[]): { reais: number; fictos: number } {
  const BRT_MS = 3 * 3600_000; // Brasília sem horário de verão (UTC-3)
  let reaisMs = 0;
  for (const p of pares) {
    const ini = new Date(p.entrada).getTime();
    const fim = new Date(p.saida).getTime();
    if (!(fim > ini)) continue;
    // Janela 22:00–05:00 BRT de cada noite que o par pode tocar.
    const diaIni = Math.floor((ini - BRT_MS) / 86400_000) - 1;
    const diaFim = Math.floor((fim - BRT_MS) / 86400_000);
    for (let d = diaIni; d <= diaFim; d++) {
      const jIni = d * 86400_000 + BRT_MS + 22 * 3600_000;
      const jFim = jIni + 7 * 3600_000;
      const a = Math.max(ini, jIni);
      const b = Math.min(fim, jFim);
      if (b > a) reaisMs += b - a;
    }
  }
  const reais = Math.round(reaisMs / 60000);
  return { reais, fictos: Math.round((reaisMs / 60000) * 60 / 52.5) };
}

// ── Intervalo obrigatório (regra do dono, 03/11/2026) ─────────────────────
// Acabou o "desconta 30 min da convenção": quem trabalha mais de 6h no dia
// TEM que bater a saída e a volta do intervalo. Sem isso o dia fica PENDENTE
// — as horas não entram na folha (mensal, semanal) até o gestor lançar o
// horário real do intervalo em /rh/ponto (correção com justificativa).
// Vale a partir de INTERVALO_OBRIGATORIO_DESDE; outubro e antes ficam como
// estavam.
export const INTERVALO_OBRIGATORIO_DESDE = '2026-11-04';
/** Jornada acima disso exige intervalo (CLT art. 71). */
export const JORNADA_EXIGE_INTERVALO_MIN = 6 * 60;
/** Menor saída→volta que conta como intervalo batido. */
export const INTERVALO_MINIMO_MIN = 15;

/** Maior intervalo batido no dia (saída de um par → entrada do próximo), em minutos. */
export function maiorIntervaloMin(pares: { entrada: string; saida: string }[]): number {
  let maior = 0;
  const ord = [...pares].sort((a, b) => a.entrada.localeCompare(b.entrada));
  for (let i = 1; i < ord.length; i++) {
    const gap = Math.round((new Date(ord[i].entrada).getTime() - new Date(ord[i - 1].saida).getTime()) / 60000);
    if (gap > maior) maior = gap;
  }
  return maior;
}

/** Intervalo pré-assinalado (CCT SINDHOTRE 2026/2028 cl.15/17 — dono
 *  07/11/2026, cozinha do Prainha Bar): quem tem a marca no cadastro
 *  (funcionario.intervalo_pre_assinalado) não precisa bater o intervalo; no
 *  dia > 6h sem intervalo batido desconta 30 min em vez de ficar pendente.
 *  Se a pessoa bateu o intervalo, vale o batido (sem desconto extra). */
export const INTERVALO_PRE_ASSINALADO_MIN = 30;

// ── Intervalo automático de 30 min (CCT — dono 11/11/2026) ────────────────
// Passou de 5h no dia, tem 30 min de intervalo pela convenção SEM precisar
// bater: quem não bateu (ou bateu menos de 15 min) tem 30 min descontados das
// horas do dia, 48h depois do dia (prazo pro gerente conferir; até lá fica
// pendente) — vale pra todo mundo, não só pra quem tem a marca de pré-assinalado. A partir de INTERVALO_AUTOMATICO_DESDE;
// de 04/11 a 10/11 continua a regra anterior (> 6h sem intervalo = pendente).
export const INTERVALO_AUTOMATICO_DESDE = '2026-11-11';
export const JORNADA_INTERVALO_CCT_MIN = 5 * 60;

/** Prazo de conferência (dono 11/11/2026): o desconto automático só entra 48h
 *  depois do fim do dia operacional (que vira às 05:00). Até lá o dia aparece
 *  "sem intervalo" (pendente) pro gerente conferir e lançar o intervalo real. */
export const INTERVALO_AUTOMATICO_APOS_H = 48;

/** Já passou o prazo de conferência do dia (fim do dia operacional + 48h)? */
export function intervaloAutomaticoLiberado(dia: string, agora: number = Date.now()): boolean {
  if (dia < INTERVALO_AUTOMATICO_DESDE) return false;
  const fimDoDia = Date.parse(`${dia}T05:00:00-03:00`) + 24 * 3600_000;
  return agora >= fimDoDia + INTERVALO_AUTOMATICO_APOS_H * 3600_000;
}

/** Jornada do dia acima da qual o intervalo é devido (6h até 10/11; 5h depois). */
function jornadaExigeIntervalo(dia: string): number {
  return dia >= INTERVALO_AUTOMATICO_DESDE ? JORNADA_INTERVALO_CCT_MIN : JORNADA_EXIGE_INTERVALO_MIN;
}

/** Dia sem intervalo batido que exige intervalo (> 6h; > 5h desde 11/11). */
function semIntervaloBatido(dia: string, calc: { totalMin: number; pares: { entrada: string; saida: string }[] }): boolean {
  if (dia < INTERVALO_OBRIGATORIO_DESDE) return false;
  if (calc.totalMin <= jornadaExigeIntervalo(dia)) return false;
  return maiorIntervaloMin(calc.pares) < INTERVALO_MINIMO_MIN;
}

/** Dia (operacional, YYYY-MM-DD) com mais de 6h trabalhadas e nenhum
 *  intervalo de pelo menos 15 min batido, a partir da vigência da regra.
 *  Com intervalo pré-assinalado nunca fica pendente (desconta 30 min). */
export function faltaIntervalo(
  dia: string,
  calc: { totalMin: number; pares: { entrada: string; saida: string }[] },
  preAssinalado = false,
  agora: number = Date.now(),
): boolean {
  // Desde 11/11 o intervalo é automático (desconta 30 min) depois das 48h de
  // conferência: aí deixa de ser pendente.
  if (intervaloAutomaticoLiberado(dia, agora)) return false;
  return !preAssinalado && semIntervaloBatido(dia, calc);
}

/** Minutos de intervalo não batido descontados no dia (30 ou 0): pré-assinalado
 *  até 10/11; todo mundo com mais de 5h a partir de 11/11. */
export function descontoIntervaloPre(
  dia: string,
  calc: { totalMin: number; pares: { entrada: string; saida: string }[] },
  preAssinalado = false,
  agora: number = Date.now(),
): number {
  const automatico = preAssinalado || intervaloAutomaticoLiberado(dia, agora);
  return automatico && semIntervaloBatido(dia, calc) ? INTERVALO_PRE_ASSINALADO_MIN : 0;
}

// ── Intervalo mínimo de 30 min (CCT SINDHOTRE 2026/2028 — dono 11/11/2026) ─
// Quem bate o intervalo com MENOS de 30 min tem o intervalo contado como 30:
// no dia > 5h, a diferença até 30 min sai das horas trabalhadas (bateu 20 →
// desconta mais 10). Vale a partir de INTERVALO_30_DESDE — dia anterior fica
// como estava. Intervalo abaixo de 15 min continua "não batido" (pendente, ou
// 30 min no pré-assinalado), como antes.
export const INTERVALO_30_DESDE = '2026-11-11';
export const INTERVALO_CCT_MIN = 30;

/** Minutos que faltam pro intervalo batido chegar a 30 (0 quando não se aplica). */
export function complementoIntervaloMin(
  dia: string,
  calc: { totalMin: number; pares: { entrada: string; saida: string }[] },
): number {
  if (dia < INTERVALO_30_DESDE) return 0;
  if (calc.totalMin <= jornadaExigeIntervalo(dia)) return 0;
  const maior = maiorIntervaloMin(calc.pares);
  if (maior < INTERVALO_MINIMO_MIN || maior >= INTERVALO_CCT_MIN) return 0;
  return INTERVALO_CCT_MIN - maior;
}

/** Minutos trabalhados do dia já com o desconto do intervalo pré-assinalado
 *  e com o intervalo curto completado até 30 min. */
export function minutosDoDia(
  dia: string,
  calc: { totalMin: number; pares: { entrada: string; saida: string }[] },
  preAssinalado = false,
  agora: number = Date.now(),
): number {
  return calc.totalMin - descontoIntervaloPre(dia, calc, preAssinalado, agora) - complementoIntervaloMin(dia, calc);
}

/** Minutos que vão pra folha: dia sem intervalo fica pendente (0); com
 *  intervalo pré-assinalado, desconta 30 min. */
export function minutosParaFolha(
  dia: string,
  calc: { totalMin: number; pares: { entrada: string; saida: string }[] },
  preAssinalado = false,
  agora: number = Date.now(),
): number {
  return faltaIntervalo(dia, calc, preAssinalado, agora) ? 0 : minutosDoDia(dia, calc, preAssinalado, agora);
}

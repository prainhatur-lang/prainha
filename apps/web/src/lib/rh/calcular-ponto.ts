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

/** Dia (operacional, YYYY-MM-DD) com mais de 6h trabalhadas e nenhum
 *  intervalo de pelo menos 15 min batido, a partir da vigência da regra. */
export function faltaIntervalo(dia: string, calc: { totalMin: number; pares: { entrada: string; saida: string }[] }): boolean {
  if (dia < INTERVALO_OBRIGATORIO_DESDE) return false;
  if (calc.totalMin <= JORNADA_EXIGE_INTERVALO_MIN) return false;
  return maiorIntervaloMin(calc.pares) < INTERVALO_MINIMO_MIN;
}

/** Minutos que vão pra folha: dia sem intervalo fica pendente (0). */
export function minutosParaFolha(dia: string, calc: { totalMin: number; pares: { entrada: string; saida: string }[] }): number {
  return faltaIntervalo(dia, calc) ? 0 : calc.totalMin;
}

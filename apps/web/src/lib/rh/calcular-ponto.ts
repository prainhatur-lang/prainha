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

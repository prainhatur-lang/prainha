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

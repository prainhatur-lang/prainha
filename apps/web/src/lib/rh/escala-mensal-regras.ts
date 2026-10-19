// Regras puras da escala do mês (sem banco) — usadas pela grade no navegador
// e por lib/rh/escala-mensal.ts. Ver o cabeçalho de lá.

import { diaDaSemana } from '@/lib/rh/banco-horas';
import { somarDias } from '@/lib/rh/dia-operacional';

export type Sexo = 'H' | 'M';

/** Domingos entre folgas: homem 5 trabalhados + 1 de folga; mulher 1 + 1. */
export const CICLO_DOMINGO: Record<Sexo, number> = { H: 6, M: 2 };

export const DIA_SEMANA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function diasDoMes(mes: string): string[] {
  const [a, m] = mes.split('-').map(Number);
  const n = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`);
}

/** Domingos de folga da sugestão, dado o último domingo de folga e o ciclo. */
export function domingosDeFolga(domingos: string[], ultimo: string | null, ciclo: number, deslocamento: number): Set<string> {
  const out = new Set<string>();
  if (!domingos.length) return out;
  // Quantos domingos já foram trabalhados desde a última folga, no 1º domingo do mês.
  let trabalhados: number;
  if (ultimo) {
    const semanas = Math.round(
      (Date.parse(`${domingos[0]}T12:00:00Z`) - Date.parse(`${ultimo}T12:00:00Z`)) / (7 * 864e5),
    );
    trabalhados = semanas - 1;
  } else {
    // Sem histórico: espalha a turma pra não folgar todo mundo no mesmo domingo.
    trabalhados = deslocamento % ciclo;
  }
  for (const d of domingos) {
    if (trabalhados >= ciclo - 1) {
      out.add(d);
      trabalhados = 0;
    } else {
      trabalhados++;
    }
  }
  return out;
}

/** Sugestão do mês: folga fixa na semana; domingo pela CCT; na semana em que
 *  folga o domingo, trabalha o dia da folga fixa (6x1). Só dias na casa. */
export function sugerirMes(
  dias: string[],
  folgaFixa: number | null,
  sexo: Sexo | null,
  ultimoDomingoFolga: string | null,
  deslocamento: number,
  foraDaCasa: Set<string>,
): Record<string, boolean> {
  const domingos = dias.filter((d) => diaDaSemana(d) === 0);
  const folgaDom = sexo ? domingosDeFolga(domingos, ultimoDomingoFolga, CICLO_DOMINGO[sexo], deslocamento) : new Set<string>();
  const out: Record<string, boolean> = {};
  for (const d of dias) {
    if (foraDaCasa.has(d)) continue;
    const w = diaDaSemana(d);
    if (w === 0) {
      out[d] = folgaDom.has(d);
      continue;
    }
    // Semana seg–dom: se o domingo dela é folga, não folga na semana.
    out[d] = folgaFixa === w && !folgaDom.has(somarDias(d, 7 - w));
  }
  return out;
}

/** Avisos da linha: semana sem folga, 2 folgas na semana, domingo fora da CCT. */
export function avisosEscala(
  dias: string[],
  folga: Record<string, boolean | undefined>,
  sexo: Sexo | null,
  ultimoDomingoFolga: string | null,
): string[] {
  const out: string[] = [];
  // Semanas seg–dom inteiras dentro do mês.
  for (const d of dias) {
    if (diaDaSemana(d) !== 1) continue;
    const semana = Array.from({ length: 7 }, (_, i) => somarDias(d, i));
    if (semana[6] > dias[dias.length - 1]) continue;
    if (semana.some((x) => folga[x] === undefined)) continue;
    const n = semana.filter((x) => folga[x]).length;
    const nome = `${d.slice(8)}/${d.slice(5, 7)}`;
    if (n === 0) out.push(`semana de ${nome} sem folga`);
    if (n > 1) out.push(`semana de ${nome} com ${n} folgas`);
  }
  if (sexo) {
    const limite = CICLO_DOMINGO[sexo] - 1;
    let seguidos: number | null = null;
    if (ultimoDomingoFolga) {
      const primeiro = dias.find((d) => diaDaSemana(d) === 0)!;
      seguidos = Math.round((Date.parse(`${primeiro}T12:00:00Z`) - Date.parse(`${ultimoDomingoFolga}T12:00:00Z`)) / (7 * 864e5)) - 1;
    }
    for (const d of dias) {
      if (diaDaSemana(d) !== 0 || folga[d] === undefined) continue;
      if (folga[d]) {
        seguidos = 0;
        continue;
      }
      seguidos = (seguidos ?? 0) + 1;
      if (seguidos > limite) {
        out.push(`domingo ${d.slice(8)}/${d.slice(5, 7)}: ${seguidos}º seguido (${sexo === 'H' ? 'homem folga 1 a cada 5' : 'mulher folga a cada 2 semanas'})`);
      }
    }
  }
  return out;
}

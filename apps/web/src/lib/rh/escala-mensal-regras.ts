// Regras puras da escala do mês (sem banco) — usadas pela grade no navegador
// e por lib/rh/escala-mensal.ts. Ver o cabeçalho de lá.

import { diaDaSemana } from '@/lib/rh/banco-horas';
import { somarDias } from '@/lib/rh/dia-operacional';

export type Sexo = 'H' | 'M';

/** Domingos entre folgas: homem 5 trabalhados + 1 de folga; mulher 1 + 1. */
export const CICLO_DOMINGO: Record<Sexo, number> = { H: 6, M: 2 };

/** Folgas por semana seg–dom por casa (dono 22/11/2026: Prainha Bar folga 2).
 *  Casa fora da lista = 6x1 (1 folga). O domingo de folga conta como uma delas. */
const FOLGAS_POR_SEMANA: Record<string, number> = {
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9': 2, // Prainha Bar
};

export function folgasPorSemana(filialId: string): number {
  return FOLGAS_POR_SEMANA[filialId] ?? 1;
}

/** Texto curto da regra pro cabeçalho da tela. */
export function regraDaCasa(folgas: number): string {
  return folgas === 1
    ? '6x1: uma folga na semana; quem folga o domingo trabalha a semana inteira'
    : `${7 - folgas}x${folgas}: ${folgas} folgas na semana; o domingo de folga conta como uma delas`;
}

/** Dias de seg–sáb de folga na semana, a partir da folga fixa: ela e os dias
 *  seguintes (sábado volta pra segunda). */
function diasDeFolgaNaSemana(folgaFixa: number, quantos: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < quantos && i < 6; i++) out.add(((folgaFixa - 1 + i) % 6) + 1);
  return out;
}

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

/** Sugestão do mês: folga fixa na semana; domingo pela CCT; o domingo de folga
 *  conta como uma das folgas da semana (6x1: trabalha o dia da folga fixa;
 *  2 folgas: folga só a fixa). Com 2 folgas, a 2ª é o dia seguinte à fixa.
 *  Só dias na casa. */
export function sugerirMes(
  dias: string[],
  folgaFixa: number | null,
  sexo: Sexo | null,
  ultimoDomingoFolga: string | null,
  deslocamento: number,
  foraDaCasa: Set<string>,
  folgasSemana = 1,
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
    // Semana seg–dom: o domingo de folga já é uma das folgas dela.
    if (folgaFixa == null) {
      out[d] = false;
      continue;
    }
    const naSemana = folgasSemana - (folgaDom.has(somarDias(d, 7 - w)) ? 1 : 0);
    out[d] = diasDeFolgaNaSemana(folgaFixa, naSemana).has(w);
  }
  return out;
}

/** Avisos da linha: semana com folga de menos ou de mais (pela regra da casa),
 *  domingo fora da CCT. */
export function avisosEscala(
  dias: string[],
  folga: Record<string, boolean | undefined>,
  sexo: Sexo | null,
  ultimoDomingoFolga: string | null,
  folgasSemana = 1,
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
    else if (n < folgasSemana) out.push(`semana de ${nome} com ${n} folga (a casa folga ${folgasSemana})`);
    else if (n > folgasSemana) out.push(`semana de ${nome} com ${n} folgas`);
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

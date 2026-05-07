// Parser do XLSX do "Espelho de Ponto" da Stelanto.
//
// Formato observado: 1 aba por pessoa (nome da aba = nome da pessoa). Em
// cada aba há uma linha de header com "Data", "Entrada", "Saida", "T.Dia"
// e abaixo as linhas dos 7 dias da semana (seg/ter/qua/qui/sex/sáb/dom).
//
// A coluna de "T.Dia" varia entre abas — descobrimos achando o índice da
// célula com texto "T.Dia" no primeiro header encontrado.

import * as XLSX from 'xlsx';

export interface HorasPorPessoa {
  /** Nome da aba (= nome da pessoa segundo a Stelanto). */
  nomeEspelho: string;
  /** { 'YYYY-MM-DD': minutosTrabalhados } pra cada dia da semana. */
  horasPorDia: Record<string, number>;
}

const DIAS_ABBR = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom', 'sab'] as const;

/** Lê o XLSX e extrai horas por pessoa por dia. */
export function parseEspelho(
  buf: ArrayBuffer | Buffer,
  dataInicio: string, // YYYY-MM-DD da segunda
): HorasPorPessoa[] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const segundaDate = new Date(dataInicio + 'T00:00:00');

  const out: HorasPorPessoa[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: null,
      raw: false,
    });

    // Acha a coluna T.Dia
    let tDiaCol = -1;
    for (const row of matrix) {
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        if (row[c] && String(row[c]).trim() === 'T.Dia') {
          tDiaCol = c;
          break;
        }
      }
      if (tDiaCol >= 0) break;
    }
    if (tDiaCol < 0) continue;

    const horasPorDia: Record<string, number> = {};
    for (const row of matrix) {
      if (!row || !row[0]) continue;
      const cell = String(row[0]).toLowerCase().trim();
      // ex: "seg 27/04/26", "ter 28/04/26", etc.
      let diaIdx = -1;
      for (let i = 0; i < DIAS_ABBR.length; i++) {
        if (cell.startsWith(DIAS_ABBR[i])) {
          diaIdx = i >= 7 ? 6 : i; // 'sab' -> 'sáb' (6)
          break;
        }
      }
      if (diaIdx < 0 || cell.length > 25) continue; // pula linhas que não são dia

      // Mapeia índice da semana (0-6) → data ISO usando dataInicio
      const data = new Date(segundaDate);
      data.setDate(segundaDate.getDate() + diaIdx);
      const iso = data.toISOString().slice(0, 10);

      const tDia = String(row[tDiaCol] ?? '').replace(/[\[\]⁠]/g, '').trim();
      const m = tDia.match(/^(\d+):(\d+)/);
      const minutos = m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;

      horasPorDia[iso] = minutos;
    }

    if (Object.keys(horasPorDia).length === 0) continue;
    out.push({ nomeEspelho: sheetName, horasPorDia });
  }

  return out;
}

/** Faz fuzzy match entre nome do espelho e lista de pessoas (fornecedor.nome).
 *  Retorna o melhor match (score ≥ 0.5) ou null. */
export function fuzzyMatchPessoa(
  nomeEspelho: string,
  pessoas: { fornecedorId: string; nome: string }[],
): { fornecedorId: string; score: number } | null {
  const tokensEsp = tokens(nomeEspelho);
  let best: { fornecedorId: string; score: number } | null = null;
  for (const p of pessoas) {
    const tokensPessoa = tokens(p.nome);
    const score = jaccard(tokensEsp, tokensPessoa);
    if (score > 0.4 && (!best || score > best.score)) {
      best = { fornecedorId: p.fornecedorId, score };
    }
  }
  return best;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}

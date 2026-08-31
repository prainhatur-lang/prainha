// Agregação do dashboard de clima (eNPS) — supressão k-anônima (k=3): uma
// competência com menos de 3 respostas não mostra distribuição nem
// comentários, só "poucas respostas, oculto". Comentários ordenados por
// NOTA (nunca por data/id — ordem de chegada é informação).

import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

const K_MINIMO = 3;

export interface MesClima {
  competencia: string;
  total: number;
  /** null = suprimido por k-anonimato (total < 3). */
  enps: number | null;
  promotores: number;
  neutros: number;
  detratores: number;
  comentarios: Array<{ nota: number; comentario: string }> | null;
}

function competenciasRecentes(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export async function dashboardClima(filialId: string, meses = 6): Promise<MesClima[]> {
  const competencias = competenciasRecentes(meses);

  return Promise.all(
    competencias.map(async (competencia): Promise<MesClima> => {
      const respostas = await db
        .select({ nota: schema.climaResposta.nota, comentario: schema.climaResposta.comentario })
        .from(schema.climaResposta)
        .where(and(eq(schema.climaResposta.filialId, filialId), eq(schema.climaResposta.competencia, competencia)));

      const total = respostas.length;
      if (total < K_MINIMO) {
        return { competencia, total, enps: null, promotores: 0, neutros: 0, detratores: 0, comentarios: null };
      }

      const promotores = respostas.filter((r) => r.nota >= 9).length;
      const detratores = respostas.filter((r) => r.nota <= 6).length;
      const neutros = total - promotores - detratores;
      const enps = Math.round(((promotores - detratores) / total) * 100);

      const comentarios = respostas
        .filter((r): r is { nota: number; comentario: string } => !!r.comentario)
        .sort((a, b) => b.nota - a.nota);

      return { competencia, total, enps, promotores, neutros, detratores, comentarios };
    }),
  );
}

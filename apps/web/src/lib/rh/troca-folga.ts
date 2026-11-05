// Trocas de folga feitas no tablet do ponto (05/11/2026). Quem pede trabalha
// em dia_trabalha no lugar do colega e folga em dia_devolve; o colega confirma
// no tablet. Confirmada, /api/loja/ponto/troca já mudou a escala dos dois.
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export interface TrocaFolga {
  id: string;
  solicitante: string;
  colega: string;
  diaTrabalha: string;
  diaDevolve: string;
  status: string;
  criadaEm: string;
  respondidaEm: string | null;
  escalaAplicada: boolean;
}

export async function trocasFolgaRecentes(filialId: string, desde: string): Promise<TrocaFolga[]> {
  const rows = (await db.execute(sql`
    SELECT t.id::text AS id, coalesce(s.nome, '?') AS solicitante, coalesce(c.nome, '?') AS colega,
           t.dia_trabalha::text AS dia_trabalha, t.dia_devolve::text AS dia_devolve, t.status,
           to_char(t.criada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS criada_em,
           to_char(t.respondida_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS respondida_em,
           (t.escala_aplicada_em IS NOT NULL) AS escala_aplicada
      FROM rh_troca_folga t
      LEFT JOIN funcionario s ON s.id = t.solicitante_id
      LEFT JOIN funcionario c ON c.id = t.colega_id
     WHERE t.filial_id = ${filialId}
       AND (t.dia_trabalha >= ${desde}::date OR t.dia_devolve >= ${desde}::date)
     ORDER BY t.criada_em DESC
     LIMIT 100`)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    solicitante: String(r.solicitante),
    colega: String(r.colega),
    diaTrabalha: String(r.dia_trabalha),
    diaDevolve: String(r.dia_devolve),
    status: String(r.status),
    criadaEm: String(r.criada_em),
    respondidaEm: r.respondida_em ? String(r.respondida_em) : null,
    escalaAplicada: !!r.escala_aplicada,
  }));
}

/**
 * Troca que a escala ainda não mostra (05/11/2026, pedido do dono: "evitar
 * que bote como falta"). Esperando o colega, ou confirmada mas ainda não
 * aplicada. Volta funcionário → dia → folga. Quem pede trabalha em
 * dia_trabalha e folga em dia_devolve; o colega fica com o contrário.
 * Recusada não conta. Confirmada e aplicada já está na escala.
 */
export async function trocasForaDaEscala(ids: string[], inicio: string, fim: string): Promise<Map<string, Map<string, boolean>>> {
  const out = new Map<string, Map<string, boolean>>();
  if (!ids.length) return out;
  const lista = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    SELECT solicitante_id::text AS s, colega_id::text AS c,
           dia_trabalha::text AS t, dia_devolve::text AS d
      FROM rh_troca_folga
     WHERE (status = 'aguardando' OR (status = 'confirmada' AND escala_aplicada_em IS NULL))
       AND (solicitante_id IN (${lista}) OR colega_id IN (${lista}))
       AND ((dia_trabalha BETWEEN ${inicio}::date AND ${fim}::date) OR (dia_devolve BETWEEN ${inicio}::date AND ${fim}::date))
     ORDER BY criada_em`)) as unknown as Array<{ s: string; c: string; t: string; d: string }>;
  const marca = (fid: string, dia: string, folga: boolean) => {
    if (!ids.includes(fid) || dia < inicio || dia > fim) return;
    const m = out.get(fid) ?? new Map<string, boolean>();
    m.set(dia, folga);
    out.set(fid, m);
  };
  for (const r of rows) {
    marca(r.s, r.t, false);
    marca(r.s, r.d, true);
    marca(r.c, r.t, true);
    marca(r.c, r.d, false);
  }
  return out;
}

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

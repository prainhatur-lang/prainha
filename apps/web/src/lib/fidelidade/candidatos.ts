// Quem já frequenta e ainda não tem cartão — base pro convite.
//
// Junta 3 fontes das casas da organização, casando pelos últimos 8 dígitos do
// telefone (mesmo critério da base de clientes do grupo):
//   · PDV: dias distintos com pedido no nome do cliente (12 meses)
//   · Reservas do Concilia que sentaram (12 meses)
//   · Tagme: nº de reservas no histórico do export
// "visitas" = o maior dos três (as fontes se sobrepõem, somar contaria 2x).

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export interface Candidato {
  chave: string;
  nome: string;
  telefone: string;
  pdvDias: number;
  reservas: number;
  tagme: number;
  visitas: number;
  /** visitas dentro da janela do programa (PDV/reserva têm data; Tagme é
   *  total histórico, entra proporcional) — é o que sugere o nível */
  visitasJanela: number;
  filialId: string | null;
}

export async function candidatosConvite(organizacaoId: string, janelaDias = 90, minimo = 2, limite = 6000): Promise<Candidato[]> {
  const rows = (await db.execute(sql`
    WITH filiais AS (SELECT id FROM filial WHERE organizacao_id = ${organizacaoId}),
    pdv AS (
      SELECT regexp_replace(coalesce(nullif(c.celular, ''), c.telefone), '\\D', '', 'g') AS fone,
             max(c.nome) AS nome, max(p.filial_id::text) AS filial_id,
             count(DISTINCT (p.data_abertura AT TIME ZONE 'America/Sao_Paulo')::date)::int AS n,
             count(DISTINCT (p.data_abertura AT TIME ZONE 'America/Sao_Paulo')::date)
               FILTER (WHERE p.data_abertura >= now() - make_interval(days => ${janelaDias}))::int AS nj
      FROM pedido p
      JOIN cliente c ON c.filial_id = p.filial_id AND c.codigo_externo = p.codigo_cliente_contato_externo
      WHERE p.filial_id IN (SELECT id FROM filiais)
        AND p.codigo_cliente_contato_externo IS NOT NULL AND p.data_delete IS NULL
        AND p.data_abertura >= now() - interval '365 days'
        AND c.data_delete IS NULL
      GROUP BY 1
    ),
    res AS (
      SELECT regexp_replace(r.cliente_telefone, '\\D', '', 'g') AS fone,
             max(r.cliente_nome) AS nome, max(r.filial_id::text) AS filial_id, count(*)::int AS n,
             count(*) FILTER (WHERE r.data >= (now() - make_interval(days => ${janelaDias}))::date)::int AS nj
      FROM reserva r
      WHERE r.filial_id IN (SELECT id FROM filiais)
        AND r.status IN ('sentada', 'concluida')
        AND r.data >= (now() - interval '365 days')::date
      GROUP BY 1
    ),
    tag AS (
      SELECT regexp_replace(cc.telefone, '\\D', '', 'g') AS fone,
             max(trim(cc.nome || ' ' || coalesce(cc.sobrenome, ''))) AS nome,
             max(cc.filial_id::text) AS filial_id, max(coalesce(cc.reservas_historico, 0))::int AS n,
             0 AS nj
      FROM cliente_contato cc
      WHERE cc.filial_id IN (SELECT id FROM filiais) AND coalesce(cc.reservas_historico, 0) > 0
      GROUP BY 1
    ),
    tudo AS (
      SELECT 'pdv' AS src, * FROM pdv UNION ALL
      SELECT 'res', * FROM res UNION ALL
      SELECT 'tag', * FROM tag
    ),
    k AS (
      SELECT right(fone, 8) AS chave, src, fone, nome, filial_id, n, nj
      FROM tudo WHERE length(fone) >= 10
    ),
    agg AS (
      SELECT chave,
        -- telefone mais completo (com DDD e o 9) e o nome mais longo
        (array_agg(fone ORDER BY length(fone) DESC))[1] AS telefone,
        (array_agg(nome ORDER BY length(coalesce(nome, '')) DESC))[1] AS nome,
        (array_agg(filial_id ORDER BY n DESC))[1] AS filial_id,
        coalesce(max(n) FILTER (WHERE src = 'pdv'), 0) AS pdv_dias,
        coalesce(max(n) FILTER (WHERE src = 'res'), 0) AS reservas,
        coalesce(max(n) FILTER (WHERE src = 'tag'), 0) AS tagme,
        coalesce(max(nj), 0) AS nj
      FROM k GROUP BY chave
    )
    SELECT a.*, greatest(a.pdv_dias, a.reservas, a.tagme) AS visitas,
      greatest(a.nj, round(a.tagme * ${janelaDias}::numeric / 365))::int AS visitas_janela
    FROM agg a
    WHERE greatest(a.pdv_dias, a.reservas, a.tagme) >= ${minimo}
      AND coalesce(trim(a.nome), '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM fidelidade_cartao fc
        WHERE fc.organizacao_id = ${organizacaoId} AND right(fc.telefone, 8) = a.chave
      )
    ORDER BY visitas_janela DESC, visitas DESC
    LIMIT ${limite}
  `)) as unknown as Array<{
    chave: string; telefone: string; nome: string; filial_id: string | null;
    pdv_dias: number; reservas: number; tagme: number; visitas: number; visitas_janela: number;
  }>;
  return rows.map((r) => ({
    chave: r.chave,
    nome: titulo(r.nome),
    telefone: r.telefone,
    pdvDias: Number(r.pdv_dias),
    reservas: Number(r.reservas),
    tagme: Number(r.tagme),
    visitas: Number(r.visitas),
    visitasJanela: Number(r.visitas_janela),
    filialId: r.filial_id,
  }));
}

/** "MARIA DA SILVA" → "Maria da Silva" */
function titulo(s: string): string {
  const min = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase()
    .split(' ').map((p, i) => (i > 0 && min.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
}

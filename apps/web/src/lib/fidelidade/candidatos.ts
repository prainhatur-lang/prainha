// Quem já frequenta e ainda não tem cartão — base pro convite.
//
// Junta 3 fontes das casas da organização, casando pelos últimos 8 dígitos do
// telefone (mesmo critério da base de clientes do grupo):
//   · PDV: dias distintos com pedido no nome do cliente (12 meses)
//   · Reservas do Concilia que sentaram (12 meses)
//   · Tagme: nº de reservas no histórico do export
// "visitas" = o maior dos três (as fontes se sobrepõem, somar contaria 2x).
//
// Endereço vem do cadastro de clientes do Consumer (CONTATOS) — é por ele que
// se filtra quem mora em Aracaju (cidade ou CEP 490xx). Com filtro de região,
// entra também quem tem endereço mas nenhuma visita contada (mínimo 0).

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
  cidade: string | null;
  bairro: string | null;
  /** última visita contada (PDV ou reserva), YYYY-MM-DD */
  ultima: string | null;
  /** celular (11 dígitos com o 9) — dá pra mandar WhatsApp */
  celular: boolean;
}

/** aracaju = cidade/CEP de Aracaju; grande = + Socorro, Barra dos Coqueiros e
 *  São Cristóvão; todos = sem filtro de endereço. */
export type Regiao = 'aracaju' | 'grande' | 'todos';

export async function candidatosConvite(
  filialId: string, janelaDias = 90, minimo = 2, regiao: Regiao = 'todos', limite = 6000,
): Promise<Candidato[]> {
  const filtraRegiao = regiao !== 'todos';
  const rows = (await db.execute(sql`
    WITH filiais AS (SELECT ${filialId}::uuid AS id),
    pdv AS (
      SELECT regexp_replace(coalesce(nullif(c.celular, ''), c.telefone), '\\D', '', 'g') AS fone,
             max(c.nome) AS nome, max(p.filial_id::text) AS filial_id,
             count(DISTINCT (p.data_abertura AT TIME ZONE 'America/Sao_Paulo')::date)::int AS n,
             count(DISTINCT (p.data_abertura AT TIME ZONE 'America/Sao_Paulo')::date)
               FILTER (WHERE p.data_abertura >= now() - make_interval(days => ${janelaDias}))::int AS nj,
             max((p.data_abertura AT TIME ZONE 'America/Sao_Paulo')::date) AS ultima
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
             count(*) FILTER (WHERE r.data >= (now() - make_interval(days => ${janelaDias}))::date)::int AS nj,
             max(r.data) AS ultima
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
             0 AS nj, NULL::date AS ultima
      FROM cliente_contato cc
      WHERE cc.filial_id IN (SELECT id FROM filiais) AND coalesce(cc.reservas_historico, 0) > 0
      GROUP BY 1
    ),
    -- endereço do cadastro (Consumer): 1 por telefone, o de Aracaju primeiro
    ende_bruto AS (
      SELECT regexp_replace(coalesce(nullif(c.celular, ''), c.telefone), '\\D', '', 'g') AS fone,
             c.nome, c.filial_id::text AS filial_id,
             nullif(trim(c.cidade), '') AS cidade, nullif(trim(c.bairro), '') AS bairro,
             (c.cidade ILIKE '%aracaj%' OR regexp_replace(coalesce(c.cep, ''), '\\D', '', 'g') ~ '^490') AS aju,
             (c.cidade ILIKE '%socorro%' OR c.cidade ILIKE '%barra dos coqueiros%'
               OR c.cidade ILIKE 's%o crist%v%o%') AS grande,
             c.sincronizado_em
      FROM cliente c
      WHERE c.filial_id IN (SELECT id FROM filiais) AND c.data_delete IS NULL
        AND coalesce(trim(c.endereco), '') <> ''
    ),
    ende AS (
      SELECT right(fone, 8) AS chave,
             (array_agg(fone ORDER BY aju DESC, length(fone) DESC, sincronizado_em DESC))[1] AS fone,
             (array_agg(nome ORDER BY aju DESC, sincronizado_em DESC))[1] AS nome,
             (array_agg(filial_id ORDER BY aju DESC, sincronizado_em DESC))[1] AS filial_id,
             (array_agg(cidade ORDER BY aju DESC, sincronizado_em DESC))[1] AS cidade,
             (array_agg(bairro ORDER BY aju DESC, sincronizado_em DESC))[1] AS bairro,
             bool_or(aju) AS aju, bool_or(aju OR grande) AS grande
      FROM ende_bruto WHERE length(fone) >= 10
      GROUP BY 1
    ),
    tudo AS (
      SELECT 'pdv' AS src, * FROM pdv UNION ALL
      SELECT 'res', * FROM res UNION ALL
      SELECT 'tag', * FROM tag UNION ALL
      -- quem só tem endereço (nenhuma visita contada) entra com 0
      SELECT 'end', fone, nome, filial_id, 0, 0, NULL::date FROM ende WHERE ${filtraRegiao}::boolean
    ),
    k AS (
      SELECT right(fone, 8) AS chave, src, fone, nome, filial_id, n, nj, ultima
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
        coalesce(max(nj), 0) AS nj,
        max(ultima)::text AS ultima
      FROM k GROUP BY chave
    )
    SELECT a.*, greatest(a.pdv_dias, a.reservas, a.tagme) AS visitas,
      greatest(a.nj, round(a.tagme * ${janelaDias}::numeric / 365))::int AS visitas_janela,
      e.cidade, e.bairro
    FROM agg a
    LEFT JOIN ende e ON e.chave = a.chave
    WHERE greatest(a.pdv_dias, a.reservas, a.tagme) >= ${minimo}
      AND coalesce(trim(a.nome), '') <> ''
      AND (${regiao}::text = 'todos'
        OR (${regiao}::text = 'aracaju' AND coalesce(e.aju, false))
        OR (${regiao}::text = 'grande' AND coalesce(e.grande, false)))
      AND NOT EXISTS (
        SELECT 1 FROM fidelidade_cartao fc
        WHERE fc.filial_id = ${filialId}::uuid AND right(fc.telefone, 8) = a.chave
      )
    ORDER BY visitas_janela DESC, visitas DESC, a.ultima DESC NULLS LAST
    LIMIT ${limite}
  `)) as unknown as Array<{
    chave: string; telefone: string; nome: string; filial_id: string | null;
    pdv_dias: number; reservas: number; tagme: number; visitas: number; visitas_janela: number;
    ultima: string | null; cidade: string | null; bairro: string | null;
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
    cidade: r.cidade ? titulo(r.cidade) : null,
    bairro: r.bairro ? titulo(r.bairro) : null,
    ultima: r.ultima,
    celular: ehCelular(r.telefone),
  }));
}

/** 79 9xxxx-xxxx (com ou sem 55) — fixo não recebe WhatsApp */
export function ehCelular(fone: string): boolean {
  let d = String(fone || '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return d.length === 11 && d[2] === '9';
}

/** "MARIA DA SILVA" → "Maria da Silva" */
function titulo(s: string): string {
  const min = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase()
    .split(' ').map((p, i) => (i > 0 && min.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
}

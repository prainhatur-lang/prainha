// Cria match MANUAL pra Cielo Pix orfa <-> pagamento PDV sem NSU/aut
// quando a evidencia eh forte: mesma data, valor exato, candidato unico
// em AMBOS os lados (1-pra-1).
//
// Cenario: garcom recebe Pix pelo Smart POS Cielo via app/celular e
// registra como "Pix Manual Outros" no PDV sem capturar o NSU. PDV
// fica sem NSU/aut, Cielo tem NSU + valor. O engine padrao nao tem
// chave forte pra casar.
//
// Usado pelo cron diario /api/cron/match-pix-orfao e pelo script
// apps/web/scripts/match-pix-orfao.mjs.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export interface MatchPixOrfaoResult {
  matchesCriados: number;
  excecoesApagadas: number;
}

export async function rodarMatchPixOrfao(): Promise<MatchPixOrfaoResult> {
  const r = await db.execute(sql`
    WITH cielo_pix_orfa AS (
      SELECT e.id AS excecao_id, va.id AS venda_id, va.filial_id,
             va.data_venda, va.valor_bruto
        FROM excecao e
        JOIN venda_adquirente va ON va.id = e.venda_adquirente_id
       WHERE e.tipo = 'CIELO_SEM_PDV'
         AND e.aceita_em IS NULL
         AND lower(coalesce(va.forma_pagamento,'')) LIKE '%pix%'
    ),
    pagto_candidato AS (
      SELECT p.id AS pagamento_id, p.filial_id,
             p.data_pagamento::date AS data, p.valor
        FROM pagamento p
        LEFT JOIN match_pdv_cielo m ON m.pagamento_id = p.id
       WHERE p.nsu_transacao IS NULL
         AND p.numero_autorizacao_cartao IS NULL
         AND m.id IS NULL
    ),
    pares AS (
      SELECT c.excecao_id, c.venda_id, c.filial_id, p.pagamento_id,
             COUNT(*) OVER (PARTITION BY c.venda_id) AS qtd_p,
             COUNT(*) OVER (PARTITION BY p.pagamento_id) AS qtd_v
        FROM cielo_pix_orfa c
        JOIN pagto_candidato p
          ON p.filial_id = c.filial_id
         AND p.data = c.data_venda
         AND p.valor = c.valor_bruto
    ),
    unicos AS (
      SELECT * FROM pares WHERE qtd_p = 1 AND qtd_v = 1
    ),
    ins AS (
      INSERT INTO match_pdv_cielo (
        filial_id, pagamento_id, venda_adquirente_id, nivel_match,
        auto_revogavel_ate, criado_por, diff_valor, observacao
      )
      SELECT filial_id, pagamento_id, venda_id, '3',
             NULL, 'AUTO', 0,
             'Pix orfao: PDV sem NSU + Cielo Pix mesmo valor/data — match em batch'
        FROM unicos
      RETURNING id
    ),
    del AS (
      DELETE FROM excecao
       WHERE id IN (SELECT excecao_id FROM unicos)
      RETURNING id
    )
    SELECT
      (SELECT COUNT(*)::int FROM ins) AS matches_criados,
      (SELECT COUNT(*)::int FROM del) AS excecoes_apagadas
  `);
  const row = (r as unknown as Array<{ matches_criados: number; excecoes_apagadas: number }>)[0];
  return {
    matchesCriados: row?.matches_criados ?? 0,
    excecoesApagadas: row?.excecoes_apagadas ?? 0,
  };
}

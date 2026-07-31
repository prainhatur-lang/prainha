// Cria match MANUAL pra pares Pix Cielo orfa ↔ pagamento PDV sem NSU/aut
// quando a evidencia eh forte: mesma data, valor exato, candidato unico em ambos os lados.
// DRY-RUN primeiro — sem --apply nada eh escrito.
import postgres from 'postgres'
const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
const sql = postgres(url, { max: 1, prepare: false })

const APPLY = process.argv.includes('--apply')

console.log(APPLY ? '\n=== MODO APPLY ===' : '\n=== DRY RUN (passa --apply pra escrever) ===')

console.log('\n=== 1) Candidatos: Cielo Pix orfa <-> PDV unico sem NSU/aut, mesma data, mesmo valor ===')
const cand = await sql`
  WITH cielo_pix_orfa AS (
    SELECT e.id AS excecao_id, va.id AS venda_id, va.filial_id,
           va.data_venda, va.valor_bruto, va.nsu, va.bandeira
      FROM excecao e
      JOIN venda_adquirente va ON va.id = e.venda_adquirente_id
     WHERE e.tipo = 'CIELO_SEM_PDV'
       AND e.aceita_em IS NULL
       AND lower(coalesce(va.forma_pagamento,'')) LIKE '%pix%'
  ),
  pagto_candidato AS (
    SELECT p.id AS pagamento_id, p.filial_id,
           p.data_pagamento::date AS data,
           p.valor, p.codigo_pedido_externo
      FROM pagamento p
     WHERE p.nsu_transacao IS NULL
       AND p.numero_autorizacao_cartao IS NULL
       AND p.data_pagamento::date BETWEEN '2026-05-01' AND '2026-06-13'
  ),
  pares AS (
    SELECT c.excecao_id, c.venda_id, c.filial_id, c.nsu, c.data_venda, c.valor_bruto,
           p.pagamento_id, p.codigo_pedido_externo,
           COUNT(*) OVER (PARTITION BY c.venda_id) AS qtd_pagto_pra_essa_venda,
           COUNT(*) OVER (PARTITION BY p.pagamento_id) AS qtd_venda_pra_esse_pagto
      FROM cielo_pix_orfa c
      JOIN pagto_candidato p
        ON p.filial_id = c.filial_id
       AND p.data = c.data_venda
       AND p.valor = c.valor_bruto
  ),
  -- pares onde ambos os lados sao 1-pra-1 (sem ambiguidade)
  unicos AS (
    SELECT *
      FROM pares
     WHERE qtd_pagto_pra_essa_venda = 1
       AND qtd_venda_pra_esse_pagto = 1
  )
  SELECT f.nome AS filial, COUNT(*) AS unicos_qtd,
         SUM(valor_bruto)::numeric(14,2) AS valor
    FROM unicos u
    JOIN filial f ON f.id = u.filial_id
   GROUP BY f.nome
   ORDER BY f.nome
`
console.table(cand)

console.log('\n=== 2) Casos AMBIGUOS (com mais de 1 candidato em algum lado) ===')
const amb = await sql`
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
           p.data_pagamento::date AS data,
           p.valor
      FROM pagamento p
     WHERE p.nsu_transacao IS NULL
       AND p.numero_autorizacao_cartao IS NULL
  ),
  pares AS (
    SELECT c.venda_id, c.data_venda, c.valor_bruto, p.pagamento_id,
           COUNT(*) OVER (PARTITION BY c.venda_id) AS qtd_p,
           COUNT(*) OVER (PARTITION BY p.pagamento_id) AS qtd_v
      FROM cielo_pix_orfa c
      JOIN pagto_candidato p
        ON p.filial_id = c.filial_id
       AND p.data = c.data_venda
       AND p.valor = c.valor_bruto
  )
  SELECT data_venda, valor_bruto, qtd_p AS pdvs_pra_essa_venda, qtd_v AS vendas_pra_esse_pdv
    FROM pares
   WHERE qtd_p > 1 OR qtd_v > 1
   ORDER BY data_venda, valor_bruto
   LIMIT 20
`
console.table(amb)

if (!APPLY) {
  await sql.end()
  process.exit(0)
}

console.log('\n=== 3) Aplicando match MANUAL e apagando excecao ===')
const res = await sql`
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
           p.data_pagamento::date AS data,
           p.valor
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
           NULL, 'AUTO',
           0,
           'Pix orfao: PDV sem NSU + Cielo Pix mesmo valor/data — match em batch (script match-pix-orfao)'
      FROM unicos
    RETURNING id, pagamento_id, venda_adquirente_id
  ),
  del AS (
    DELETE FROM excecao
     WHERE id IN (SELECT excecao_id FROM unicos)
    RETURNING id
  )
  SELECT (SELECT COUNT(*) FROM ins) AS matches_criados,
         (SELECT COUNT(*) FROM del) AS excecoes_apagadas
`
console.table(res)

await sql.end()

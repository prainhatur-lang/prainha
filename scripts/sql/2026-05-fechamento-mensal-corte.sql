-- ============================================================
-- Otimização da base: snapshot mensal + corte historico
-- ============================================================
-- Roda este script no Supabase SQL Editor em ETAPAS, conferindo
-- o resultado de cada bloco antes de continuar.
--
-- Configuração:
--   - Data de corte: 2025-10-01 (tudo ANTES dessa data eh consolidado)
--   - Tudo dia 2025-10-01 e DEPOIS continua como raw data
--   - Snapshots ficam em fechamento_mensal_*
--   - Apos confirmar os snapshots, executa o BLOCO 4 (DELETE)
-- ============================================================


-- ============================================================
-- BLOCO 1: DDL das tabelas de fechamento (idempotente)
-- ============================================================
CREATE TABLE IF NOT EXISTS fechamento_mensal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
  ano int NOT NULL,
  mes int NOT NULL,
  total_vendas numeric(14,2) NOT NULL DEFAULT 0,
  total_itens numeric(14,2) NOT NULL DEFAULT 0,
  qtd_pedidos int NOT NULL DEFAULT 0,
  qtd_pessoas int NOT NULL DEFAULT 0,
  ticket_medio numeric(14,2) NOT NULL DEFAULT 0,
  total_desconto numeric(14,2) NOT NULL DEFAULT 0,
  total_acrescimo numeric(14,2) NOT NULL DEFAULT 0,
  total_servico numeric(14,2) NOT NULL DEFAULT 0,
  total_entrega numeric(14,2) NOT NULL DEFAULT 0,
  total_pagamentos numeric(14,2) NOT NULL DEFAULT 0,
  qtd_pagamentos int NOT NULL DEFAULT 0,
  gerado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fech_mes_filial UNIQUE (filial_id, ano, mes)
);
CREATE INDEX IF NOT EXISTS idx_fech_mes_filial ON fechamento_mensal(filial_id, ano, mes);

CREATE TABLE IF NOT EXISTS fechamento_mensal_forma (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
  ano int NOT NULL,
  mes int NOT NULL,
  forma_pagamento varchar(100) NOT NULL,
  qtd int NOT NULL DEFAULT 0,
  valor_total numeric(14,2) NOT NULL DEFAULT 0,
  gerado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fech_mes_forma UNIQUE (filial_id, ano, mes, forma_pagamento)
);
CREATE INDEX IF NOT EXISTS idx_fech_mes_forma_filial ON fechamento_mensal_forma(filial_id, ano, mes);

CREATE TABLE IF NOT EXISTS fechamento_mensal_produto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
  ano int NOT NULL,
  mes int NOT NULL,
  posicao int NOT NULL,
  codigo_produto_externo int,
  nome_produto varchar(200),
  qtd numeric(14,3) NOT NULL DEFAULT 0,
  valor_total numeric(14,2) NOT NULL DEFAULT 0,
  gerado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fech_mes_prod UNIQUE (filial_id, ano, mes, posicao)
);
CREATE INDEX IF NOT EXISTS idx_fech_mes_prod_filial ON fechamento_mensal_produto(filial_id, ano, mes);

CREATE TABLE IF NOT EXISTS fechamento_mensal_colaborador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
  ano int NOT NULL,
  mes int NOT NULL,
  codigo_colaborador int,
  nome_colaborador varchar(200),
  qtd_pedidos int NOT NULL DEFAULT 0,
  valor_total numeric(14,2) NOT NULL DEFAULT 0,
  gerado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fech_mes_colab UNIQUE (filial_id, ano, mes, codigo_colaborador)
);
CREATE INDEX IF NOT EXISTS idx_fech_mes_colab_filial ON fechamento_mensal_colaborador(filial_id, ano, mes);


-- ============================================================
-- BLOCO 2: AGREGACAO — gera snapshots mensais ANTES de 2025-10-01
-- ============================================================
-- Pode rodar quantas vezes quiser — o ON CONFLICT atualiza.

-- 2.1) fechamento_mensal (totais por mes)
WITH ped_agg AS (
  SELECT
    filial_id,
    EXTRACT(YEAR FROM data_fechamento)::int AS ano,
    EXTRACT(MONTH FROM data_fechamento)::int AS mes,
    COALESCE(SUM(valor_total), 0) AS total_vendas,
    COALESCE(SUM(valor_total_itens), 0) AS total_itens,
    COUNT(*) AS qtd_pedidos,
    COALESCE(SUM(quantidade_pessoas), 0)::int AS qtd_pessoas,
    CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(valor_total), 0) / COUNT(*) ELSE 0 END AS ticket_medio,
    COALESCE(SUM(total_desconto), 0) AS total_desconto,
    COALESCE(SUM(total_acrescimo), 0) AS total_acrescimo,
    COALESCE(SUM(total_servico), 0) AS total_servico,
    COALESCE(SUM(valor_entrega), 0) AS total_entrega
  FROM pedido
  WHERE data_delete IS NULL
    AND data_fechamento < '2025-10-01'
  GROUP BY filial_id,
           EXTRACT(YEAR FROM data_fechamento),
           EXTRACT(MONTH FROM data_fechamento)
),
pag_agg AS (
  SELECT
    filial_id,
    EXTRACT(YEAR FROM data_pagamento)::int AS ano,
    EXTRACT(MONTH FROM data_pagamento)::int AS mes,
    COALESCE(SUM(valor), 0) AS total_pagamentos,
    COUNT(*)::int AS qtd_pagamentos
  FROM pagamento
  WHERE data_pagamento < '2025-10-01'
  GROUP BY filial_id,
           EXTRACT(YEAR FROM data_pagamento),
           EXTRACT(MONTH FROM data_pagamento)
)
INSERT INTO fechamento_mensal (
  filial_id, ano, mes,
  total_vendas, total_itens, qtd_pedidos, qtd_pessoas, ticket_medio,
  total_desconto, total_acrescimo, total_servico, total_entrega,
  total_pagamentos, qtd_pagamentos
)
SELECT
  ped.filial_id, ped.ano, ped.mes,
  ped.total_vendas, ped.total_itens, ped.qtd_pedidos, ped.qtd_pessoas,
  ped.ticket_medio,
  ped.total_desconto, ped.total_acrescimo, ped.total_servico, ped.total_entrega,
  COALESCE(pag.total_pagamentos, 0),
  COALESCE(pag.qtd_pagamentos, 0)
FROM ped_agg ped
LEFT JOIN pag_agg pag
  ON pag.filial_id = ped.filial_id
 AND pag.ano = ped.ano
 AND pag.mes = ped.mes
ON CONFLICT (filial_id, ano, mes) DO UPDATE SET
  total_vendas = EXCLUDED.total_vendas,
  total_itens = EXCLUDED.total_itens,
  qtd_pedidos = EXCLUDED.qtd_pedidos,
  qtd_pessoas = EXCLUDED.qtd_pessoas,
  ticket_medio = EXCLUDED.ticket_medio,
  total_desconto = EXCLUDED.total_desconto,
  total_acrescimo = EXCLUDED.total_acrescimo,
  total_servico = EXCLUDED.total_servico,
  total_entrega = EXCLUDED.total_entrega,
  total_pagamentos = EXCLUDED.total_pagamentos,
  qtd_pagamentos = EXCLUDED.qtd_pagamentos,
  gerado_em = now();


-- 2.2) fechamento_mensal_forma (por forma de pagamento)
INSERT INTO fechamento_mensal_forma (filial_id, ano, mes, forma_pagamento, qtd, valor_total)
SELECT
  p.filial_id,
  EXTRACT(YEAR FROM p.data_pagamento)::int,
  EXTRACT(MONTH FROM p.data_pagamento)::int,
  COALESCE(p.forma_pagamento, '(sem forma)'),
  COUNT(*)::int,
  COALESCE(SUM(p.valor), 0)
FROM pagamento p
WHERE p.data_pagamento < '2025-10-01'
GROUP BY p.filial_id,
         EXTRACT(YEAR FROM p.data_pagamento),
         EXTRACT(MONTH FROM p.data_pagamento),
         COALESCE(p.forma_pagamento, '(sem forma)')
ON CONFLICT (filial_id, ano, mes, forma_pagamento) DO UPDATE SET
  qtd = EXCLUDED.qtd,
  valor_total = EXCLUDED.valor_total,
  gerado_em = now();


-- 2.3) fechamento_mensal_produto (top 100 produtos do mes)
-- IMPORTANTE: agrupa por NOME do produto (nao por codigo_produto_externo) —
-- agente nao populou codigo_produto_externo na tabela pedido_item historica
-- (todos null), mas nome_produto esta populado.
-- E tambem JOIN via filial_id + codigo_pedido_externo (em vez de pi.pedido_id)
-- porque so ~24% dos itens historicos tem pedido_id (FK) resolvido pelo agente.
WITH ranked AS (
  SELECT
    pi.filial_id,
    EXTRACT(YEAR FROM ped.data_fechamento)::int AS ano,
    EXTRACT(MONTH FROM ped.data_fechamento)::int AS mes,
    pi.nome_produto,
    MAX(pi.codigo_produto_externo) AS codigo_produto_externo,
    COALESCE(SUM(pi.quantidade), 0) AS qtd,
    COALESCE(SUM(pi.valor_total), 0) AS valor_total,
    ROW_NUMBER() OVER (
      PARTITION BY pi.filial_id,
                   EXTRACT(YEAR FROM ped.data_fechamento),
                   EXTRACT(MONTH FROM ped.data_fechamento)
      ORDER BY COALESCE(SUM(pi.valor_total), 0) DESC NULLS LAST
    ) AS posicao
  FROM pedido_item pi
  INNER JOIN pedido ped
    ON ped.filial_id = pi.filial_id
   AND ped.codigo_externo = pi.codigo_pedido_externo
  WHERE pi.data_delete IS NULL
    AND ped.data_delete IS NULL
    AND ped.data_fechamento < '2025-10-01'
    AND pi.nome_produto IS NOT NULL
  GROUP BY pi.filial_id,
           EXTRACT(YEAR FROM ped.data_fechamento),
           EXTRACT(MONTH FROM ped.data_fechamento),
           pi.nome_produto
)
INSERT INTO fechamento_mensal_produto (
  filial_id, ano, mes, posicao, codigo_produto_externo, nome_produto, qtd, valor_total
)
SELECT filial_id, ano, mes, posicao, codigo_produto_externo, nome_produto, qtd, valor_total
FROM ranked
WHERE posicao <= 100
ON CONFLICT (filial_id, ano, mes, posicao) DO UPDATE SET
  codigo_produto_externo = EXCLUDED.codigo_produto_externo,
  nome_produto = EXCLUDED.nome_produto,
  qtd = EXCLUDED.qtd,
  valor_total = EXCLUDED.valor_total,
  gerado_em = now();


-- 2.4) fechamento_mensal_colaborador (vendas por garcom/operador)
INSERT INTO fechamento_mensal_colaborador (
  filial_id, ano, mes, codigo_colaborador, nome_colaborador, qtd_pedidos, valor_total
)
SELECT
  ped.filial_id,
  EXTRACT(YEAR FROM ped.data_fechamento)::int,
  EXTRACT(MONTH FROM ped.data_fechamento)::int,
  ped.codigo_colaborador,
  -- Nome ainda nao temos tabela de colaborador unificada — guarda null,
  -- preenche depois quando tabela existir
  NULL::varchar(200),
  COUNT(*)::int,
  COALESCE(SUM(ped.valor_total), 0)
FROM pedido ped
WHERE ped.data_delete IS NULL
  AND ped.data_fechamento < '2025-10-01'
  AND ped.codigo_colaborador IS NOT NULL
GROUP BY ped.filial_id,
         EXTRACT(YEAR FROM ped.data_fechamento),
         EXTRACT(MONTH FROM ped.data_fechamento),
         ped.codigo_colaborador
ON CONFLICT (filial_id, ano, mes, codigo_colaborador) DO UPDATE SET
  qtd_pedidos = EXCLUDED.qtd_pedidos,
  valor_total = EXCLUDED.valor_total,
  gerado_em = now();


-- ============================================================
-- BLOCO 3: VERIFICACAO — confere os snapshots antes do delete
-- ============================================================
-- Comparar snapshot vs raw — se bater, eh seguro deletar.

-- 3.1) Total snapshot por filial
SELECT
  f.nome AS filial,
  COUNT(*) AS qtd_meses,
  ROUND(SUM(fm.total_vendas)::numeric, 2) AS total_vendas_snap,
  ROUND(SUM(fm.total_pagamentos)::numeric, 2) AS total_pagamentos_snap
FROM fechamento_mensal fm
JOIN filial f ON f.id = fm.filial_id
GROUP BY f.nome
ORDER BY f.nome;

-- 3.2) Compara snapshot vs raw em alguns meses (auditoria)
SELECT
  fm.ano, fm.mes,
  ROUND(fm.total_vendas::numeric, 2) AS snap_vendas,
  (SELECT ROUND(COALESCE(SUM(valor_total), 0)::numeric, 2)
   FROM pedido WHERE filial_id = fm.filial_id
     AND data_delete IS NULL
     AND data_fechamento >= make_date(fm.ano, fm.mes, 1)
     AND data_fechamento < (make_date(fm.ano, fm.mes, 1) + INTERVAL '1 month')) AS raw_vendas,
  ROUND(fm.total_pagamentos::numeric, 2) AS snap_pag,
  (SELECT ROUND(COALESCE(SUM(valor), 0)::numeric, 2)
   FROM pagamento WHERE filial_id = fm.filial_id
     AND data_pagamento >= make_date(fm.ano, fm.mes, 1)
     AND data_pagamento < (make_date(fm.ano, fm.mes, 1) + INTERVAL '1 month')) AS raw_pag
FROM fechamento_mensal fm
WHERE fm.filial_id = (SELECT id FROM filial WHERE nome ILIKE '%prainha bar%')
ORDER BY fm.ano DESC, fm.mes DESC
LIMIT 12;


-- ============================================================
-- BLOCO 4: DELETE retroativo (DESTRUTIVO!)
-- ============================================================
-- SO RODE SE OS BLOCOS 2 E 3 ESTAO 100% OK.
-- Recomendado: BACKUP da base antes (Supabase ja tem auto-backup).
-- BEGIN/COMMIT pra rollback se algo errado.

BEGIN;

-- Quanto vai apagar?
SELECT 'pedido_item antes corte' AS o, COUNT(*) FROM pedido_item pi
  WHERE EXISTS (SELECT 1 FROM pedido p WHERE p.id = pi.pedido_id AND p.data_fechamento < '2025-10-01')
UNION ALL
SELECT 'pedido antes corte', COUNT(*) FROM pedido WHERE data_fechamento < '2025-10-01'
UNION ALL
SELECT 'pagamento antes corte', COUNT(*) FROM pagamento WHERE data_pagamento < '2025-10-01'
UNION ALL
SELECT 'movimento_conta_corrente antes corte', COUNT(*) FROM movimento_conta_corrente WHERE data_hora < '2025-10-01'
UNION ALL
SELECT 'venda_adquirente antes corte', COUNT(*) FROM venda_adquirente WHERE data_venda < '2025-10-01'
UNION ALL
SELECT 'recebivel_adquirente antes corte', COUNT(*) FROM recebivel_adquirente WHERE data_pagamento < '2025-10-01'
UNION ALL
SELECT 'lancamento_banco antes corte', COUNT(*) FROM lancamento_banco WHERE data_movimento < '2025-10-01';

-- Confirmou? Descomenta os DELETEs abaixo e roda em batches:

-- DELETE FROM pedido_item pi
-- USING pedido p
-- WHERE pi.pedido_id = p.id AND p.data_fechamento < '2025-10-01';

-- DELETE FROM pedido WHERE data_fechamento < '2025-10-01';

-- DELETE FROM pagamento WHERE data_pagamento < '2025-10-01';

-- Movimento conta corrente — manter so quem tem saldo aberto (cliente ainda deve)
-- DELETE FROM movimento_conta_corrente
-- WHERE data_hora < '2025-10-01'
--   AND cliente_id IS NOT NULL
--   AND cliente_id IN (
--     SELECT cliente_id FROM movimento_conta_corrente
--     WHERE cliente_id IS NOT NULL
--     GROUP BY cliente_id
--     HAVING ABS(SUM(COALESCE(credito,0)) - SUM(COALESCE(debito,0))) < 0.01
--   );
-- Cuidado: a logica acima preserva movimentos de clientes com saldo > 0.
-- Se quiser apagar tudo antes de 2025-10-01, simplifica:
-- DELETE FROM movimento_conta_corrente WHERE data_hora < '2025-10-01';

-- DELETE FROM venda_adquirente WHERE data_venda < '2025-10-01';
-- DELETE FROM recebivel_adquirente WHERE data_pagamento < '2025-10-01';
-- DELETE FROM lancamento_banco WHERE data_movimento < '2025-10-01';

-- Conta a pagar / fornecedor / categoria_conta — MANTÊM (auditoria fiscal)

COMMIT;


-- ============================================================
-- BLOCO 5: Recupera espaço (depois do delete)
-- ============================================================
-- Roda 1x apos os deletes. VACUUM FULL bloqueia a tabela — fazer
-- em horario de pouco uso (madrugada). Nao tem efeito em transacao.

-- VACUUM FULL pedido_item;
-- VACUUM FULL pedido;
-- VACUUM FULL pagamento;
-- VACUUM FULL movimento_conta_corrente;
-- VACUUM FULL venda_adquirente;
-- VACUUM FULL recebivel_adquirente;
-- VACUUM FULL lancamento_banco;

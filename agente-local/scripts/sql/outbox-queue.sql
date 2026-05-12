-- =====================================================================
-- CONCILIA outbox queue para o Firebird do Consumer
-- =====================================================================
-- Cria uma tabela de fila CONCILIA_SYNC_QUEUE e dois triggers que
-- registram nela toda alteracao relevante de produto (em PRODUTOS e
-- em PRODUTODETALHE). O agente local le essa fila a cada ciclo e
-- reenvia os produtos afetados pra nuvem, que faz UPSERT por
-- (filial_id, codigo_externo).
--
-- COMO USAR:
--   isql -u SYSDBA -p masterkey CONSUMER.FDB -i outbox-queue.sql
--
-- IDEMPOTENCIA: rodar este script duas vezes vai dar erro "already
-- exists" nos CREATEs — e seguro ignorar. Pra recriar tudo do zero,
-- rode antes o trecho DROP comentado no final.
--
-- COMPATIBILIDADE: Firebird 2.5+. "IS DISTINCT FROM" disponivel desde 2.5.
-- =====================================================================

-- ----- Fila ------------------------------------------------------------
CREATE TABLE CONCILIA_SYNC_QUEUE (
  ID         INTEGER NOT NULL PRIMARY KEY,
  TABELA     VARCHAR(30) NOT NULL,
  CODIGO     INTEGER NOT NULL,
  OPERACAO   VARCHAR(10) NOT NULL,                            -- UPDATE | DELETE
  CRIADO_EM  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PROCESSADO SMALLINT  DEFAULT 0 NOT NULL                     -- 0 pendente, 1 processado
);

CREATE GENERATOR GEN_CONCILIA_SYNC_QUEUE;

CREATE INDEX IDX_CONCILIA_QUEUE_PEND
  ON CONCILIA_SYNC_QUEUE (PROCESSADO, ID);

CREATE INDEX IDX_CONCILIA_QUEUE_DEDUP
  ON CONCILIA_SYNC_QUEUE (TABELA, CODIGO, PROCESSADO);

COMMIT;

-- ----- Trigger: PRODUTOS ----------------------------------------------
SET TERM ^ ;

CREATE TRIGGER TR_CONCILIA_PRODUTOS_AU FOR PRODUTOS
ACTIVE AFTER UPDATE POSITION 100
AS
BEGIN
  IF (OLD.NOME                IS DISTINCT FROM NEW.NOME OR
      OLD.DESCRICAO           IS DISTINCT FROM NEW.DESCRICAO OR
      OLD.PRECOVENDA          IS DISTINCT FROM NEW.PRECOVENDA OR
      OLD.PRECOCUSTO          IS DISTINCT FROM NEW.PRECOCUSTO OR
      OLD.ESTOQUEATUAL        IS DISTINCT FROM NEW.ESTOQUEATUAL OR
      OLD.ESTOQUEMINIMO       IS DISTINCT FROM NEW.ESTOQUEMINIMO OR
      OLD.ESTOQUECONTROLADO   IS DISTINCT FROM NEW.ESTOQUECONTROLADO OR
      OLD.DESCONTINUADO       IS DISTINCT FROM NEW.DESCONTINUADO OR
      OLD.ITEMPORKG           IS DISTINCT FROM NEW.ITEMPORKG OR
      OLD.CODIGOPERSONALIZADO IS DISTINCT FROM NEW.CODIGOPERSONALIZADO OR
      OLD.CODIGOETIQUETA      IS DISTINCT FROM NEW.CODIGOETIQUETA OR
      OLD.CODIGOUNIDADECOMERCIAL IS DISTINCT FROM NEW.CODIGOUNIDADECOMERCIAL OR
      OLD.CODIGOPRODUTOTIPO   IS DISTINCT FROM NEW.CODIGOPRODUTOTIPO OR
      OLD.CODIGOCOZINHA       IS DISTINCT FROM NEW.CODIGOCOZINHA OR
      OLD.NCM                 IS DISTINCT FROM NEW.NCM OR
      OLD.CFOP                IS DISTINCT FROM NEW.CFOP OR
      OLD.CEST                IS DISTINCT FROM NEW.CEST)
  THEN
    INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CODIGO, OPERACAO)
    VALUES (GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1), 'PRODUTOS', NEW.CODIGO, 'UPDATE');
END^

-- ----- Trigger: PRODUTODETALHE ----------------------------------------
-- Preco e estoque "reais" ficam aqui. Marcamos como TABELA='PRODUTOS'
-- mesmo, porque do lado nuvem so existe 1 produto (a query do agente
-- agrega os detalhes via MAX/SUM).

CREATE TRIGGER TR_CONCILIA_PRODDETALHE_AU FOR PRODUTODETALHE
ACTIVE AFTER UPDATE POSITION 100
AS
BEGIN
  IF (OLD.PRECOVENDA       IS DISTINCT FROM NEW.PRECOVENDA OR
      OLD.PRECOCUSTO       IS DISTINCT FROM NEW.PRECOCUSTO OR
      OLD.ESTOQUEATUAL     IS DISTINCT FROM NEW.ESTOQUEATUAL OR
      OLD.ESTOQUEMINIMO    IS DISTINCT FROM NEW.ESTOQUEMINIMO OR
      OLD.ESTOQUECONTROLADO IS DISTINCT FROM NEW.ESTOQUECONTROLADO OR
      OLD.DATAPAUSADO      IS DISTINCT FROM NEW.DATAPAUSADO)
  THEN
    INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CODIGO, OPERACAO)
    VALUES (GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1), 'PRODUTOS', NEW.CODIGOPRODUTO, 'UPDATE');
END^

SET TERM ; ^

COMMIT;

-- =====================================================================
-- DROP (pra reinstalar do zero — descomente se precisar):
--
-- DROP TRIGGER TR_CONCILIA_PRODDETALHE_AU;
-- DROP TRIGGER TR_CONCILIA_PRODUTOS_AU;
-- DROP INDEX  IDX_CONCILIA_QUEUE_DEDUP;
-- DROP INDEX  IDX_CONCILIA_QUEUE_PEND;
-- DROP GENERATOR GEN_CONCILIA_SYNC_QUEUE;
-- DROP TABLE  CONCILIA_SYNC_QUEUE;
-- COMMIT;
-- =====================================================================

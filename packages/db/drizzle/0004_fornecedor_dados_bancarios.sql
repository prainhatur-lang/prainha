-- Adiciona dados bancarios em fornecedor — usado pra exportar arquivo
-- de pagamento da folha pro orgao pagador (CSV/print).
-- Editaveis via /folha-equipe/pessoas; NAO sao sobrescritos pelo agente
-- (FORNECEDORES no Consumer nao tem essas colunas — ingest so atualiza
-- as colunas espelhadas, deixa as locais intactas).

ALTER TABLE "fornecedor"
  ADD COLUMN IF NOT EXISTS "banco_nome" varchar(100),
  ADD COLUMN IF NOT EXISTS "banco_agencia" varchar(20),
  ADD COLUMN IF NOT EXISTS "banco_conta" varchar(30),
  ADD COLUMN IF NOT EXISTS "chave_pix" varchar(100);

-- Folha de pagamento da equipe (garcons / diaristas / gerente).
-- Vide packages/db/src/schema/folha.ts pra docs do desenho.

-- ============================================================
-- 1. fornecedor_folha (satelite 1:1 com fornecedor)
-- ============================================================
CREATE TABLE "fornecedor_folha" (
  "fornecedor_id"                UUID PRIMARY KEY REFERENCES "fornecedor"("id") ON DELETE CASCADE,
  "cliente_id"                   UUID REFERENCES "cliente"("id") ON DELETE SET NULL,
  "papel"                        VARCHAR(20) NOT NULL,
  "gerente_modelo"               VARCHAR(20),
  "gerente_valor_fixo_dia"       NUMERIC(10, 2),
  "diarista_taxa_hora_override"  NUMERIC(10, 2),
  "codigo_colaborador_externo"   INTEGER,
  "nomes_alternativos"           JSONB,
  "ativo"                        BOOLEAN NOT NULL DEFAULT TRUE,
  "criado_em"                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "atualizado_em"                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "idx_fornecedor_folha_papel"
  ON "fornecedor_folha" ("papel", "ativo");

-- ============================================================
-- 2. folha_config (1:1 com filial)
-- ============================================================
CREATE TABLE "folha_config" (
  "filial_id"                  UUID PRIMARY KEY REFERENCES "filial"("id") ON DELETE CASCADE,
  "pp_empresa"                 NUMERIC(5, 2) NOT NULL DEFAULT 1,
  "pp_gerente"                 NUMERIC(5, 2) NOT NULL DEFAULT 1,
  "pp_funcionarios"            NUMERIC(5, 2) NOT NULL DEFAULT 8,
  "taxa_diarista_hora"         NUMERIC(10, 2) NOT NULL DEFAULT 8.00,
  "aux_transporte_ativo"       BOOLEAN NOT NULL DEFAULT FALSE,
  "aux_transporte_valor_hora"  NUMERIC(10, 2),
  "aux_transporte_dias"        JSONB,
  "categoria_comissao_id"      UUID REFERENCES "categoria_conta"("id") ON DELETE SET NULL,
  "categoria_diaria_id"        UUID REFERENCES "categoria_conta"("id") ON DELETE SET NULL,
  "categoria_gratificacao_id"  UUID REFERENCES "categoria_conta"("id") ON DELETE SET NULL,
  "categoria_transporte_id"    UUID REFERENCES "categoria_conta"("id") ON DELETE SET NULL,
  "dia_pagamento"              INTEGER NOT NULL DEFAULT 1,
  "atualizado_em"              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. folha_semana
-- ============================================================
CREATE TABLE "folha_semana" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "filial_id"           UUID NOT NULL REFERENCES "filial"("id") ON DELETE CASCADE,
  "data_inicio"         DATE NOT NULL,
  "data_fim"            DATE NOT NULL,
  "status"              VARCHAR(20) NOT NULL DEFAULT 'aberta',
  "dez_pct_por_dia"     JSONB NOT NULL DEFAULT '{}',
  "config_snapshot"     JSONB,
  "data_pagamento"      DATE,
  "criado_em"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "fechada_em"          TIMESTAMPTZ,
  "fechada_por"         UUID,
  CONSTRAINT "uq_folha_semana_filial_inicio" UNIQUE ("filial_id", "data_inicio")
);
CREATE INDEX "idx_folha_semana_status"
  ON "folha_semana" ("filial_id", "status");

-- ============================================================
-- 4. folha_horas (horas por fornecedor por dia)
-- ============================================================
CREATE TABLE "folha_horas" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "folha_semana_id"  UUID NOT NULL REFERENCES "folha_semana"("id") ON DELETE CASCADE,
  "fornecedor_id"    UUID NOT NULL REFERENCES "fornecedor"("id") ON DELETE CASCADE,
  "dia"              DATE NOT NULL,
  "total_min"        INTEGER NOT NULL DEFAULT 0,
  "origem"           VARCHAR(20) NOT NULL DEFAULT 'manual',
  CONSTRAINT "uq_folha_horas_pessoa_dia" UNIQUE ("folha_semana_id", "fornecedor_id", "dia")
);

-- ============================================================
-- 5. ALTER conta_pagar: adiciona vinculo opcional com folha
-- ============================================================
ALTER TABLE "conta_pagar"
  ADD COLUMN IF NOT EXISTS "folha_semana_id" UUID
  REFERENCES "folha_semana"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_conta_pagar_folha"
  ON "conta_pagar" ("folha_semana_id")
  WHERE "folha_semana_id" IS NOT NULL;

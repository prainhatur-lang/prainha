-- Avaliacoes de clientes (reputacao).
-- Aplicar via: pnpm --filter @concilia/db migrate:avaliacoes (idempotente)
--
-- 1) Novos campos na filial: token publico do QR, link do Google e nota de corte.
-- 2) Tabela avaliacao: grava toda nota (1-5). As baixas (< corte) entram no
--    painel /avaliacoes com contato do cliente + workflow de status.

ALTER TABLE "filial"
  ADD COLUMN IF NOT EXISTS "avaliacao_token" text,
  ADD COLUMN IF NOT EXISTS "google_review_url" text,
  ADD COLUMN IF NOT EXISTS "nota_corte_google" integer NOT NULL DEFAULT 4;

-- unique parcial: dois tokens null sao permitidos, tokens preenchidos sao unicos
CREATE UNIQUE INDEX IF NOT EXISTS "filial_avaliacao_token_unique"
  ON "filial" ("avaliacao_token")
  WHERE "avaliacao_token" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "avaliacao" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "filial_id" uuid NOT NULL REFERENCES "filial"("id") ON DELETE CASCADE,
  "nota" integer NOT NULL,
  "comentario" text,
  "nome" varchar(200),
  "whatsapp" varchar(30),
  "origem" varchar(100),
  "foi_pra_google" boolean NOT NULL DEFAULT false,
  "status" varchar(20) NOT NULL DEFAULT 'novo',
  "observacao_interna" text,
  "resolvido_por" uuid,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "avaliacao_filial_status_idx" ON "avaliacao" ("filial_id", "status");
CREATE INDEX IF NOT EXISTS "avaliacao_filial_criado_idx" ON "avaliacao" ("filial_id", "criado_em");

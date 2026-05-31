-- Setor de Reservas de mesa.
-- Aplicar via: pnpm --filter @concilia/db migrate:reservas (idempotente)

CREATE TABLE IF NOT EXISTS "reserva" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "filial_id" uuid NOT NULL REFERENCES "filial"("id") ON DELETE CASCADE,
  "cliente_nome" varchar(200) NOT NULL,
  "cliente_telefone" varchar(30),
  "pessoas" integer NOT NULL DEFAULT 1,
  "data" date NOT NULL,
  "hora" varchar(5) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pendente',
  "area" varchar(100),
  "mesa" varchar(20),
  "canal" varchar(30) NOT NULL DEFAULT 'outro',
  "observacao" text,
  "origem_externa" varchar(30),
  "id_externo" varchar(100),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "reserva_filial_data_idx" ON "reserva" ("filial_id", "data");

-- Dedupe de import: a mesma reserva externa nao duplica.
DO $$ BEGIN
  ALTER TABLE "reserva" ADD CONSTRAINT "reserva_externa_unique"
    UNIQUE ("filial_id", "origem_externa", "id_externo");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

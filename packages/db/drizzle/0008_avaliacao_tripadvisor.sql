-- Segundo destino de avaliacao publica: TripAdvisor.
-- Aplicar via: pnpm --filter @concilia/db migrate:avaliacao-links (idempotente)
-- O script tambem seeda os links de Google + TripAdvisor das filiais ativas.

ALTER TABLE "filial"
  ADD COLUMN IF NOT EXISTS "tripadvisor_review_url" text;

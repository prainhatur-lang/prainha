-- Adiciona campo bonus_fixo_semanal em fornecedor_folha.
-- Quando preenchido, entra como acrescimo automatico em toda folha
-- desse fornecedor — sem precisar lançar manualmente em cada semana.
-- Util pra gerentes/fiscais com bonus recorrente. NULL = sem bonus fixo.

ALTER TABLE "fornecedor_folha"
  ADD COLUMN IF NOT EXISTS "bonus_fixo_semanal" numeric(10, 2);

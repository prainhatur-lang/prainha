-- Adiciona campo bonus_por_dia em fornecedor_folha.
-- Quando preenchido, gera acrescimo automatico = dias_trabalhados ×
-- valor. Util pra funcionarios com plus por dia (ex: Marcia R$120/dia
-- alem da comissao).
-- Diferente do bonus_fixo_semanal porque escala com os dias batidos
-- no espelho de ponto.

ALTER TABLE "fornecedor_folha"
  ADD COLUMN IF NOT EXISTS "bonus_por_dia" numeric(10, 2);

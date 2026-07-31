-- Adiciona modelo de remuneracao por dia fixo pro diarista.
-- Ate aqui, diarista era sempre R$/hora (config.taxa_diarista_hora ou
-- diarista_taxa_hora_override). Agora algumas pessoas (ex: Lilian R$150/dia)
-- recebem valor fixo por dia trabalhado, independente de horas.
--
-- diarista_modelo:
--   'por_hora'    (default) -> usa diarista_taxa_hora_override OU config.taxa_diarista_hora
--   'fixo_por_dia'          -> usa diarista_valor_fixo_dia × dias_com_horas>0
--
-- Mesma logica do gerente_modelo='fixo_por_dia' (gerente_valor_fixo_dia),
-- aplicada agora pra diarista.

ALTER TABLE "fornecedor_folha"
  ADD COLUMN IF NOT EXISTS "diarista_modelo" varchar(20) NOT NULL DEFAULT 'por_hora',
  ADD COLUMN IF NOT EXISTS "diarista_valor_fixo_dia" numeric(10, 2);

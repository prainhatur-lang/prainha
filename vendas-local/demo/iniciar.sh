#!/bin/sh
# Sobe o servidor de demonstração. Banco vazio → aplica o cardápio de exemplo
# antes (o server.mjs completa o resto das tabelas sozinho ao subir).
# DEMO_ZERAR=1 nas variáveis → apaga as vendas de teste e recomeça do cardápio.
set -e
: "${PG_URL:?PG_URL não definida (fly secrets set PG_URL=...)}"
for i in $(seq 1 30); do psql "$PG_URL" -Atc "select 1" >/dev/null 2>&1 && break; echo "[demo] esperando o banco ($i)"; sleep 2; done
if [ "${DEMO_ZERAR:-}" = "1" ]; then
  echo "[demo] DEMO_ZERAR=1 → apagando tudo e recomeçando"
  psql "$PG_URL" -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
fi
TEM=$(psql "$PG_URL" -Atc "select to_regclass('public.produto_local') is not null")
if [ "$TEM" != "t" ]; then
  echo "[demo] banco vazio → aplicando cardápio de exemplo"
  psql "$PG_URL" -q -v ON_ERROR_STOP=1 -f demo/seed.sql
fi
exec node server.mjs

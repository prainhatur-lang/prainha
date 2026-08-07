#!/usr/bin/env bash
# Sobe as credenciais do EDI da Cielo pro ambiente Production da Vercel.
#
# Rode de apps/web:   bash scripts/subir-envs-cielo-edi.sh
#
# Le tudo do .env da raiz do repo — nada e' digitado a mao. O certificado e a
# chave viram base64 (na Vercel nao ha arquivo em disco, o cliente le de
# CIELO_EDI_CERT_B64 / CIELO_EDI_KEY_B64).
#
# Idempotente: remove a env antiga antes de recriar.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="$RAIZ/.env"
[ -f "$ENV_FILE" ] || { echo "nao achei $ENV_FILE"; exit 1; }

ler() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }

# ID da filial dona do EC matriz (Prainha Bar) — usado como default do cron
# quando um EC do arquivo ainda nao tem historico.
FILIAL_PADRAO="${CIELO_EDI_FILIAL_ID:-7c5c66ce-cceb-4e89-9c6d-d0785255c4f9}"

subir() { # nome valor
  local nome="$1" valor="$2"
  [ -n "$valor" ] || { echo "  ! $nome vazio no .env — pulando"; return; }
  npx vercel env rm "$nome" production --yes >/dev/null 2>&1 || true
  printf '%s' "$valor" | npx vercel env add "$nome" production >/dev/null
  echo "  ok $nome"
}

echo "subindo envs do EDI pra Production..."
subir CIELO_EDI_BASE          "$(ler CIELO_EDI_BASE)"
subir CIELO_EDI_CLIENT_ID     "$(ler CIELO_EDI_CLIENT_ID)"
subir CIELO_EDI_ACCESS_TOKEN  "$(ler CIELO_EDI_ACCESS_TOKEN)"
subir CIELO_EDI_HMAC_KEY      "$(ler CIELO_EDI_HMAC_KEY)"
subir CIELO_EDI_MATRIZ        "$(ler CIELO_EDI_MATRIZ)"
subir CIELO_EDI_FILIAL_ID     "$FILIAL_PADRAO"

CERT_PATH="$(ler CIELO_EDI_CERT_PATH)"
KEY_PATH="$(ler CIELO_EDI_KEY_PATH)"
if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
  subir CIELO_EDI_CERT_B64 "$(base64 -i "$CERT_PATH" | tr -d '\n')"
  subir CIELO_EDI_KEY_B64  "$(base64 -i "$KEY_PATH"  | tr -d '\n')"
else
  echo "  ! cert/key nao encontrados ($CERT_PATH / $KEY_PATH)"
fi

echo
echo "pronto. redeploy pra valer:  npx vercel --prod"
echo "depois confira:  curl -H \"Authorization: Bearer \$CRON_SECRET\" https://app.prainhabar.com/api/cron/cielo-edi"

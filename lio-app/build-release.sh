#!/bin/bash
# Gera o APK release ASSINADO de UM flavor (adquirente = máquina):
#   ./build-release.sh          → cielo (padrão) → dist/concilia-garcom-v<versão>.apk (Cielo Store)
#   ./build-release.sh rede     → rede           → dist/concilia-garcom-rede-v<versão>.apk (Rede Store)
#
# Lê tudo de secrets.properties (ver secrets.properties.example).
set -euo pipefail
cd "$(dirname "$0")"
FLAVOR="${1:-cielo}"
case "$FLAVOR" in cielo|rede) ;; *) echo "❌ flavor inválido: $FLAVOR (cielo|rede)"; exit 1;; esac
FLAVOR_CAP="$(tr '[:lower:]' '[:upper:]' <<< "${FLAVOR:0:1}")${FLAVOR:1}"

# JDK 17 (AGP 8.5 exige; o wrapper acha via JAVA_HOME)
if [ -z "${JAVA_HOME:-}" ] || ! "$JAVA_HOME/bin/java" -version 2>/dev/null | grep -q 'version "17'; then
  for cand in \
    "$(/usr/libexec/java_home -v 17 2>/dev/null || true)" \
    /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home; do
    [ -n "$cand" ] && [ -x "$cand/bin/java" ] && { export JAVA_HOME="$cand"; break; }
  done
fi
[ -x "${JAVA_HOME:-/nonexistent}/bin/java" ] || { echo "❌ JDK 17 não encontrado (brew install openjdk@17)"; exit 1; }
export PATH="$JAVA_HOME/bin:$PATH"

[ -f secrets.properties ] || { echo "❌ Falta lio-app/secrets.properties (copie do .example e preencha)"; exit 1; }

get() { grep "^$1=" secrets.properties | head -1 | cut -d= -f2- | tr -d '[:space:]'; }

# Credenciais Cielo: sem elas o botão de receber NÃO EXISTE no APK e a
# certificação reprova (reprovação real do CupomPro v2.0.0). Só no build cielo.
CID="$(get CIELO_CLIENT_ID)"
if [ "$FLAVOR" = "cielo" ] && { [ -z "$CID" ] || [ -z "$(get CIELO_ACCESS_TOKEN)" ]; }; then
  echo "❌ CIELO_CLIENT_ID / CIELO_ACCESS_TOKEN vazios em secrets.properties."
  echo "   Pegue em https://desenvolvedores.cielo.com.br → Dev Console → app do Prainha → credenciais,"
  echo "   preencha e rode de novo. (Pra um build de teste SEM maquininha: SKIP_CIELO_CHECK=1 $0)"
  [ -z "${SKIP_CIELO_CHECK:-}" ] && exit 1
  echo "   ⚠️  Prosseguindo SEM pagamento na maquininha (SKIP_CIELO_CHECK=1) — NÃO subir esse APK."
fi
KS="$(get KEYSTORE_FILE)"; KS="${KS/#\~/$HOME}"
[ -f "$KS" ] || { echo "❌ Keystore não encontrada em $KS (a MESMA de sempre — update com outra assinatura é rejeitado)"; exit 1; }

echo "▶ Compilando release $FLAVOR (R8 + assinatura)…"
./gradlew ":app:assemble${FLAVOR_CAP}Release" --console=plain -q

APK="$HOME/.concilia-lio-build/app/outputs/apk/$FLAVOR/release/app-$FLAVOR-release.apk"
[ -f "$APK" ] || { echo "❌ APK não gerado em $APK"; exit 1; }

# ---- Verificações obrigatórias da certificação ----
SDKDIR="$(grep '^sdk.dir=' local.properties | cut -d= -f2)"
BT="$(ls "$SDKDIR/build-tools" 2>/dev/null | sort -V | tail -1)"
SIGNER="$SDKDIR/build-tools/$BT/apksigner"

# 1. Assinatura confere (mesma keystore de sempre)
if [ -x "$SIGNER" ]; then
  "$SIGNER" verify --print-certs "$APK" | head -2
else
  echo "⚠️  apksigner não encontrado — pulei a verificação da assinatura"
fi

DEX=$(mktemp -d)
unzip -o -q "$APK" 'classes*.dex' -d "$DEX"
# strings extraídas UMA vez pra arquivo. Grepar arquivo (e não pipe) importa:
# com pipefail, `… | strings | grep -q` leva SIGPIPE quando o grep sai no
# primeiro match e o check "falha" mesmo tendo achado — aconteceu aqui.
STR="$DEX/strings.txt"
cat "$DEX"/classes*.dex | strings > "$STR"

# 2. ZERO WebView (PCI do DX8000 — reprovação real da v1 do CupomPro).
#    Única referência tolerada ao pacote android.webkit: MimeTypeMap.
WEBKIT=$(grep 'android/webkit' "$STR" | grep -v 'MimeTypeMap' | sort -u || true)
if [ -n "$WEBKIT" ]; then
  echo "❌ REFERÊNCIA A WEBVIEW NO DEX (certificação reprova):"; echo "$WEBKIT"; rm -rf "$DEX"; exit 1
fi
echo "✓ zero android.webkit no dex"

# 3. SDK da adquirente: Cielo PRESENTE no build cielo, AUSENTE no build rede
#    (o APK da Rede Store não pode carregar o SDK da concorrente).
CIELO_N=$(grep -c 'cielo/sdk' "$STR" || true)
if [ "$FLAVOR" = "cielo" ]; then
  [ "$CIELO_N" -gt 0 ] || { echo "❌ SDK Cielo não encontrado no dex"; rm -rf "$DEX"; exit 1; }
  echo "✓ SDK Cielo no dex ($CIELO_N refs)"
else
  [ "$CIELO_N" -eq 0 ] || { echo "❌ SDK Cielo VAZOU pro build rede ($CIELO_N refs)"; rm -rf "$DEX"; exit 1; }
  echo "✓ build rede sem SDK Cielo (encaixe do SDK da Rede aguardando onboarding)"
fi

# 4. Credencial embutida (BuildConfig) — só faz sentido no build cielo
if [ "$FLAVOR" = "cielo" ] && [ -n "$CID" ]; then
  if grep -q "$CID" "$STR"; then
    echo "✓ CIELO_CLIENT_ID embutido no APK"
  else
    echo "❌ CIELO_CLIENT_ID não está no APK (BuildConfig quebrado?)"; rm -rf "$DEX"; exit 1
  fi
fi
rm -rf "$DEX"

VERSION="$(grep 'versionName = ' app/build.gradle.kts | sed 's/.*"\(.*\)".*/\1/')"
mkdir -p dist
if [ "$FLAVOR" = "cielo" ]; then OUT="dist/concilia-garcom-v$VERSION.apk"; else OUT="dist/concilia-garcom-rede-v$VERSION.apk"; fi
cp "$APK" "$OUT"
echo ""
if [ "$FLAVOR" = "cielo" ]; then echo "✅ $OUT ($(du -h "$OUT" | cut -f1 | tr -d ' ')) — pronto pro Dev Console da Cielo."; else echo "✅ $OUT ($(du -h "$OUT" | cut -f1 | tr -d ' ')) — build REDE (Laranjinha Smart); pagamento só depois do SDK da Rede."; fi
echo "   Próximos passos: subir na Cielo Store (app privado), instalar via Test Your App,"
echo "   testar aprovada/cancelada/recusada na maquininha real e validar a baixa no vendas-local."

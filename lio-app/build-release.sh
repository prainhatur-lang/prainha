#!/bin/bash
# Gera o APK release ASSINADO pronto pro Dev Console da Cielo.
# Uso: ./build-release.sh          (na pasta lio-app)
#
# Lê tudo de secrets.properties (ver secrets.properties.example).
# Sai em dist/prainha-lio-v<versão>.apk — é ESSE arquivo que sobe na Cielo.
set -euo pipefail
cd "$(dirname "$0")"

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
# certificação reprova (reprovação real do CupomPro v2.0.0).
CID="$(get CIELO_CLIENT_ID)"
if [ -z "$CID" ] || [ -z "$(get CIELO_ACCESS_TOKEN)" ]; then
  echo "❌ CIELO_CLIENT_ID / CIELO_ACCESS_TOKEN vazios em secrets.properties."
  echo "   Pegue em https://desenvolvedores.cielo.com.br → Dev Console → app do Prainha → credenciais,"
  echo "   preencha e rode de novo. (Pra um build de teste SEM maquininha: SKIP_CIELO_CHECK=1 $0)"
  [ -z "${SKIP_CIELO_CHECK:-}" ] && exit 1
  echo "   ⚠️  Prosseguindo SEM pagamento na maquininha (SKIP_CIELO_CHECK=1) — NÃO subir esse APK."
fi
KS="$(get KEYSTORE_FILE)"; KS="${KS/#\~/$HOME}"
[ -f "$KS" ] || { echo "❌ Keystore não encontrada em $KS (a MESMA de sempre — update com outra assinatura é rejeitado)"; exit 1; }

echo "▶ Compilando release (R8 + assinatura)…"
./gradlew :app:assembleRelease --console=plain -q

APK="$HOME/.concilia-lio-build/app/outputs/apk/release/app-release.apk"
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

# 2. ZERO WebView (PCI do DX8000 — reprovação real da v1 do CupomPro).
#    Única referência tolerada ao pacote android.webkit: MimeTypeMap.
WEBKIT=$(cat "$DEX"/classes*.dex | strings | grep 'android/webkit' | grep -v 'MimeTypeMap' | sort -u || true)
if [ -n "$WEBKIT" ]; then
  echo "❌ REFERÊNCIA A WEBVIEW NO DEX (certificação reprova):"; echo "$WEBKIT"; rm -rf "$DEX"; exit 1
fi
echo "✓ zero android.webkit no dex"

# 3. SDK Cielo embarcado
CIELO_N=$(cat "$DEX"/classes*.dex | strings | grep -c 'cielo/sdk' || true)
[ "$CIELO_N" -gt 0 ] || { echo "❌ SDK Cielo não encontrado no dex"; rm -rf "$DEX"; exit 1; }
echo "✓ SDK Cielo no dex ($CIELO_N refs)"

# 4. Credencial embutida (BuildConfig)
if [ -n "$CID" ]; then
  if cat "$DEX"/classes*.dex | strings | grep -q "$CID"; then
    echo "✓ CIELO_CLIENT_ID embutido no APK"
  else
    echo "❌ CIELO_CLIENT_ID não está no APK (BuildConfig quebrado?)"; rm -rf "$DEX"; exit 1
  fi
fi
rm -rf "$DEX"

VERSION="$(grep 'versionName = ' app/build.gradle.kts | sed 's/.*"\(.*\)".*/\1/')"
mkdir -p dist
OUT="dist/prainha-lio-v$VERSION.apk"
cp "$APK" "$OUT"
echo ""
echo "✅ $OUT ($(du -h "$OUT" | cut -f1 | tr -d ' ')) — pronto pro Dev Console da Cielo."
echo "   Próximos passos: subir na Cielo Store (app privado), instalar via Test Your App,"
echo "   testar aprovada/cancelada/recusada na maquininha real e validar a baixa no vendas-local."

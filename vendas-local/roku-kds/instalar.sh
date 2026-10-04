#!/bin/bash
# Manda o KDS pra uma TV Roku (o aplicativo fica gravado na TV, nao precisa
# mandar de novo depois que estiver funcionando).
#
#   ./instalar.sh                      TV do quintal da Prainha Mar (192.168.4.153)
#   ./instalar.sh 192.168.4.200        outra TV
#   ./instalar.sh 192.168.4.153 uma    manda uma vez, tira a foto e sai
#
# Antes, na TV: ligar o modo desenvolvedor pelo controle (Home 3x, Cima 2x,
# Direita, Esquerda, Direita, Esquerda, Direita), aceitar e criar uma senha.
#
# A senha e pedida aqui, fica so na memoria deste terminal: nao e gravada em
# arquivo e nao aparece na linha de comando.
#
# Sem o "uma" o terminal fica aberto esperando pedido (Ctrl+C encerra):
#   touch saida/mandar   -> empacota e manda de novo
#   touch saida/foto     -> tira foto da tela da TV em saida/tela.jpg
# O que aconteceu fica em saida/instalar.log.

TV="${1:-192.168.4.153}"
MODO="${2:-espera}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$AQUI/app"
SAIDA="$AQUI/saida"
LOG="$SAIDA/instalar.log"
mkdir -p "$SAIDA"

diz() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"; }

if ! curl -s -m 6 "http://$TV:8060/query/device-info" | /usr/bin/grep -q '<developer-enabled>true'; then
  echo "A TV $TV nao esta com o modo desenvolvedor ligado (ou nao respondeu)."
  echo "No controle dela: Home 3x, Cima 2x, Direita, Esquerda, Direita, Esquerda, Direita."
  exit 1
fi

printf 'Senha do modo desenvolvedor da TV %s: ' "$TV"
read -rs SENHA
echo
[ -n "$SENHA" ] || { echo "Sem senha, nada feito."; exit 1; }

# a senha vai pro curl por um "arquivo" que so existe na memoria
cfg() { printf 'user = "rokudev:%s"\n' "$(printf '%s' "$SENHA" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }
tv() { curl -sS -m 90 --digest -K <(cfg) "$@"; }

aberto() { curl -s -m 5 "http://$TV:8060/query/active-app" | /usr/bin/grep -q 'id="dev"'; }

# Com o KDS aberto na tela, a TV derruba a conexao no meio do envio (o curl
# acusa "Send failure: Broken pipe" - visto em 04/10/2026, duas vezes seguidas).
# Entao fecha antes: abrir o canal com sair=1 faz o proprio KDS se fechar. Essa
# TV nao aceita "apertar Home" de fora (controle por aplicativo em modo limitado).
fecha() {
  aberto || return 0
  curl -s -m 5 -o /dev/null -X POST "http://$TV:8060/launch/dev?sair=1"
  local i
  for i in 1 2 3 4 5 6; do sleep 1; aberto || return 0; done
  diz "o KDS continua aberto na TV: se o envio falhar, aperte Home no controle dela e peca de novo"
}

manda() {
  rm -f "$SAIDA/kds.zip"
  (cd "$APP" && zip -qr -X "$SAIDA/kds.zip" . -x '.*' -x '*/.*') || { diz "ERRO: nao consegui empacotar $APP"; return 1; }
  fecha
  local cod sai erro msg vez
  for vez in 1 2 3; do
    cod=$(tv -o "$SAIDA/resposta.html" -w '%{http_code}' -F "mysubmit=Install" -F "archive=@$SAIDA/kds.zip" "http://$TV/plugin_install" 2>"$SAIDA/curl.err")
    sai=$?
    erro=$(tr '\n' ' ' < "$SAIDA/curl.err")
    [ $sai -eq 0 ] && break
    # o 401 que aparece aqui e so a primeira metade da conversa da senha: quem
    # falhou foi a conexao, nao a senha
    diz "tentativa $vez: a conexao com a TV caiu no meio do envio (${erro:-curl saiu com $sai})"
    sleep 4
  done
  if [ $sai -ne 0 ]; then diz "ERRO: nao consegui mandar - feche o KDS na TV (Home no controle) e peca de novo"; return 1; fi
  if [ "$cod" = "401" ]; then diz "ERRO: a TV recusou a senha"; return 2; fi
  msg=$(/usr/bin/grep -o "'Set message content', '[^']*'" "$SAIDA/resposta.html" | sed "s/'Set message content', '//; s/'\$//" | tr '\n' ' ')
  [ -n "$msg" ] || msg=$(sed -n 's/.*<font color="red">\(.*\)<\/font>.*/\1/p' "$SAIDA/resposta.html" | tr '\n' ' ')
  diz "enviado (http $cod): ${msg:-sem mensagem - veja saida/resposta.html}"
}

foto() {
  tv -o "$SAIDA/foto.html" -F "mysubmit=Screenshot" -F "passwd=" -F "archive=" "http://$TV/plugin_inspect" 2>"$SAIDA/curl.err" || { diz "foto: a TV nao respondeu ($(tr '\n' ' ' < "$SAIDA/curl.err"))"; return 1; }
  local caminho
  caminho=$(/usr/bin/grep -o 'pkgs/dev\.[a-z]*' "$SAIDA/foto.html" | head -1)
  [ -n "$caminho" ] || { diz "foto: a TV nao devolveu imagem (o KDS esta aberto nela?)"; return 1; }
  rm -f "$SAIDA"/tela.*
  tv -o "$SAIDA/tela.${caminho##*.}" "http://$TV/$caminho" && diz "foto: saida/tela.${caminho##*.}"
}

manda
[ $? -eq 2 ] && exit 1
sleep 8
foto
[ "$MODO" = "uma" ] && exit 0

rm -f "$SAIDA/mandar" "$SAIDA/foto"
diz "pronto - esperando pedido em $SAIDA (Ctrl+C encerra)"
while true; do
  sleep 2
  if [ -e "$SAIDA/mandar" ]; then
    rm -f "$SAIDA/mandar"
    manda
    sleep 8
    foto
  fi
  if [ -e "$SAIDA/foto" ]; then
    rm -f "$SAIDA/foto"
    foto
  fi
done

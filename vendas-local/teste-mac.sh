#!/bin/zsh
# Servidor de TESTE do vendas-local neste Mac (modo próprio, sem Consumer, sem
# loja): banco local `vendas_teste` (cópia do cardápio do Bar), portas 8790
# (http) e 8791 (https, câmera do KDS). Pra tablets na mesma Wi-Fi.
# Uso: ./teste-mac.sh   — derruba qualquer instância antiga e sobe de novo.
cd "$(dirname "$0")" || exit 1
for p in 8790 8791; do lsof -tiTCP:$p -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null; done
IP=$(ifconfig 2>/dev/null | grep "inet 192\.\|inet 10\." | grep -v "inet 10.0.0" | head -1 | awk '{print $2}')
echo "==> Teste tablets: http://${IP:-<ip-do-mac>}:8790  (KDS com câmera: https://${IP:-<ip-do-mac>}:8791)  login teste / PIN 1234"
echo "==> Ctrl+C para parar"
BANCO=proprio PG_URL="postgres://$USER@127.0.0.1:5432/vendas_teste" PORT=8790 LOJA_NOME="Teste tablets (Mac)" \
AUTO_UPDATE=off MESA_MAX=250 COMANDA_MIN=300 COMANDA_MAX=400 TAXA_SERVICO=10 \
exec node server.mjs 2>&1 | grep -v "severity\|code: '42P07'\|message: 'relation\|file: '\|line: '\|routine: '\|^[{}]$"

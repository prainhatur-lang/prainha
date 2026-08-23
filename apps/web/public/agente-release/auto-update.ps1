# auto-update.ps1 — aplica uma atualização do vendas-local com ROLLBACK
# AUTOMÁTICO se a versão nova não subir saudável.
#
# Disparado pelo PRÓPRIO server.mjs (loopAutoUpdate) como processo separado,
# desacoplado — ele SOBREVIVE ao passo que mata o processo Node, porque no
# Windows um arquivo em uso não pode ser sobrescrito por quem está rodando
# ele. server.mjs baixa e confere o hash do arquivo novo; da troca pra frente
# quem manda é este script.
#
# Uso: powershell -File auto-update.ps1 -HashEsperado <8 chars>
# Espera, na mesma pasta: server.novo.mjs (já baixado e com hash conferido).
param(
  [Parameter(Mandatory=$true)][string]$HashEsperado
)
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
$Log = Join-Path $PSScriptRoot 'auto-update.log'
function Registrar($msg) {
  $linha = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' — ' + $msg
  Add-Content -Path $Log -Value $linha
}

if (-not (Test-Path 'server.novo.mjs')) {
  Registrar "ABORTADO: server.novo.mjs não existe"
  exit 1
}

Registrar "iniciando troca pra versão $HashEsperado"

# ---- passo 1: mata o processo atual (libera o arquivo) --------------------
schtasks /end /tn PrainhaVendas *> $null
Start-Sleep -Seconds 2

# ---- passo 2: backup + aplica a nova versão --------------------------------
# server-anterior.mjs é o ÚNICO backup — sobrescrever de novo aqui é
# intencional: se um rollback já aconteceu antes e ninguém percebeu, manter
# só o penúltimo "bom conhecido" evitaria acumular lixo, mas o risco maior é
# perder o rollback de uma falha em cadeia — por isso o rollback abaixo NUNCA
# apaga server-anterior.mjs até confirmar que a troca deu certo.
Copy-Item 'server.mjs' 'server-anterior.mjs' -Force
Copy-Item 'server.novo.mjs' 'server.mjs' -Force
Remove-Item 'server.novo.mjs' -Force -ErrorAction SilentlyContinue

# ---- passo 3: sobe de novo e confere se nasceu saudável --------------------
schtasks /run /tn PrainhaVendas *> $null
Start-Sleep -Seconds 15

$versaoSubiu = $null
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8790/api/versao' -TimeoutSec 8
  $versaoSubiu = ($r.Content | ConvertFrom-Json).versao
} catch {
  Registrar ("não respondeu em 15s+8s: " + $_.Exception.Message)
}

if ($versaoSubiu -eq $HashEsperado) {
  Registrar "OK — no ar em $versaoSubiu"
  exit 0
}

# ---- ROLLBACK: a versão nova não subiu saudável ----------------------------
Registrar ("FALHOU (veio '" + $versaoSubiu + "', esperava '" + $HashEsperado + "') — revertendo")
schtasks /end /tn PrainhaVendas *> $null
Start-Sleep -Seconds 2
Copy-Item 'server-anterior.mjs' 'server.mjs' -Force
schtasks /run /tn PrainhaVendas *> $null
Start-Sleep -Seconds 15

$versaoVoltou = $null
try {
  $r2 = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8790/api/versao' -TimeoutSec 8
  $versaoVoltou = ($r2.Content | ConvertFrom-Json).versao
} catch { }
if ($versaoVoltou) {
  Registrar "rollback OK — de volta em $versaoVoltou"
} else {
  Registrar "⚠️ ROLLBACK TAMBÉM NÃO RESPONDEU — precisa de alguém olhar a loja"
}
exit 1

# auto-update.ps1 - aplica uma atualizacao do vendas-local com ROLLBACK
# automatico se a versao nova nao subir saudavel.
#
# ############ ESTE ARQUIVO PRECISA SER 100% ASCII ############
# O PowerShell 5.1 le .ps1 SEM BOM como ANSI. Em 25/08/2026 um travessao
# (em-dash) dentro de uma string virou, na leitura ANSI, o byte 0x94 = aspas
# curvas de fechar, que o PowerShell aceita como aspas de verdade: a string
# fechou no lugar errado e o script INTEIRO parou de compilar (ParserError,
# MissingEndCurlyBrace). Resultado: dois dias de auto-update que nunca rodou
# uma linha, sem log nenhum. Nada de acento, travessao ou emoji aqui.
# ##############################################################
#
# Disparado pelo PROPRIO server.mjs (loopAutoUpdate) como processo separado,
# desacoplado: ele sobrevive ao passo que mata o processo Node, porque no
# Windows um arquivo em uso nao pode ser sobrescrito por quem esta rodando
# ele. server.mjs baixa e confere o hash do arquivo novo; da troca pra frente
# quem manda e este script.
#
# Uso: powershell -File auto-update.ps1 -HashEsperado <8 chars>
# Espera, na mesma pasta: server.novo.mjs (ja baixado e com hash conferido).
param(
  [Parameter(Mandatory=$true)][string]$HashEsperado
)
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
$Log = Join-Path $PSScriptRoot 'auto-update.log'
function Registrar($msg) {
  $linha = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' - ' + $msg
  try { Add-Content -Path $Log -Value $linha }
  catch { Write-Output ("REGISTRAR FALHOU: " + $_.Exception.Message + " | msg era: " + $msg) }
}

# Banner no stdout: o server.mjs redireciona a saida deste processo pra
# auto-update-spawn.log. Se nem ESTA linha aparecer la, o powershell morreu
# antes de executar o script - e o problema e do processo, nao do script.
$eAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Output ("ps1 vivo: pid=" + $PID + " usuario=" + $env:USERNAME + " admin=" + $eAdmin + " pasta=" + $PSScriptRoot + " hash=" + $HashEsperado)

# PRIMEIRA linha de qualquer execucao: se este registro nao aparecer, o
# script nem chegou a compilar (foi exatamente o bug de 25/08/2026).
Registrar "script iniciado (hash esperado $HashEsperado)"

if (-not (Test-Path 'server.novo.mjs')) {
  Registrar "ABORTADO: server.novo.mjs nao existe"
  exit 1
}

Registrar "iniciando troca pra versao $HashEsperado"

# ---- passo 1: mata o processo atual (libera o arquivo) --------------------
$saidaEnd = (schtasks /end /tn PrainhaVendas 2>&1 | Out-String).Trim()
Registrar ("schtasks end rc=" + $LASTEXITCODE + " -> " + $saidaEnd)
Write-Output ("schtasks end rc=" + $LASTEXITCODE + " -> " + $saidaEnd)
Start-Sleep -Seconds 2

# ---- passo 2: backup + aplica a nova versao --------------------------------
# server-anterior.mjs e o UNICO backup. Sobrescrever aqui e intencional; o
# rollback abaixo NUNCA apaga server-anterior.mjs ate confirmar que a troca
# deu certo.
Copy-Item 'server.mjs' 'server-anterior.mjs' -Force
Copy-Item 'server.novo.mjs' 'server.mjs' -Force
Remove-Item 'server.novo.mjs' -Force -ErrorAction SilentlyContinue

# ---- passo 3: sobe de novo e confere se nasceu saudavel --------------------
$saidaRun = (schtasks /run /tn PrainhaVendas 2>&1 | Out-String).Trim()
Registrar ("schtasks run rc=" + $LASTEXITCODE + " -> " + $saidaRun)
Start-Sleep -Seconds 15

$versaoSubiu = $null
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8790/api/versao' -TimeoutSec 8
  $versaoSubiu = ($r.Content | ConvertFrom-Json).versao
} catch {
  Registrar ("nao respondeu em 15s+8s: " + $_.Exception.Message)
}

if ($versaoSubiu -eq $HashEsperado) {
  Registrar "OK - no ar em $versaoSubiu"
  exit 0
}

# ---- ROLLBACK: a versao nova nao subiu saudavel ----------------------------
Registrar ("FALHOU (veio '" + $versaoSubiu + "', esperava '" + $HashEsperado + "') - revertendo")
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
  Registrar "rollback OK - de volta em $versaoVoltou"
} else {
  Registrar "ATENCAO: ROLLBACK TAMBEM NAO RESPONDEU - precisa de alguem olhar a loja"
}
exit 1

# updater-task.ps1 - roda como tarefa agendada propria (SYSTEM, elevada),
# a cada 5 minutos. ARQUIVO 100% ASCII (mesma regra do auto-update.ps1).
#
# Por que existe: o server.mjs (Node, dentro da tarefa PrainhaVendas) nao
# consegue disparar um powershell que execute de verdade - o processo nasce
# e morre sem rodar o script (contexto de sessao/elevacao da tarefa). O
# MESMO auto-update.ps1, rodado de terminal admin, funcionou 3 de 3 vezes
# em 25/08/2026. Esta tarefa reproduz esse contexto bom: o Task Scheduler
# dispara o powershell ja elevado, fora do processo do Node.
#
# Fluxo: o server.mjs detecta versao nova, baixa e confere server.novo.mjs,
# espera a loja ficar tranquila e SINALIZA gravando aplicar-versao.txt com o
# hash. Esta tarefa ve o sinal e roda o auto-update.ps1 (troca + rollback).
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
$Flag = Join-Path $PSScriptRoot 'aplicar-versao.txt'
$Log  = Join-Path $PSScriptRoot 'updater-task.log'
function Reg($m) { try { Add-Content -Path $Log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' - ' + $m) } catch {} }

# Aproveita a passada pra manter o auto-update.ps1 em dia mesmo com o Node
# fora do ar. Se o download falhar, segue com o que tem.
try {
  $tmp = Join-Path $PSScriptRoot 'auto-update.novo.ps1'
  Invoke-WebRequest -UseBasicParsing 'https://app.prainhabar.com/agente-release/auto-update.ps1' -OutFile $tmp -TimeoutSec 20
  if ((Get-Item $tmp).Length -gt 500) { Move-Item $tmp (Join-Path $PSScriptRoot 'auto-update.ps1') -Force }
} catch {}

if (-not (Test-Path $Flag)) { exit 0 }
$hash = (Get-Content $Flag -Raw).Trim().ToLower()
Remove-Item $Flag -Force -ErrorAction SilentlyContinue
if ($hash -notmatch '^[0-9a-f]{8}$') { Reg ("sinal invalido: '" + $hash + "' - ignorado"); exit 1 }
if (-not (Test-Path (Join-Path $PSScriptRoot 'server.novo.mjs'))) { Reg ("sinal " + $hash + " sem server.novo.mjs - ignorado"); exit 1 }
Reg ("sinal recebido: aplicar " + $hash)
& powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'auto-update.ps1') -HashEsperado $hash
Reg ("auto-update.ps1 terminou rc=" + $LASTEXITCODE)
exit 0

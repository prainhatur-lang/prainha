import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { VERSAO_RELEASE } from '../route';

/** Instalador idempotente do agente local. Funciona pra:
 *  - Instalacao do zero (cria pasta, baixa ZIP, instala servico, configura)
 *  - Atualizacao (preserva checkpoint, swap dos binarios, restart)
 *  - Reparo (instala/sobrescreve config quebrado, reinstala servico)
 *
 *  Token da filial vem na URL — embutido no .bat baixado pelo painel. */
export async function GET(req: NextRequest) {
  const filialId = req.nextUrl.searchParams.get('filial');
  const token = req.nextUrl.searchParams.get('token');

  if (!filialId || !token) {
    return new NextResponse('# Erro: parametros filial e token obrigatorios', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Confere que o token bate com o que está no banco (defesa contra fishing)
  const [filial] = await db
    .select({ nome: schema.filial.nome, token: schema.filial.agenteToken })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);

  if (!filial || filial.token !== token) {
    return new NextResponse('# Erro: filial/token invalidos', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const zipUrl = `${baseUrl}/agente-release/concilia-agente-v${VERSAO_RELEASE}.zip`;

  const ps1 = `# Concilia Agente — Instalador 1-clique
# Versao: ${VERSAO_RELEASE}
# Filial: ${filial.nome}
# Gerado: ${new Date().toISOString()}

#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Versao   = '${VERSAO_RELEASE}'
$ZipUrl   = '${zipUrl}'
$ApiUrl   = '${baseUrl}'
$Token    = '${token}'
$FbDb     = 'C:\\Users\\eliso\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\consumer.fdb'
$Pasta    = 'C:\\concilia-agente'
$Servico  = 'ConciliaAgente'
$DisplayName = 'Concilia Agente Local'

function Write-Step([string]$msg, [string]$cor='Cyan') { Write-Host "[..] $msg" -ForegroundColor $cor }
function Write-Ok([string]$msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Err([string]$msg)  { Write-Host "[ERRO] $msg" -ForegroundColor Red }
function Write-Warn([string]$msg) { Write-Host "[!]   $msg" -ForegroundColor Yellow }

Write-Host ''
Write-Host '======================================================' -ForegroundColor Cyan
Write-Host " Concilia Agente Local - Instalador" -ForegroundColor Cyan
Write-Host " Filial : ${filial.nome.replace(/'/g, "''")}" -ForegroundColor Cyan
Write-Host " Versao : v$Versao" -ForegroundColor Cyan
Write-Host '======================================================' -ForegroundColor Cyan
Write-Host ''

# 1. Detecta se o Firebird/Consumer esta instalado e descobre o caminho do FDB
Write-Step 'Procurando o banco do Consumer (.fdb)...'
$fdbCandidatos = @(
  'C:\\Users\\eliso\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\consumer.fdb',
  'C:\\Users\\Administrator\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\consumer.fdb',
  "$env:LOCALAPPDATA\\RAL Tecnologia\\CreateInstall\\consumer.fdb"
)
$FbDbAchado = $null
foreach ($p in $fdbCandidatos) {
  if (Test-Path $p) { $FbDbAchado = $p; break }
}
if (-not $FbDbAchado) {
  # Busca mais ampla
  Write-Step '  Nao achei nos caminhos padrao, fazendo busca mais ampla (pode demorar)...'
  $busca = Get-ChildItem -Path 'C:\\Users' -Filter 'consumer.fdb' -Recurse -ErrorAction SilentlyContinue -File | Select-Object -First 1
  if ($busca) { $FbDbAchado = $busca.FullName }
}
if (-not $FbDbAchado) {
  Write-Err 'Nao encontrei consumer.fdb. O Consumer Rede esta instalado?'
  exit 1
}
Write-Ok "FDB: $FbDbAchado"

# 2. Cria pasta destino
Write-Step "Preparando pasta $Pasta..."
New-Item -ItemType Directory -Path $Pasta -Force | Out-Null
Write-Ok 'Pasta pronta'

# 3. Para o servico se ja existir
$svcExiste = Get-Service $Servico -ErrorAction SilentlyContinue
if ($svcExiste) {
  Write-Step "Parando servico $Servico (existente)..."
  Stop-Service $Servico -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Write-Ok 'Servico parado'
}

# 4. Backup do checkpoint e config se existirem (preserva progresso de sync)
$BackupSubdir = "$Pasta\\backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$preservou = $false
if ((Test-Path "$Pasta\\checkpoint.json") -or (Test-Path "$Pasta\\config.json")) {
  New-Item -ItemType Directory -Path $BackupSubdir -Force | Out-Null
  if (Test-Path "$Pasta\\checkpoint.json") { Copy-Item "$Pasta\\checkpoint.json" "$BackupSubdir\\checkpoint.json" -Force }
  if (Test-Path "$Pasta\\config.json")     { Copy-Item "$Pasta\\config.json"     "$BackupSubdir\\config.json"     -Force }
  $preservou = $true
  Write-Ok "Backup checkpoint+config em: $BackupSubdir"
}

# 5. Baixa o ZIP do agente
$ZipPath = "$Pasta\\concilia-agente-v$Versao.zip"
Write-Step "Baixando bundle v$Versao (~30 MB)..."
try {
  Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
  $tam = (Get-Item $ZipPath).Length
  if ($tam -lt (5 * 1MB)) {
    Write-Err "Download invalido — $([math]::Round($tam/1MB,1)) MB. Vercel pode estar deployando ainda. Aguarde 2 min e tente de novo."
    exit 1
  }
  Write-Ok "Baixado: $([math]::Round($tam/1MB,1)) MB"
} catch {
  Write-Err "Download falhou: $_"
  exit 1
}

# 6. Extrai (sobrescreve binarios, NAO sobrescreve config.json/checkpoint.json)
Write-Step 'Extraindo arquivos...'
$ExtractDir = "$Pasta\\_extract"
if (Test-Path $ExtractDir) { Remove-Item $ExtractDir -Recurse -Force }
Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force

$srcDir = Join-Path $ExtractDir 'concilia-agente'
if (-not (Test-Path $srcDir)) { $srcDir = $ExtractDir }

# Copia tudo exceto config.json e checkpoint.json (preserva os existentes)
Get-ChildItem -Path $srcDir -File | ForEach-Object {
  if ($_.Name -ne 'config.json' -and $_.Name -ne 'config.example.json' -and $_.Name -ne 'checkpoint.json') {
    Copy-Item $_.FullName -Destination "$Pasta\\$($_.Name)" -Force
  }
}
Remove-Item $ExtractDir -Recurse -Force
Remove-Item $ZipPath -Force
Write-Ok 'Arquivos copiados'

# 7. Gera config.json (sempre — sobrescreve qualquer existente, fonte de verdade eh a API)
Write-Step 'Gerando config.json...'
$cfg = @{
  api = @{
    url   = $ApiUrl
    token = $Token
  }
  firebird = @{
    host     = 'localhost'
    port     = 3050
    database = $FbDbAchado
    user     = 'SYSDBA'
    password = 'masterkey'
  }
  intervalSeconds   = 900
  batchSize         = 1000
  checkpointFile    = 'checkpoint.json'
  refetchJanelaDias = 14
}
$cfgJson = $cfg | ConvertTo-Json -Depth 10

# IMPORTANTE: escrever sem BOM (PowerShell 5 Set-Content -Encoding utf8 adiciona BOM e quebra)
[System.IO.File]::WriteAllText("$Pasta\\config.json", $cfgJson, (New-Object System.Text.UTF8Encoding $false))
Write-Ok 'config.json gerado (sem BOM)'

# 8. Garante que pastas de logs existem
New-Item -ItemType Directory -Path "$Pasta\\logs" -Force | Out-Null

# 9. Instala/reinstala servico via NSSM
$NssmPath = "$Pasta\\nssm.exe"
if (-not (Test-Path $NssmPath)) {
  Write-Err "nssm.exe nao encontrado em $NssmPath"
  exit 1
}

if ($svcExiste) {
  Write-Step 'Atualizando configuracao do servico...'
  & $NssmPath set $Servico Application "$Pasta\\node.exe" | Out-Null
  & $NssmPath set $Servico AppParameters "$Pasta\\agente.cjs" | Out-Null
  & $NssmPath set $Servico AppDirectory $Pasta | Out-Null
  & $NssmPath set $Servico AppStdout "$Pasta\\logs\\stdout.log" | Out-Null
  & $NssmPath set $Servico AppStderr "$Pasta\\logs\\stderr.log" | Out-Null
  & $NssmPath set $Servico DisplayName $DisplayName | Out-Null
  & $NssmPath set $Servico Start SERVICE_AUTO_START | Out-Null
  Write-Ok 'Servico atualizado'
} else {
  Write-Step 'Instalando servico Windows...'
  & $NssmPath install $Servico "$Pasta\\node.exe" "$Pasta\\agente.cjs" | Out-Null
  & $NssmPath set $Servico AppDirectory $Pasta | Out-Null
  & $NssmPath set $Servico AppStdout "$Pasta\\logs\\stdout.log" | Out-Null
  & $NssmPath set $Servico AppStderr "$Pasta\\logs\\stderr.log" | Out-Null
  & $NssmPath set $Servico DisplayName $DisplayName | Out-Null
  & $NssmPath set $Servico Start SERVICE_AUTO_START | Out-Null
  Write-Ok 'Servico instalado'
}

# 10. Inicia
Write-Step "Iniciando servico $Servico..."
Start-Service $Servico -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

$svc = Get-Service $Servico
if ($svc.Status -ne 'Running') {
  Write-Err "Servico nao subiu (status: $($svc.Status))"
  Write-Warn "Veja o log em: $Pasta\\logs\\stderr.log"
  Get-Content "$Pasta\\logs\\stderr.log" -Tail 10 -ErrorAction SilentlyContinue
  exit 1
}
Write-Ok "Servico rodando (status: $($svc.Status))"

# 11. Aguarda boot e valida versao no log
Write-Step 'Aguardando 25s pra validar boot...'
Start-Sleep -Seconds 25

$logHoje = "$Pasta\\logs\\agente-$(Get-Date -Format 'yyyy-MM-dd').log"
$bootOk = $false
if (Test-Path $logHoje) {
  $linhas = Get-Content $logHoje -Tail 30
  $boot = $linhas | Select-String -Pattern '"versao":"([^"]+)"' | Select-Object -Last 1
  if ($boot -match '"versao":"([^"]+)"') {
    $vBoot = $matches[1]
    if ($vBoot -eq $Versao) {
      Write-Ok "Boot OK: agente reportou v$vBoot"
      $bootOk = $true
    } else {
      Write-Warn "Servico subiu mas log mostra v$vBoot (esperado v$Versao)"
    }
  }
}
if (-not $bootOk) {
  Write-Warn 'Nao consegui validar versao no log. Cheque manualmente:'
  Write-Warn "  Get-Content $logHoje -Tail 20"
}

Write-Host ''
Write-Host '======================================================' -ForegroundColor Green
Write-Host ' INSTALACAO CONCLUIDA' -ForegroundColor Green
Write-Host '======================================================' -ForegroundColor Green
Write-Host ''
Write-Host "  Filial   : ${filial.nome.replace(/'/g, "''")}" -ForegroundColor Gray
Write-Host "  Versao   : v$Versao" -ForegroundColor Gray
Write-Host "  Pasta    : $Pasta" -ForegroundColor Gray
Write-Host "  Servico  : $Servico ($($svc.Status))" -ForegroundColor Gray
if ($preservou) {
  Write-Host "  Backup   : $BackupSubdir" -ForegroundColor Gray
}
Write-Host ''
`;

  return new NextResponse(ps1, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

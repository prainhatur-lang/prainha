import { NextResponse } from 'next/server';
import { VERSAO_RELEASE } from '../route';

/** Gera um script PowerShell pronto pra rodar no PC da filial.
 *  Baixa o bundle da v atual, faz backup, para o serviço, substitui o
 *  agente.cjs, reinicia o serviço, valida o boot e mostra o resultado. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const versao = VERSAO_RELEASE;
  const bundleUrl = `${baseUrl}/agente-release/agente-v${versao}.cjs`;

  const ps1 = `# Atualizador do Concilia Agente
# Gerado por ${baseUrl} em ${new Date().toISOString()}
# Versão alvo: v${versao}
#
# Como usar:
#   1) Baixar este arquivo no PC da filial
#   2) Abrir PowerShell como Administrador
#   3) Set-ExecutionPolicy -Scope Process Bypass
#   4) .\\atualizar-agente.ps1

#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

$VersaoAlvo = '${versao}'
$BundleUrl  = '${bundleUrl}'
$Pasta      = 'C:\\concilia-agente'
$Servico    = 'ConciliaAgente'

Write-Host ''
Write-Host '============================================' -ForegroundColor Cyan
Write-Host " Concilia Agente - Atualizador v$VersaoAlvo" -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ''

# 1. Verifica pasta
if (-not (Test-Path $Pasta)) {
  Write-Host "[ERRO] Pasta $Pasta nao encontrada. Agente nao instalado?" -ForegroundColor Red
  exit 1
}
Write-Host "[OK] Pasta encontrada: $Pasta" -ForegroundColor Green

# 2. Backup do agente atual
$BackupNome = "agente.cjs.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item "$Pasta\\agente.cjs" "$Pasta\\$BackupNome" -Force
Write-Host "[OK] Backup: $BackupNome" -ForegroundColor Green

# 3. Baixa o novo bundle
$Tmp = "$Pasta\\agente.cjs.new"
Write-Host "[..] Baixando v$VersaoAlvo..."
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $BundleUrl -OutFile $Tmp -UseBasicParsing
  $Tamanho = (Get-Item $Tmp).Length
  Write-Host "[OK] Baixado: $([math]::Round($Tamanho/1KB,1)) KB" -ForegroundColor Green
} catch {
  Write-Host "[ERRO] Download falhou: $_" -ForegroundColor Red
  exit 1
}

# 3b. Valida que o download eh um bundle de verdade (pelo menos 100 KB) e nao
#     uma pagina HTML de redirect/erro. Detecta caso o middleware do Vercel
#     redirecione pra login ou retorne 404.
$tamanhoMinKB = 100
if ($Tamanho -lt ($tamanhoMinKB * 1024)) {
  Write-Host "[ERRO] Download invalido — $([math]::Round($Tamanho/1KB,1)) KB (esperado >= $tamanhoMinKB KB)." -ForegroundColor Red
  Write-Host "       Provavel HTML de redirect/erro. Conteudo capturado:" -ForegroundColor Red
  Get-Content $Tmp -TotalCount 5 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "       $_" -ForegroundColor Gray }
  Remove-Item $Tmp -Force
  Write-Host "       Servico NAO foi alterado. Tente novamente em alguns minutos." -ForegroundColor Yellow
  exit 1
}

# 3c. Valida que comeca com '#!' ou '"use strict"' ou outro padrao de JS valido
$primeirasLinhas = Get-Content $Tmp -TotalCount 3 -Raw -ErrorAction SilentlyContinue
if ($primeirasLinhas -match '<html|<!DOCTYPE|^<') {
  Write-Host "[ERRO] Download retornou HTML em vez do bundle JS." -ForegroundColor Red
  Remove-Item $Tmp -Force
  exit 1
}

# 4. Strip BOM no config.json (precaucao)
$cfgPath = "$Pasta\\config.json"
if (Test-Path $cfgPath) {
  $cfgRaw = [System.IO.File]::ReadAllText($cfgPath)
  if ($cfgRaw[0] -eq [char]0xFEFF) {
    Write-Host "[..] Removendo BOM do config.json..."
    [System.IO.File]::WriteAllText($cfgPath, $cfgRaw.Substring(1), (New-Object System.Text.UTF8Encoding $false))
  }
}

# 5. Para o servico
Write-Host "[..] Parando servico $Servico..."
Stop-Service $Servico -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 6. Substitui o agente.cjs
Move-Item -Path $Tmp -Destination "$Pasta\\agente.cjs" -Force
Write-Host "[OK] agente.cjs substituido" -ForegroundColor Green

# 7. Inicia o servico
Write-Host "[..] Iniciando servico $Servico..."
Start-Service $Servico
Start-Sleep -Seconds 5

# 8. Valida
$svc = Get-Service $Servico
if ($svc.Status -ne 'Running') {
  Write-Host "[ERRO] Servico nao subiu (status: $($svc.Status))" -ForegroundColor Red
  Write-Host "       Restaurando backup..." -ForegroundColor Yellow
  Stop-Service $Servico -ErrorAction SilentlyContinue
  Copy-Item "$Pasta\\$BackupNome" "$Pasta\\agente.cjs" -Force
  Start-Service $Servico
  exit 1
}
Write-Host "[OK] Servico rodando" -ForegroundColor Green

# 9. Aguarda o boot e valida versao no log
Write-Host "[..] Aguardando 25s pra validar versao no log..."
Start-Sleep -Seconds 25

$logHoje = "$Pasta\\logs\\agente-$(Get-Date -Format 'yyyy-MM-dd').log"
if (Test-Path $logHoje) {
  $linhasBoot = Get-Content $logHoje -Tail 30 | Select-String -Pattern '"versao":"([^"]+)"' | Select-Object -Last 1
  if ($linhasBoot -match '"versao":"([^"]+)"') {
    $versaoBoot = $matches[1]
    if ($versaoBoot -eq $VersaoAlvo) {
      Write-Host ''
      Write-Host '============================================' -ForegroundColor Green
      Write-Host " SUCESSO - Agente atualizado pra v$versaoBoot" -ForegroundColor Green
      Write-Host '============================================' -ForegroundColor Green
    } else {
      Write-Host "[AVISO] Servico subiu mas log mostra v$versaoBoot (esperado v$VersaoAlvo)" -ForegroundColor Yellow
    }
  } else {
    Write-Host '[AVISO] Nao consegui ler versao do log. Confira manualmente:' -ForegroundColor Yellow
    Write-Host "  Get-Content $logHoje -Tail 20"
  }
} else {
  Write-Host '[AVISO] Log nao gerado ainda. Confira em alguns segundos.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Backup mantido em:' -ForegroundColor Gray
Write-Host "  $Pasta\\$BackupNome" -ForegroundColor Gray
Write-Host ''
`;

  return new NextResponse(ps1, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="atualizar-agente-v${versao}.ps1"`,
    },
  });
}

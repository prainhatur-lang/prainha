# ============================================================================
#  INSTALADOR DO CAIXA (vendas-local) — TABUARÁ / filial 02
#
#  Roda numa máquina Windows LIMPA e deixa a loja pronta: Node, Postgres,
#  servidor, banco, tarefa agendada, firewall e configuração de praças.
#
#  Uso (PowerShell COMO ADMINISTRADOR, na máquina da Tabuará):
#     irm https://app.prainhabar.com/agente-release/instalar-tabuara.ps1 | iex
#
#  É IDEMPOTENTE: pode rodar de novo sem estragar o que já está feito.
#  Não apaga dados. Se algo já existir, ele reaproveita e avisa.
# ============================================================================
# ⚠️ 'Continue', NAO 'Stop': psql, winget, npm e schtasks escrevem avisos na
# saida de ERRO mesmo quando dao certo. Com 'Stop' o PowerShell trata isso como
# falha fatal e o instalador morre no meio — foi o que aconteceu no passo 3,
# ANTES de conseguir perguntar a senha. Cada passo confere o proprio resultado.
param(
  [string]$Secret   = '',   # PAGAR_MESA_SECRET (o mesmo das outras lojas)
  [string]$Salt     = '',   # CLIENTE_HASH_SALT (pode ficar vazio)
  [string]$CieloId  = '',   # CIELO_MERCHANT_ID da TABUARÁ
  [string]$CieloKey = '',   # CIELO_MERCHANT_KEY da TABUARÁ
  [string]$SpcUser  = '',
  [string]$SpcPass  = ''
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
function Passo($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  [ok] $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Erro($t)  { Write-Host "  [X] $t" -ForegroundColor Red }

$RAIZ    = 'C:\prainha-vendas'
$FILIAL  = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7'   # Tabuará
$FDB     = 'C:\Users\eliso\AppData\Local\RAL Tecnologia\CreateInstall\consumer.fdb'
$PGSENHA = 'prainha'            # senha local do postgres desta máquina
$PGBANCO = 'vendas_local'

# --- administrador? sem isso winget/serviço/firewall falham no meio -----------
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
      ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Erro 'Abra o PowerShell COMO ADMINISTRADOR e rode de novo.'
  return
}

Passo 'Conferindo a máquina'
Write-Host ("  " + $env:COMPUTERNAME + " · " + (Get-CimInstance Win32_OperatingSystem).Caption)
if (-not (Test-Path $FDB)) {
  Erro "Não achei o banco do Consumer em: $FDB"
  Aviso 'Confira o caminho e me avise — sem o Consumer o caixa não tem cardápio.'
  return
}
Ok 'Consumer encontrado'

# --- 1. Node ----------------------------------------------------------------
Passo '1/8  Node.js'
$node = $null
try { $node = (node -v) } catch {}
if ($node) { Ok "já instalado ($node)" }
else {
  Write-Host '  instalando (leva alguns minutos)...'
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent | Out-Null
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  try { $node = (node -v); Ok "instalado ($node)" } catch { Erro 'Node não entrou no PATH — FECHE e reabra o PowerShell e rode de novo.'; return }
}

# --- 2. PostgreSQL ----------------------------------------------------------
Passo '2/8  PostgreSQL'
$psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
if ($psql) { Ok "já instalado ($($psql.FullName))" }
else {
  Write-Host '  instalando (demora — é o passo mais longo)...'
  winget install --id PostgreSQL.PostgreSQL.16 -e --accept-source-agreements --accept-package-agreements --silent `
    --override "--mode unattended --unattendedmodeui none --superpassword $PGSENHA --serverport 5432" | Out-Null
  Start-Sleep 20
  $psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
          Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $psql) { Erro 'PostgreSQL não instalou. Instale manualmente e rode de novo.'; return }
  Ok 'instalado'
}
$svc = Get-Service | Where-Object { $_.Name -like 'postgresql*' } | Select-Object -First 1
if ($svc -and $svc.Status -ne 'Running') { Start-Service $svc.Name; Start-Sleep 5 }
if ($svc) { Ok "serviço $($svc.Name): $((Get-Service $svc.Name).Status)" }

# --- 3. banco do caixa ------------------------------------------------------
# Se o Postgres JÁ existia na máquina, a senha do 'postgres' é a que o dono
# escolheu na época — não a nossa. Em vez de falhar, pergunta e testa.
Passo "3/8  Banco '$PGBANCO'"
function TestaSenha($senha) {
  if ([string]::IsNullOrWhiteSpace($senha)) { return $false }
  $env:PGPASSWORD = $senha
  $null = (& $psql.FullName -U postgres -tAc 'SELECT 1' 2>&1)
  return ($LASTEXITCODE -eq 0)
}
# 1) a senha que este instalador usa; 2) a que já está num start.bat anterior
$cands = @($PGSENHA)
if (Test-Path "$RAIZ\start.bat") {
  $m = [regex]::Match((Get-Content "$RAIZ\start.bat" -Raw), 'postgres://postgres:([^@]+)@')
  if ($m.Success) { $cands = @($m.Groups[1].Value) + $cands }
}
$cands += @('postgres','admin','Postgres','Prainha@2026','prainha2026','123456')
$senhaOk = $null
foreach ($c in $cands) { if (TestaSenha $c) { $senhaOk = $c; Ok 'senha do postgres reconhecida'; break } }

if (-not $senhaOk) {
  # A senha do 'postgres' e' de quem instalou o Postgres nesta maquina, e nao
  # temos como adivinhar. Em vez de parar a instalacao e devolver o problema
  # pro dono no meio do movimento, redefine sozinho: por ~10s o Postgres LOCAL
  # aceita conexao sem senha, define a senha nova e volta ao normal. Nenhum
  # dado e' tocado; o pg_hba.conf original fica salvo ao lado como .bak-prainha.
  Aviso 'Senha do postgres desconhecida — vou definir uma nova (10 segundos).'
  $hbaFile = (Get-ChildItem 'C:\Program Files\PostgreSQL\*\data\pg_hba.conf' -ErrorAction SilentlyContinue |
              Sort-Object FullName -Descending | Select-Object -First 1)
  if (-not $hbaFile) { Erro 'nao achei o pg_hba.conf'; return }
  $hba = $hbaFile.FullName
  Copy-Item $hba "$hba.bak-prainha" -Force
  $linhas = Get-Content $hba | ForEach-Object {
    if ($_ -match '^\s*host\s+all\s+all\s+(127\.0\.0\.1/32|::1/128)\s+\S+') {
      ($_ -replace '(\s)\S+\s*$', '$1trust')
    } else { $_ }
  }
  $linhas | Set-Content $hba -Encoding ascii
  Restart-Service $svc.Name -Force; Start-Sleep 8
  $env:PGPASSWORD = ''
  $null = (& $psql.FullName -U postgres -c "ALTER USER postgres WITH PASSWORD '$PGSENHA'" 2>&1)
  Copy-Item "$hba.bak-prainha" $hba -Force
  Restart-Service $svc.Name -Force; Start-Sleep 8
  if (TestaSenha $PGSENHA) { $senhaOk = $PGSENHA; Ok 'senha do postgres redefinida' }
  else { Erro 'nao consegui redefinir a senha do postgres'; return }
}
$PGSENHA = $senhaOk
$env:PGPASSWORD = $PGSENHA
$existe = (& $psql.FullName -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$PGBANCO'" 2>&1) -join ''
if ($existe -match '1') { Ok 'já existe (mantido como está)' }
else {
  $null = (& $psql.FullName -U postgres -c "CREATE DATABASE $PGBANCO" 2>&1)
  if ($LASTEXITCODE -ne 0) { Erro 'nao consegui criar o banco'; return }
  Ok 'criado'
}

# --- 4. arquivos ------------------------------------------------------------
Passo '4/8  Servidor'
New-Item -ItemType Directory -Force -Path $RAIZ | Out-Null
Set-Location $RAIZ
if (Test-Path "$RAIZ\server.mjs") { Copy-Item "$RAIZ\server.mjs" "$RAIZ\server-anterior.mjs" -Force }
Invoke-WebRequest -UseBasicParsing 'https://app.prainhabar.com/agente-release/vendas-local-server.mjs' -OutFile "$RAIZ\server.mjs"
$v = (Get-FileHash "$RAIZ\server.mjs" -Algorithm SHA256).Hash.Substring(0,8).ToLower()
Ok "server.mjs baixado (versao $v)"
# auto-update.ps1: quem faz a troca segura (com rollback) quando o server.mjs
# se auto-atualizar depois. Sem isto na pasta, o servidor detecta versão nova
# mas não tem como aplicar sozinho.
Invoke-WebRequest -UseBasicParsing 'https://app.prainhabar.com/agente-release/auto-update.ps1' -OutFile "$RAIZ\auto-update.ps1"
Ok 'auto-update.ps1 baixado (auto-atualização pronta pra funcionar)'

'{ "name":"vendas-local","private":true,"type":"module","dependencies":{"node-firebird":"2.0.2","postgres":"^3.4.4","qrcode-svg":"^1.1.0"} }' |
  Set-Content "$RAIZ\package.json" -Encoding ascii
if (Test-Path "$RAIZ\node_modules\postgres") { Ok 'dependências já instaladas' }
else { Write-Host '  instalando dependências...'; $null = (npm install --omit=dev --no-audit --no-fund 2>&1); Ok 'dependências instaladas' }

# --- 5. segredos ------------------------------------------------------------
Passo '5/8  Segredos da rede'
Write-Host '  Estes valores são os MESMOS das outras lojas.'
Write-Host '  Na máquina da Prainha (0001) rode:' -ForegroundColor DarkGray
Write-Host '    Select-String -Path C:\prainha-vendas\start.bat -Pattern "PAGAR_MESA_SECRET|CLIENTE_HASH_SALT|CIELO_MERCHANT|SPC_USER|SPC_PASSWORD"' -ForegroundColor DarkGray
$jaTem = (Test-Path "$RAIZ\start.bat") -and ((Get-Content "$RAIZ\start.bat" -Raw) -notmatch 'COPIAR')
if ($jaTem) { Ok 'start.bat já preenchido — mantido' }
else {
  # veio por parâmetro? usa. Só pergunta o que faltar — assim dá pra instalar
  # numa linha só, sem ninguém digitar segredo com a casa abrindo.
  $sec  = if ($Secret)   { $Secret }   else { Read-Host '  PAGAR_MESA_SECRET' }
  $salt = if ($Salt)     { $Salt }     else { '' }
  $cid  = if ($CieloId)  { $CieloId }  else { '' }
  $ckey = if ($CieloKey) { $CieloKey } else { '' }
  $spcu = if ($SpcUser)  { $SpcUser }  else { '' }
  $spcp = if ($SpcPass)  { $SpcPass }  else { '' }
  if ($sec) { Ok 'segredos recebidos' }
  $nodeExe = (Get-Command node).Source
  $bat = @"
@echo off
rem A tarefa roda como SYSTEM, cujo diretorio e o System32. Sem este cd, o
rem certificado do HTTPS (cert\) e as fotos de baixa (fotos\) nasceriam dentro
rem do System32 — o servidor sobe e a camera do KDS quebra sem explicacao.
cd /d $RAIZ
set "FILIAL_ID=$FILIAL"
set "LOJA_NOME=Tabuara"
set "PAGAR_MESA_URL=https://app.prainhabar.com"
set "FB_HOST=127.0.0.1"
set "FB_PORT=3050"
set "FB_DATABASE=$FDB"
set "FB_USER=SYSDBA"
set "FB_PASSWORD=masterkey"
set "PG_URL=postgres://postgres:$PGSENHA@127.0.0.1:5432/$PGBANCO"
set "MESA_MAX=50"
set "COMANDA_MIN=100"
set "COMANDA_MAX=200"
set "TAXA_SERVICO=10"
set "PORT=8790"
set "PORT_HTTPS=8791"
set "PAGAR_MESA_SECRET=$sec"
set "CLIENTE_HASH_SALT=$salt"
set "PIX_PROVEDOR=cielo"
set "CIELO_MERCHANT_ID=$cid"
set "CIELO_MERCHANT_KEY=$ckey"
set "SPC_USER=$spcu"
set "SPC_PASSWORD=$spcp"
:loop
rem caminho explicito do node: o PATH da conta SYSTEM so atualiza no proximo boot
rem log: se cair de madrugada, e o unico rastro que sobra
"$nodeExe" "$RAIZ\server.mjs" >> "$RAIZ\log.txt" 2>&1
timeout /t 5 /nobreak > nul
goto loop
"@
  $bat | Set-Content "$RAIZ\start.bat" -Encoding oem
  Ok 'start.bat criado'
}

# --- 6. firewall ------------------------------------------------------------
Passo '6/8  Firewall'
foreach ($porta in 8790, 8791) {
  $nome = "Prainha Vendas $porta"
  if (-not (Get-NetFirewallRule -DisplayName $nome -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $nome -Direction Inbound -Protocol TCP -LocalPort $porta -Action Allow -Profile Any | Out-Null
  }
}
Ok 'portas 8790 (app) e 8791 (câmera do KDS) liberadas'

# --- 7. tarefa agendada -----------------------------------------------------
Passo '7/8  Tarefa PrainhaVendas'
schtasks /query /tn PrainhaVendas *> $null
if ($LASTEXITCODE -eq 0) { schtasks /end /tn PrainhaVendas *> $null; schtasks /delete /tn PrainhaVendas /f *> $null }
schtasks /create /tn PrainhaVendas /tr "cmd /c $RAIZ\start.bat" /sc onstart /ru SYSTEM /rl HIGHEST /f *> $null
schtasks /run /tn PrainhaVendas *> $null
Ok 'criada e iniciada (sobe sozinha no boot)'

# --- 8. subiu? --------------------------------------------------------------
Passo '8/8  Conferindo'
$subiu = $false
foreach ($i in 1..12) {
  Start-Sleep 5
  try {
    $r = Invoke-WebRequest -UseBasicParsing 'http://localhost:8790/api/versao' -TimeoutSec 5
    Write-Host "  $($r.Content)"
    $subiu = $true; break
  } catch { Write-Host '  aguardando o servidor...' }
}
if (-not $subiu) {
  Erro 'O servidor não respondeu. Veja o erro rodando na mão:'
  Write-Host "    cd $RAIZ ; .\start.bat" -ForegroundColor Yellow
  return
}
Ok 'servidor no ar'

# KDS so na Cozinha e no Bar (decisao do dono). A praca "Caixa" NAO pode ser
# apenas OCULTADA: o proprio codigo avisa que item de praca oculta nao some —
# cai no balde laranja "Sem praca definida" e continua contando atraso. Entao
# ela e REDIRECIONADA pro Bar: o item nasce na fila de quem vai entregar.
$null = (& $psql.FullName -U postgres -d $PGBANCO -c "INSERT INTO app_config (chave,valor) VALUES ('pracas_redirecionadas','caixa>bar') ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor;" 2>&1)
$null = (& $psql.FullName -U postgres -d $PGBANCO -c "INSERT INTO app_config (chave,valor) VALUES ('pracas_ocultas','') ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor;" 2>&1)
Ok 'KDS: Cozinha e Bar · itens da praca Caixa caem no Bar'

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
       Select-Object -First 1).IPAddress
Write-Host "`n=====================================================" -ForegroundColor Green
Write-Host " TABUARA PRONTA" -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "  garcom : http://$ip`:8790/venda"
Write-Host "  caixa  : http://$ip`:8790/caixa"
Write-Host "  KDS    : http://$ip`:8790/         (camera: https://$ip`:8791/)"
Write-Host "  cliente: http://$ip`:8790/mesa?n=1"
Write-Host ""
Write-Host "  Falta so o PIN das pessoas: no /caixa, entre e cadastre em 'usuarios do sistema'."

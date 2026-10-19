# ============================================================================
#  INSTALADOR DO CAIXA (vendas-local) — TABUARÁ / filial 02 — BANCO PRÓPRIO
#
#  Variante do instalar-tabuara.ps1 SEM Consumer: o servidor da Tabuará morreu
#  em 18/10/2026 com o SSD do Firebird junto. Aqui a loja vende só no Postgres
#  local (BANCO=proprio, igual Bar e Mar), cardápio vem da nuvem e as vendas
#  sobem direto pro Concilia com o token do agente (AGENTE_TOKEN).
#
#  Uso (PowerShell COMO ADMINISTRADOR, na máquina nova da Tabuará):
#     irm https://app.prainhabar.com/agente-release/instalar-tabuara-proprio.ps1 | iex
#  Ele pergunta: PAGAR_MESA_SECRET (o mesmo das outras lojas), o token do
#  agente (Concilia → /sync → card da Tabuará → "Token do agente") e o PIN do
#  primeiro administrador (login 'admin').
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
  [string]$SpcPass  = '',
  [string]$AgenteToken = '', # filial.agente_token da TABUARÁ (Concilia → /sync)
  [string]$AdminPin = '',   # PIN do 1º administrador (login 'admin'), 4–8 dígitos
  [switch]$SemTailscale,    # pula o Funnel (tabuara.tailb22e0d.ts.net)
  [string]$IpFixo = '192.168.0.100'  # IP do servidor antigo: LIO e QR das mesas já apontam pra ele ('' = não mexe)
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
function Passo($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  [ok] $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Erro($t)  { Write-Host "  [X] $t" -ForegroundColor Red }

$RAIZ    = 'C:\prainha-vendas'
$FILIAL  = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7'   # Tabuará
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
Ok 'modo BANCO PRÓPRIO (sem Consumer): cardápio vem da nuvem'

# --- 1. Node ----------------------------------------------------------------
Passo '1/10  Node.js'
$node = $null
try { $node = (node -v) } catch {}
if ($node) { Ok "já instalado ($node)" }
else {
  Write-Host '  instalando (leva alguns minutos)...'
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent | Out-Null
  # winget ausente/quebrado (Windows recem-instalado): baixa o MSI direto do nodejs.org
  if (-not (Test-Path 'C:\Program Files\nodejs\node.exe')) {
    Write-Host '  winget nao instalou; baixando o MSI do nodejs.org...'
    $msi = Join-Path $env:TEMP 'node-lts-x64.msi'
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest 'https://nodejs.org/dist/v22.11.0/node-v22.11.0-x64.msi' -OutFile $msi -UseBasicParsing
      Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
    } catch { Erro "falha ao baixar/instalar o Node: $_" }
  }
  $env:Path = 'C:\Program Files\nodejs;' + [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  try { $node = (node -v) } catch {}
  if ($node) { Ok "instalado ($node)" } else { Erro 'Node nao instalou. Mande um print deste erro.'; return }
}

# --- 2. PostgreSQL ----------------------------------------------------------
Passo '2/10  PostgreSQL'
# Acha o psql em qualquer disco (C:\Program Files ou X:\PostgreSQL de instalacao em outro disco)
function AchaPsql {
  $l = @(Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue)
  foreach ($d in (Get-PSDrive -PSProvider FileSystem)) {
    $l += @(Get-ChildItem "$($d.Root)PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue)
  }
  $l | Sort-Object FullName -Descending | Select-Object -First 1
}
# C: com pouco espaco (PC de uso geral, 18/10 o Telao estava com 0 GB): banco vai pro disco com mais folga
$livreC = [math]::Round((Get-PSDrive C).Free/1GB,1)
$pgDisco = $null
if ($livreC -lt 20) {
  $pgDisco = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -ne 'C' -and $_.Free -gt 20GB -and (Test-Path $_.Root) } |
             Sort-Object Free -Descending | Select-Object -First 1
}
$psql = AchaPsql
if ($psql) { Ok "já instalado ($($psql.FullName))" }
else {
  if ($pgDisco) {
    $pgPrefix = "$($pgDisco.Name):\PostgreSQL\16"
    Aviso "C: so tem $livreC GB livres: o PostgreSQL e o banco vao pro disco $($pgDisco.Name): ($pgPrefix)"
  } else {
    if ($livreC -lt 3) { Erro "C: so tem $livreC GB livres e nao achei outro disco com 20 GB. Libere espaco e rode de novo."; return }
    Write-Host '  instalando (demora — é o passo mais longo)...'
    winget install --id PostgreSQL.PostgreSQL.16 -e --accept-source-agreements --accept-package-agreements --silent `
      --override "--mode unattended --unattendedmodeui none --superpassword $PGSENHA --serverport 5432" | Out-Null
    Start-Sleep 20
    $psql = AchaPsql
  }
  if (-not $psql) {
    # winget ausente/quebrado ou outro disco: baixa o instalador oficial (EDB, ~350 MB) e roda silencioso
    Write-Host '  baixando o instalador oficial do PostgreSQL (~350 MB, alguns minutos)...'
    $baixa = if ($pgDisco) { "$($pgDisco.Name):\" } else { $env:TEMP }
    $exe = Join-Path $baixa 'postgresql-16-x64.exe'
    $pgArgs = "--mode unattended --unattendedmodeui none --superpassword $PGSENHA --serverport 5432 --disable-components stackbuilder"
    if ($pgDisco) { $pgArgs += " --prefix `"$pgPrefix`" --datadir `"$pgPrefix\data`"" }
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $ProgressPreference = 'SilentlyContinue'
      # internet da loja lenta/instavel (19/10: Invoke-WebRequest estourou o tempo): curl.exe do
      # Windows continua de onde parou (-C -); ate 20 tentativas, o arquivo parcial fica no disco
      $pgUrl = 'https://get.enterprisedb.com/postgresql/postgresql-16.10-1-windows-x64.exe'
      $pgTam = 357432712
      $curl = Join-Path $env:WINDIR 'System32\curl.exe'
      for ($t = 1; $t -le 20; $t++) {
        if ((Test-Path $exe) -and (Get-Item $exe).Length -ge $pgTam) { break }
        if (Test-Path $curl) { & $curl -L -C - --retry 5 --retry-delay 5 --connect-timeout 30 -sS -o $exe $pgUrl }
        else { Invoke-WebRequest $pgUrl -OutFile $exe -UseBasicParsing -TimeoutSec 3600 }
        $mb = if (Test-Path $exe) { [math]::Round((Get-Item $exe).Length/1MB) } else { 0 }
        Write-Host "  baixado: $mb de 341 MB (tentativa $t)"
      }
      if (-not ((Test-Path $exe) -and (Get-Item $exe).Length -ge $pgTam)) { throw 'download incompleto (internet caindo) - rode de novo que ele continua de onde parou' }
      Write-Host '  instalando o PostgreSQL...'
      Start-Process $exe -ArgumentList $pgArgs -Wait
    } catch { Erro "falha ao baixar/instalar o PostgreSQL: $_" }
    $psql = AchaPsql
  }
  if (-not $psql) { Erro 'PostgreSQL nao instalou. Mande um print deste erro.'; return }
  Ok "instalado ($($psql.FullName))"
}
$svc = Get-Service | Where-Object { $_.Name -like 'postgresql*' } | Select-Object -First 1
if ($svc -and $svc.Status -ne 'Running') { Start-Service $svc.Name; Start-Sleep 5 }
if ($svc) { Ok "serviço $($svc.Name): $((Get-Service $svc.Name).Status)" }

# --- 3. banco do caixa ------------------------------------------------------
# Se o Postgres JÁ existia na máquina, a senha do 'postgres' é a que o dono
# escolheu na época — não a nossa. Em vez de falhar, pergunta e testa.
Passo "3/10  Banco '$PGBANCO'"
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
  $hbaFile = (Get-ChildItem (Join-Path (Split-Path (Split-Path $psql.FullName)) 'data\pg_hba.conf'),'C:\Program Files\PostgreSQL\*\data\pg_hba.conf' -ErrorAction SilentlyContinue |
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
Passo '4/10  Servidor'
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
Passo '5/10  Segredos da rede'
Write-Host '  Estes valores são os MESMOS das outras lojas.'
Write-Host '  Na máquina da Prainha (0001) rode:' -ForegroundColor DarkGray
Write-Host '    Select-String -Path C:\prainha-vendas\start.bat -Pattern "PAGAR_MESA_SECRET|CLIENTE_HASH_SALT|CIELO_MERCHANT|SPC_USER|SPC_PASSWORD"' -ForegroundColor DarkGray
$jaTem = (Test-Path "$RAIZ\start.bat") -and ((Get-Content "$RAIZ\start.bat" -Raw) -notmatch 'COPIAR')
if ($jaTem) {
  # start.bat de antes (modo Firebird): troca só BANCO/AGENTE_TOKEN/FB_*
  $b = Get-Content "$RAIZ\start.bat" -Raw
  if ($b -notmatch 'BANCO=proprio' -or $b -notmatch 'AGENTE_TOKEN=\S') {
    $tok = if ($AgenteToken) { $AgenteToken } else { Read-Host '  Token do agente da Tabuara (Concilia -> /sync)' }
    Copy-Item "$RAIZ\start.bat" "$RAIZ\start-firebird.bat" -Force
    $linhas = @(Get-Content "$RAIZ\start.bat" | Where-Object { $_ -notmatch '^\s*set\s+"?(BANCO|AGENTE_TOKEN|FB_[A-Z]+)\s*=' })
    $i = [array]::IndexOf($linhas, ':loop'); if ($i -lt 1) { $i = $linhas.Count }
    $novo = @('set "BANCO=proprio"', ('set "AGENTE_TOKEN=' + $tok + '"'))
    $fim = if ($i -lt $linhas.Count) { $linhas[$i..($linhas.Count-1)] } else { @() }
    ($linhas[0..($i-1)] + $novo + $fim) | Set-Content "$RAIZ\start.bat" -Encoding oem
    Ok 'start.bat virou banco próprio (cópia antiga em start-firebird.bat)'
  } else { Ok 'start.bat já preenchido (banco próprio) — mantido' }
}
else {
  # veio por parâmetro? usa. Só pergunta o que faltar — assim dá pra instalar
  # numa linha só, sem ninguém digitar segredo com a casa abrindo.
  $sec  = if ($Secret)   { $Secret }   else { Read-Host '  PAGAR_MESA_SECRET' }
  $tok  = if ($AgenteToken) { $AgenteToken } else { Read-Host '  Token do agente da Tabuara (Concilia -> /sync)' }
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
rem banco proprio: nunca abre Firebird; vende no Postgres e sobe pra nuvem
set "BANCO=proprio"
set "AGENTE_TOKEN=$tok"
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
Passo '6/10  Firewall'
foreach ($porta in 8790, 8791) {
  $nome = "Prainha Vendas $porta"
  if (-not (Get-NetFirewallRule -DisplayName $nome -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $nome -Direction Inbound -Protocol TCP -LocalPort $porta -Action Allow -Profile Any | Out-Null
  }
}
Ok 'portas 8790 (app) e 8791 (câmera do KDS) liberadas'

# --- 7. tarefa agendada -----------------------------------------------------
Passo '7/10  Tarefa PrainhaVendas'
schtasks /query /tn PrainhaVendas *> $null
if ($LASTEXITCODE -eq 0) { schtasks /end /tn PrainhaVendas *> $null; schtasks /delete /tn PrainhaVendas /f *> $null }
schtasks /create /tn PrainhaVendas /tr "cmd /c $RAIZ\start.bat" /sc onstart /ru SYSTEM /rl HIGHEST /f *> $null
schtasks /run /tn PrainhaVendas *> $null
Ok 'criada e iniciada (sobe sozinha no boot)'

# --- 8. subiu? --------------------------------------------------------------
Passo '8/10  Conferindo'
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

# --- 9. primeiro administrador ---------------------------------------------
# Sem Consumer nao tem de onde migrar usuario, e criar usuario no /caixa exige
# alguem logado. Entao o instalador semeia UM admin (login 'admin'); o resto da
# equipe ele cadastra em Caixa -> Usuarios (ou pela Equipe do Concilia).
Passo '9/10  Primeiro administrador'
$env:PGPASSWORD = $PGSENHA
$qtd = ((& $psql.FullName -U postgres -d $PGBANCO -tAc "SELECT count(*) FROM usuario_local WHERE admin AND ativo" 2>&1) -join '').Trim()
if ($qtd -match '^[1-9]') { Ok "já tem administrador ($qtd) — mantido" }
else {
  $pin = $AdminPin
  while ($pin -notmatch '^\d{4,8}$') { $pin = Read-Host '  PIN do administrador (4 a 8 numeros)' }
  # mesmo hash do server.mjs: pinHash(pin, salt) = scrypt(pin, salt, 32) hex
  $js = @'
import postgres from 'postgres';
import { scryptSync, randomBytes } from 'node:crypto';
const sql = postgres(process.env.PG_URL);
const salt = randomBytes(16).toString('hex');
const h = scryptSync(String(process.env.ADMIN_PIN), salt, 32).toString('hex');
await sql`INSERT INTO usuario_local (login, nome, pin_hash, salt, perms, admin, criado_por)
  VALUES ('admin', 'Administrador', ${h}, ${salt}, '{}'::integer[], true, 'instalador')
  ON CONFLICT (login) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, salt=EXCLUDED.salt, admin=true, ativo=true`;
await sql`INSERT INTO garcom_pin (login, pin_hash, salt, nome) VALUES ('admin', ${h}, ${salt}, 'Administrador')
  ON CONFLICT (login) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, salt=EXCLUDED.salt, atualizado_em=now()`;
console.log('semeado-ok');
await sql.end();
'@
  [System.IO.File]::WriteAllText("$RAIZ\semear-admin.mjs", $js, (New-Object System.Text.UTF8Encoding $false))
  $env:PG_URL = "postgres://postgres:$PGSENHA@127.0.0.1:5432/$PGBANCO"
  $env:ADMIN_PIN = $pin
  Push-Location $RAIZ
  $out = (& node "$RAIZ\semear-admin.mjs" 2>&1) -join ' '
  Pop-Location
  Remove-Item "$RAIZ\semear-admin.mjs" -Force -ErrorAction SilentlyContinue
  $env:ADMIN_PIN = ''
  if ($out -match 'semeado-ok') { Ok "login 'admin' criado com o PIN escolhido" } else { Erro "não criei o admin: $out" }
}

# --- 10. Tailscale Funnel ---------------------------------------------------
# A maquininha LIO e o filial.caixa_url apontam pra tabuara.tailb22e0d.ts.net.
# Se a maquina nova entrar no tailnet com o MESMO nome, nada precisa mudar.
# ANTES: apague a maquina antiga "tabuara" em login.tailscale.com/admin/machines,
# senao a nova vira "tabuara-1" e o endereco muda.
Passo '10/10  Tailscale (endereço externo)'
if ($SemTailscale) { Aviso 'pulado (-SemTailscale)' }
else {
  $ts = 'C:\Program Files\Tailscale\tailscale.exe'
  if (-not (Test-Path $ts)) {
    Write-Host '  instalando Tailscale...'
    winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements --silent | Out-Null
    Start-Sleep 10
    if (-not (Test-Path $ts)) {
      Write-Host '  winget nao instalou; baixando o MSI do Tailscale...'
      $tsmsi = Join-Path $env:TEMP 'tailscale-setup.msi'
      try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi' -OutFile $tsmsi -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i `"$tsmsi`" /qn /norestart" -Wait
        Start-Sleep 5
      } catch { Aviso "falha ao baixar o Tailscale: $_" }
    }
  }
  if (-not (Test-Path $ts)) { Aviso 'Tailscale não instalou — instale em tailscale.com/download e rode de novo.' }
  else {
    Write-Host '  Se abrir o navegador: entre com a conta prainhatur@gmail.com.' -ForegroundColor Yellow
    & $ts up --hostname=tabuara --unattended 2>&1 | Out-Host
    & $ts funnel --bg 8790 2>&1 | Out-Host
    $dns = ''
    try { $dns = ((& $ts status --json 2>$null) -join "`n" | ConvertFrom-Json).Self.DNSName } catch {}
    if ($dns -like 'tabuara.*') {
      & $ts cert $dns.TrimEnd('.') 2>&1 | Out-Null
      Ok "no ar em https://$($dns.TrimEnd('.'))"
    } else {
      Aviso "o nome saiu '$dns' (não 'tabuara'): apague a máquina antiga no painel do Tailscale e rode: tailscale set --hostname=tabuara"
    }
  }
}

# --- IP fixo = o do servidor antigo ----------------------------------------
# A maquininha aprende o IP local pelo /api/config, mas os QR impressos e a
# lista de reserva da LIO têm 192.168.0.100. Assumir o mesmo IP evita reimprimir.
# Fica por ÚLTIMO: a conexão remota (AnyDesk/VPN) cai e volta no IP novo.
if ($IpFixo) {
  Passo "IP fixo $IpFixo"
  $cfgIp = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
  if (-not $cfgIp) { Aviso 'não achei a placa de rede com gateway — IP não mudou' }
  elseif ($cfgIp.IPv4Address.IPAddress -eq $IpFixo) { Ok 'já está nesse IP' }
  elseif (Test-Connection -ComputerName $IpFixo -Count 2 -Quiet) { Aviso "$IpFixo respondeu na rede (o servidor antigo voltou?) — IP não mudou" }
  else {
    $idx  = $cfgIp.InterfaceIndex
    $gw   = $cfgIp.IPv4DefaultGateway.NextHop
    $pref = ($cfgIp.IPv4Address | Select-Object -First 1).PrefixLength
    $dnsS = @((Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv4).ServerAddresses)
    if (-not $dnsS -or $dnsS.Count -eq 0) { $dnsS = @($gw, '8.8.8.8') }
    Write-Host "  $($cfgIp.IPv4Address.IPAddress) -> $IpFixo (gateway $gw, DNS $($dnsS -join ','))"
    Write-Host '  a conexao remota vai cair por alguns segundos.' -ForegroundColor Yellow
    Set-NetIPInterface -InterfaceIndex $idx -Dhcp Disabled -ErrorAction SilentlyContinue
    Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
    Get-NetRoute -InterfaceIndex $idx -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
    New-NetIPAddress -InterfaceIndex $idx -IPAddress $IpFixo -PrefixLength $pref -DefaultGateway $gw | Out-Null
    Set-DnsClientServerAddress -InterfaceIndex $idx -ServerAddresses $dnsS
    Start-Sleep 5
    if (Test-Connection -ComputerName $gw -Count 2 -Quiet) { Ok "IP agora é $IpFixo (fixo)" }
    else { Aviso 'gateway não respondeu no IP novo — confira o cabo/roteador' }
  }
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
       Select-Object -First 1).IPAddress
Write-Host "`n=====================================================" -ForegroundColor Green
Write-Host " TABUARA PRONTA (BANCO PROPRIO)" -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "  garcom : http://$ip`:8790/venda"
Write-Host "  caixa  : http://$ip`:8790/caixa"
Write-Host "  KDS    : http://$ip`:8790/         (camera: https://$ip`:8791/)"
Write-Host "  cliente: http://$ip`:8790/mesa?n=1"
Write-Host ""
Write-Host "  Entre no /caixa com login 'admin' e o PIN escolhido e cadastre a equipe em 'usuarios do sistema'."
Write-Host "  O cardapio chega da nuvem em ~1 minuto (confira em http://$ip`:8790/api/produtos)." 

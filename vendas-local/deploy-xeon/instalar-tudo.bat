@echo off
REM ============================================================
REM  PRAINHA BAR - Sistema de Vendas local (KDS + venda garcom)
REM  Rodar NA MAQUINA DA LOJA (Xeon / 10.0.0.252) como ADMIN:
REM    botao direito neste arquivo > "Executar como administrador"
REM  (NAO colar este conteudo dentro do PowerShell!)
REM
REM  O que faz (tudo automatico):
REM   1) Copia o sistema para C:\prainha-vendas
REM   2) Instala PostgreSQL 16 (se nao tiver) + cria banco vendas_local
REM   3) Instala Node.js LTS (se nao tiver)
REM   4) Libera a porta 8790 no firewall (tablets/TVs/celulares da loja)
REM   5) Cria o servico "PrainhaVendas" (inicia junto com o Windows)
REM   6) Inicia agora e testa
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion

set "PASTA=C:\prainha-vendas"
set "PGVER=16"
set "PGFULLVER=16.9-1"
set "PGPORT=5432"
set "PGSUPERPASS=Eli153515"
set "APPDB=vendas_local"
set "APPUSER=prainha_app"
set "APPPASS=Prainha_App_2026"
set "PORTA=8790"

echo.
echo ===== PRAINHA VENDAS - instalador (Xeon) =====
echo.

REM ---- 0) precisa ser Administrador ----
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo [ERRO] Rode como ADMINISTRADOR: botao direito ^> Executar como administrador.
  pause & exit /b 1
)

REM ---- 1) copiar arquivos pra C:\prainha-vendas ----
echo [1/6] Copiando arquivos para %PASTA% ...
if not exist "%PASTA%" mkdir "%PASTA%"
robocopy "%~dp0." "%PASTA%" /E /NFL /NDL /NJH /NJS >nul
if not exist "%PASTA%\server.mjs" (
  echo [ERRO] server.mjs nao encontrado. Extraia o ZIP inteiro antes de rodar.
  pause & exit /b 1
)

REM ---- 2) PostgreSQL (detecta QUALQUER versao ja instalada) ----
set "PGHOME="
for /d %%D in ("C:\Program Files\PostgreSQL\*") do if exist "%%D\bin\psql.exe" set "PGHOME=%%D"
if not "%PGHOME%"=="" (
  echo [2/6] PostgreSQL ja instalado em "%PGHOME%".
  goto :pgconfig
)
set "PGHOME=C:\Program Files\PostgreSQL\%PGVER%"
echo [2/6] Instalando PostgreSQL %PGVER% ...
where winget >nul 2>&1
if "%errorlevel%"=="0" (
  winget install -e --id PostgreSQL.PostgreSQL.%PGVER% --silent --accept-package-agreements --accept-source-agreements
) else (
  echo    winget indisponivel, baixando instalador EDB...
  powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing 'https://get.enterprisedb.com/postgresql/postgresql-%PGFULLVER%-windows-x64.exe' -OutFile '%TEMP%\pg-installer.exe' } catch { exit 1 }"
  if not exist "%TEMP%\pg-installer.exe" (
    echo [ERRO] Nao baixou o Postgres. Verifique a internet e rode de novo.
    pause & exit /b 1
  )
  "%TEMP%\pg-installer.exe" --mode unattended --unattendedmodeui minimal --superpassword "%PGSUPERPASS%" --serverport %PGPORT% --enable-components server,commandlinetools --disable-components stackbuilder
)
timeout /t 5 /nobreak >nul
if not exist "%PGHOME%\bin\psql.exe" (
  echo [ERRO] PostgreSQL nao encontrado em "%PGHOME%". Ajuste PGVER no topo e rode de novo.
  pause & exit /b 1
)

:pgconfig
set "PSQL=%PGHOME%\bin\psql.exe"
set "PGDATA=%PGHOME%\data"
powershell -NoProfile -Command "Get-Service | Where-Object {$_.Name -like 'postgresql*'} | Select-Object -First 1 -ExpandProperty Name" > "%TEMP%\pgsvc.txt" 2>nul
set "SVC="
set /p SVC=<"%TEMP%\pgsvc.txt"
if "%SVC%"=="" set "SVC=postgresql-x64-%PGVER%"
sc config "%SVC%" start= auto >nul 2>&1
net start "%SVC%" >nul 2>&1

REM define a senha do superusuario via trust temporario (idempotente)
powershell -NoProfile -Command "$f='%PGDATA%\pg_hba.conf'; Copy-Item $f ($f + '.bak') -Force; (Get-Content $f) -replace '(scram-sha-256|md5|peer|ident|sspi)','trust' | Set-Content $f"
net stop "%SVC%" >nul 2>&1
net start "%SVC%" >nul 2>&1
timeout /t 3 /nobreak >nul
"%PSQL%" -U postgres -h 127.0.0.1 -p %PGPORT% -c "ALTER USER postgres PASSWORD '%PGSUPERPASS%';" >nul 2>&1
powershell -NoProfile -Command "Copy-Item ('%PGDATA%\pg_hba.conf.bak') ('%PGDATA%\pg_hba.conf') -Force"
net stop "%SVC%" >nul 2>&1
net start "%SVC%" >nul 2>&1
timeout /t 3 /nobreak >nul

echo    Criando banco %APPDB% e usuario %APPUSER% ...
set "SQL=%TEMP%\pg-setup.sql"
> "%SQL%" echo DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='%APPUSER%') THEN CREATE ROLE %APPUSER% LOGIN PASSWORD '%APPPASS%'; END IF; END $$;
>>"%SQL%" echo SELECT 'CREATE DATABASE %APPDB% OWNER %APPUSER%' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='%APPDB%') \gexec
>>"%SQL%" echo GRANT ALL PRIVILEGES ON DATABASE %APPDB% TO %APPUSER%;
>>"%SQL%" echo \connect %APPDB%
>>"%SQL%" echo GRANT ALL ON SCHEMA public TO %APPUSER%;
>>"%SQL%" echo ALTER SCHEMA public OWNER TO %APPUSER%;
set "PGPASSWORD=%PGSUPERPASS%"
"%PSQL%" -U postgres -h 127.0.0.1 -p %PGPORT% -f "%SQL%" >nul
set "PGPASSWORD="
del "%SQL%" >nul 2>&1

REM ---- 3) Node.js ----
set "NODEEXE=C:\Program Files\nodejs\node.exe"
if exist "%NODEEXE%" (
  echo [3/6] Node.js ja instalado.
) else (
  where node >nul 2>&1
  if "!errorlevel!"=="0" (
    echo [3/6] Node.js ja instalado (no PATH).
  ) else (
    echo [3/6] Instalando Node.js LTS ...
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    timeout /t 3 /nobreak >nul
  )
)

REM ---- 4) firewall: liberar a porta pros aparelhos da loja ----
echo [4/6] Liberando porta %PORTA% no firewall ...
netsh advfirewall firewall delete rule name="Prainha Vendas %PORTA%" >nul 2>&1
netsh advfirewall firewall add rule name="Prainha Vendas %PORTA%" dir=in action=allow protocol=TCP localport=%PORTA% >nul

REM ---- 5) servico: tarefa que inicia com o Windows e se mantem viva ----
echo [5/6] Criando servico "PrainhaVendas" (inicia com o Windows) ...
schtasks /end /tn "PrainhaVendas" >nul 2>&1
schtasks /delete /tn "PrainhaVendas" /f >nul 2>&1
schtasks /create /tn "PrainhaVendas" /sc onstart /ru SYSTEM /rl HIGHEST /tr "\"%PASTA%\start.bat\"" /f >nul
if not "%errorlevel%"=="0" (
  echo [ERRO] Nao consegui criar a tarefa agendada.
  pause & exit /b 1
)

REM ---- 6) iniciar agora e testar ----
echo [6/6] Iniciando ...
schtasks /run /tn "PrainhaVendas" >nul
timeout /t 8 /nobreak >nul
curl -s -o "%TEMP%\vendas-teste.json" http://localhost:%PORTA%/api/areas
if exist "%TEMP%\vendas-teste.json" (
  findstr /c:"areas" "%TEMP%\vendas-teste.json" >nul && (
    echo.
    echo ================= PRONTO! =================
    echo  O sistema esta NO AR nesta maquina.
    echo.
    echo  Nos aparelhos da loja (mesma rede/Wi-Fi):
    echo    Garcom (celular): http://10.0.0.252:%PORTA%/venda
    echo    KDS producao (TV): http://10.0.0.252:%PORTA%/?area=NUMERO
    echo    Entregas (tablet): http://10.0.0.252:%PORTA%/entrega
    echo.
    echo  Log: %PASTA%\log.txt
    echo ===========================================
  ) || (
    echo [AVISO] Servico iniciou mas a resposta veio estranha.
    echo         Veja o log em %PASTA%\log.txt e me mande o final dele.
  )
) else (
  echo [AVISO] Nao respondeu ainda. Aguarde 30s e abra http://localhost:%PORTA%
  echo         Se nao abrir, veja %PASTA%\log.txt e me mande o final dele.
)
echo.
pause
endlocal

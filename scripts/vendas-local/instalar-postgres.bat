@echo off
REM ============================================================
REM  Instalador do Postgres LOCAL para o sistema de vendas novo
REM  Rodar NA MAQUINA da loja (0001 / Xeon), como ADMINISTRADOR.
REM  - Instala PostgreSQL (winget; se nao tiver, baixa o instalador EDB)
REM  - Define a senha do superusuario 'postgres'
REM  - Cria o banco + usuario da aplicacao
REM  - Deixa o Postgres so em localhost (NAO expoe na rede) = seguro
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion

REM ============ CONFIG (pode editar) ============
set "PGVER=16"
set "PGFULLVER=16.9-1"
set "PGPORT=5432"
set "PGSUPERPASS=Prainha_Super_2026"
set "APPDB=vendas_local"
set "APPUSER=prainha_app"
set "APPPASS=Prainha_App_2026"
REM =============================================

echo.
echo === Instalador Postgres local (sistema de vendas) ===
echo.

REM ---- 1) precisa ser Administrador ----
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo [ERRO] Rode este arquivo como ADMINISTRADOR
  echo        (clique com o botao direito ^> "Executar como administrador").
  pause & exit /b 1
)

REM ---- 2) ja esta instalado? ----
set "PGHOME=C:\Program Files\PostgreSQL\%PGVER%"
if exist "%PGHOME%\bin\psql.exe" (
  echo [OK] PostgreSQL %PGVER% ja esta instalado em "%PGHOME%".
  goto :configurar
)

REM ---- 3) instalar ----
where winget >nul 2>&1
if "%errorlevel%"=="0" (
  echo [..] Instalando PostgreSQL %PGVER% via winget...
  winget install -e --id PostgreSQL.PostgreSQL.%PGVER% --silent --accept-package-agreements --accept-source-agreements
) else (
  echo [..] winget indisponivel. Baixando o instalador EDB %PGFULLVER%...
  set "INST=%TEMP%\pg-installer.exe"
  powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing 'https://get.enterprisedb.com/postgresql/postgresql-%PGFULLVER%-windows-x64.exe' -OutFile '%TEMP%\pg-installer.exe' } catch { exit 1 }"
  if not exist "%TEMP%\pg-installer.exe" (
    echo [ERRO] Nao consegui baixar o instalador. Ajuste PGFULLVER no topo do .bat
    echo        ou instale o PostgreSQL %PGVER% manualmente e rode este .bat de novo.
    pause & exit /b 1
  )
  echo [..] Instalando em modo silencioso...
  "%TEMP%\pg-installer.exe" --mode unattended --unattendedmodeui minimal --superpassword "%PGSUPERPASS%" --serverport %PGPORT% --enable-components server,commandlinetools --disable-components stackbuilder
)

REM ---- espera + confere ----
timeout /t 5 /nobreak >nul
if not exist "%PGHOME%\bin\psql.exe" (
  echo [ERRO] Instalacao nao encontrada em "%PGHOME%".
  echo        Confira a versao instalada e ajuste PGVER no topo do .bat.
  pause & exit /b 1
)

:configurar
set "PSQL=%PGHOME%\bin\psql.exe"
set "PGDATA=%PGHOME%\data"

REM ---- 4) descobrir o nome do servico ----
powershell -NoProfile -Command "Get-Service | Where-Object {$_.Name -like 'postgresql*'} | Select-Object -First 1 -ExpandProperty Name" > "%TEMP%\pgsvc.txt" 2>nul
set "SVC="
set /p SVC=<"%TEMP%\pgsvc.txt"
if "%SVC%"=="" set "SVC=postgresql-x64-%PGVER%"
echo [OK] Servico: %SVC%

REM ---- 5) garantir a senha do 'postgres' (via trust temporario) ----
echo [..] Ajustando autenticacao para definir a senha do superusuario...
powershell -NoProfile -Command "$f='%PGDATA%\pg_hba.conf'; Copy-Item $f ($f + '.bak') -Force; (Get-Content $f) -replace '(scram-sha-256|md5|peer|ident|sspi)','trust' | Set-Content $f"
net stop "%SVC%" >nul 2>&1
net start "%SVC%" >nul 2>&1
timeout /t 3 /nobreak >nul
"%PSQL%" -U postgres -h 127.0.0.1 -p %PGPORT% -c "ALTER USER postgres PASSWORD '%PGSUPERPASS%';" >nul
REM ---- restaura autenticacao segura ----
powershell -NoProfile -Command "Copy-Item ('%PGDATA%\pg_hba.conf.bak') ('%PGDATA%\pg_hba.conf') -Force"
net stop "%SVC%" >nul 2>&1
net start "%SVC%" >nul 2>&1
timeout /t 3 /nobreak >nul

REM ---- 6) criar banco + usuario da aplicacao ----
echo [..] Criando banco "%APPDB%" e usuario "%APPUSER%"...
set "SQL=%TEMP%\pg-setup.sql"
> "%SQL%" echo DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='%APPUSER%') THEN CREATE ROLE %APPUSER% LOGIN PASSWORD '%APPPASS%'; END IF; END $$;
>>"%SQL%" echo SELECT 'CREATE DATABASE %APPDB% OWNER %APPUSER%' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='%APPDB%') \gexec
>>"%SQL%" echo GRANT ALL PRIVILEGES ON DATABASE %APPDB% TO %APPUSER%;
>>"%SQL%" echo \connect %APPDB%
>>"%SQL%" echo GRANT ALL ON SCHEMA public TO %APPUSER%;
>>"%SQL%" echo ALTER SCHEMA public OWNER TO %APPUSER%;
set "PGPASSWORD=%PGSUPERPASS%"
"%PSQL%" -U postgres -h 127.0.0.1 -p %PGPORT% -f "%SQL%"
set "PGPASSWORD="
del "%SQL%" >nul 2>&1

REM ---- 7) servico inicia junto com o Windows ----
sc config "%SVC%" start= auto >nul 2>&1

echo.
echo ================= PRONTO =================
echo  Host   : localhost  (porta %PGPORT%, somente local = seguro)
echo  Banco  : %APPDB%
echo  Usuario: %APPUSER%
echo  Senha  : %APPPASS%
echo.
echo  String de conexao (na propria maquina):
echo   postgresql://%APPUSER%:%APPPASS%@localhost:%PGPORT%/%APPDB%
echo ==========================================
echo.
echo Copie essa string e me mande. Se algum passo deu erro, me manda o texto do erro.
pause
endlocal

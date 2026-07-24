@echo off
REM Inicia o sistema de vendas e o mantem vivo (reinicia se cair).
REM Executado pela tarefa "PrainhaVendas" no boot do Windows.
cd /d C:\prainha-vendas

REM --- config da LOJA (Firebird e Postgres locais) ---
set "FB_HOST=127.0.0.1"
set "FB_PORT=3050"
set "FB_DATABASE=C:\Users\Administrator\AppData\Local\RAL Tecnologia\CreateInstall\consumer.fdb"
set "FB_USER=SYSDBA"
set "FB_PASSWORD=masterkey"
set "PG_URL=postgres://prainha_app:Prainha_App_2026@127.0.0.1:5432/vendas_local"
set "PORT=8790"

set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

:loop
REM rotaciona o log se passar de ~10 MB
for %%A in (log.txt) do if %%~zA GTR 10485760 move /y log.txt log-anterior.txt >nul 2>&1
echo [%date% %time%] iniciando server >> log.txt
"%NODE%" server.mjs >> log.txt 2>&1
echo [%date% %time%] server parou, reiniciando em 5s >> log.txt
timeout /t 5 /nobreak >nul
goto loop

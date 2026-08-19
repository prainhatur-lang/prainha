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
set "PORT=8080"
REM Porta 8080 é a porta dos QR codes impressos nas mesas
REM As DUAS portas ao mesmo tempo: 8790 continua viva pros atalhos antigos
REM dos tablets, e o HTTPS da camera fica cravado no 8791 de sempre
set "PORT_EXTRA=8790"
set "PORT_HTTPS=8791"

REM --- consulta de CPF (SPC Brasil) ---
REM O cadastro e' por CPF: o nome vem da consulta (casa -> ja atendidos ->
REM outras filiais -> SPC). SEM as tres linhas abaixo o SPC fica desligado e
REM quem nao e' cliente da casa aparece como "nao achei nome".
REM Conferir se pegou: http://localhost:8080/api/cpf/status
REM set "CPF_PROVEDOR=spc"
REM set "SPC_USER=preencher"
REM set "SPC_PASSWORD=preencher"

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

@echo off
REM Atualiza o Prainha Vendas (troca so o server.mjs pela versao nova).
REM Uso: extrair o ZIP e BOTAO DIREITO ^> Executar como administrador.
cd /d "%~dp0"
if not exist server.mjs echo ERRO: server.mjs nao esta nesta pasta (extraia o ZIP inteiro) & pause & exit /b 1
if not exist C:\prainha-vendas\server.mjs echo ERRO: sistema nao instalado em C:\prainha-vendas & pause & exit /b 1
copy /y C:\prainha-vendas\server.mjs C:\prainha-vendas\server-anterior.mjs >nul
copy /y server.mjs C:\prainha-vendas\server.mjs >nul
if errorlevel 1 echo ERRO ao copiar (feche editores abertos) & pause & exit /b 1
REM derruba SO o node do vendas-local - a tarefa PrainhaVendas religa em ~5s
REM (nao usa taskkill geral pra nao matar o agente-local que roda na mesma maquina)
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo.
echo Atualizado! O sistema religa sozinho em ~5 segundos.
echo Confira no navegador:  http://localhost:8790/api/config
echo (deve responder com "ok":true e o nome da loja)
echo.
pause

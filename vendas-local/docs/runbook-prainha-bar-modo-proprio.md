# Runbook — Prainha Bar (0001, 10.0.0.252) sem Consumer/Firebird

Flip do vendas-local pra `BANCO=proprio`: a loja passa a vender só no Postgres
local (`vendas_local`) + Concilia na nuvem. Release que traz tudo: **9d44d19d**.
Tudo roda em **PowerShell como Administrador** na máquina WIN-3TT8LMSANUH
(Chrome Remote Desktop). Fazer com a loja PARADA (antes de abrir ou depois de
fechar o caixa): o flip reinicia o servidor das mesas.

## 0. Conferir que a loja já está no release 9d44d19d
```powershell
(Invoke-WebRequest -UseBasicParsing http://localhost:8790/api/versao -TimeoutSec 8).Content
```
Se não for `9d44d19d` (o auto-update leva ~20-30 min depois do publish), força:
```powershell
cd C:\prainha-vendas; Copy-Item server.mjs server-anterior.mjs -Force; Invoke-WebRequest -UseBasicParsing "https://app.prainhabar.com/agente-release/vendas-local-server.mjs" -OutFile server.mjs; "baixado: " + (Get-FileHash server.mjs -Algorithm SHA256).Hash.Substring(0,8).ToLower(); schtasks /end /tn PrainhaVendas | Out-Null; schtasks /run /tn PrainhaVendas | Out-Null; Start-Sleep 14; (Invoke-WebRequest -UseBasicParsing http://localhost:8790/api/versao -TimeoutSec 8).Content
```

## 1. Migrar clientes e usuários do Firebird (Consumer AINDA ligado, ainda sem BANCO=proprio)
Copia CONTATOS (fiado: saldo/limite/bloqueio) → `cliente_local` e USUARIOS/ACESSO →
`usuario_local`, com os MESMOS códigos. Idempotente (rodar de novo só atualiza).
O PIN de cada um fica onde está (`garcom_pin`). Lê as variáveis do próprio start.bat:
```powershell
cd C:\prainha-vendas
Get-Content start.bat | ForEach-Object { if ($_ -match '^\s*set\s+([A-Z0-9_]+)=(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] } }
Remove-Item env:BANCO -ErrorAction SilentlyContinue
node server.mjs --migrar-consumer
```
Esperado: `[migrar] clientes: N em cliente_local`, `[migrar] usuários: N em usuario_local`,
`[migrar] conferência: cliente_local=… usuario_local ativos=… produto_nuvem=…`.
Se `produto_nuvem=0`: o start.bat está sem `FILIAL_ID`/`PAGAR_MESA_SECRET` — corrigir
antes do flip (o cardápio do modo próprio vem da nuvem por esse par).

## 2. Pegar o token do agente e desligar o agente-local
Em modo próprio quem fala com a nuvem (vendas, pagamentos, clientes, fila de
comandos: cadastro do Financeiro, baixa de fiado, bebida da reserva) é o próprio
vendas-local, com o mesmo token que o agente usava.
```powershell
$tok = (Get-Content C:\concilia-agente\config.json -Raw | ConvertFrom-Json).token; "token: " + $tok.Substring(0,8) + "..."
Stop-Service ConciliaAgente -ErrorAction SilentlyContinue; Set-Service ConciliaAgente -StartupType Disabled; Get-Service ConciliaAgente
```

## 3. Ligar o modo próprio no start.bat (guarda cópia pro rollback)
```powershell
cd C:\prainha-vendas; Copy-Item start.bat start-antes-proprio.bat -Force
$b = Get-Content start.bat
$novo = @("set BANCO=proprio", "set AGENTE_TOKEN=$tok") | Where-Object { -not ($b -match ('^' + ($_ -split '=')[0] + '=')) }
if ($novo) { Set-Content start.bat (@($novo) + $b) -Encoding ASCII }
Select-String -Path start.bat -Pattern '^set (BANCO|AGENTE_TOKEN|FILIAL_ID|PAGAR_MESA_SECRET|PG_URL|LOJA_NOME|PORT)=' | ForEach-Object { $_.Line -replace '=(.{6}).*', '=$1...' }
```
As 5 primeiras linhas TÊM que aparecer (BANCO, AGENTE_TOKEN, FILIAL_ID,
PAGAR_MESA_SECRET, PG_URL). Sem aspas, sem espaço em volta do `=`.

## 4. Reiniciar e conferir
```powershell
schtasks /end /tn PrainhaVendas | Out-Null; schtasks /run /tn PrainhaVendas | Out-Null; Start-Sleep 15
(Invoke-WebRequest -UseBasicParsing http://localhost:8790/api/config -TimeoutSec 8).Content
(Invoke-WebRequest -UseBasicParsing "http://localhost:8790/api/produtos?q=" -TimeoutSec 8).Content.Length
(Invoke-WebRequest -UseBasicParsing http://localhost:8790/api/venda/abertas -TimeoutSec 8).Content
```
- `/api/config` tem que dizer `"banco":"proprio"` e `"versao":"9d44d19d"`.
- `/api/produtos` grande (milhares de caracteres) = cardápio veio da nuvem.
- Na loja: garçom entra com o PIN de sempre → lança item numa mesa → caixa abre
  → recebe → conferir em app.prainhabar.com (Movimento) que a venda subiu.
- No Concilia, /sync mostra a filial 01 com ping recente (é o vendas-local
  pingando, não mais o agente).

## Rollback (volta pro Consumer em 1 minuto)
```powershell
cd C:\prainha-vendas; Copy-Item start-antes-proprio.bat start.bat -Force; Set-Service ConciliaAgente -StartupType Automatic; Start-Service ConciliaAgente; schtasks /end /tn PrainhaVendas | Out-Null; schtasks /run /tn PrainhaVendas | Out-Null
```
⚠️ Vendas feitas em modo próprio ficam no Postgres local + nuvem; NÃO existem
no Consumer. Não fazer rollback com contas abertas.

## Depois de uns dias estável (opcional)
Parar o Firebird e deixar manual (o .fdb fica pra consulta de histórico):
```powershell
Stop-Service FirebirdServerDefaultInstance -ErrorAction SilentlyContinue; Set-Service FirebirdServerDefaultInstance -StartupType Manual
```

## Pendências fiscais (não bloqueiam a venda)
NFC-e no modo próprio já lê itens/pagamentos/fiado das tabelas locais e NCM/CFOP
do catálogo da nuvem — mas só emite com CSC (portal SEFAZ-SE) + certificado A1
da filial 01 cadastrados em /configuracoes/fiscal. Enquanto isso, sem nota.

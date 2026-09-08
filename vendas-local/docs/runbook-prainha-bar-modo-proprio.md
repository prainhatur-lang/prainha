# Runbook — Prainha Bar (0001, 10.0.0.252) sem Consumer/Firebird

Flip do vendas-local pra `BANCO=proprio`: a loja passa a vender só no Postgres
local (`vendas_local`) + Concilia na nuvem. Release que traz tudo: **9d44d19d**;
a migração de usuários num attach só e o `--so-usuarios` vieram no **68059901**.
Tudo roda em **PowerShell como Administrador** na máquina WIN-3TT8LMSANUH
(Chrome Remote Desktop). Fazer com a loja PARADA (antes de abrir ou depois de
fechar o caixa): o flip reinicia o servidor das mesas.

**Executado na Prainha Bar em 07/09/2026 ~21:54.** `/api/config` respondeu
`"banco":"proprio"`, 32.663 clientes em `cliente_local`, catálogo da nuvem OK.
Na 1ª rodada os passos 1 e 2 falharam por erro deste runbook (já corrigidos
abaixo) e a migração de usuários morreu com `uncaught`: o driver do Firebird
crasha quando abre um 2º attach logo depois do detach pesado dos clientes. Isso
deixou `usuario_local` só com quem foi criado à mão — ninguém do Consumer
entrava. Corrigido no release 68059901 (as 3 leituras saem num attach só); pra
refazer só a parte dos usuários existe `--so-usuarios`.

## 0. Conferir que a loja já está no release
```powershell
(Invoke-WebRequest -UseBasicParsing http://localhost:8790/api/versao -TimeoutSec 8).Content
```
Se não for o esperado (o auto-update leva ~20-30 min depois do publish), força:
```powershell
cd C:\prainha-vendas; Copy-Item server.mjs server-anterior.mjs -Force; Invoke-WebRequest -UseBasicParsing "https://app.prainhabar.com/agente-release/vendas-local-server.mjs" -OutFile server.mjs; "baixado: " + (Get-FileHash server.mjs -Algorithm SHA256).Hash.Substring(0,8).ToLower(); schtasks /end /tn PrainhaVendas | Out-Null; schtasks /run /tn PrainhaVendas | Out-Null; Start-Sleep 14; (Invoke-WebRequest -UseBasicParsing http://localhost:8790/api/versao -TimeoutSec 8).Content
```
Só pra rodar a migração (`node server.mjs --migrar-consumer ...`) basta o arquivo
baixado — não precisa reiniciar o servidor; o auto-update reinicia depois.

## 1. Migrar clientes e usuários do Firebird (Consumer AINDA ligado, ainda sem BANCO=proprio)
Copia CONTATOS (fiado: saldo/limite/bloqueio) → `cliente_local` e USUARIOS/ACESSO →
`usuario_local`, com os MESMOS códigos. Idempotente (rodar de novo só atualiza).
O PIN de cada um fica onde está (`garcom_pin`). O Firebird vem do `config.json`
do agente (o que sempre funcionou); `PG_URL` vem do start.bat com um parser que
aceita `set "X=Y"` e espaços — o regex antigo (`^set X=`) não achava a linha da
0001 e o node caía no socket `/tmp/.s.PGSQL.5432`.
```powershell
$cfg = Get-Content C:\concilia-agente\config.json -Raw | ConvertFrom-Json
cd C:\prainha-vendas; $env:FB_HOST = $cfg.firebird.host; $env:FB_DATABASE = $cfg.firebird.database; $env:FB_PASSWORD = $cfg.firebird.password
Get-Content start.bat | ForEach-Object { if ($_ -match '^\s*set\s+"?([A-Za-z0-9_]+)\s*=\s*(.*?)"?\s*$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] } }
Remove-Item env:BANCO -ErrorAction SilentlyContinue
("PG_URL=" + $env:PG_URL) -replace '://[^@]*@', '://***@'
if ($env:PG_URL) { node server.mjs --migrar-consumer 2>&1 | Select-String '^\[migrar\]' } else { "*** start.bat SEM PG_URL" }
```
Só usuários (clientes já migrados): `node server.mjs --migrar-consumer --so-usuarios`.
Esperado: `[migrar] clientes: N em cliente_local`, `[migrar] usuários: N em usuario_local`,
`[migrar] conferência: cliente_local=… usuario_local ativos=… produto_nuvem=…`.
Na Prainha Bar (07/09/2026): 32.663 clientes, 121 usuários do Consumer (33 ativos) +
o `paulao` já criado na loja → `usuario_local ativos=34`; `produto_nuvem` ≈ 981–982
(varia com o catálogo). Rodado de verdade às 22:07 com `--so-usuarios`: conferido de
fora pelo Funnel (`/api/central/equipe/usuarios`) — 122 usuários, 34 ativos, elison e
marta admins.
Se `produto_nuvem=0`: o start.bat está sem `FILIAL_ID`/`PAGAR_MESA_SECRET` — corrigir
antes do flip (o cardápio do modo próprio vem da nuvem por esse par).

Dá pra ensaiar do Mac (VPN alcança `10.0.0.252:3050`), gravando no banco de teste:
```bash
cd vendas-local && env -u BANCO PG_URL="postgres://$USER@127.0.0.1:5432/vendas_teste" FB_HOST=10.0.0.252 node server.mjs --migrar-consumer --so-usuarios 2>&1 | grep '^\[migrar\]'
```

## 2. Pegar o token do agente e desligar o agente-local
Em modo próprio quem fala com a nuvem (vendas, pagamentos, clientes, fila de
comandos: cadastro do Financeiro, baixa de fiado, bebida da reserva) é o próprio
vendas-local, com o mesmo token que o agente usava. O token fica em `api.token`
(não em `token`, como o runbook antigo dizia).
```powershell
$cfg = Get-Content C:\concilia-agente\config.json -Raw | ConvertFrom-Json; $tok = $cfg.api.token; "token: " + $tok.Substring(0,8) + "..."
Stop-Service ConciliaAgente -ErrorAction SilentlyContinue; Set-Service ConciliaAgente -StartupType Disabled; Get-Service ConciliaAgente
```
⚠️ A partir daqui, enquanto o flip não termina, as vendas do Consumer NÃO sobem
pra nuvem. Ou termina os passos 3 e 4, ou religa:
`Set-Service ConciliaAgente -StartupType Automatic; Start-Service ConciliaAgente`.

## 3. Ligar o modo próprio no start.bat (guarda cópia pro rollback)
Precisa do `$tok` do passo 2 na MESMA janela.
```powershell
cd C:\prainha-vendas; Copy-Item start.bat start-antes-proprio.bat -Force
$b = Get-Content start.bat
$novo = @("set BANCO=proprio", "set AGENTE_TOKEN=$tok") | Where-Object { -not ($b -match ('^' + ($_ -split '=')[0] + '=')) }
if ($novo) { Set-Content start.bat (@($novo) + $b) -Encoding ASCII }
Select-String -Path start.bat -Pattern '^\s*set\s+"?(BANCO|AGENTE_TOKEN|FILIAL_ID|PAGAR_MESA_SECRET|PG_URL|LOJA_NOME|PORT)\s*=' | ForEach-Object { $_.Line -replace '=(.{6}).*', '=$1...' }
```
BANCO, AGENTE_TOKEN, FILIAL_ID, PAGAR_MESA_SECRET e PG_URL TÊM que estar no
start.bat (o servidor confirma no passo 4: sem PG_URL nem sobe).

## 4. Reiniciar e conferir
```powershell
schtasks /end /tn PrainhaVendas | Out-Null; schtasks /run /tn PrainhaVendas | Out-Null; Start-Sleep 15
(Invoke-WebRequest -UseBasicParsing http://localhost:8790/api/config -TimeoutSec 8).Content
(Invoke-WebRequest -UseBasicParsing "http://localhost:8790/api/produtos?q=" -TimeoutSec 8).Content.Length
(Invoke-WebRequest -UseBasicParsing http://localhost:8790/api/venda/abertas -TimeoutSec 8).Content
```
- `/api/config` tem que dizer `"banco":"proprio"` e a `"versao"` do release.
- `/api/produtos` grande (milhares de caracteres) = cardápio veio da nuvem.
- Na loja: garçom entra com o PIN de sempre → lança item numa mesa → caixa abre
  → recebe → conferir em app.prainhabar.com (Movimento) que a venda subiu.
- No Concilia, /sync mostra a filial 01 com ping recente (é o vendas-local
  pingando, não mais o agente).
- Quem pode entrar (usuario_local) dá pra conferir de fora, sem PIN: a tela
  Equipe do Concilia (ou `/api/central/equipe/usuarios` assinado com escopo
  `equipe`) lê pelo Funnel `https://win-3tt8lmsanuh.tailb22e0d.ts.net`.

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

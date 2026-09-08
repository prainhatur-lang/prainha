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

## Parar o Firebird (feito na Prainha Bar em 07/09/2026 22:48)
O dono parou no mesmo dia do flip, com a loja já no 68059901 (servidor no ar
desde 22:37). Auditoria estática do server.mjs no mesmo dia: nenhum loop do
modo próprio chega no Firebird — todo caminho de caixa/pedido/pagamento/fiado/
NFC-e tem ramo `nativo()` nas tabelas locais, e o único helper só-Firebird
alcançável (`fbAlterarProduto`) fica atrás de `loopProdutoFila`, que sai cedo
em modo próprio. Se alguma chamada perdida bater no Firebird parado, `qi()`
falha em 8 s com `{ok:false}` — erro na tela, nunca trava. O .fdb fica no
disco pra consulta de histórico.
```powershell
Stop-Service FirebirdServerDefaultInstance -ErrorAction SilentlyContinue; Set-Service FirebirdServerDefaultInstance -StartupType Manual; Get-Service FirebirdServerDefaultInstance
```
Religar (só faz sentido junto com o rollback): `Set-Service FirebirdServerDefaultInstance -StartupType Automatic; Start-Service FirebirdServerDefaultInstance`.

## Conferência de Caixa vazia depois do flip ("nao veio os caixas", 07/09/2026 23:19)
A Conferência da nuvem lê a LOJA VIVA (`/api/central/caixa/relatorio`), e no modo
próprio a loja lê só `caixa_local`/`pagamento_local`. Os caixas do dia do flip
(14 na Prainha Bar: 5569–5582, todos abertos na maquininha, R$ ~47 mil em 211
recebimentos) ficaram no CAIXA do Firebird parado — a migração do passo 1 só
levou clientes e usuários. Resultado: "nenhum caixa nesse dia", ninguém fecha.
Desde o release `06cb0a31` existe `--migrar-consumer --so-caixas [--dias N]`: copia
os caixas ainda ABERTOS (ou abertos nos últimos N dias, padrão 2) + PAGAMENTOS
+ CAIXAOPERACAO deles pras tabelas locais com os MESMOS códigos; pagamentos já
entram como sincronizados (a nuvem os tem pelo agente); rodar de novo não
reabre caixa que a loja já fechou no modo próprio. Precisa do Firebird ligado
só durante a cópia (é só leitura nele). Comando completo (liga o Firebird,
baixa o release, migra, desliga o Firebird de novo):
```powershell
Start-Service FirebirdServerDefaultInstance; $cfg = Get-Content C:\concilia-agente\config.json -Raw | ConvertFrom-Json; cd C:\prainha-vendas; Copy-Item server.mjs server-anterior.mjs -Force; Invoke-WebRequest -UseBasicParsing "https://app.prainhabar.com/agente-release/vendas-local-server.mjs" -OutFile server.mjs; "baixado: " + (Get-FileHash server.mjs -Algorithm SHA256).Hash.Substring(0,8).ToLower(); $env:FB_HOST = $cfg.firebird.host; $env:FB_DATABASE = $cfg.firebird.database; $env:FB_PASSWORD = $cfg.firebird.password; Get-Content start.bat | ForEach-Object { if ($_ -match '^\s*set\s+"?([A-Za-z0-9_]+)\s*=\s*(.*?)"?\s*$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] } }; Remove-Item env:BANCO -ErrorAction SilentlyContinue; node server.mjs --migrar-consumer --so-caixas 2>&1 | Select-String '^\[migrar\]'; Stop-Service FirebirdServerDefaultInstance; Get-Service FirebirdServerDefaultInstance
```
Esperado: `[migrar] caixas: N em caixa_local (A ainda abertos) · pagamentos: … ·
operações: …` e `[migrar] conferência: caixa_local abertos=… · recebido hoje…`.
O servidor no ar não precisa reiniciar (a tela lê o banco); o auto-update troca
pro release novo sozinho em ~20-30 min. Depois: abrir a Conferência de Caixa da
Prainha Bar em 07/09 — os caixas aparecem e "Fechar" fecha em `caixa_local`.
Mesmo release corrige `caixasDeOperadorAbertos` (lia `saldo_inicial`/
`codigo_usuario`, colunas do Firebird, e quebrava o "Abrir caixa" com fundo).

## Conferência de Caixa "Loja fora do ar — fetch failed (ENOTFOUND)" (07/09/2026 22:47–23:10)
Não era a loja: o servidor nunca caiu e o Funnel estava ligado. Era o DNS do
nome do Funnel (`win-3tt8lmsanuh.tailb22e0d.ts.net`): o Tailscale tira o
registro público quando o nó pisca e repõe quando volta; quem consultou nesse
instante guardou "não existe" (cache negativo). Às 23:10 os 4 NS do ts.net,
Google, Quad9, OpenDNS e o DoH da Cloudflare já respondiam certo, mas o
resolver da Vercel (e o 1.1.1.1, e o roteador do Mac) seguiam com NXDOMAIN —
mais de 25 min, bem além dos 300 s do SOA. Repetir a chamada (19c988a) não
adiantava. Desde a versão de 07/09 23:15 a nuvem, ao receber ENOTFOUND,
resolve o nome por DNS-over-HTTPS (Google, depois Cloudflare) e chama a loja
direto no IP do ingress, com o nome no SNI/Host (node:https com `lookup`
fixo). Log na Vercel: `[caixa-loja] … via IP 199.38.181.54 (DoH dns.google):
HTTP 200`. Se o DoH também disser NXDOMAIN, aí o Funnel está desligado na loja
mesmo (é o caso da Tabuará) — a tela diz isso em vez de "fetch failed".
Conferir de fora: na loja `tailscale funnel status` (tem que listar
`https://<nome> (Funnel on) |-- / proxy http://127.0.0.1:8790`); do Mac,
`dig @ns1.dnsimple.com A <nome>` diz se o registro existe na fonte. Pra testar
o caminho da nuvem sem a nuvem: assinar `filialId|caixa|e` com o
PAGAR_MESA_SECRET do `.env` e chamar o Funnel; pela VPN, `10.0.0.252:8790`
responde sem assinatura em `/api/versao`.

## Fiscal (já cadastrado — não é pendência)
A filial 01 já tem tudo em /configuracoes/fiscal: NFC-e ativa em produção,
série 20, CSC id 000001 e certificado A1 do CNPJ 0001-66 válido até 14/04/2027
(o mesmo da distribuição DF-e). Até o flip a nuvem já tinha autorizado 402 notas
da série 20. No modo próprio a emissão lê itens/pagamentos/fiado das tabelas
locais e NCM/CFOP do catálogo da nuvem; a chave do pedido muda de `fb:<código>`
pra o código local (≥ 5.000.000). Conferir a 1ª nota do modo próprio em
/fiscal/nfce.

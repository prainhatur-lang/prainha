# Runbook — ligar o iFood na Tabuará (filial 02)

Objetivo: pedido do iFood da **Tabuará** (`fde37b95-7c7e-4b41-a618-2aba1fbc0de7`,
CNPJ 33.159.574/0002-47) cair na cozinha/entrega/impressora da casa pelo
Concilia, como já acontece na Prainha Bar.

Hoje a Tabuará **não tem onde o pedido cair**: a casa roda só Consumer/Firebird
+ agente-local (online, pingando a cada ~20s em `/sync`). Quem recebe iFood no
Concilia é o **vendas-local**, e ele não está instalado lá.

**Não precisa virar a casa pro modo próprio.** O pedido do iFood entra nas
tabelas de espelho do Postgres local com código negativo (`projetarIfood`), e
KDS, tela de entrega e impressora leem de lá — funciona com `BANCO=firebird`
(Consumer intacto). O loop do iFood (`loopIfood`) também não depende do modo.

## Pré-requisito que NÃO é técnico: credencial do iFood da Tabuará

A fila de eventos do polling é **por credencial (device)**, não por loja — ver
`[[ifood-fila-por-clientid]]`. Duas instalações com o MESMO `client_id` dividem
a fila e some pedido (já aconteceu em ago/2026 com a Prainha Mar). Então:

- **Trocar de merchant no app já homologado NÃO exige nova homologação** —
  Portal do Desenvolvedor → Concilia PDV Central → Permissões → achar a loja
  pelo CNPJ/ID → aprovar no Portal do Parceiro. Isso resolve o *acesso*.
- O que **não** resolve é quem faz o polling: se a Tabuará puxar com o mesmo
  `client_id 8e6715c3…` que a Prainha Bar já usa, as duas brigam pela fila.

Dois caminhos, escolher um:

| | Caminho A — app próprio da Tabuará | Caminho B — poller único na nuvem |
|---|---|---|
| iFood | criar app novo (client_id próprio) + **homologação 60/60** | usa o app já homologado, 1 credencial pra todas as casas |
| Código | nenhum | nuvem passa a fazer o polling e distribui pelo cano que já existe (`delivery-fila` → `ifood_pedido` → `projetarIfood`) |
| Prazo | depende da rodada de homologação | depende do desenvolvimento |
| Risco | isolado por casa | nuvem fora do ar = nenhuma casa recebe |

Caminho A é a arquitetura decidida em 06/09/2026 (um app por filial). Caminho B
é o desenho que o iFood espera de app centralizado e mata de uma vez a
pendência da Prainha Mar.

## 1. Instalar o vendas-local na máquina da Tabuará

Vale pra qualquer máquina da loja que alcance o Firebird. Chrome Remote Desktop
na máquina da Tabuará, ZIP do `vendas-local/deploy-xeon` → extrair → botão
direito em `instalar-tudo.bat` → **Executar como administrador**.

Depois, editar `C:\prainha-vendas\start.bat` e garantir o bloco abaixo (os
valores de `FB_*` são os do Consumer da Tabuará — conferir em
`C:\concilia-agente\config.json`, chave `firebird`):

```bat
set "FB_HOST=127.0.0.1"
set "FB_PORT=3050"
set "FB_DATABASE=<caminho do consumer.fdb da Tabuara>"
set "FB_USER=SYSDBA"
set "FB_PASSWORD=masterkey"
set "LOJA_NOME=Tabuara"
set "FILIAL_ID=fde37b95-7c7e-4b41-a618-2aba1fbc0de7"
set "PAGAR_MESA_SECRET=<o mesmo da Prainha Bar>"
set "AGENTE_TOKEN=<config.json do agente, campo api.token>"
set "CLIENTE_HASH_SALT=<o mesmo das outras casas>"
```

`BANCO` **não entra** (fica `firebird` = Consumer continua sendo o PDV).
`PG_URL` e as portas o instalador já escreve.

Conferir (na máquina da loja):

```powershell
(Invoke-WebRequest -UseBasicParsing http://localhost:8790/api/config -TimeoutSec 8).Content
```

Tem que vir `"banco":"firebird"`, a `versao` do release e `filial` preenchida.
Sem `FILIAL_ID`/`PAGAR_MESA_SECRET` a loja não puxa a config do iFood da nuvem.

## 2. Gravar a credencial do iFood da Tabuará na nuvem

`app.prainhabar.com` → Configurações → iFood → card **Tabuara**:

- `client_id` / `client_secret` do app escolhido no pré-requisito (colar o
  client_id **inteiro**, 36 chars);
- `merchant_id` = UUID da loja Tabuará no iFood (Portal do Parceiro);
- `modo` = `centralizado`, `codigoPdv` = `produto`, `ativo` = `1`.

A loja puxa isso sozinha no ciclo do `loopIfood` (`puxarConfigIfood`, a cada
30s) e grava local — não precisa digitar segredo na tela da loja.

## 3. Conferir que está no ar

Na loja, `http://<ip-da-tabuara>:8790/ifood`:

- banner verde **“✓ No ar — o iFood respondeu há Xs”** (release `4640649f` ou
  mais novo);
- “A loja no iFood” vai dizer *não dá pra saber por aqui* — é esperado, o app
  não tem o módulo Merchant; abrir/fechar/pausar segue no Gestor de Pedidos.

Por API: `GET /api/ifood` → `ativo:true`, `pronto:true`, `ultimo_erro:null` e
`ultimo_ok` andando a cada 30s. Erros: `400` = client_id truncado, `401` =
par id/segredo errado, `403` = merchant não autorizado no app.

Prova de ponta a ponta só com **pedido real** na Tabuará: tem que aparecer no
KDS, sair na impressora e lançar a conta a receber do canal na nuvem.

## Enquanto isso

Até o passo 1 + 2 estarem feitos, a Tabuará continua recebendo iFood pelo
**Gestor de Pedidos** — é exatamente o que a Prainha Bar fez de 18/08 a 10/09.

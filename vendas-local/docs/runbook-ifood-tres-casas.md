# Runbook — ligar o iFood nas três casas (01 Prainha Bar, 02 Tabuará, 03 Prainha Mar)

Objetivo: pedido do iFood de **cada casa** cair na cozinha/entrega/impressora da
própria casa pelo Concilia, cada uma com seus pedidos, suas entregas e seu
faturamento — como já acontece na Prainha Bar.

Filiais: **01 Prainha Bar** `7c5c66ce-cceb-4e89-9c6d-d0785255c4f9` (CNPJ
33.159.574/0001-66) · **02 Tabuará** `fde37b95-7c7e-4b41-a618-2aba1fbc0de7`
(…/0002-47) · **03 Prainha Mar e Grill** `e899dae2-38bf-4f3f-9149-7effd059fab8`
(…/0003-28).

## Arquitetura decidida em 10/09/2026: puxador único na nuvem

A fila de eventos do polling é **por credencial (device)**, não por loja — ver
`[[ifood-fila-por-clientid]]`. Duas instalações com o MESMO `client_id` dividem
a fila e some pedido (aconteceu em ago/2026 com a Prainha Mar). As três casas
estão como merchant do **mesmo app já homologado** (Concilia PDV Central,
`8e6715c3-4ac2-434b-a91e-937570bfadb1`), então quem puxa passa a ser a **nuvem**:

- o cron `/api/cron/ifood-poll` roda 1x/min (dois ciclos de 30s por invocação),
  puxa **uma vez só** por `client_id` com `x-polling-merchants` trazendo os três
  merchants, persiste antes de ackear e ackeia **100%** dos eventos (Firefly
  Audit);
- um **lease** no Postgres (`ifood_nuvem_lease`) garante que duas invocações
  nunca dividam a fila;
- cada evento é roteado pra filial **dona do merchant** e fica em
  `/api/loja/ifood-fila`, que a loja consome assinando HMAC com a própria filial
  (a loja só vê o que é dela, e a credencial não sai da nuvem);
- as ações do caixa (aceitar / despachar / pronto / cancelar) sobem pela mesma
  rota e a nuvem fala com o iFood.

**Trocar/adicionar merchant em app já homologado NÃO exige nova homologação.**

### A chave da virada: `puxador`

Configurações → iFood tem o campo **`puxador`** por casa: `loja` (o vendas-local
fala com o iFood, comportamento antigo) ou `nuvem`. Default é `loja`, então
deploy nenhum muda o que a Prainha Bar já faz.

⚠️ **Grupo misto não é puxado.** Se duas casas no mesmo `client_id` estiverem uma
em `loja` e outra em `nuvem`, o cron **pula o grupo inteiro** e registra
`pulado: 'grupo misto…'` no lease — seria exatamente o bug de dividir a fila.
Logo: as três casas viram a chave **juntas**.

## 1. Autorizar as três lojas no app (iFood)

Portal do Desenvolvedor → Concilia PDV Central → **Permissões**: as três lojas
já estão pedidas. Estado em 10/09/2026:

| Loja | CNPJ | Estado |
|---|---|---|
| Prainha Bar | 33.159.574/0001-66 | **Ativo** |
| Restaurante Tabuará | …/0002-47 | Aguardando Ativação |
| Prainha Mar e Grill | …/0003-28 | Aguardando Ativação |

"Aguardando Ativação" se resolve **no Portal do Parceiro de cada loja**
(Integrações → aprovar o pedido do Concilia PDV Central). Só depois disso o
`merchant_id` da casa responde pro nosso app — antes disso o polling dela dá
`403`.

Webhook fica **Desativado** nas três: nós usamos polling, não webhook.

## 2. Gravar a credencial de cada casa na nuvem

`app.prainhabar.com` → Configurações → iFood → card de **cada** casa:

- `client_id` = `8e6715c3-4ac2-434b-a91e-937570bfadb1` (colar **inteiro**, 36 chars);
- `client_secret` do mesmo app (cifrado; depois de salvar some da tela);
- `merchant_id` = UUID **daquela** loja no iFood (Portal do Parceiro);
- `modo` = `centralizado`, `codigoPdv` = `produto`, `ativo` = `1`;
- `puxador` = `nuvem` — **nas três ao mesmo tempo** (grupo misto não é puxado).

A loja puxa isso sozinha no ciclo do `loopIfood` (`puxarConfigIfood`, a cada
30s) — não precisa digitar segredo na tela da loja.

## 3. Instalar o vendas-local nas casas que não têm

A Prainha Bar já tem. A **Tabuará** roda só Consumer/Firebird + agente-local, e
a **Prainha Mar** precisa de máquina (offline desde 04/09, nunca sincronizou).

**Não precisa virar a casa pro modo próprio.** O pedido do iFood entra nas
tabelas de espelho do Postgres local com código negativo (`projetarIfood`), e
KDS, tela de entrega e impressora leem de lá — funciona com `BANCO=firebird`
(Consumer intacto). O loop do iFood também não depende do modo.

Chrome Remote Desktop na máquina da loja, ZIP do `vendas-local/deploy-xeon` →
extrair → botão direito em `instalar-tudo.bat` → **Executar como administrador**.

Depois, editar `C:\prainha-vendas\start.bat` e garantir o bloco abaixo (os
valores de `FB_*` são os do Consumer daquela casa — conferir em
`C:\concilia-agente\config.json`, chave `firebird`):

```bat
set "FB_HOST=127.0.0.1"
set "FB_PORT=3050"
set "FB_DATABASE=<caminho do consumer.fdb da casa>"
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

Com `puxador=nuvem` o `PAGAR_MESA_SECRET` + `FILIAL_ID` deixam de ser só pra
config: é por eles que a loja assina a leitura da **fila de pedidos** dela.
Sem os dois, `/ifood` mostra "não pronto".

Conferir (na máquina da loja):

```powershell
(Invoke-WebRequest -UseBasicParsing http://localhost:8790/api/config -TimeoutSec 8).Content
```

Tem que vir `"banco":"firebird"`, a `versao` do release e `filial` preenchida.

## 4. Conferir que está no ar

Na loja, `http://<ip-da-loja>:8790/ifood`:

- banner verde **“✓ No ar — o iFood respondeu há Xs”**; com `puxador=nuvem` ele
  diz também *“Quem fala com o iFood é o Concilia (as três casas dividem a mesma
  credencial)”*;
- “A loja no iFood” vai dizer *não dá pra saber por aqui* — é esperado, o app
  não tem o módulo Merchant; abrir/fechar/pausar segue no Gestor de Pedidos.

Por API: `GET /api/ifood` → `ativo:true`, `pronto:true`, `ultimo_erro:null` e
`ultimo_ok` andando a cada 30s. Erros: `400` = client_id truncado, `401` = par
id/segredo errado, `403` = merchant **não autorizado** (passo 1 pendente).

Do lado da nuvem, o lease mostra o último ciclo:

```sql
select chave, dono, ultimo_ok, eventos, ultimo_erro from ifood_nuvem_lease;
select filial_id, codigo, ocorrido_em, ack_em, entregue_em
  from ifood_nuvem_evento order by criado_em desc limit 20;
```

Prova de ponta a ponta só com **pedido real** em cada casa: tem que aparecer no
KDS daquela casa, sair na impressora dela e lançar a conta a receber do canal na
filial certa.

## Enquanto isso

Até os passos 1–3 estarem feitos, Tabuará e Prainha Mar continuam recebendo
iFood pelo **Gestor de Pedidos** — é exatamente o que a Prainha Bar fez de 18/08
a 10/09.

## Pendências conhecidas

- Release do vendas-local com o consumidor da fila da nuvem: **publicar fora do
  horário de rodada** (auto-update chega na loja em ~2min —
  `[[vendas-local-auto-update]]`).
- Pedir o **módulo Merchant** pro app (abrir/fechar loja pelo Concilia).
- **Rotacionar** os client secrets que já passaram por chat.

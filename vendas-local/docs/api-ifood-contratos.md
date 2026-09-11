# Contratos da API do iFood que o Concilia usa

Referência condensada, tirada das especificações OpenAPI publicadas em
`developer.ifood.com.br/pt-BR/docs/references` (as 18 specs vêm embutidas no
`page-data.json` da página — a doc renderizada é SPA e não serve por `curl`,
que volta 403).

Está no repositório porque recuperar isso é caro e porque o código abaixo foi
escrito contra estes campos — quando algum parar de casar com a realidade, é
aqui que se compara.

Base: `https://merchant-api.ifood.com.br` (`IFOOD_BASE`).
Cada bloco abaixo é um **módulo separado na homologação** do Portal do
Desenvolvedor: ter o de Pedidos não dá acesso aos outros, e chamada de módulo
não liberado volta **403** (não 401 — 401 é par client_id/secret errado).

---

## Autenticação — `/authentication/v1.0/oauth/token`

`POST` form-urlencoded `grantType=client_credentials&clientId=&clientSecret=`
→ `{ accessToken, expiresIn }`. Só app **centralizado**; o distribuído tem
refresh_token rotativo, que precisa de gravação durável e não cabe em
serverless. Código: `apps/web/src/lib/ifood-api.ts`.

---

## Merchant — `/merchant/v1.0` → `apps/web/src/lib/ifood-loja.ts`

| Rota | Serve pra |
|---|---|
| `GET /merchants` | descobrir os `merchant_id` que o app pode ver (é como se acha o id de uma casa nova) |
| `GET /merchants/{id}/status` | se a loja está no ar — **NÃO reflete interrupção** |
| `GET /merchants/{id}/interruptions` | as pausas; interrupção ativa é o sinal confiável de "não está recebendo" |
| `POST /merchants/{id}/interruptions` | pausar: `{ description, start, end }` em ISO **sem timezone**, hora de Brasília |
| `DELETE /merchants/{id}/interruptions/{id}` | voltar a receber |
| `GET /merchants/{id}/opening-hours` | turnos (`dayOfWeek`, `start`, `duration` em minutos) |

⚠️ `start`/`end` em BRT sem sufixo. Na Vercel (UTC) `getTimezoneOffset()` vale
0, então o `-3h` é **explícito** no código — o truque que funciona no
vendas-local aqui não corrigiria nada.

---

## Catálogo — `/catalog/v2.0` → `apps/web/src/lib/ifood-catalogo.ts`

| Rota | Serve pra |
|---|---|
| `GET /merchants/{id}/catalogs` | achar o catálogo (`catalogId`, `context[]`, `status`) |
| `GET /merchants/{id}/catalogs/{catalogId}/categories?includeItems=true` | o cardápio inteiro |
| `PATCH /merchants/{id}/items/{itemId}` | `{ status, price:{value,originalValue}, externalCode, index, shifts[] }` |

- `status`: `AVAILABLE` \| `UNAVAILABLE` (`DELETED` existe nos lotes de produto).
- `price.originalValue` é o "de" da promoção. PATCH de preço manda
  `originalValue = value` por padrão: não inventa promoção nem apaga a que existe.
- `externalCode` é o que liga o item ao produto do Consumer. Código vazio, não
  numérico, ou que não existe na casa = pedido entra e **não vira prato**.
- Os `PATCH /items/status` e `/items/price` em lote estão marcados como legado.

---

## Pedidos e eventos — `/order/v1.0`, eventos → puxador da nuvem

| Rota | Serve pra |
|---|---|
| `GET /events:polling` | a fila (204 = vazia). `x-polling-merchants` é só **filtro de leitura** |
| `POST /events/acknowledgment` | ack — o Firefly Audit exige **100%** dos recebidos |
| `GET /orders/{id}` | o pedido inteiro |
| `POST /orders/{id}/{confirm\|dispatch\|readyToPickup\|requestCancellation\|acceptCancellation\|denyCancellation}` | ações do caixa |

⚠️ **A fila é por CREDENCIAL (device), não por loja.** Dois pollers no mesmo
`client_id` dividem a fila e some pedido (aconteceu com a Prainha Mar em
ago/2026). É por isso que existe o `puxador` (`loja` \| `nuvem`) e por isso
grupo misto — mesma credencial com uma casa em cada modo — **não é puxado**.

---

## Financeiro → `apps/web/src/lib/ifood-financeiro.ts`

### `/financial/v2.1/merchants/{id}/sales` — conciliação POR PEDIDO

Query: `beginOrderDate`, `endOrderDate` (ou `beginLastProcessingDate`/
`endLastProcessingDate`, ou `periodId`). A spec declara a resposta como objeto
único, mas o endpoint devolve a lista do período — o código aceita array,
objeto único e envelope `{sales:[…]}`.

```
orderDate*, orderId, lastProcessingDate*, orderDateTime, displayId, periodId*,
orderStatus* (CONCLUDED|CANCELLED|NOT_DEFINED),
businessModelOrder* (ON_DEMAND|FULL_SERVICE|HYBRID|HYBRID_REGION|MARKETPLACE|MKT_DELIVERY),
deliveryProviderType (IFOOD|MERCHANT|OTHERS), salesChannel,
companyName*, documentNumber*,
payment*  { type*(ONLINE|OFFLINE), method*(MEAL_VOUCHER|FOOD_VOUCHER|CREDIT|DEBIT|PIX),
            brand*, liability*(MERCHANT|INTERNAL|EXTERNAL), cardNumber*, nsu* }
billing*  { gmv*(=totalBag+deliveryFee), initialTotalBag, totalBag*, deliveryFee*,
            consumerPaymentIfood, deliveryFeeIfood, benefitIfood*, benefitMerchant*,
            commission*, acquirerFee*, deliveryCommission*, commissionRate*,
            acquirerFeeRate*, totalDebit*, totalCredit*, anticipationFee,
            anticipationFeeRate, smallOrderFee, benefitPaymentCredit,
            benefitAcquirerFee, otherDebits, otherCredits }
transfer* { expectedTransferDate*, expectedBankAccount* { bankNumber*, bankName,
            branchCode*, branchCodeDigit*, accountNumber*, accountNumberDigit* } }
```

**Líquido do pedido = `totalCredit − totalDebit`.** A tela mostra as duas
pontas junto com o líquido de propósito: é assim que se confere a conta contra
o Portal no primeiro fechamento, em vez de confiar num número derivado.
`payment.type = OFFLINE` é pagamento na entrega — **não entra em repasse**, o
dinheiro já está no caixa da casa.

### `/financial/v3.0/merchants/{id}/settlements` — o que cai NO BANCO

Query: `beginPaymentDate`/`endPaymentDate` ou `beginCalculationDate`/`endCalculationDate`.

```
beginDate*, endDate*, balance*, merchantId*, consolidatedMerchants[],
settlements*[ { startDateCalculation, endDateCalculation,
  closingItems[ { id, type, product, amount, status, transactionId, paymentDate,
                  accountDetails{ bankName, bankNumber, branchCode, branchDigit,
                                  accountNumber, accountDigit, documentNumber } } ] } ]
```

### `/financial/v3.0/merchants/{id}/financial-events` — POR QUE veio menor

Query: `beginDate`, `endDate`, `idSaldo`, `page`, `size`. Paginado por
`hasNextPage`. **`amount.value` e `billing.*` vêm como STRING** (`"-0.99"`).

```
page*, size*, hasNextPage*,
financialEvents*[ { name, description, product, trigger, dateTime, competence,
  period{beginDate,endDate}, reference{type,id,date}, hasTransferImpact,
  amount{value}, billing{baseValue,feePercentage}, settlement{expectedDate},
  receiver{businessId,businessType,businessDocument},
  payment{method,brand,liability} } ]
```

`reference.id` é o `orderId` quando `reference.type = ORDER`.
`hasTransferImpact = false` é informativo: não muda o que cai no banco.

### Resto do financeiro, ainda não usado

- `v3.0 /sales?beginSalesDate&endSalesDate&page` → `{page,size,sales[],total,pageCount}`;
  cada `Sale` tem `{id, shortId, createdAt, type, category, salesChannel,
  currentStatus, merchant, saleGrossValue, benefits, delivery, payments,
  orderStatusHistory[], billingSummary, orderEvents[]}`.
- `v3.0 /anticipations` — antecipação de recebíveis.
- `v3.0 /reconciliation?competence=yyyy-MM` → `{downloadPath, createdAt}`;
  `POST /reconciliation/on-demand` + `GET /reconciliation/on-demand/{requestId}`
  pra gerar o relatório fechado do mês.
- `v2.0` tem as listas finas: `/salesAdjustments`, `/payments`,
  `/paymentDetails`, `/occurrences`, `/maintenanceFees`, `/incomeTaxes`,
  `/periods?competence=`, `/chargeCancellations`, `/cancellations`,
  `/receivableRecords`, `/salesBenefits`, `/adjustmentsBenefits`.

---

## Como tirar as specs de novo, se precisar

A doc é SPA e `curl` volta 403 (com ou sem User-Agent de browser). O caminho
que funciona é pelo Chrome:

1. abrir `https://developer.ifood.com.br/pt-BR/docs/references` e esperar ~6 s;
2. `fetch('/page-data/pt-BR/docs/references/page-data.json')` — as 18 specs
   estão em `result.data.allSwaggerSpec.edges[].node.{specId, internal.content}`;
3. o resultado do `javascript_tool` corta em ~1000 chars e download de blob é
   bloqueado, então o canal é jogar o texto no DOM
   (`document.body.innerHTML=''` + `<pre textContent=…>`) e ler com
   `get_page_text`.

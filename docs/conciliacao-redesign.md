# Redesign da conciliação — design doc

Status: **proposta v2** · Autor: discussão Elison + Claude · 2026-04-25

> v2: incorpora pesquisa de mercado (TOTVS, Sankhya, Senior, Citel, Cielo, F360, Concil, BACEN) + ajustes acordados em conversa (E2E ID fase 2, cross-route fallback pra erro de garçom).

## Por que mexer

Comportamento atual incomoda:

1. **Não-determinismo entre rodadas** — uma exceção que tava lá some, depois volta. Causa: engine recalcula tudo do zero a cada rodada, sem persistir matches de fallback. Quando entram dados novos, o pareamento global se reembaralha.
2. **Buraco arquitetural** — a engine assume sempre PDV → Cielo → Banco. Pagamentos que não passam pela Cielo (ex: Pix Manual direto na conta) viram exceção fantasma dos dois lados (PDV sem Cielo + Banco sem origem) e nunca casam.
3. **UX de investigação fraca** — sem filtro de visualização por sub-período, sem busca por NSU/autorização, manual match lista tudo sem filtro.
4. **Erro humano não tratado** — garçom às vezes registra Pix Manual como Pix Online (e vice-versa). Engine atual não tem fallback cross-route, então o pagamento fica órfão pra sempre.

## Os 4 blocos da mudança

### 1. Classificar formas de pagamento por canal de liquidação

> Internamente chamamos de "rota de liquidação" no código. Na UI usar **"canal de liquidação"** ou **"tipo de recebimento"** — termos que o financeiro brasileiro reconhece (TOTVS / Conciliadora usam variações).

Nem toda forma de pagamento passa pela Cielo. Cada `formaPagamento` (string vinda do Consumer) precisa estar mapeada pra um dos **4 canais**:

| Canal | Quando usar | Exemplo de forma | Etapas de match |
|---|---|---|---|
| `ADQUIRENTE` | Passa por uma adquirente (Cielo, Stone, Rede, etc) | Crédito, Débito, Pix maquininha (Pix Online), Voucher | PDV → Cielo → Banco |
| `DIRETO` | Vai direto do cliente pra conta da empresa | Pix Manual, TED, DOC, boleto recebido | PDV → Banco |
| `CAIXA` | Fica em dinheiro físico | Dinheiro | PDV → Conferência caixa |
| `INTERNA` | Não envolve banco — vira AR | Fiado, Vale-funcionário | PDV → contas a receber |

**Implementação:**

- Nova tabela `forma_pagamento_canal` (filial_id, forma_pagamento_texto, canal, observacao). Default heurístico no insert (regex em "pix manual" → DIRETO, "dinheiro" → CAIXA, etc).
- UI em `/configuracoes/formas-pagamento` pra editar mapeamento.
- Toda forma desconhecida cai em `ADQUIRENTE` por default e vira alerta na UI ("classifique antes de conciliar").

### 2. Cascata determinística + matches persistidos (PDV ↔ Cielo)

Aplica só pra formas com canal=ADQUIRENTE.

**Cascata fixa, do mais forte pro mais fraco. Cada nível roda só nos pares que sobraram.**

| Nível | Regra | Confiança | Comportamento de valor |
|---|---|---|---|
| 1 | NSU + Autorização batem | máxima | match mesmo se valor difere → flag "divergência aceita" |
| 2 | Só NSU bate, candidato único | alta | match mesmo se valor difere → flag "divergência aceita" |
| 3 | Data exata + Valor exato + categoria forma | alta | match limpo |
| 4 | Data exata + Valor próximo (dentro da tolerância) + categoria | média | **divergência de valor** (não match silencioso) |
| 5 | Data ±1 dia útil + Valor exato + categoria | média | match com flag "casado por proximidade" |
| 6 | Sobra | — | exceção (PDV sem Cielo / Cielo sem PDV) |

> **Mudança vs proposta v1:** janela do nível 5 reduzida de **±3 dias corridos pra ±1 dia útil**. Pesquisa de mercado mostra que ±3 dias gera falsos positivos em alto volume; D+1/D+2 são as janelas reais de liquidação.

**Tolerância de valor configurável** (vs R$ 0,10 fixo da v1): por canal/forma, **percentual + absoluto, escolhe o maior**. Default sugerido: `max(R$ 0,10; 1% do valor)`. Razão: R$ 0,10 fixo é 2% num ticket de R$ 5 (alto demais); percentual fixo é frouxo demais em ticket de R$ 500.

**Mudança crítica vs hoje:**

- Tabela nova `match_pdv_cielo` (pagamento_id UNIQUE, venda_adquirente_id UNIQUE, nivel_match, criado_em, criado_por='AUTO'|user_id, observacao). UNIQUE em ambos os lados garante 1:1.
- **Próxima rodada só processa pagamentos e vendas Cielo que NÃO têm linha em `match_pdv_cielo`.** Acabou o reembaralhamento.
- Matches manuais (`criado_por != 'AUTO'`) **nunca** são auto-revogados.
- Matches AUTO de nível 4-5 ganham flag `auto_revogavel`. Quando aparece evidência mais forte (ex: NSU bate em outro par na rodada seguinte), o auto-revogável quebra e o forte assume.

### 3. Engine PDV ↔ Banco direto (canal DIRETO)

Pra Pix Manual, TED, etc.

**Cascata fase 1** (E2E ID promovido a nível 1 quando confirmarmos que o Consumer guarda — vide `Pendências de investigação`):

| Nível | Regra | Confiança |
|---|---|---|
| 1 | Valor exato + Data exata (D ou D±1 dia útil) + descrição banco contém "PIX/TED/DOC" | alta |
| 2 | Valor exato + Data ±2 dias úteis + categoria PIX/transferência | média (sugestão) |
| 3 | Sobra | exceção (PDV sem Banco / Banco sem origem) |

**Cascata fase 2** (depois que extrairmos E2E ID do PDV):

| Nível | Regra | Confiança |
|---|---|---|
| 1 | E2E ID do banco bate com E2E ID do PDV | máxima |
| 2 | Valor exato + Data D ou D±1 + descrição compatível | alta |
| 3 | Valor exato + Data ±2 dias úteis + categoria | média (sugestão) |
| 4 | Sobra | exceção |

**Estrutura:**
- Tabela `match_pdv_banco` (pagamento_id UNIQUE, tx_banco_id UNIQUE, nivel_match, criado_em, criado_por, observacao).
- Roda **antes** da Cielo (pra tirar Pix Manual da pilha — evita que vire exceção fantasma).
- Resultado:
  - Match → não vira exceção em ninguém
  - PDV-DIRETO sobra → exceção "PDV sem Banco" (NOVA)
  - Crédito banco sobra com descrição compatível → exceção "Banco sem origem" (já existe, mas hoje pega tudo)

### 3.5. Cross-route fallback (erro de cadastro do garçom)

Garçom às vezes registra Pix Manual como Pix Online ou vice-versa. Engine atual não cobre isso. Solução:

**Passada extra depois das cascatas de cada canal:**

- Pagamento PDV-ADQUIRENTE sem match na Cielo → testa contra créditos PIX direto no banco
- Pagamento PDV-DIRETO sem match no banco → testa contra Cielo

**Match cross-route nunca é silencioso.** Sempre vira **sugestão** com flag `cross_route='ADQUIRENTE→DIRETO'` ou `'DIRETO→ADQUIRENTE'`. Por quê?

- Se aceita automático, esconde o erro de cadastro do garçom (problema vira invisível)
- Como sugestão, o user vê "Pix Online casou com PIX direto no banco — talvez o garçom errou. Confirmar?" e tem oportunidade de corrigir o cadastro
- Vira input pra relatório de "formas erradas no PDV" (% de cross-routes por garçom)

### 4. Filtro de visualização independente do "rodar conciliação"

Hoje só dá pra ver as exceções da última rodada inteira. Falta poder filtrar sub-período sem rerodar.

- Inputs `dataInicio` / `dataFim` na URL — backend já aceita ([page.tsx:70](apps/web/src/app/conciliacao/operadora/page.tsx#L70))
- Adicionar UI de filtro acima das tabelas (separado do "Conciliar período")
- Default = mesmo período da última conciliação OK
- KPIs mostram 2 colunas: "no último OK" vs "no filtro atual"
- Mesma UX em `/conciliacao/recebiveis` e `/conciliacao/banco`
- Adicionar busca por NSU/autorização/valor/E2E ID no `match-manual-picker` (hoje lista tudo sem filtro)

## Categorização de divergências (insight da pesquisa)

Hoje toda divergência cai num bucket genérico. Mercado (F360, Concil, TOTVS) categoriza, e isso vira diferencial:

| Categoria | Sintoma | Causa típica |
|---|---|---|
| `TAXA_ANTECIPACAO` | Cielo paga menos que PDV registrou | antecipação de recebíveis pela adquirente |
| `TAXA_MDR` | Cielo cobra MDR diferente do contratado | renegociação ou erro Cielo |
| `GORJETA` | PDV registra incluindo gorjeta, Cielo registra só o principal | divisão na maquininha |
| `CHARGEBACK` | Cielo estorna venda já conciliada | disputa do cliente |
| `CANCELAMENTO_PARCIAL` | PDV cancelou item, Cielo já liquidou cheio | cancelamento pós-fechamento |
| `OUTRO` | divergência sem causa identificada | requer investigação manual |

Categorização **automática** quando padrão é claro (ex: diff = exatamente o valor da gorjeta = `GORJETA`). Manual quando ambíguo. Vira filtro nas exceções e métrica no dashboard.

## Status de match (insight da pesquisa)

TOTVS Protheus tem 4 status, vale adotar:

| Status | Quando |
|---|---|
| `MATCH_AUTO` | Engine bateu nos níveis 1-3 |
| `MATCH_PROXIMIDADE` | Engine bateu nível 4-5 (auto_revogavel=true) |
| `MATCH_MANUAL` | User confirmou manualmente |
| `MATCH_MANUAL_DIVERGENTE` | User confirmou ciente da divergência de valor |

Auditoria fica limpa: filtro por status mostra exatamente quem decidiu o quê.

## EDI Cielo Conciliador

A Cielo já oferece um produto chamado **EDI Conciliador** que entrega arquivo padronizado com NSU + Autorização + valor bruto + valor líquido + taxas separadas + data prevista de pagamento. É a **fonte primária** que ERPs brasileiros usam (Citel, CIGAM, Adaptive, TOTVS).

Hoje parece que parseamos extrato cru. Vale checar se conseguimos receber o EDI Conciliador via Cielo Concilia (pacote pago) ou pelo portal — reduz fricção, taxas vêm pré-categorizadas, e cobre 90% das divergências automaticamente.

## Pendências de investigação (antes de codar)

1. **O Consumer guarda o E2E ID** quando o pagamento é Pix Manual lançado direto? Verificar no schema `PAGAMENTOS` da base Firebird (192.168.10.59). Se sim, fase 2 do PIX manual já é viável.
2. **O extrato bancário usado hoje** (CNAB 240 Inter, OFX, etc) traz o E2E ID na descrição/observação? Bradesco, Itaú e Santander entregam. Verificar parser atual.
3. **Cliente tem acesso ao Cielo Conciliador / EDI?** Se sim, vale priorizar parser desse arquivo antes do refactor da engine.

## Plano de migração

1. **Schema** — criar `forma_pagamento_canal`, `match_pdv_cielo`, `match_pdv_banco`. Index UNIQUE. Migration sem perda de dados.
2. **Backfill** — popular `forma_pagamento_canal` com heurística inicial. Popular `match_pdv_cielo` a partir das exceções **resolvidas** existentes (matches manuais já feitos viram persistidos).
3. **Engine v2 PDV ↔ Cielo** — refatora `match-pdv-cielo.ts` pra cascata determinística com persistência. Mantém v1 disponível atrás de feature flag por filial pra rollback rápido.
4. **Engine PDV ↔ Banco direto** — nova função em `packages/conciliador/src/engine/match-pdv-banco-direto.ts`. Roda **antes** da Cielo.
5. **Cross-route fallback** — passada extra após (3) e (4).
6. **Categorização de divergências** — heurísticas automáticas + UI de classificação manual.
7. **UI** — filtro de visualização + busca no manual picker + nova seção "PDV sem Banco" + status de match.

## Tradeoffs e riscos

- **Persistir matches AUTO trava o reembaralhamento, mas exige regra de "auto-quebrar quando aparece evidência mais forte"**. Sem isso, um match nível 5 (proximidade) pode prender uma Cielo que devia bater por NSU em outra rodada.
- **Classificação manual de formas é trabalho inicial.** Mitigação: heurística de regex preenche 80% dos casos, user só ajusta o resto. UI mostra "X formas sem classificação" em alerta.
- **Cross-route como sugestão (não match firme)** é trade-off entre automação e visibilidade. Aceitamos sacrificar automação porque erro de cadastro precisa ser visível pro user corrigir.
- **Match PDV ↔ Banco direto sem E2E ID é menos preciso** que com. Mitigação: roda DEPOIS da Cielo (só sobra o realmente direto), e mantém fase 2 com E2E ID quando confirmarmos disponibilidade.

## O que **não** muda

- Schemas existentes de `excecao`, `pagamento`, `vendaAdquirente`, `txBanco` continuam.
- Engine `match-cielo-banco` (recebíveis) continua igual.
- Endpoints `/api/conciliacao/*` mantêm contrato (response + body).

## Estimativa grosseira

| Bloco | Complexidade | Tempo |
|---|---|---|
| Classificação de formas (canal de liquidação) | baixa | 1 dia |
| Cascata + persistência (PDV↔Cielo) | alta | 3-4 dias |
| Engine PDV ↔ Banco direto (fase 1, sem E2E) | média | 1-2 dias |
| Cross-route fallback | baixa | 0.5 dia |
| Categorização de divergências | média | 1 dia |
| UI de filtros + busca no picker + status | média | 1.5 dias |
| Backfill + migration | — | 1 dia |
| **Total** | — | **9-11 dias** |

Fase 2 (E2E ID + EDI Cielo Conciliador): +2-3 dias quando confirmarmos disponibilidade.

## Próximo passo

Aprovação do design e definição da ordem de implementação. Sugestão: começar por:

1. **Bloco 1** (classificação de formas) — desbloqueia tudo o resto e gera valor imediato (alerta de formas sem classificação).
2. **Bloco 4** (filtro de visualização) — entrega rápida, melhora UX já hoje sem mexer em engine.
3. Depois: engine PDV↔Banco direto + cross-route + nova cascata Cielo persistida + categorização + status.

## Referências (pesquisa de mercado, 2026-04-25)

**Cascata de match e EDI:**
- [Citel — Conciliação automática Cielo](https://documentacao.citelsoftware.com.br/fazer-conciliacao-automatica-de-cartoes-cielo-erp-autcom-doc-9/)
- [Citel — Conciliação automática Stone](https://documentacao.citelsoftware.com.br/fazer-conciliacao-automatica-de-cartoes-stone-erp-autcom-doc-9/)
- [CIGAM — Conciliação Cartões VAN/AUTTAR](https://www.cigam.com.br/wiki/index.php?title=GF_-_Como_Fazer_-_Concilia%C3%A7%C3%A3o_de_Cart%C3%B5es-CIGAM-VAN-AUTTAR)
- [Adaptive — Faturamento e Conciliação de Cartões](https://wiki.adaptive.com.br/Adaptive-Business/Financeiro/Movimenta%C3%A7%C3%A3o/faturamento-de-cartoes-conciliacao)
- [Cielo — EDI Conciliador](https://developercielo.github.io/manual/edi-cielo-conciliador)

**NSU/ARP/Autorização:**
- [Tray — O que são NSU e ARP](https://basedeconhecimento.tray.com.br/hc/pt-br/articles/6741514913819-O-que-s%C3%A3o-os-c%C3%B3digos-NSU-e-ARP)
- [Veloce — NSU em transações](https://cac.veloce.tech/central-de-ajuda/o-que-e-nsu-em-transacoes-de-pagamentos/)

**Categorização de divergências:**
- [F360 — Divergências de taxas de cartões](https://f360.com.br/blog/financas/divergencias-de-taxas-de-cartoes/)
- [Concil — Antecipação de parcelas](https://www.concil.com.br/blog/como-calcular-antecipacao-de-parcelas-do-cartao-de-credito/)
- [Boavista — Conciliação de Cartões](https://boavistatecnologia.com.br/blog/conciliacao-de-cartoes/)
- [Conciliadora — Conciliação Venda Sistema](https://sac.conciliadora.com.br/hc/pt-br/articles/34396966134036)
- [Pagar.me — Conciliação automática](https://www.pagar.me/blog/conciliacao-previne-situacoes-indesejadas-no-e-commerce/)

**PIX e E2E ID:**
- [BCB — Manual de Padrões para Iniciação do Pix](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf)
- [bacen/pix-api — txid no QR Code](https://github.com/bacen/pix-api/issues/190)
- [Sankhya — PIX](https://ajuda.sankhya.com.br/hc/pt-br/articles/4413021641495-Pix)
- [Senior — PIX Recebimento Eletrônico](https://documentacao.senior.com.br/gestaoempresarialerp/5.10.2/integracoes/pix-recebimento.htm)
- [E-Commerce Brasil — Pix ao ERP](https://www.ecommercebrasil.com.br/artigos/como-integrar-pix-ao-erp-e-alcancar-a-automacao-financeira)
- [Contplan — PIX e conciliação bancária](https://www.contplan.com.br/pix-e-conciliacao-bancaria-como-reduzir-diferencas-entre-vendas-extrato-e-taxas/)
- [Efí — QR Code estático vs dinâmico](https://sejaefi.com.br/blog/qr-code-estatico-qr-code-dinamico-no-pix)

**Status de match e conciliação por exceção:**
- [TOTVS — CTBA940 Bloqueio Match Divergente](https://centraldeatendimento.totvs.com/hc/pt-br/articles/35832257052567)
- [Onfly — Automatizar conciliação no ERP](https://www.onfly.com.br/blog/conciliacao-no-erp/)

**Adquirente vs sub-adquirente:**
- [Zoop — Adquirente e subadquirente](https://www.zoop.com.br/blog/mercado/adquirente-subadquirente)

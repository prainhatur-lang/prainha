# Redesign da conciliação — design doc

Status: **proposta** · Autor: discussão Elison + Claude · 2026-04-25

## Por que mexer

Comportamento atual incomoda:

1. **Não-determinismo entre rodadas** — uma exceção que tava lá some, depois volta. Causa: engine recalcula tudo do zero a cada rodada, sem persistir matches de fallback. Quando entram dados novos, o pareamento global se reembaralha.
2. **Buraco arquitetural** — a engine assume sempre PDV → Cielo → Banco. Pagamentos que não passam pela Cielo (ex: Pix Manual direto na conta) viram exceção fantasma dos dois lados (PDV sem Cielo + Banco sem origem) e nunca casam.
3. **UX de investigação fraca** — sem filtro de visualização por sub-período, sem busca por NSU/autorização, manual match lista tudo sem filtro.

## Os 4 blocos da mudança

### 1. Classificar formas de pagamento por rota de liquidação

Nem toda forma de pagamento passa pela Cielo. Cada `formaPagamento` (string vinda do Consumer) precisa estar mapeada pra uma das **4 rotas**:

| Rota | Quando usar | Exemplo de forma | Etapas de match |
|---|---|---|---|
| `ADQUIRENTE` | Passa por uma adquirente (Cielo, Stone, Rede, etc) | Crédito, Débito, Pix maquininha, Voucher | PDV → Cielo → Banco |
| `DIRETO` | Vai direto do cliente pra conta da empresa | Pix Manual, TED, DOC, boleto recebido | PDV → Banco |
| `CAIXA` | Fica em dinheiro físico | Dinheiro | PDV → Conferência caixa |
| `INTERNA` | Não envolve banco — vira AR | Fiado, Vale-funcionário | PDV → contas a receber |

**Implementação:**

- Nova tabela `forma_pagamento_rota` (filial_id, forma_pagamento_texto, rota, observacao). Default heurístico no insert (regex em "pix manual" → DIRETO, "dinheiro" → CAIXA, etc).
- UI em `/configuracoes/formas-pagamento` pra editar mapeamento.
- Toda forma desconhecida cai em `ADQUIRENTE` por default (comportamento atual) e vira alerta na UI ("classifique antes de conciliar").

### 2. Cascata determinística + matches persistidos (PDV ↔ Cielo)

Aplica só pra forma com rota=ADQUIRENTE.

**Cascata fixa, do mais forte pro mais fraco. Cada nível roda só nos pares que sobraram.**

| Nível | Regra | Confiança | Comportamento de valor |
|---|---|---|---|
| 1 | NSU + Autorização batem | máxima | match mesmo se valor difere → flag "divergência aceita" |
| 2 | Só NSU bate, candidato único | alta | match mesmo se valor difere → flag "divergência aceita" |
| 3 | Data exata + Valor exato + categoria forma | alta | match limpo |
| 4 | Data exata + Valor próximo (±10 cent) + categoria | média | **divergência de valor** (não match silencioso) |
| 5 | Data ±3 dias + Valor exato + categoria | média | match com flag "casado por proximidade" |
| 6 | Sobra | — | exceção (PDV sem Cielo / Cielo sem PDV) |

**Mudança crítica vs hoje:**

- Tabela nova `match_pdv_cielo` (pagamento_id UNIQUE, venda_adquirente_id UNIQUE, nivel_match, criado_em, criado_por='AUTO'|user_id, observacao). UNIQUE em ambos os lados garante 1:1.
- **Próxima rodada só processa pagamentos e vendas Cielo que NÃO têm linha em `match_pdv_cielo`.** Acabou o reembaralhamento.
- Matches manuais (`criado_por != 'AUTO'`) **nunca** são auto-revogados.
- Matches AUTO de nível 4-5 ganham flag `auto_revogavel`. Quando aparece evidência mais forte (ex: NSU bate em outro par na rodada seguinte), o auto-revogável quebra e o forte assume.

### 3. Nova engine PDV ↔ Banco direto (rota DIRETO)

Pra Pix Manual, TED, etc.

**Match por (data ±N dias, valor exato, descrição compatível).**

- "descrição compatível" = filtro no `tx_banco.descricao` (regex `PIX RECEBIDO`, `TED CRED`, `DOC CRED`).
- Mesma estrutura de cascata, persistido em `match_pdv_banco`.
- Resultado vira:
  - Match → não vira exceção em ninguém
  - PDV-DIRETO sobra → exceção "PDV sem Banco" (NOVA)
  - Crédito banco sobra com descrição compatível → exceção "Banco sem origem" (já existe, mas hoje pega tudo)

### 4. Filtro de visualização independente do "rodar conciliação"

Hoje só dá pra ver as exceções da última rodada inteira. Falta poder filtrar sub-período sem rerodar.

- Inputs `dataInicio` / `dataFim` na URL — backend já aceita ([page.tsx:70](apps/web/src/app/conciliacao/operadora/page.tsx#L70))
- Adicionar UI de filtro acima das tabelas (separado do "Conciliar período")
- Default = mesmo período da última conciliação OK
- KPIs mostram 2 colunas: "no último OK" vs "no filtro atual"
- Mesma UX em `/conciliacao/recebiveis` e `/conciliacao/banco`
- Adicionar busca por NSU/autorização/valor no `match-manual-picker` (hoje lista tudo sem filtro)

## Plano de migração

1. **Schema** — criar `forma_pagamento_rota`, `match_pdv_cielo`, `match_pdv_banco`. Index UNIQUE. Migration sem perda de dados.
2. **Backfill** — popular `forma_pagamento_rota` com heurística inicial. Popular `match_pdv_cielo` a partir das exceções **resolvidas** existentes (matches manuais já feitos viram persistidos).
3. **Engine v2** — refatora `match-pdv-cielo.ts` pra cascata determinística com persistência. Mantém v1 disponível atrás de feature flag por filial pra rollback rápido.
4. **Engine PDV ↔ Banco direto** — nova função em `packages/conciliador/src/engine/match-pdv-banco-direto.ts`. Roda **antes** da Cielo (pra tirar Pix Manual da pilha).
5. **UI** — filtro de visualização + busca no manual picker + nova seção "PDV sem Banco".

## Tradeoffs e riscos

- **Persistir matches AUTO trava o reembaralhamento, mas exige regra de "auto-quebrar quando aparece evidência mais forte"**. Sem isso, um match nível 5 (proximidade) pode prender uma Cielo que devia bater por NSU em outra rodada.
- **Classificação manual de formas é trabalho inicial.** Mitigação: heurística de regex preenche 80% dos casos, user só ajusta o resto. UI mostra "X formas sem classificação" em alerta.
- **Match PDV ↔ Banco direto é menos preciso** que via Cielo (não tem NSU). Mitigação: roda DEPOIS de PDV ↔ Cielo, então só sobra o que realmente é direto.

## O que **não** muda

- Schemas existentes de `excecao`, `pagamento`, `vendaAdquirente`, `txBanco` continuam.
- Engine `match-cielo-banco` (recebíveis) continua igual.
- Endpoints `/api/conciliacao/*` mantêm contrato (response + body).

## Estimativa grosseira

| Bloco | Complexidade | Tempo |
|---|---|---|
| Classificação de formas | baixa | 1 dia |
| Cascata + persistência (PDV↔Cielo) | alta | 3-4 dias |
| Engine PDV ↔ Banco direto | média | 1-2 dias |
| UI de filtros + busca no picker | baixa | 1 dia |
| **Total** | — | **6-8 dias** |

Backfill + migration: +1 dia.

## Próximo passo

Aprovação do design e definição da ordem de implementação. Sugestão: começar pelos blocos 1 + 4 (mais simples, geram valor imediato) antes de mexer na engine.

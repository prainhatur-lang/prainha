# Concilia

Plataforma operacional integrada para restaurantes. Núcleo financeiro rastreia a conciliação ponta-a-ponta (PDV → Cielo → banco), agregando compras, reservas, folha, atendimento, fiscal e operações locais.

> **Documentação detalhada:** leia [`docs/arquitetura.md`](docs/arquitetura.md) para o mapa técnico completo.

## Stack

- **Web:** Next.js 16 + React 19 + Tailwind 4
- **Banco:** Postgres (Supabase) + Drizzle ORM
- **Auth:** Supabase Auth (multi-tenant)
- **Engine de conciliação:** parsers Cielo + CNAB 240 + matching com subset sum
- **Agente local:** Node.js + Firebird CDC + Windows service
- **Operação:** Cielo Lio (Android), WhatsApp/IA, SEFAZ, iFood, delivery próprio

## Estrutura

```
concilia/
├── apps/
│   └── web/                    # Next.js (dashboards + APIs)
├── packages/
│   ├── db/                     # Drizzle schema + migrations
│   ├── conciliador/            # Parsers + matching engines
│   └── shared/                 # Tipos compartilhados
├── agente-local/               # Serviço Windows (Consumer → nuvem)
├── vendas-local/               # Backend operacional (KDS + garçom)
├── lio-app/                    # App Android para Cielo Lio
├── agente-patio/               # Integração de cancela/placa
└── docs/                       # Arquitetura e especificações
```

## Domínios implementados

- **Conciliação financeira:** PDV × Cielo × banco + exceções + aceite
- **Integração Consumer:** CDC + checkpoint incremental + mappers
- **Financeiro:** contas a pagar/receber, caixa, DRE, fechamento
- **Compras:** sugestão, cotação, pedidos, notas, estoque
- **Reservas:** agenda, mesas, lista de espera, orçamentos
- **Atendimento:** WhatsApp com IA (Nina), avaliações, contatos
- **Folha:** folha semanal, colaboradores, fechamento
- **Fiscal:** NFC-e, DF-e, certificados, SEFAZ
- **Delivery:** cardápio público, pedidos, frete, iFood
- **Operação:** KDS, garçom na Lio, comanda, impressora, pátio

## Setup local

```bash
# 1. Instalar deps
pnpm install

# 2. Variáveis de ambiente
cp .env.example .env
# Editar .env com URLs do Supabase

# 3. Rodar app (nunca use db:push em prod)
pnpm dev
```

App em http://localhost:3000

### Migrations em produção

**NUNCA** rode `db:push` ou `db:generate` em produção. Migrations são manuais:

```bash
# 1. Editar schema em packages/db/src/schema/*.ts
# 2. Criar script: packages/db/scripts/migrate-<nome>.ts
# 3. Adicionar target em packages/db/package.json
# 4. Rodar localmente para testar
pnpm --filter @concilia/db migrate:<nome>
```

[Detalhes em CLAUDE.md](CLAUDE.md#migrations-são-manuais)

## Comandos principais

| Comando | O que faz |
|---|---|
| `pnpm dev` | Roda Next.js em dev |
| `pnpm build` | Build completo |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm test` | Testes (executar antes de commit) |
| `pnpm --filter @concilia/db migrate:<nome>` | Roda migration idempotente |
| `pnpm db:studio` | Abre Drizzle Studio |

## Convenções críticas

1. **Commit direto no `main`** → Vercel publica automaticamente.
2. **Timezone BRT** → use helpers de `@/lib/datas` (nunca `new Date().toISOString()`).
3. **Multi-tenant obrigatório** → toda query filtra por `filialId`.
4. **RLS em tabelas novas** → `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` (ENABLE, não FORCE).
5. **Permissões** → guards `exigirPermPage`/`exigirPermApi` de `@/lib/exigir-perm`.

[Mais detalhes em CLAUDE.md](CLAUDE.md)

## Deploy

- **Web:** branch `main` publica automaticamente na Vercel → app.prainhabar.com
- **Agente local:** release manual em `apps/web/public/agente-release/`
- **Lio:** build Android assinado + certificação Cielo por filial

## Contribuir

- Leia [CLAUDE.md](CLAUDE.md) antes de começar.
- Leia [docs/arquitetura.md](docs/arquitetura.md) para entender o sistema.
- Typecheck antes de commit: `pnpm --filter @concilia/web typecheck`
- Termine commit com: `Co-Authored-By: Claude <...>`

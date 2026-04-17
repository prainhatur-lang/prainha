# concilia

Conciliação financeira ponta-a-ponta para restaurantes.

Rastreia cada venda do PDV (Consumer/Firebird) → adquirente (Cielo) → conta bancária (banco).

## Stack

- **Web:** Next.js 16 + React 19 + Tailwind 4
- **Banco:** Postgres (Supabase) + Drizzle ORM
- **Auth:** Supabase Auth (multi-tenant)
- **Engine de conciliação:** parsers Cielo + CNAB 240 + matching com subset sum
- **Monorepo:** pnpm + Turborepo

## Estrutura

```
concilia/
├── apps/
│   └── web/                    # Next.js (dashboard + APIs)
├── packages/
│   ├── shared/                 # Tipos compartilhados
│   ├── db/                     # Drizzle schema + cliente
│   └── conciliador/            # Parsers (Cielo, CNAB) + engine
└── agente-local/               # Agente Windows (Fase 1)
```

## Setup local

```bash
# 1. Instalar deps
pnpm install

# 2. Configurar variaveis
cp .env.example .env
# Editar .env com URLs do Supabase

# 3. Push do schema para o banco
pnpm db:push

# 4. Rodar app
pnpm dev
```

App em http://localhost:3000

## Roadmap

- ✅ **Fase 0** Setup do monorepo, schema multi-tenant, auth basica
- ⏳ **Fase 1** Agente local (Windows) lendo Firebird
- ⏳ **Fase 2** Upload de arquivos Cielo + CNAB
- ⏳ **Fase 3** Engine de conciliacao em background jobs
- ⏳ **Fase 4** Dashboard do dono (consolidado)
- ⏳ **Fase 5** Dashboard de gerente (RBAC) + lista de excecoes
- ⏳ **Fase 6** Notificacoes (email/WhatsApp) + cron diario
- ⏳ **Fase 7** Polish, mobile, exports

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Roda Next.js em dev |
| `pnpm build` | Build de tudo |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm db:push` | Aplica schema no Postgres (dev) |
| `pnpm db:generate` | Gera arquivo de migration |
| `pnpm db:migrate` | Roda migrations (prod) |
| `pnpm db:studio` | Abre Drizzle Studio |

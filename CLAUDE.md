# Concilia — guia pro Claude

App de gestão do **Prainha** (Prainha Bar / Tabuará, Aracaju-SE): conciliação
financeira, folha de pagamento, reservas, avaliações, compras/cotação, e
integração com o **Consumer** (PDV Firebird on-site, via agente + CDC).

## Stack & estrutura
- Monorepo **pnpm + Turbo**. Next.js 16 (React 19) + Drizzle ORM + Postgres (Supabase).
- `apps/web` — app Next.js (App Router). Páginas em `apps/web/src/app`, libs em `apps/web/src/lib`.
- `packages/db` — schema Drizzle (`src/schema/*.ts`) + scripts de migration (`scripts/migrate-*.ts`).
- `agente-local` — agente Node que roda on-site lendo o Firebird do Consumer.
- Repo: `prainhatur-lang/prainha`. **Vercel publica do `main`** → projeto `prainha-web` → domínio **app.prainhabar.com**.

## ⚠️ Convenções que NÃO se quebra
1. **Commit + push direto no `main`, sem perguntar.** Vercel publica sozinho. Termina msg de commit com a linha `Co-Authored-By`.
2. **Sempre PRODUÇÃO e realidade.** Nada de modo teste/mock como solução final. App Meta publicado, token permanente, envs em Production. Dado de teste em prod → limpar depois.
3. **Migrations são MANUAIS.** NUNCA rode `db:generate`/`db:push` (o journal do drizzle está congelado no 0002). Pra mudar o banco:
   - Edita o schema em `packages/db/src/schema/*.ts`.
   - Cria `packages/db/scripts/migrate-<nome>.ts` (copia o padrão de outro: ALTER ... IF NOT EXISTS, idempotente, usa `DATABASE_URL_DIRECT`).
   - Adiciona o target em `packages/db/package.json` (`"migrate:<nome>": "tsx scripts/migrate-<nome>.ts"`).
   - Roda: `pnpm --filter @concilia/db migrate:<nome>`.
   - **CREATE TABLE nova → SEMPRE terminar com `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY`** (ENABLE, nunca FORCE). Sem isso a anon key do Supabase lê/escreve a tabela via PostgREST (aconteceu 2x: jun + ago/2026 — as tabelas da Nina/eventos vazaram). Conserto rápido: `pnpm --filter @concilia/db migrate:rls` (idempotente, pega todas).
4. **Timezone BRT.** Use os helpers de `@/lib/datas` (`hojeBr()`, `diasAtrasBr(n)`, `dateToBrYmd`) — NUNCA `new Date().toISOString().slice(0,10)` (bug recorrente em prod). `diasAtrasBr(-1)` = amanhã.
5. **Typecheck antes de commitar:** `pnpm --filter @concilia/web typecheck`.

## Multi-tenant & permissões
- Hierarquia: `organizacao → filial → dados`. Toda query filtra por `filialId`.
- Permissões: guards `exigirPermPage`/`exigirPermApi`/`negarSemPerm` de `@/lib/exigir-perm` (códigos tipo `reserva.update`, `cotacao.create`). Acesso à filial via `usuario_filial`.
- **Filial IDs:** Prainha Bar = `7c5c66ce-cceb-4e89-9c6d-d0785255c4f9` · Tabuará = `fde37b95-7c7e-4b41-a618-2aba1fbc0de7`.

## Acessar o banco em scripts pontuais
Roda de `packages/db` (tem o driver `postgres`), lendo `../../.env`:
```js
const postgres = require('postgres');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });
```
GOTCHA: ao imprimir `date`/`timestamp` com `String(x)`/JS Date, mostra -1 dia (BRT). Use `::text` no SQL pra ver a data real.

## WhatsApp (Meta Cloud API) — gotchas
- Token lido como `WHATSAPP_TOKEN || WHATSAPP_META` (o user salvou como `WHATSAPP_META`). Tem que ser **permanente** (System User).
- Templates por env: `WHATSAPP_COTACAO_TEMPLATE`, `WHATSAPP_PEDIDO_TEMPLATE`, `WHATSAPP_CONFIRMACAO_TEMPLATE`, `WHATSAPP_LEMBRETE_TEMPLATE`. Funções em `apps/web/src/lib/whatsapp-otp.ts`.
- Template de **AUTENTICAÇÃO** é bloqueado na conta; **UTILIDADE** passa. OTP de reserva foi pro **Twilio**.
- Botão de URL dinâmica da Meta **anexa** a variável (vira `{{1}}token`) → páginas públicas limpam o prefixo `{{N}}`.
- Webhook: `/api/whatsapp/webhook` (GET verify + POST). Verify token default `prainha_zap_2026`. Lembrete usa botões **quick_reply** (`confirmar:<token>`/`cancelar:<token>`).
- Fallback que funciona sem template aprovado: **wa.me** (1 toque).

## Outras gotchas importantes
- **Folha fechada = snapshot imutável** (lê de `conta_pagar`, não recalcula). Reabrir pede senha; `fechar` é idempotente. Cuidado: a flag PAGA da baixa em lote ≠ dinheiro saiu (fonte da verdade = arquivo PDF).
- **Sync do Consumer (concilia-mappers.ts):** não sobrescreve email/telefone do fornecedor quando o Consumer manda vazio (`COALESCE(NULLIF(excluded.x,''), atual)`).
- **Reservas:** a **mesa é a unidade** — reservar aloca a mesa inteira; lotação por nº de mesas. `reserva_config` (jsonb na filial) tem `areas[{nome, mesas[{numero,lugares}], horaLimite, ...}]`, `semOtp`, `valorCheio/valorAtual`.
- **CONTACORRENTE Consumer:** pagamento = CREDITO+IMPORTADO=S; saldo = sum(DEBITO) - sum(CREDITO).

## Memória detalhada
Há memória do projeto com detalhes por feature/episódio (folha, reservas, WhatsApp,
CDC v2, Consumer, etc.) — consulte quando precisar de contexto histórico.

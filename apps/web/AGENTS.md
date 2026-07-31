<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agente Local — Distribuição via Vercel

O agente Node.js que roda nas filiais (Firebird → Postgres) é distribuído **a partir deste app**. Tem 4 superfícies que você precisa preservar:

## 1. Bundle hospedado em `public/agente-release/`

```
apps/web/public/agente-release/
├── concilia-agente-vX.Y.Z.zip   # bundle completo (~30 MB) — node + nssm + agente.cjs
└── agente-vX.Y.Z.cjs            # só o cjs (~545 KB) — pra updates incrementais
```

O bundle é gerado fora deste app, em `agente-local/`:

```bash
cd ../../agente-local
pnpm bundle && pnpm package:win
cp release/concilia-agente-windows.zip \
   ../apps/web/public/agente-release/concilia-agente-vX.Y.Z.zip
cp build/index.cjs \
   ../apps/web/public/agente-release/agente-vX.Y.Z.cjs
```

⚠️ Esses arquivos **vão pro git** (são <40 MB, ok). Não adicione ao `.gitignore`.

## 2. Constante `VERSAO_RELEASE`

Em `src/app/api/agente-release/route.ts` — string que aponta pro arquivo no `public/`. Bumpar essa constante junto com novo bundle.

## 3. Endpoints (não quebrar)

| Endpoint | O que retorna |
|---|---|
| `GET /api/agente-release` | JSON com `versao`, `bundleUrl`, `changelog` |
| `GET /api/agente-release/instalar.bat?filial=ID` | `.bat` per-filial (UAC + iwr/iex). **Requer auth do user.** |
| `GET /api/agente-release/instalar.ps1?filial=ID&token=X` | Instalador completo. Valida token contra DB. **Público (chamado via PowerShell, sem cookies).** |
| `GET /agente-release/concilia-agente-vX.Y.Z.zip` | Bundle estático (público). |

O `.ps1` é chamado pelo PowerShell do PC da filial via `iwr|iex` — **não tem sessão de browser**, então não pode exigir auth de usuário. A defesa é: token da filial vem na URL e é validado contra `filial.agente_token` no DB.

## 4. Middleware (`src/proxy.ts`)

`/agente-release/*` está na lista de **rotas públicas** (sem auth). Senão o PowerShell baixa HTML de redirect em vez do bundle.

```ts
const isAgenteRelease = path.startsWith('/agente-release/');
const isPublicRoute = ... || isAgenteRelease;
```

`/api/agente-release/instalar.ps1` também é público (é uma API mas é chamada por PowerShell sem cookie).

## 5. UI

A página `/sync` é onde o usuário vê o status das filiais e baixa o instalador. Cada `FilialCard` tem o botão **📦 Baixar instalador** que aponta pra `/api/agente-release/instalar.bat?filial=<id>`.

Há também `/configuracoes/agente` como página alternativa (mais limpa, mas não tem o status histórico).

## Como subir nova versão (checklist)

1. Editar código em `agente-local/src/`
2. Bumpar `version` em `agente-local/package.json` E `AGENTE_VERSAO` em `agente-local/src/index.ts`
3. `pnpm typecheck && pnpm bundle && pnpm package:win` em `agente-local/`
4. Copiar `release/concilia-agente-windows.zip` → `apps/web/public/agente-release/concilia-agente-vX.Y.Z.zip`
5. Copiar `build/index.cjs` → `apps/web/public/agente-release/agente-vX.Y.Z.cjs`
6. Atualizar `VERSAO_RELEASE` em `src/app/api/agente-release/route.ts`
7. Adicionar entrada no `agente-local/README.md` "Histórico de versões"
8. Commit + push (Vercel deploya em ~2min)
9. Pra cada filial: rebaixar o `.bat` no painel `/sync` e duplo-clicar no PC

Não há mecanismo de auto-update no agente — toda nova versão exige re-deploy manual via `.bat` em cada filial. (Possível v0.6+: agente faz polling de versão.)

## O que NÃO mexer sem entender o impacto

- **Middleware `proxy.ts`**: mudar a lista de rotas públicas pode bloquear o download do bundle pelo PowerShell (vira HTML de redirect, agente não inicia)
- **Encoding do `config.json`** gerado pelo instalador: deve ser UTF-8 **sem BOM**. Use `[System.IO.File]::WriteAllText(path, json, (New-Object System.Text.UTF8Encoding $false))`. PS5 `Set-Content -Encoding utf8` adiciona BOM e quebra `JSON.parse` no Node
- **`unique(filial_id, codigo_externo)` na tabela `pedido` e `pedido_item`**: o agente depende disso pro UPSERT do refetch janela funcionar
- **Janela de refetch (`refetchJanelaDias`)**: 14 dias é mínimo pra cobrir folha semanal (semana fecha segunda, então pedidos da segunda passada precisam ser captados ainda na segunda atual = 7-13 dias atrás). Não baixar pra 7

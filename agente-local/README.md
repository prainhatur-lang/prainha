# concilia — Agente Local

Serviço Node.js que roda na rede local de cada restaurante e:

1. Conecta no Firebird do Consumer Rede (`consumer.fdb`)
2. Lê PAGAMENTOS, PEDIDOS, ITENSPEDIDO, CLIENTES, FORNECEDORES, etc. (via checkpoint incremental)
3. **Re-busca pedidos abertos nos últimos 14 dias** a cada ciclo (UPSERT — captura updates pós-criação)
4. Envia em batch para `https://app.prainhabar.com/api/ingest` e `/api/ingest/pdv`
5. Roda em loop a cada `intervalSeconds` (padrão 900 = 15 min)

## ⚡ Instalação 1-clique (recomendado)

**Pra qualquer pessoa instalar/atualizar/reparar uma filial:**

1. Abre `https://app.prainhabar.com/sync` (logado)
2. Em cada card de filial, clica **📦 Baixar instalador** — baixa um `.bat` com o token da filial já embutido
3. Conecta no PC da filial (Chrome Remote Desktop) e copia o `.bat` pra lá
4. **Duplo-clique no `.bat`** → aceita o UAC → espera ~1 min
5. Em até 15 min a filial aparece como **online** no painel

O instalador é **idempotente**: serve pra instalar do zero, atualizar versão ou reparar instalação quebrada. Preserva o `checkpoint.json` (não perde progresso de sync).

### O que o `.bat` faz por baixo

1. Auto-eleva via UAC (1 prompt de Admin)
2. Baixa o `.ps1` instalador via `iwr | iex` (sem salvar arquivo intermediário)
3. Detecta `consumer.fdb` automaticamente em paths candidatos:
   - `C:\Users\<user>\AppData\Local\RAL Tecnologia\CreateInstall\consumer.fdb`
   - Busca recursiva em `C:\Users\` se não achar
4. Cria/garante a pasta `C:\concilia-agente\`
5. Para o serviço `ConciliaAgente` se já existe
6. Faz backup de `checkpoint.json` + `config.json` em `backup-<timestamp>/`
7. Baixa `concilia-agente-v<X.Y.Z>.zip` do Vercel (~30 MB com node.exe + nssm.exe + agente.cjs)
8. Extrai sobrescrevendo binários, **mas preservando** `checkpoint.json` e `config.json` existentes
9. Gera `config.json` novo com o token correto da filial — **sem BOM** (UTF8 puro)
10. (Re)instala serviço via NSSM com paths corretos
11. Inicia, valida boot no log de hoje, reporta versão

## Arquitetura do servidor (release de nova versão)

Quando precisa subir uma versão nova do agente:

1. **No código:**
   - Edita `agente-local/src/...` com a mudança
   - Bumpa `agente-local/package.json` `version`
   - Bumpa `AGENTE_VERSAO` em `agente-local/src/index.ts`
2. **Build:**
   ```bash
   cd agente-local
   pnpm typecheck   # garante OK
   pnpm bundle      # gera build/index.cjs
   pnpm package:win # gera release/concilia-agente-windows.zip
   ```
3. **Hospeda no Vercel:**
   ```bash
   cp release/concilia-agente-windows.zip \
      ../apps/web/public/agente-release/concilia-agente-vX.Y.Z.zip
   cp build/index.cjs \
      ../apps/web/public/agente-release/agente-vX.Y.Z.cjs
   ```
4. **Atualiza VERSAO_RELEASE:**
   - `apps/web/src/app/api/agente-release/route.ts` → constante `VERSAO_RELEASE = 'X.Y.Z'`
5. **Commit + push** — Vercel deploya em ~2min
6. **Cada filial atualiza** baixando o novo `.bat` em `/sync` e duplo-clicando

## Estrutura de arquivos no PC da filial (após instalação)

```
C:\concilia-agente\
├── node.exe              # runtime portátil (~83 MB)
├── nssm.exe              # service manager (~331 KB)
├── agente.cjs            # bundle do agente (~545 KB)
├── config.json           # gerado pelo instalador (token + caminho do FDB)
├── checkpoint.json       # progresso do sync (preservado entre updates)
├── install-service.bat   # legado, não usar mais (instalador faz tudo)
├── uninstall-service.bat # pra desinstalar manualmente se precisar
├── run.cmd               # legado pra rodar fora de serviço
├── logs/
│   ├── agente-YYYY-MM-DD.log   # log diário do agente
│   ├── boot-trace.log          # trace de inicialização
│   ├── stdout.log              # capturado pelo NSSM
│   └── stderr.log              # capturado pelo NSSM
└── backup-<timestamp>/   # backups feitos pelo instalador a cada update
```

## Config.json — formato

```json
{
  "api": {
    "url": "https://app.prainhabar.com",
    "token": "agt_<TOKEN_DA_FILIAL>"
  },
  "firebird": {
    "host": "localhost",
    "port": 3050,
    "database": "C:\\Users\\eliso\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\consumer.fdb",
    "user": "SYSDBA",
    "password": "masterkey"
  },
  "intervalSeconds": 900,
  "batchSize": 1000,
  "checkpointFile": "checkpoint.json",
  "refetchJanelaDias": 14
}
```

⚠️ **Importante**: o `config.json` deve estar em **UTF-8 sem BOM**. O agente trata BOM automaticamente desde v0.5.4, mas o instalador grava sem BOM por padrão. Não use `Set-Content -Encoding utf8` do PowerShell 5 (adiciona BOM).

## Comandos úteis no PC da filial

```powershell
# Ver status
Get-Service ConciliaAgente

# Reiniciar
Restart-Service ConciliaAgente

# Ver logs do dia
Get-Content "C:\concilia-agente\logs\agente-$(Get-Date -Format 'yyyy-MM-dd').log" -Tail 30

# Ver versão rodando
Get-Content "C:\concilia-agente\logs\agente-$(Get-Date -Format 'yyyy-MM-dd').log" -Tail 30 |
  Select-String -Pattern '"versao":"([^"]+)"' | Select-Object -Last 1

# Desinstalar serviço (manualmente)
& "C:\concilia-agente\nssm.exe" remove ConciliaAgente confirm
```

## Troubleshooting

| Sintoma | Causa | Solução |
|---|---|---|
| Filial offline no painel | Serviço caiu / sem internet | Logar no PC, `Get-Service ConciliaAgente`. Ver logs |
| Banco com 10% bem menor que real | Agente em versão < 0.5.4 (sem refetch) | Rodar o `.bat` instalador novo (atualiza pra v0.5.4+) |
| `config.json invalido: Unexpected token 'ï»¿'` | BOM no config.json | Reinstalar via `.bat` (gera sem BOM) |
| Pedidos com `data_fechamento` NULL | Mesa ainda aberta no Consumer | Aguardar mesa fechar, refetch da próxima janela atualiza |
| Service não sobe | Path errado no NSSM | Reinstalar via `.bat` (recria configuração NSSM) |
| `firebird timeout (60000ms)` | Firebird trava temporariamente | Comum, agente reinicia ciclo. Se persistir → reiniciar serviço |

## Histórico de versões

- **v0.5.4** (2026-05-06):
  - Refetch janela 14 dias — captura updates pós-criação do PEDIDO. Corrige snapshot velho que causava ~60% de subreporting do 10%.
  - Strip de BOM no config.json — evita crash com `Set-Content -Encoding utf8` do PS5.
  - Default `refetchJanelaDias: 14`.
  - Instalador 1-clique via `.bat` per-filial.
- **v0.5.3** (2026-04-25): Compactação do bundle, NSSM embutido.
- **v0.5.0** (2026-04-17): Primeira versão como serviço Windows.

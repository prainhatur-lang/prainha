# concilia - Agente Local

Servico Node.js que roda na **rede local de cada restaurante** e:

1. Conecta no Firebird do Consumer (`consumer.fdb`)
2. Le PAGAMENTOS novos (delta via checkpoint)
3. Envia em batch para `https://app.prainhabar.com/api/ingest`
4. Roda em loop a cada N minutos (padrao 15 min)

## Instalacao no Windows (passo a passo)

### 1. Instalar Node.js (uma vez)
Baixa a LTS em https://nodejs.org/ e instala.

### 2. Baixar o agente
- Crie uma pasta, por ex. `C:\concilia-agente`
- Coloque dentro:
  - `dist/` (codigo compilado, gerado por `pnpm build`)
  - `node_modules/` (gerado por `pnpm install --prod`)
  - `config.json`
  - `package.json`

### 3. Configurar
Copie `config.example.json` para `config.json` e edite:

```json
{
  "api": {
    "url": "https://app.prainhabar.com",
    "token": "agt_<TOKEN_DA_FILIAL>"
  },
  "firebird": {
    "host": "192.168.10.59",
    "port": 3050,
    "database": "C:\\Users\\User\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\consumer.fdb",
    "user": "SYSDBA",
    "password": "masterkey"
  },
  "intervalSeconds": 900,
  "batchSize": 500,
  "checkpointFile": "checkpoint.json"
}
```

O token da filial e obtido no painel do app concilia (Configuracoes > Filiais).

### 4. Testar (modo manual)
Abra o CMD na pasta:
```
node dist/index.js
```
Voce deve ver logs `[INFO] iniciando ciclo`, `[INFO] enviando batch ...`.

### 5. Instalar como Windows Service (auto-start)
Use o **NSSM** (Non-Sucking Service Manager):
1. Baixe em https://nssm.cc/download
2. Extraia `nssm.exe` (use `win64/`).
3. Abra CMD como Administrador, va ate a pasta com `nssm.exe`.
4. Rode:
   ```
   nssm install ConciliaAgente
   ```
5. No GUI:
   - **Path:** `C:\Program Files\nodejs\node.exe`
   - **Startup directory:** `C:\concilia-agente`
   - **Arguments:** `dist\index.js`
   - **Service name:** `ConciliaAgente`
   - Aba **Details** > Display name: `Concilia Agente Local`
   - Aba **I/O** > Output: `C:\concilia-agente\logs\stdout.log`, Error: `logs\stderr.log`
   - **Install service**

6. Inicie o servico:
   ```
   nssm start ConciliaAgente
   ```

### 6. Verificar
- Logs em `C:\concilia-agente\logs\agente-YYYY-MM-DD.log`
- No painel concilia, vai aparecer `Ultimo ping` atualizado em /sync

## Variaveis de ambiente (alternativa ao config.json)

- `CONCILIA_CONFIG=C:\caminho\para\config.json` para usar arquivo em outra pasta.

## Troubleshooting

| Erro | Causa | Solucao |
|---|---|---|
| `ECONNREFUSED 192.168.x.x:3050` | Firebird nao esta acessivel | Verificar se servico Firebird esta no ar e firewall liberado |
| `HTTP 401 invalid token` | Token errado | Conferir `agente_token` no painel concilia |
| `EHOSTUNREACH` | Sem internet | Verificar conexao da maquina |
| Servico nao inicia | Path errado no NSSM | Editar com `nssm edit ConciliaAgente` |

# agente-patio

Nó de cancela do **pátio / estacionamento** do concilia. Substitui o controle de
acesso do Secullum. Roda no **mini-PC de cada cancela** (entrada e saída), 24/7.

Cada nó fala com:

- **Facial Intelbras SS 3532** (Dahua) via CGI Digest → abre a cancela (relé) e lê status.
- **Câmera UniFi G6 (LPR)** → recebe a placa por **webhook do Alarm Manager** do Protect.
- **API do concilia** → cria/valida a sessão de estacionamento (F2/F3).
- **Impressora térmica USB** → imprime o ticket na entrada (F2).

## Fluxo (entrada)

```
laço detecta carro → câmera lê placa (webhook) → cria sessão + imprime ticket
                                                  (código + placa + hora) → abre cancela
```

O **laço** é o gatilho; a **placa** é a identidade. Sem placa lida, imprime mesmo
assim (placa "NAO_LIDA") e abre — ninguém fica preso.

## Config

Copie `config.example.json` para `config.json` e preencha. `config.json` NÃO é
versionado (tem segredos: senha do facial + API key do Protect).

| campo | o quê |
|---|---|
| `papel` | `entrada` ou `saida` |
| `facial` | host/usuário/senha do SS 3532 dessa cancela |
| `camera.id` | id da câmera UniFi que cobre a cancela |
| `protect` | host + API key do NVR |
| `laco.fonte` | `facial` (entrada de alarme do SS 3532) \| `rele` (placa USB) \| `none` (DEV) |
| `autoAbrir` | `false` na F1 (só captura, não aciona o portão) |

## Testes (do Mac, que alcança os dispositivos)

```bash
pnpm --filter @concilia/agente-patio test:facial    # read-only: modelo + status da porta
pnpm --filter @concilia/agente-patio test:protect   # read-only: ping + confirma câmera LPR
pnpm --filter @concilia/agente-patio test:relay      # ⚠️ FÍSICO: abre a cancela
pnpm --filter @concilia/agente-patio dev             # sobe o listener de webhook
```

## Status

- **F1** (atual): núcleo — facial, Protect, listener de webhook, captura de placa. ✅
- **F2**: impressão do ticket (ESC/POS USB) + criação de sessão.
- **F3**: validação no caixa (consumo do Consumer, regra mista).
- **F4**: saída automática por placa + leitor de cupom (fallback) + relatórios.

# Espaço Kids — controle de criança com chamada do responsável pelo WhatsApp

Data: 2026-09-03 · Loja piloto: **filial 03 (Prainha Mar)** · Status: aprovado pelo dono, aguardando implementação.

## 1. Objetivo

Os pais deixam a criança no espaço kids da Prainha Mar. A monitora registra a
criança num tablet, com o responsável identificado por um WhatsApp **testado**
(ele mandou uma mensagem pra casa) e a mesa onde está. Quando precisa, a
monitora **chama o responsável pelo WhatsApp** com um toque, vê a resposta dele
na tela e, se ele demorar, avisa o garçom da mesa. O responsável recebe o
**link da câmera do kids** (transmissão ao vivo do UniFi Protect) na resposta
automática.

Decisões fechadas com o dono (03/09/2026):

| Pergunta | Resposta |
|---|---|
| "Acesso à câmera" | O **pai vê o kids ao vivo** pelo celular (link de transmissão do Protect). Sem foto da criança. |
| "Zap testado" | O **pai manda uma mensagem** pra casa via QR (wa.me com texto pronto). Sem template novo na Meta. |
| Quem faz o check-in | A **monitora**, num tablet, página `/kids` do vendas-local, com PIN da equipe. |
| Câmera | Filial 03, **UniFi Protect**. Usa o **link de compartilhamento de transmissão** do próprio Protect (configuração; zero código de câmera). |
| Chamar o pai | Botão **+ motivo + resposta do pai na tela + alerta vermelho se demorar + chamar de novo / avisar o garçom**. |
| Dados da criança | Nome, **idade e observação**. Várias crianças por responsável. |
| Arquitetura | **Opção A**: tudo na loja; a nuvem só faz a ponte do WhatsApp (3 rotas assinadas + desvio no webhook). |

## 2. Arquitetura

```
tablet do kids ──HTTP──▶ vendas-local (/kids, /api/kids/*)  ──HTTPS assinado──▶ app.prainhabar.com (/api/loja/kids/*)
                                   │ Postgres local                                      │ Supabase (kids_checkin, kids_mensagem)
                                   │ kids_entrada / kids_crianca / kids_evento           │
                                   │                                                     ▼
celular do pai ◀──wa.me QR──┘                                   Meta Cloud API ◀──▶ /api/whatsapp/webhook (desvio "kids")
```

- **Nada entra na loja de fora.** Só a loja chama a nuvem (mesmo canal do
  `/cliente-documento`: HMAC com `PAGAR_MESA_SECRET`). Não precisa de Funnel.
- A loja **sincroniza por polling**: a cada 4 s enquanto tem criança dentro ou
  QR esperando; a cada 60 s fora disso.
- A nuvem envia texto livre pela Meta com o `phone_number_id` que recebeu a
  mensagem do pai (`enviarTexto` de `@/lib/atendimento/zap.ts`), dentro da
  janela de 24 h aberta por ele. **Nenhum template novo.**
- O número da casa que vai no QR é o `whatsapp_numero` da filial; se a filial
  não tem número próprio (caso da 03 hoje), o primeiro com `atendente_ativo`
  (o da Nina, 5579996749949 / phone_id 1055094051031714).

## 3. Tela `/kids` (vendas-local)

### 3.1 Entrar
- `/kids` pede **login + PIN**, mesma tabela `garcom_pin` e mesmo token
  (`garcomGeraToken`, header `x-garcom`) do garçom/caixa.
- **Não exige permissão de venda no Consumer**: basta `permsDoUsuario(login).ok`
  (login existe e está ativo). Nova função `apiKidsEntrar` (cópia enxuta de
  `apiCaixaEntrar` sem a checagem de `p.caixa`) e `kidsDaRequisicao(req,u)`
  que valida o token e o login.
- Gerente (`ehGerente`) vê a engrenagem de configuração.

### 3.2 Tela principal
- Cabeçalho: "Espaço Kids · <loja> · <hora>" + botão grande **"+ Nova entrada"**.
- Um **cartão por criança dentro** (`saiu_em IS NULL`), ordenado por entrada:
  - Nome da criança (destaque), idade, mesa, responsável (nome curto + últimos
    4 do zap), "há N min" dentro, observação.
  - Selo do zap: ⏳ *aguardando o zap* (botão "mostrar QR de novo") ·
    ✅ *zap confirmado* · ⚠️ *sem zap* (código expirou: 2 h sem confirmação) ·
    ⏳ *sem conexão com a nuvem* (último sync falhou há > 30 s).
  - Botões: **📣 Chamar** (travado enquanto o zap não está confirmado) e
    **🚪 Saiu**.
  - Estado da chamada: "chamado há N min · <motivo>"; resposta do pai como
    balão (texto escapado). Passou `kids_alerta_min` (padrão 5) sem resposta:
    cartão **vermelho** com **Chamar de novo** e **🔔 Avisar o garçom da mesa**.
- Auto-refresh a cada 5 s (`GET /api/kids/estado`).
- Rodapé recolhido "Hoje": crianças que já saíram, com entrada/saída.

### 3.3 Nova entrada (3 passos)
1. **Mesa** (teclado numérico da casa). Se a mesa tem `identificacao` aberta
   (`fechada_em IS NULL`) com telefone, sugere o responsável (nome + zap).
2. **Responsável**: WhatsApp (obrigatório, DDD + número, 10–11 dígitos) e
   nome. Busca do nome: `contatoPorTelefone` (Consumer) → `identificacao`
   (últimos 8 dígitos) → `kids_entrada` anterior. Nome vem preenchido se
   achou; senão a monitora digita.
3. **Crianças**: nome (obrigatório), idade (0–17, opcional), observação
   (opcional, até 200 chars); "+ outra criança".
4. **Confirmar** → `POST /api/kids/entrada` → cria `kids_entrada` + crianças,
   registra na nuvem (`checkin`) e volta com o QR.
5. **Tela do QR**: QR grande (`qrcode-svg`, já dependência) com
   `https://wa.me/<numero>?text=<texto>`, o texto por extenso embaixo, e
   "Aponte a câmera e toque em enviar". Polling do estado; ao confirmar mostra
   "✅ Confirmado · Fulano · (79) 9xxxx-xxxx · o link da câmera já foi pro
   celular dele" e um botão "Voltar pra lista". Botão **"Deixar pra depois"**:
   volta pra lista com o cartão ⏳.
6. **Mesmo responsável de novo no mesmo dia** (a nuvem responde
   `ja_confirmado: true` — mesmo telefone confirmado nas últimas 12 h nessa
   filial): pula o QR, entrada já nasce ✅, e a nuvem manda a mensagem 4 da
   seção 6.

### 3.4 Chamar
- 📣 → escolhe o motivo: `quer_pai` ("quer o pai"), `hora_sair` ("hora de
  sair"), `machucou` ("se machucou, mas está bem"), `outro` (texto curto,
  até 120 chars) → `POST /api/kids/chamar {crianca_id, motivo, texto}`.
- A loja monta o texto (seção 6, msg 3), chama `enviar` na nuvem, grava
  `kids_evento tipo='chamada'` com o texto e o resultado. Erro da Meta →
  evento com `erro`, cartão mostra o erro em vermelho.
- **Trava de toque duplo**: uma chamada por criança a cada 60 s; dentro disso
  o botão fica "enviado ✓" e não reenvia.
- **Chamar de novo**: mesma mensagem com prefixo "📣 Segunda chamada:" (e
  "Terceira…" — conta os eventos de chamada da criança).
- **Avisar o garçom**: `INSERT INTO chamado (mesa, tipo='garcom', origem='kids',
  texto='Kids: buscar <criança>')` + `kids_evento tipo='escalada'`. A barra
  de chamados do garçom (`puxarChamados`) passa a mostrar o `texto` também
  quando `origem==='kids'` (hoje só mostra pra `pedido-cliente`).

### 3.5 Saiu
- 🚪 → confirmação ("Maria saiu? Sim / Não") → `POST /api/kids/saida
  {crianca_id}` → `saiu_em=now()`, `saiu_por=<login>`, `kids_evento
  tipo='saida'`, manda a msg 5 (seção 6). Se era a última criança da entrada,
  chama `enviar` com `encerrar: true` (a nuvem encerra o check-in) e marca
  `kids_entrada.encerrada_em`.

### 3.6 Configuração (gerente)
- `kids_camera_link` (URL do "Share livestream" do Protect; validada como
  `https://`), `kids_alerta_min` (1–30, padrão 5). Em `app_config` via
  `cfgGet/cfgSet`. Mostra, só leitura, o número da casa que veio da nuvem no
  último check-in (`kids_numero_casa`).

## 4. Dados

### 4.1 Loja (Postgres local, criadas no `initSchema` com `CREATE TABLE IF NOT EXISTS` + `addCol`; compatível com Postgres 9.5)

```sql
CREATE TABLE IF NOT EXISTS kids_entrada (
  id bigserial PRIMARY KEY,
  codigo text NOT NULL,                 -- 6 chars de "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  mesa integer,
  responsavel_nome text NOT NULL,
  responsavel_tel varchar(15) NOT NULL, -- digitado, só dígitos
  tel_confirmado varchar(20),           -- o que a Meta viu (com DDI)
  zap_status text NOT NULL DEFAULT 'aguardando',  -- aguardando | confirmado | expirado
  confirmado_em timestamptz,
  criado_em timestamptz DEFAULT now(),
  criado_por text,
  encerrada_em timestamptz,
  nuvem_ok boolean,                     -- checkin registrado na nuvem?
  nuvem_erro text
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_kids_entrada_codigo ON kids_entrada(codigo);
CREATE TABLE IF NOT EXISTS kids_crianca (
  id bigserial PRIMARY KEY,
  entrada_id bigint NOT NULL REFERENCES kids_entrada(id),
  nome text NOT NULL,
  idade integer,
  observacao text,
  entrou_em timestamptz DEFAULT now(),
  saiu_em timestamptz,
  saiu_por text
);
CREATE INDEX IF NOT EXISTS ix_kids_crianca_dentro ON kids_crianca(saiu_em, entrou_em);
CREATE TABLE IF NOT EXISTS kids_evento (
  id bigserial PRIMARY KEY,
  entrada_id bigint NOT NULL,
  crianca_id bigint,                    -- NULL em eventos do responsável (resposta, zap_confirmado)
  tipo text NOT NULL,                   -- chamada | resposta | escalada | saida | zap_confirmado
  motivo text,
  texto text,
  wa_message_id text,                   -- dedupe das respostas vindas da nuvem
  erro text,
  criado_em timestamptz DEFAULT now(),
  por text
);
CREATE INDEX IF NOT EXISTS ix_kids_evento_entrada ON kids_evento(entrada_id, criado_em);
CREATE UNIQUE INDEX IF NOT EXISTS ux_kids_evento_wa ON kids_evento(wa_message_id) WHERE wa_message_id IS NOT NULL;
```

`app_config`: `kids_camera_link`, `kids_alerta_min`, `kids_sync_desde`
(cursor ISO do último sync), `kids_numero_casa`.

### 4.2 Nuvem (Supabase; schema em `packages/db/src/schema/kids.ts`; migration `scripts/migrate-kids.ts`, target `migrate:kids`; **terminar com ENABLE ROW LEVEL SECURITY nas duas**)

```sql
CREATE TABLE IF NOT EXISTS kids_checkin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
  codigo varchar(8) NOT NULL,
  phone_number_id text NOT NULL,        -- número da casa usado no QR
  telefone_digitado varchar(20) NOT NULL,
  telefone_confirmado varchar(20),
  responsavel_nome varchar(160) NOT NULL,
  criancas text NOT NULL,               -- "Maria (6) e João (4)" — pronto pras mensagens
  mesa integer,
  link_camera text,
  status varchar(20) NOT NULL DEFAULT 'aguardando',  -- aguardando | confirmado | encerrado | expirado
  confirmado_em timestamptz,
  encerrado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_kids_checkin_codigo ON kids_checkin(filial_id, codigo);
CREATE INDEX IF NOT EXISTS ix_kids_checkin_tel ON kids_checkin(phone_number_id, telefone_confirmado, status);
CREATE TABLE IF NOT EXISTS kids_mensagem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id uuid NOT NULL REFERENCES kids_checkin(id) ON DELETE CASCADE,
  direcao varchar(10) NOT NULL,         -- entrada (do pai) | saida (da casa)
  texto text NOT NULL,
  wa_message_id text,
  erro text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_kids_mensagem_checkin ON kids_mensagem(checkin_id, criado_em);
ALTER TABLE kids_checkin ENABLE ROW LEVEL SECURITY;
ALTER TABLE kids_mensagem ENABLE ROW LEVEL SECURITY;
```

## 5. Rotas

### 5.1 Loja (`server.mjs`, todas exigem token do PIN via `kidsDaRequisicao`, exceto a página)
| Rota | Faz |
|---|---|
| `GET /kids` | página (HTML inline `KIDS_HTML`, mesmo estilo do `/caixa`) |
| `POST /api/kids/entrar` | login+PIN → token |
| `GET /api/kids/sessao` | "ainda estou logado?" + `gerente` |
| `GET /api/kids/estado` | crianças dentro (com entrada, último evento de chamada, resposta posterior, `alerta` calculado), quem saiu hoje, config, status do sync |
| `GET /api/kids/sugerir?mesa=N&tel=…` | responsável sugerido pela mesa / nome pelo telefone |
| `POST /api/kids/entrada` | cria entrada + crianças, gera código, chama `checkin` na nuvem; devolve `{entrada_id, codigo, qr_svg, wa_url, texto_qr, zap_status}` |
| `POST /api/kids/qr-novo` | `{entrada_id}` — código novo (expirado/perdido), novo checkin na nuvem |
| `POST /api/kids/crianca` | `{entrada_id, nome, idade, observacao}` — irmão que chegou depois |
| `POST /api/kids/chamar` | `{crianca_id, motivo, texto?}` |
| `POST /api/kids/escalar` | `{crianca_id}` → chamado de garçom |
| `POST /api/kids/saida` | `{crianca_id}` |
| `POST /api/kids/config` | gerente: `{camera_link, alerta_min}` |

Sync (loop interno `kidsSyncLoop`, não é rota): `GET …/api/loja/kids/sync?desde=`
→ para cada confirmação: `UPDATE kids_entrada SET zap_status='confirmado',
tel_confirmado, confirmado_em` + evento `zap_confirmado`; para cada mensagem
do pai: evento `resposta` (dedupe por `wa_message_id`). Cursor avança pro
`agora` que a nuvem devolveu. Falhou → guarda `kids_sync_erro_em` em memória
(o `estado` expõe `nuvem_ok:false` se > 30 s).

Expiração local: `kids_entrada` aguardando há > 2 h → `zap_status='expirado'`
(feita no `estado`, idempotente).

### 5.2 Nuvem (`apps/web/src/app/api/loja/kids/{checkin,sync,enviar}/route.ts`)
Assinatura: `s = HMAC_SHA256(PAGAR_MESA_SECRET, [f, 'kids', e].join('|'))`,
`e` = epoch + 120 s. Validação idêntica ao `/cliente-documento` (`timingSafeEqual`,
expira, filial existe). Sem `PAGAR_MESA_SECRET` (≥16 chars) → 403.

| Rota | Entrada | Saída |
|---|---|---|
| `POST checkin` | `{f,e,s, codigo, telefone, responsavel, criancas:[{nome,idade}], mesa, link_camera}` | `{ok, numero_casa, phone_number_id, ja_confirmado, telefone_confirmado?}`. Escolhe o número da casa (§2). Se o mesmo `telefone` (últimos 8 dígitos) tem checkin `confirmado` nessa filial nas últimas 12 h: cria já `confirmado` com o mesmo `telefone_confirmado`, manda msg 4 e devolve `ja_confirmado:true`. Código repetido na filial → 409 (a loja gera outro e tenta de novo, até 3×). |
| `GET sync?f&e&s&desde=<ISO>` | — | `{ok, agora, confirmados:[{codigo, telefone, confirmado_em}], mensagens:[{codigo, texto, wa_message_id, criado_em}]}` — só checkins da filial com `confirmado_em >= desde` e mensagens `direcao='entrada'` com `criado_em >= desde`. Janela máxima de 48 h. |
| `POST enviar` | `{f,e,s, codigo, texto, encerrar?}` | `{ok, wa_message_id}` ou `{ok:false, erro}`. Exige checkin `confirmado`. Envia com `enviarTexto(phone_number_id, telefone_confirmado, texto)`, grava `kids_mensagem saida`. `encerrar:true` → `status='encerrado', encerrado_em=now()` (mesmo se o envio falhar). |

### 5.3 Webhook (`/api/whatsapp/webhook`, dentro do loop de `messages`, ANTES de `tratarPayload`/`tratarMensagemComum`)
Nova função `tratarKids(msg, phoneNumberId)` → `true` se consumiu:
1. `msg.type==='text'` e o corpo casa `/kids[\s\S]*c[oó]digo\s*[:\-]?\s*([A-Z0-9]{6})/i`
   → busca `kids_checkin` (`phone_number_id`, `codigo` = grupo em maiúsculas,
   `status='aguardando'`, `criado_em > now()-2h`). Achou: `status='confirmado'`,
   `telefone_confirmado=msg.from`, `confirmado_em=now()`; grava
   `kids_mensagem entrada`; responde msg 2 (seção 6) via `enviarTexto`; grava
   `kids_mensagem saida`. Retorna `true`. Não achou (código velho/errado):
   responde "Não achei esse código. Peça pra monitora mostrar o QR de novo."
   e retorna `true` (a Nina não deve tentar interpretar isso).
2. Senão, se existe `kids_checkin` com `phone_number_id`, `telefone_confirmado=msg.from`,
   `status='confirmado'` e `confirmado_em > now()-24h`: grava `kids_mensagem
   entrada` com o texto (áudio/imagem → "🎤 áudio" / "📷 imagem", sem baixar
   mídia) e retorna `true`. **A Nina fica quieta com esse número enquanto o
   check-in está ativo.** Dedupe pelo `wa_message_id` (índice único parcial
   em `kids_mensagem(wa_message_id)`).
3. Senão retorna `false` e o fluxo de hoje segue igual.

Reações/figurinhas de número ativo: consome sem gravar (retorna `true`).

## 6. Mensagens (texto livre; `<nome>` = nome curto do responsável, como `nomeCurto`)

1. **Texto pronto do QR** (a loja monta; `<loja>` = nome da filial sem "0003"):
   `Kids <loja> · mesa <N> · código <CODIGO>` (sem mesa: `Kids <loja> · código <CODIGO>`)
2. **Confirmação automática** (nuvem, webhook):
   ```
   ✅ Pronto, <nome>! <criancas> está no Espaço Kids do <loja>, mesa <N>, desde <HH:MM>.
   📹 Veja o espaço ao vivo: <link>
   Quando a monitora precisar de você, avisamos por aqui. Se quiser falar com ela, é só responder esta mensagem.
   ```
   Duas crianças: "Maria (6) e João (4) estão…" (concordância pelo número).
   Sem `link_camera`: a linha 📹 some. Sem mesa: ", mesa <N>" some.
3. **Chamada** (loja monta, nuvem envia):
   ```
   📣 <nome>, a monitora do Espaço Kids pede pra você vir buscar a <criança> (mesa <N>).
   Motivo: <quer o pai | hora de sair | se machucou, mas está bem | texto da monitora>
   Pode responder por aqui que ela vê na tela.
   ```
   Repetição: prefixo "📣 Segunda chamada: " / "📣 Terceira chamada: " (a partir da 4ª, "📣 Nova chamada: ").
4. **Entrou de novo / irmão** (nuvem, no `checkin` com `ja_confirmado`, ou loja via `enviar` ao adicionar criança):
   `✅ <criança> (<idade>) entrou no Espaço Kids às <HH:MM>, mesa <N>.`
5. **Saída** (loja via `enviar`):
   `🚪 <criança> saiu do Espaço Kids às <HH:MM>. Obrigado pela confiança!`
6. **Código não achado** (webhook): `Não achei esse código. Peça pra monitora mostrar o QR de novo.`

Horários em BRT (a nuvem usa os helpers de `@/lib/datas`; a loja usa o relógio local da máquina).

## 7. Erros e casos de borda

| Situação | Comportamento |
|---|---|
| Loja sem internet | Entrada, QR, Saiu e diário funcionam. `nuvem_ok=false` → selo "sem conexão com a nuvem". `checkin` falhou → `nuvem_ok=false, nuvem_erro`; o sync loop **reenvia o checkin** das entradas com `nuvem_ok IS NOT TRUE` e `zap_status='aguardando'` a cada ciclo até conseguir. |
| Pai não manda o zap | Cartão ⏳, Chamar travado. 2 h → `expirado`, selo ⚠️; "mostrar QR de novo" gera código novo (`qr-novo`). |
| Pai manda de outro celular | Vale o `from` da Meta (`tel_confirmado`); o digitado fica só como registro. |
| Meta recusa (janela fechada, bloqueio, número inválido) | `enviar` devolve `erro`; evento de chamada com `erro`; cartão vermelho "WhatsApp recusou: <erro curto>" + botões Chamar de novo / Avisar o garçom. Janela fechada (erro 131047): também reabre o QR. |
| Toque duplo em Chamar | 1 chamada / criança / 60 s. |
| Código repetido | Único por filial na nuvem e único na loja; gera de novo até 3×. |
| Mesa sem número | Permitido (`mesa NULL`); mensagens omitem a mesa. |
| Segunda criança do mesmo responsável | `crianca` na entrada existente (o tablet oferece "adicionar criança" ao digitar um zap que tem entrada ativa). |
| Responsável com criança dentro e a monitora dá "Saiu" na última | `encerrar` → Nina volta a atender esse número. |
| Nuvem devolve confirmação de código que a loja já marcou | idempotente (UPDATE sem efeito). |
| Dois tablets ao mesmo tempo | Estado está no servidor; ambos veem o mesmo a cada 5 s. |

## 8. Segurança e privacidade
- `/api/kids/*` só com token do PIN (`x-garcom`), como caixa/garçom.
- Rotas da nuvem só com HMAC + expiração de 2 min + `timingSafeEqual`; RLS ligado nas tabelas novas.
- Telefone do pai viaja no **corpo** assinado (POST) — nunca em URL.
- Texto do pai é **dado**: escapado na tela (`esc`), nunca interpretado.
- O link do Protect é público por natureza (decisão do dono); só é enviado a quem tem criança dentro.

## 9. Testes
1. `pnpm --filter @concilia/web typecheck`.
2. Webhook: POST de payloads no formato da Meta contra produção com um checkin de teste real (o webhook não valida assinatura): código certo → confirmado + resposta; código errado → msg 6; texto de número confirmado → `kids_mensagem entrada`, Nina não responde; número comum → fluxo antigo intacto. Limpar os registros de teste depois.
3. Rotas da nuvem: assinatura válida (200), inválida/expirada (403), código repetido (409), `enviar` em checkin não confirmado (erro).
4. `server.mjs` no Mac (Postgres local): fluxo completo na tela pelo navegador — entrada com 2 crianças, QR, "deixar pra depois", chamar (travado antes de confirmar), simular confirmação via nuvem, chamar com cada motivo, alerta vermelho (config 1 min), chamar de novo, escalar (aparece na barra do garçom em `/venda`), saída e encerramento.
5. **Teste real na Prainha Mar com o celular do dono** (check-in, zap, link, chamada, resposta na tela, saída). Critério de pronto.

## 10. Deploy
1. Nuvem: `schema/kids.ts` + `migrate-kids.ts` + target no `package.json` → `pnpm --filter @concilia/db migrate:kids` → typecheck → commit + push `main` (Vercel).
2. Loja: `vendas-local/server.mjs` → cópia em `apps/web/public/agente-release/vendas-local-server.mjs` no mesmo push. Na Mar (0003) a tarefa de auto-update ainda não está instalada: entregar ao dono o comando PowerShell **completo** de atualização (padrão de `deploy-vendas-local-powershell`), publicando **uma sessão de cada vez** e conferindo antes que nada de outra sessão sumiu do arquivo.
3. Pós-deploy: gerente abre `/kids` → engrenagem → cola o link "Share livestream" do Protect. Opcional: linha em `whatsapp_numero` pra filial 03 ter número próprio.

## 11. Fora de escopo (decidido)
- Foto da criança, vídeo transcodificado (HLS), regra de idade máxima, limite de tempo dentro do kids, cobrança, relatório na nuvem, notificação por template quando a janela de 24 h fecha.

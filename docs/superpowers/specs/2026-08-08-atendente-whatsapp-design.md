# Nina — atendente virtual no WhatsApp (Prainha / Tabuará)

**Data:** 2026-08-08 · **Status:** aprovado pelo Elison (conversa 08/08) · **Fase desta spec:** Fase 1

## Objetivo

Atender no WhatsApp quem procura o Prainha Bar e o Tabuará, conversando como
gente (sem menu "digite 1"), tirando dúvidas com as informações oficiais da
casa (horários, localização, AquaArena, entrada, estacionamento, cardápio,
áreas) e vendendo os espaços de evento (gramado, terraço, varandinha) — com
preços, coleta de dados do interessado e registro de lead. Tudo acompanhável e
corrigível pelo Elison num painel dentro do Concilia.

## Decisões tomadas (com o Elison, 08/08)

1. **Número:** o atendente responde no número público do Prainha,
   **(79) 99600-7289**, que será migrado pra Cloud API da Meta (Fase 2). O
   número deixa de funcionar no app do celular; respostas manuais passam pro
   painel. Tabuará entra depois com o número próprio (Fase 3).
2. **Quando não sabe / cliente pede pessoa:** transfere — pausa o bot naquela
   conversa e notifica a equipe no WhatsApp com resumo. Equipe responde pelo
   painel.
3. **Eventos:** o bot **informa preços e condições** cadastrados no painel,
   coleta tipo de evento, dia, horário, nº de pessoas e nome, registra lead e
   avisa a equipe. Espaço sem preço preenchido → apresenta o espaço e diz que a
   equipe confirma o valor. Nunca inventa preço.
4. **Supervisão:** painel completo — conversas ao vivo, assumir/devolver
   conversa, edição da base de conhecimento e dos espaços/preços.
5. **Nome:** **Nina** (configurável no painel).
6. **Honestidade:** conversa natural como uma pessoa, mas se perguntarem se é
   robô, não mente — diz que é a atendente virtual da casa e oferece chamar a
   equipe. (Confiança do cliente + política da Meta.)

## O que já existe e será reaproveitado

- WABA Meta com webhook `/api/whatsapp/webhook` (GET verify + POST) recebendo
  mensagens; hoje só trata botões (reserva/pedido) e ignora texto livre.
- `enviarTextoWhatsApp()` em `apps/web/src/lib/whatsapp-otp.ts` — texto livre
  dentro da janela de 24h (que abre quando o cliente manda mensagem).
- `OPENAI_API_KEY` em produção (usada no OCR de boleto) — reaproveitada pro
  motor de resposta e transcrição de áudio. Modelo econômico, configurável por
  env; abstração num módulo único permite trocar de provedor depois.
- Painel Concilia: multi-filial, permissões (`exigir-perm`), padrão de páginas.
- Conteúdo do site prainhabar.com pra semear a base de conhecimento.

## Arquitetura — fluxo da mensagem

```
Cliente manda msg → Meta → POST /api/whatsapp/webhook
  1. Botão de template (confirmar/cancelar/ped_ok/ped_nao)? → fluxo atual, inalterado.
  2. value.statuses? → atualiza status de entrega das mensagens enviadas.
  3. Mensagem comum: busca whatsapp_numero pelo value.metadata.phone_number_id.
     Não mapeado ou atendente inativo → ignora (comportamento atual).
  4. Dedupe: INSERT atendimento_mensagem com wa_message_id ON CONFLICT DO NOTHING
     (Meta reenvia eventos). Conflito → para.
  5. Upsert atendimento_conversa (filial+telefone), atualiza nome, não-lidas,
     ultima_msg_cliente_em. Conversa 'encerrada' que recebe mensagem nova
     reabre como 'bot'; conversa 'humano' permanece 'humano' (equipe cuidando).
  6. Áudio → baixa mídia da Meta e transcreve (OpenAI); corpo = transcrição.
  7. Responde 200 imediato; geração roda depois (after() do Next — conferir
     docs em node_modules/next/dist/docs antes de codar).
  8. Debounce ~6s: espera; se chegou mensagem mais nova nessa conversa, aborta
     (a mais nova é quem gera). Evita responder mensagem picada.
  9. conversa.status='humano' ou config.ativo=false → não gera resposta.
 10. Gera resposta (LLM + persona + conhecimento + ferramentas), envia pelo
     phone_number_id da conversa, salva saída com o wa_message_id retornado.
```

## Modelo de dados (migrations manuais, padrão do repo)

**`whatsapp_numero`** — mapeia número Meta → filial.
`phone_number_id` (text, PK) · `filial_id` (FK) · `numero_exibicao` ·
`atendente_ativo` (bool, default false) · `criado_em`

**`atendimento_conversa`** — um registro por contato por filial.
`id` · `filial_id` · `telefone` (só dígitos, com DDI) · `nome_cliente` (profile
do zap) · `status` ('bot' | 'humano' | 'encerrada', default 'bot') ·
`motivo_transferencia` · `ultima_msg_cliente_em` (controla janela 24h) ·
`ultima_msg_em` · `nao_lidas` (int) · `criado_em` · `atualizado_em` ·
unique(filial_id, telefone)

**`atendimento_mensagem`** — transcript completo.
`id` · `conversa_id` · `wa_message_id` (unique, dedupe) · `direcao`
('entrada'|'saida') · `autor` ('cliente'|'bot'|'equipe'|'sistema') ·
`autor_usuario_id` (quando equipe) · `tipo` ('texto'|'audio'|'imagem'|
'video'|'documento'|'botao'|'outro') · `corpo` (texto ou transcrição) ·
`media_id` · `status_envio` ('pendente'|'enviada'|'entregue'|'lida'|'erro') ·
`erro` · `criado_em` · index(conversa_id, criado_em)

**`atendimento_config`** — 1 linha por filial.
`filial_id` (PK/FK) · `ativo` (bool) · `nome_atendente` (default 'Nina') ·
`persona` (texto editável de tom) · `conhecimento` (jsonb:
`[{id, titulo, conteudo, atualizadoEm}]`) · `espacos_evento` (jsonb:
`[{id, nome, capacidade, descricao, preco, condicoes, ativo}]`) ·
`numeros_equipe` (jsonb: telefones que recebem avisos) · `atualizado_em`

**`evento_lead`** — pedidos de orçamento de evento.
`id` · `filial_id` · `conversa_id` · `nome` · `telefone` · `tipo_evento` ·
`data_evento` (date) · `hora` · `pessoas` (int) · `espaco` · `observacoes` ·
`status` ('novo'|'em_contato'|'fechado'|'perdido', default 'novo') ·
`criado_em` · `atualizado_em`

## Motor de resposta

- **Contexto:** persona (nome + instruções de tom editáveis) + blocos de
  conhecimento + espaços de evento + regras fixas + últimas ~30 mensagens da
  conversa.
- **Regras fixas (system prompt):** mensagens curtas (1–3 frases), PT-BR
  natural, no máx. 1 emoji por mensagem, sem listão e sem robotês; só afirma o
  que está na base — dúvida que a base não cobre → transferir; perguntou se é
  robô → se apresenta como atendente virtual e oferece a equipe; eventos:
  coleta os dados ao longo da conversa (sem interrogatório) e registra o lead
  quando tiver o essencial (tipo + data aproximada + nº de pessoas); reserva de
  mesa → manda o link do site; nunca pede dado sensível nem trata pagamento.
- **Ferramentas (function calling):**
  - `registrar_lead_evento(tipo, data, hora, pessoas, espaco, nome, observacoes)`
    → INSERT em `evento_lead` + aviso à equipe.
  - `transferir_para_humano(motivo, resumo)` → conversa vira 'humano' + aviso à
    equipe. Bot responde despedida curta ("vou chamar alguém da equipe 👍").
- **Áudio de cliente:** transcreve e trata como texto. Falhou a transcrição →
  resposta gentil pedindo por escrito.
- **Imagem/vídeo/documento:** v1 não interpreta — grava no transcript e o bot
  avisa que não consegue ver mídia por aqui, pede em texto.
- **Modelo:** módulo único `apps/web/src/lib/atendimento/ia.ts` com a chamada;
  modelo por env (`ATENDIMENTO_MODELO`, default econômico da OpenAI). Trocar de
  provedor = mexer só nesse módulo.

## Persona semente da Nina (ditada pelo Elison, 08/08 — editável no painel)

Nina é doce, amável e super educada, de fala meiga; sempre compreende e acolhe
as pessoas com quem conversa. Acredita que as pessoas podem sempre muito mais,
e que toda festa e confraternização é uma coisa especial que deve ser
valorizada. Esse texto entra como valor inicial do campo `persona` em
`atendimento_config` e orienta o tom em toda resposta (junto com as regras
fixas, que continuam valendo — ex.: honestidade sobre ser atendente virtual).

## Base de conhecimento — semente inicial (Prainha)

Horário 9h–18h todos os dias (pôr do sol ~16h+) · Endereço: Estr. Matapoã,
2288 — Matapoã (Parque Santo Antonio), Aracaju-SE, foz do Vaza-Barris ·
Estacionamento coberto gratuito · Entrada/couvert: **Elison confirma no
painel** · AquaArena: status/preços **Elison confirma no painel** (site diz
"reabertura prevista julho/2026") · Cardápio: prainha.menudino.com.br
(destaques: Camarão Paris, moqueca, picanha Angus, drink Prainha Sunset) ·
Música ao vivo · Reservas de mesa: link do site · Espaços de evento: gramado
(casamentos, ar livre), terraço (fechado no dia a dia; eventos com ~50
sentadas), varandinha (15–20 pessoas) · Instagram @prainha.se · A validação
final do conteúdo é do Elison, no painel — é assim que ele "corrige" a Nina.

## Painel (menu "Atendimento" no Concilia)

- **`/atendimento`** — lista de conversas (filial, não-lidas, status, última
  mensagem) + chat com transcript (bolhas cliente/Nina/equipe), atualização por
  polling ~5s. Ações: **Assumir** (status→'humano'), **Devolver pra Nina**
  (status→'bot'), **Encerrar**. Caixa de resposta da equipe: envia texto livre
  se dentro da janela de 24h; fora dela, bloqueia e explica.
- **`/atendimento/config`** — ligar/desligar por filial, nome/persona, blocos
  de conhecimento (título + texto), espaços de evento (com preço/condições),
  números da equipe pra avisos, números conectados (whatsapp_numero).
- **`/atendimento/eventos`** — leads com status (novo → em contato →
  fechado/perdido) e link pra conversa de origem.
- **Permissões:** códigos novos `atendimento.view`, `atendimento.respond`,
  `atendimento.config` (guards `exigirPermPage`/`exigirPermApi`, padrão do
  repo).

## Avisos à equipe (handoff e lead)

Template UTILIDADE novo, `atendimento_aviso`, corpo genérico:
"Olá! {{1}}. Cliente: {{2}} ({{3}}), no WhatsApp do {{4}}. Responda pelo
painel: app.prainhabar.com/atendimento" — {{1}} = motivo/resumo curto, {{2}}
nome, {{3}} telefone, {{4}} filial. Um template só cobre transferência e lead
novo. Envio best-effort pros `numeros_equipe`; enquanto o template não for
aprovado na Meta, o painel destaca a conversa pendente (badge/ordenação) e nada
quebra.

## Tratamento de erros

- Webhook **sempre responde 200** (padrão atual — evita replay infinito da Meta).
- Dedupe por `wa_message_id` cobre reenvios.
- LLM falhou (2 tentativas): envia "já te respondo 😉", marca conversa
  pendente (destaque no painel), registra erro na mensagem.
- Envio falhou: `status_envio='erro'` + `erro` gravado, visível no transcript.
- Resposta da equipe fora da janela de 24h: bloqueada na UI com explicação.
- Transcrição de áudio falhou: pede por escrito, mídia fica gravada.

## Custos estimados

IA: ~R$0,05–0,15/conversa (dezenas de reais/mês no volume esperado).
WhatsApp: respostas dentro da janela de 24h grátis; avisos à equipe via
template = centavos. Sem mensalidade nova.

## Fase 2 — migração do número público (checklist ops, executar só após Fase 1 aprovada)

1. Backup do histórico no celular atual, se desejado (será perdido no aparelho).
2. Business Manager → adicionar (79) 99600-7289 na **mesma WABA** (templates
   valem pra qualquer número dela).
3. No celular: WhatsApp → apagar conta (libera o número da app).
4. Registrar o número na Cloud API (verificação SMS/ligação), PIN 2FA, display
   name "Prainha Bar".
5. Cadastrar o novo `phone_number_id` em `whatsapp_numero` → filial Prainha,
   `atendente_ativo=true`.
6. Testar ponta a ponta; fazer fora de pico. Fluxos internos (cotação, pedido,
   lembrete de reserva) **continuam no número interno atual** — nada muda neles.

**Fase 3:** repetir pro número do Tabuará → filial Tabuará, com base de
conhecimento própria.

## Testes (Fase 1)

- `pnpm --filter @concilia/web typecheck` sempre antes de commit.
- Simulação local do webhook via curl: texto, áudio, botão de reserva (regressão
  do fluxo atual), status de entrega, evento duplicado (dedupe), mensagens
  picadas (debounce).
- Teste real no padrão da casa: número interno já integrado + celular do Elison
  (79 99972-4554) conversando de verdade — dúvidas, evento com preço, pedir
  humano, áudio. Painel: assumir/devolver, editar conhecimento e ver a resposta
  mudar. Limpar dados de teste depois.

## Fora do escopo (v1) / Futuro

Criar ou consultar reserva de mesa dentro da conversa (v1 manda o link) ·
resumo diário no zap do Elison · interpretar imagens · tempo real por
websocket (v1 é polling) · coexistência app+API da Meta (beta) · catálogo /
pagamento no WhatsApp.

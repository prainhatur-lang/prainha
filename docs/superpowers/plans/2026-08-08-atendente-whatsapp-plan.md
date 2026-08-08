# Plano de implementação — Nina (Fase 1)

Spec: `docs/superpowers/specs/2026-08-08-atendente-whatsapp-design.md`.
Convenções do repo valem (migrations manuais, typecheck antes de commit,
push direto no main, helpers de data BRT).

## Passo 1 — Schema Drizzle

`packages/db/src/schema/atendimento.ts` com:
`whatsappNumero` (phone_number_id PK text, filial_id, numero_exibicao,
atendente_ativo) · `atendimentoConversa` (unique filial+telefone; status
bot|humano|fornecedor|encerrada; ultima_msg_cliente_em; nao_lidas) ·
`atendimentoMensagem` (wa_message_id unique nullable; direcao; autor;
tipo; corpo; media_id; status_envio; erro; index conversa+criado_em) ·
`atendimentoConfig` (filial_id PK; ativo; nome_atendente; persona;
conhecimento jsonb; espacos_evento jsonb; numeros_equipe jsonb) ·
`eventoLead` (status novo|em_contato|fechado|perdido). Tipos jsonb
exportados. Export em `schema/index.ts`.

## Passo 2 — Migration + seed

`packages/db/scripts/migrate-atendimento.ts` (padrão do repo: idempotente,
`DATABASE_URL_DIRECT`): CREATE TABLE IF NOT EXISTS ×5 + índices; INSERT
das permissões `atendimento.read|responder|config` no catálogo (tabela
`permissao`) + vínculo aos grupos sistema Admin e Gerente (ON CONFLICT DO
NOTHING); seed `whatsapp_numero` (1055094051031714 → filial Prainha,
`atendente_ativo=false`); seed `atendimento_config` da Prainha (persona
ditada pelo Elison, blocos de conhecimento do site, espaços gramado/
terraço/varandinha sem preço). Adicionar `atendimento.read/responder/
config` também em `packages/db/src/catalogo-permissoes.ts` (Admin pega
tudo; Gerente pega por não ser configuracao/usuario/grupo). Target
`migrate:atendimento` no package.json. **Rodar a migration.**

## Passo 3 — Lib do atendente (`apps/web/src/lib/atendimento/`)

- `zap.ts` — token (`WHATSAPP_TOKEN||WHATSAPP_META`), `enviarTexto(phoneId,
  para, corpo)` → wa_message_id; `marcarLida(phoneId, waMsgId)` (com typing
  indicator, best-effort); `baixarMidia(mediaId)` → {buffer, mime}.
- `transcrever.ts` — OpenAI transcriptions (áudio ogg do zap → texto).
- `ia.ts` — `gerarResposta({config, filialNome, historico, agoraBrt})` via
  chat completions (modelo `ATENDIMENTO_MODELO` default gpt-4o-mini), tools
  `registrar_lead_evento` e `transferir_para_humano`, loop máx 3; retorna
  `{texto, lead?, transferencia?}`.
- `motor.ts` — `processarEntrada(...)`: dedupe já feito no webhook; guard
  fornecedor (sufixo 8 dígitos vs fone_principal/secundario, qualquer
  filial); upsert conversa (encerrada→bot; humano/fornecedor não geram);
  debounce 6s (aborta se chegou msg mais nova); monta histórico (30 msgs),
  chama ia, executa ações (INSERT evento_lead; UPDATE conversa→humano),
  avisa equipe, envia resposta, salva saída. Erro LLM → fallback "já te
  respondo 😉" + conversa destacada.
- `avisos.ts` — `avisarEquipe(cfg, {motivo, nome, fone, filial})` via
  template `WHATSAPP_AVISO_TEMPLATE` (se setada; senão no-op silencioso).

## Passo 4 — Webhook

`api/whatsapp/webhook/route.ts`: manter GET e botões intocados; adicionar
`export const maxDuration = 60`; tratar `value.statuses` (entregue/lida/
falha → update por wa_message_id); mensagens sem payload de botão → salvar
entrada (dedupe ON CONFLICT) e agendar `after(() => processarEntrada(...))`
quando o `metadata.phone_number_id` estiver em `whatsapp_numero`.

## Passo 5 — APIs do painel (guards exigirPermApi)

`/api/atendimento/conversas` GET (lista, filtro filial/status) ·
`/api/atendimento/conversas/[id]` GET (mensagens; `?ler=1` zera não-lidas)
e PATCH (status assumir/devolver/encerrar) [read p/ GET, responder p/
PATCH] · `/api/atendimento/conversas/[id]/responder` POST (valida janela
24h; envia; salva autor equipe) [responder] · `/api/atendimento/config`
GET/PUT (config + números; PUT liga/desliga atendente_ativo) [config] ·
`/api/atendimento/eventos` GET, `[id]` PATCH status [read/responder].

## Passo 6 — Páginas + nav

`/atendimento` (client: 2 colunas, lista + chat, polling 5s, assumir/
devolver/encerrar, composer com aviso de janela 24h) · `/atendimento/
config` (persona, conhecimento em blocos, espaços com preço, números da
equipe, toggle ativo, números conectados) · `/atendimento/eventos` (leads
com status). Grupo "Atendimento" no `app-nav.tsx` (perm `atendimento.read`;
link de config com `atendimento.config`). Estilo: seguir páginas existentes
(Tailwind slate, tabelas simples).

## Passo 7 — Verificação

`pnpm --filter @concilia/web typecheck` · commit + push (deploy Vercel) ·
GET do webhook verify em prod · abrir painel · teste real: ligar o toggle e
Elison conversa com a Nina do celular dele (dúvida, evento, pedir humano,
áudio) · ajustar persona/KB conforme o teste · limpar dados de teste.

## Riscos conhecidos

Timeout Vercel (mitigado com maxDuration=60 + after) · resposta dupla se a
Meta reentregar (mitigado pelo unique wa_message_id) · fornecedor com fone
formatado (guard por sufixo de 8 dígitos) · template de aviso ainda não
aprovado (avisos viram no-op; painel continua mostrando pendências).

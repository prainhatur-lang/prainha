// Vendas local-first — KDS por ÁREA, em DUAS telas: Produção e Entrega.
//   node server.mjs   ->   http://localhost:8790
//
// /          = PRODUÇÃO: escolhe a área (estação) e vê os itens A PRODUZIR.
//              a estação marca "Pronto" (por item ou a comanda toda da área).
// /entrega   = ENTREGA (global): comandas com itens PRONTOS aguardando entrega.
//              o corredor marca "Entregue".
//
// Areas = tabela COZINHAS do Consumer; roteamento = PRODUTOS.CODIGOCOZINHA.
// Firebird = SÓ LEITURA (espelho). Os toques (pronto/entregue) gravam no
// Postgres local, na tabela `marca`, chaveada por ITENSPEDIDO.CODIGO (estável).

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createHmac, createHash, generateKeyPairSync, sign, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync, createReadStream, statSync,
  readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import Firebird from 'node-firebird';
import postgres from 'postgres';
import QRCode from 'qrcode-svg';

// Config por variável de ambiente. Defaults = desenvolvimento no Mac (VPN).
// Na LOJA (Xeon), o start.bat define FB_HOST=127.0.0.1 e PG_URL do Postgres local.
const FB = {
  host: process.env.FB_HOST || '10.0.0.252',
  port: Number(process.env.FB_PORT || 3050),
  database: process.env.FB_DATABASE || 'C:\\Users\\Administrator\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\consumer.fdb',
  user: process.env.FB_USER || 'SYSDBA',
  password: process.env.FB_PASSWORD || 'masterkey',
  lowercase_keys: false, pageSize: 4096 };
const sql = process.env.PG_URL ? postgres(process.env.PG_URL) : postgres({ host: '/tmp', port: 5432, database: 'vendas_local' });
const PORT = Number(process.env.PORT || 8790);
// Porta que o APP da maquininha usa (sempre 8790 por convenção; na 0001 a PORT
// principal é 8080 e o 8790 vem no PORT_EXTRA). É a que vai no `lan` do config.
const APP_PORT = (PORT === 8790 || String(process.env.PORT_EXTRA || '').split(',').map((x) => Number(x.trim())).includes(8790)) ? 8790 : PORT;
// A versão precisa existir ANTES dos blocos HTML: a tela do cliente carimba
// ela na página pra saber quando o servidor mudou. Declarada depois, dava
// "Cannot access 'VERSAO' before initialization" e o processo morria na partida.
const VERSAO = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex').slice(0, 8);
const INTERVALO_MS = 15000;
// Janela de comandas do espelho. CURRENT_DATE = só o dia de HOJE (a partir de 00:00).
// Se de madrugada faltar a virada (comanda aberta ontem à noite ainda aberta), trocar por:
//   DATEADD(-16 HOUR TO CURRENT_TIMESTAMP)   (janela rolante de 16h, como o Consumer usa)
// Janela do espelho. Era CURRENT_DATE puro, e isso apagava a casa inteira à
// meia-noite: mesa aberta 23:30 sumia do KDS às 00:01, com item ainda na
// cozinha. Num bar que fecha 2h da manhã isso acontece TODA noite.
//
// ⚠️ POR QUE 7 DIAS E NÃO 1: a conta que o Consumer mantém aberta numa mesa
// pode ser bem mais velha que a noite. Quando isso acontece, o pedido novo é
// ANEXADO nela (fbAcharPedido acha a aberta) — e se a janela não alcançar a
// data de abertura, o item entra no banco e NÃO APARECE em lugar nenhum: nem
// no KDS, nem no "o que já pedi". Foi exatamente isso na 0003: pedido gravado
// certo numa conta de 2 dias antes, e a tela vazia. Uma janela curta não
// esconde o problema, esconde a única pista dele.
//
// Conta aberta há mais de uma semana é sujeira pra loja fechar, não coisa
// pro sistema adivinhar. ESPELHO_DIAS=0 volta ao comportamento antigo.
const ESPELHO_DIAS = Number(process.env.ESPELHO_DIAS ?? 7);
const DESDE = ESPELHO_DIAS > 0 ? `CURRENT_DATE - ${ESPELHO_DIAS}` : 'CURRENT_DATE';
const LIMITE_ATRASO_MIN = 15; // fallback: praça sem tempo configurado em praca_config
// Prato PRONTO não pode envelhecer no passe: 3 min é o limite da casa (dono,
// 19/08). Muda em cfg 'entrega_min' sem precisar de deploy.
const LIMITE_ENTREGA_MIN = 3;
// Uma comanda do Consumer é a MESA INTEIRA da noite — dois lançamentos
// separados caem no mesmo PEDIDOS.CODIGO. Pra cozinha isso é errado: o que
// já foi mandado não pode crescer depois. Itens com intervalo maior que isso
// viram uma VIA nova, como se fosse outro papel na impressora.
const RODADA_GAP_SEG = Number(process.env.RODADA_GAP_SEG || 90);
// ---- NUMERAÇÃO DE MESA E COMANDA — muda de loja pra loja ----
// Mesa = ONDE entregar; comanda = DE QUEM é. Uma mesa pode ter várias comandas.
//
//   Prainha Bar .. mesas até 299 + comanda individual (o cartão da PESSOA) 300–400
//   Tabuará ...... só mesa, 1 a 50 — comanda individual não existe lá, e a
//                  tabela de vínculo PEDIDOMESAS está vazia (0 registros)
//
// Pra desligar a comanda numa loja: COMANDA_MIN=0 (e ajuste MESA_MAX).
const COMANDA_MIN = Number(process.env.COMANDA_MIN ?? 300);
const COMANDA_MAX = Number(process.env.COMANDA_MAX ?? 400);
const COMANDA_ATIVA = COMANDA_MIN > 0 && COMANDA_MAX >= COMANDA_MIN;
// Limiar de "isto é comanda ou mesa?". Com a comanda desligada vira Infinity,
// então nenhum número alcança e tudo é tratado como mesa.
const COMANDA_DE = COMANDA_ATIVA ? COMANDA_MIN : Infinity;
// Maior número de MESA aceito.
const MESA_MAX = Number(process.env.MESA_MAX ?? (COMANDA_ATIVA ? COMANDA_MIN - 1 : 299));
// Teto de QUALQUER número válido (mesa ou comanda) — usado nas validações.
const NUMERO_MAX = COMANDA_ATIVA ? COMANDA_MAX : MESA_MAX;
// Nome da casa, pros títulos e telas do cliente.
const LOJA_NOME = process.env.LOJA_NOME || 'Prainha Bar';
// A última palavra sai em destaque, como era o "Prainha <b>Bar</b>".
const LOJA_HTML = (() => {
  const p = LOJA_NOME.trim().split(/\s+/);
  return p.length > 1
    ? p.slice(0, -1).join(' ') + ' <b>' + p[p.length - 1] + '</b>'
    : '<b>' + LOJA_NOME + '</b>';
})();
const VENDA_ORIGEM_FB = 3; // origem do pedido gravado no Consumer (3 = Cardápio Digital, caminho validado 13/06)

const ORIGEM_NOME = { 1: 'Balcão', 2: 'Comanda', 3: 'QR Mesa', 4: 'iFood', 5: 'MenuDino', 6: 'MenuDino', 7: 'DeliveryHub', 8: 'Totem' };
const DELIVERY_ORIGENS = new Set([4, 5, 6, 7]);
function classificar(origem, numero) {
  if (DELIVERY_ORIGENS.has(origem)) return { tipo: 'delivery', rotulo: ORIGEM_NOME[origem] || 'Delivery' };
  if (numero && numero > 0) return { tipo: 'mesa', rotulo: 'Mesa ' + numero };
  return { tipo: 'balcao', rotulo: 'Balcão' };
}
// Comanda 300-400 = a PESSOA; o rótulo ganha a mesa onde ela está (vínculo mesa_comanda).
async function rotularComandas(comandas) {
  if (!COMANDA_ATIVA) return comandas; // loja só com mesa: não há o que rotular
  const nums = comandas.filter((c) => c.numero >= COMANDA_DE && c.numero <= NUMERO_MAX).map((c) => c.numero);
  if (!nums.length) return comandas;
  const vinc = await sql`SELECT comanda, mesa FROM mesa_comanda WHERE comanda = ANY(${nums}) AND fechada_em IS NULL`;
  const mapa = new Map(vinc.map((v) => [Number(v.comanda), Number(v.mesa)]));
  for (const c of comandas) {
    if (c.numero >= COMANDA_DE && c.numero <= NUMERO_MAX) {
      const mesa = mapa.get(c.numero);
      c.rotulo = 'Comanda ' + c.numero + (mesa ? ' · Mesa ' + mesa : '');
      c.mesa_local = mesa ?? null;
    }
  }
  return comandas;
}
const temMod = (d) => { const s = (d || '').trim().toUpperCase(); return s && s !== 'NENHUM' && s !== 'N/A'; };

// ---- Firebird serializado (só leitura) ----
// O node-firebird estoura FORA da promise quando a conexão cai feio
// ("Cannot read properties of undefined (reading 'pluginName')"), e aí a
// query nunca resolveria. O resgate é o uncaughtException abaixo.
//
// BUG QUE ISSO CORRIGE: antes era UMA variável `pending` global — desenho de
// quando havia uma fila só. Com a fila interativa (qi), passam a existir DUAS
// queries em voo: a segunda sobrescrevia o `pending` da primeira, a primeira
// ao terminar consumia o da segunda, e a segunda ficava pendurada PARA SEMPRE
// — travando espelho, lançamento de pedido e tela de pagamento juntos.
// Agora cada query tem seu próprio `done` e o resgate acorda todas as em voo.
const pendentes = new Set();
const resgatar = (err) => { for (const fin of [...pendentes]) fin({ ok: false, err }); };
process.on('uncaughtException', () => resgatar('uncaught'));
process.on('unhandledRejection', () => resgatar('unhandled'));
let chain = Promise.resolve();
function q1(s) {
  return new Promise((res) => {
    let done = false;
    const fin = (r) => { if (done) return; done = true; pendentes.delete(fin); res(r); };
    pendentes.add(fin);
    setTimeout(() => fin({ ok: false, err: 'timeout' }), 15000);
    try { Firebird.attach(FB, (err, db) => { if (err) return fin({ ok: false, err: String(err.message).slice(0, 150) }); db.query(s, [], (e, rows) => { try { db.detach(() => {}); } catch {} if (e) return fin({ ok: false, err: String(e.message).slice(0, 180) }); fin({ ok: true, rows }); }); }); } catch (e) { fin({ ok: false, err: String(e.message).slice(0, 150) }); } });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function q(s, tries = 3) { const run = async () => { for (let i = 0; i < tries; i++) { const r = await q1(s); if (r.ok) return r; await sleep(400); } return { ok: false, err: 'retry' }; }; const p = chain.then(run); chain = p.catch(() => {}); return p; }
// Fila SEPARADA pras telas interativas (conta/pagamento). Sem isso, abrir a
// conta de uma mesa fica atrás do ciclo do espelho e o operador espera até 90s
// — inaceitável na hora de fechar a conta. Cada query já abre sua própria
// conexão, então são só duas vias em vez de uma.
let chainUi = Promise.resolve();
// TIMEOUT obrigatório: quando a conexão do node-firebird falha feio (o
// "Cannot read properties of undefined (reading 'pluginName')"), ele estoura
// fora do contexto da promise e ela NUNCA resolve — a tela do garçom fica
// girando pra sempre e a fila inteira trava atrás dela.
function qi(s, tries = 2) {
  const run = async () => {
    for (let i = 0; i < tries; i++) {
      const r = await comTimeout(q1(s), 8000, 'Firebird não respondeu em 8s').catch((e) => ({ ok: false, err: e.message }));
      if (r.ok) return r;
      await sleep(250);
    }
    return { ok: false, err: 'sem resposta do Firebird' };
  };
  const p = chainUi.then(run, run); // erro anterior não pode matar a fila
  chainUi = p.catch(() => {});
  return p;
}
const N = (v) => (v == null ? null : Number(v));
const T = (v) => { const s = (v == null ? '' : String(v)).trim(); return s || null; };
// Normaliza pra busca: sem acento, minusculo. Feito em JS (nao com a extensao
// unaccent do Postgres) porque o banco da loja e' o 9.5 legado — nao da pra
// contar com extensao instalada nem com o schema `extensions` do Supabase.
const semAcento = (s) => (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---- schema ----
// addCol tolerante: o Postgres da loja pode ser ANTIGO (9.5 não tem ADD COLUMN IF NOT EXISTS).
// ═══════════════ BANCO PRÓPRIO (0001 sem Consumer) ═══════════════
// O dono desliga o Firebird da 0001. Como NADA mais é lançado pela tela do
// Consumer (só o vendas-local escreve lá), o corte é trocar onde a escrita
// cai — de PEDIDOS/ITENSPEDIDO/PAGAMENTOS/CAIXA/CONTACORRENTE pro Postgres
// daqui, que já guarda a operação inteira em `comanda`/`comanda_item` (hoje
// como espelho; no modo próprio, como original).
//
//   BANCO=firebird (padrão)  escreve no Consumer, igual sempre
//   BANCO=proprio            escreve aqui; o Firebird nem é aberto
//
// A chave existe pra ida E volta: o Firebird fica ligado sem uso por algumas
// semanas, então voltar é editar o start.bat e reiniciar.
//
// CÓDIGOS ≥ 5.000.000 SÃO NOSSOS. O Consumer parou em pedido 158.620, item
// 1.492.360, pagamento 187.701 — começar em 5 milhões garante que nenhum
// código novo colida com o histórico, e olhar o número já diz de onde veio.
// Isso importa porque meia dúzia de tabelas locais (marca, cancelamento,
// nfce_log, venda_pagamento) apontam pra esses códigos.
const BANCO = String(process.env.BANCO || 'firebird').toLowerCase();
const nativo = () => BANCO === 'proprio';
const SEQ_INICIO = 5000000;

async function addCol(tabela, ddl) {
  try { await sql.unsafe(`ALTER TABLE ${tabela} ADD COLUMN ${ddl}`); }
  catch (e) { if (e.code !== '42701') throw e; } // 42701 = coluna já existe
}
/** Tabelas/colunas que só o modo próprio usa. Criadas sempre (custo zero) pra
 *  o corte ser só trocar a env — e pra dar pra popular e conferir ANTES. */
async function initSchemaNativo() {
  for (const nome of ['pedido', 'item', 'pagamento', 'caixa', 'cc', 'cliente']) {
    // Postgres 9.5 na 0001: CREATE SEQUENCE IF NOT EXISTS existe desde a 9.5.
    await sql.unsafe(`CREATE SEQUENCE IF NOT EXISTS seq_${nome} START ${SEQ_INICIO} MINVALUE ${SEQ_INICIO}`);
  }
  // comanda vira ORIGINAL: precisa dos campos que só existiam no PEDIDOS
  await addCol('comanda', 'fechada_em timestamptz');
  await addCol('comanda', 'total_itens numeric');
  await addCol('comanda', 'total_servico numeric');
  await addCol('comanda', 'percentual_servico numeric');
  await addCol('comanda', 'total_desconto numeric');
  await addCol('comanda', 'total_acrescimo numeric');
  await addCol('comanda', 'valor_entrega numeric');
  await addCol('comanda', 'cpf text');
  await addCol('comanda', 'contato_codigo integer');
  await addCol('comanda', 'criado_por text');
  await addCol('comanda_item', 'codigo_pdv bigint');
  await addCol('comanda_item', 'produto_codigo bigint');
  await addCol('comanda_item', 'valor_unitario numeric');
  await addCol('comanda_item', 'cancelado_em timestamptz');
  await addCol('comanda_item', 'cancelado_por text');
  await addCol('comanda_item', 'criado_por text');
  await sql`CREATE TABLE IF NOT EXISTS pagamento_local (codigo bigint PRIMARY KEY, pedido bigint, forma_codigo integer,
    valor numeric, caixa_codigo bigint, nsu text, autorizacao text, bandeira text, observacao text,
    conta_corrente bigint, quando timestamptz DEFAULT now(), cancelado_em timestamptz)`;
  await sql`CREATE TABLE IF NOT EXISTS caixa_local (codigo bigint PRIMARY KEY, login text, usuario_codigo integer,
    aberto_em timestamptz DEFAULT now(), fundo numeric DEFAULT 0, fechado_em timestamptz, obs text)`;
  await addCol('caixa_local', 'saldo_final numeric');
  await addCol('caixa_local', 'saldo_informado numeric');
  await sql`CREATE TABLE IF NOT EXISTS caixa_operacao_local (id bigserial PRIMARY KEY, caixa_codigo bigint,
    tipo text, valor numeric, forma_codigo integer, obs text, login text, quando timestamptz DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS conta_corrente_local (codigo bigint PRIMARY KEY, cliente_codigo integer,
    pedido bigint, credito numeric, debito numeric, saldo_inicial numeric, saldo_final numeric,
    observacao text, pagamento_codigo bigint, login text, quando timestamptz DEFAULT now())`;
  // espelho do cadastro de cliente (vem da nuvem): nome, limite e saldo do fiado
  await sql`CREATE TABLE IF NOT EXISTS cliente_local (codigo integer PRIMARY KEY, nome text, cpf text,
    telefone text, limite_credito numeric DEFAULT 0, saldo_atual numeric DEFAULT 0, ativo boolean DEFAULT true,
    atualizado_em timestamptz DEFAULT now())`;
  await addCol('cliente_local', 'bloqueia_apos_limite boolean DEFAULT false');
  await addCol('comanda', 'fiado_codigo integer');
  await sql`CREATE INDEX IF NOT EXISTS idx_pagamento_local_pedido ON pagamento_local (pedido)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cc_local_cliente ON conta_corrente_local (cliente_codigo)`;
}
/** Próximo código nosso (≥ 5.000.000). */
async function proxCodigo(seq) {
  const r = await sql.unsafe(`SELECT nextval('seq_${seq}')::bigint AS n`);
  return Number(r[0].n);
}

async function initSchema() {
  await sql`CREATE TABLE IF NOT EXISTS area (codigo integer PRIMARY KEY, nome text)`;
  await sql`CREATE TABLE IF NOT EXISTS comanda (codigo integer PRIMARY KEY, numero integer, origem integer, nome text, valor_total numeric, subtotal_pago numeric, qtd_pessoas integer, data_abertura timestamptz)`;
  await sql`CREATE TABLE IF NOT EXISTS comanda_item (id bigserial PRIMARY KEY, item_codigo bigint, codigo_pai bigint, comanda_codigo integer, nome text, quantidade numeric, valor_total numeric, tipo integer, detalhes text, area_codigo integer, criado timestamptz, produzido timestamptz, entregue timestamptz)`;
  await addCol('comanda_item', 'item_codigo bigint');
  await addCol('comanda_item', 'codigo_pai bigint');
  await addCol('comanda_item', 'criado timestamptz');
  await addCol('comanda_item', 'area_codigo integer');
  // marca = os toques do NOSSO sistema + REGISTRO DURÁVEL do tempo de produção.
  // (não some no TRUNCATE do espelho; chave = ITENSPEDIDO.CODIGO)
  // tempo de produção = pronto_em - criado_em ; tempo de entrega = entregue_em - pronto_em
  await addCol('comanda', 'conta_pedida boolean DEFAULT false'); // PEDIDOS.CONTASOLICITADA = mesa em fechamento
  await addCol('comanda', 'percentual_desconto numeric');
  // cancelar ≠ fechar: pedido cancelado some da mesa mas NÃO virou venda.
  await addCol('comanda', 'cancelada_em timestamptz');
  await addCol('comanda', 'cancelada_por text');
  await sql`CREATE TABLE IF NOT EXISTS marca (item_codigo bigint PRIMARY KEY, pronto_em timestamptz, entregue_em timestamptz)`;
  await addCol('marca', 'criado_em timestamptz');
  await addCol('marca', 'comanda_codigo integer');
  await addCol('marca', 'area_codigo integer');
  await addCol('marca', 'nome text');
  await addCol('marca', 'numero integer'); // nº da mesa/comanda no momento da baixa (a comanda fecha e some do espelho)
  await sql`CREATE INDEX IF NOT EXISTS ix_marca_pronto ON marca(pronto_em)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_marca_entregue ON marca(entregue_em)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_ci_item ON comanda_item(item_codigo)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_ci_pai ON comanda_item(codigo_pai)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_ci_area ON comanda_item(area_codigo)`;
  await addCol('comanda_item', 'codigo_pdv integer'); // liga o item ao catálogo (tempo extra por prato)
  await sql`CREATE TABLE IF NOT EXISTS sync_estado (id int PRIMARY KEY DEFAULT 1, ultimo_ok timestamptz, ultimo_erro text, comandas int, itens int)`;
  await sql`INSERT INTO sync_estado (id) VALUES (1) ON CONFLICT DO NOTHING`;
  // --- VENDA (Fase 1) ---
  // catálogo local (cache do Firebird; a busca do garçom lê daqui — funciona offline)
  // descricao/preparo do Consumer: 216 dos 2.041 produtos tem texto, e sao
  // justamente os pratos principais — e o que o cliente le antes de pedir
  await sql`CREATE TABLE IF NOT EXISTS produto_local (codigo_pdv integer PRIMARY KEY, produto_codigo integer, nome text, tamanho text, preco numeric, area_codigo integer, comanda_mobile boolean, descricao text, preparo text, atualizado timestamptz DEFAULT now())`;
  // nome+tamanho normalizado (sem acento, minusculo) — a busca do garcom usa esta coluna
  await addCol('produto_local', 'nome_busca text');
  // categoria = ETIQUETAS do Consumer (a mesma que monta o cardápio impresso).
  // sem_estoque: produto de estoque controlado que zerou — aparece CINZA, não some.
  await addCol('produto_local', 'categoria text');
  await addCol('produto_local', 'categoria_ordem integer');
  await addCol('produto_local', 'descricao text');
  await addCol('produto_local', 'preparo text');
  await addCol('produto_local', 'sem_estoque boolean DEFAULT false');
  // quantidade em estoque (null = produto sem controle de estoque no Consumer)
  await addCol('produto_local', 'estoque numeric');
  await addCol('produto_local', 'cardapio_digital boolean DEFAULT true');
  // grupos que a CASA decidiu esconder do cliente, independente do Consumer
  // (ex.: "Artistas" vem marcado como cardapio digital la, mas nao e' pra mesa)
  await sql`CREATE TABLE IF NOT EXISTS grupo_oculto (categoria text PRIMARY KEY, criado_em timestamptz DEFAULT now())`;
  // Produto criado NA NUVEM (não existe no Firebird). Fica em tabela própria
  // porque produto_local leva TRUNCATE a cada espelho — e porque a loja tem que
  // vender igual com a internet caída: o que chegou uma vez fica aqui.
  await sql`CREATE TABLE IF NOT EXISTS produto_nuvem (codigo_pdv integer PRIMARY KEY, produto_codigo integer,
    nome text, tamanho text, preco numeric, area_codigo integer, comanda_mobile boolean, cardapio_digital boolean,
    categoria text, descricao text, atualizado timestamptz DEFAULT now())`;
  // saldo vem da nuvem no modo próprio: o ESTOQUEMOVIMENTACAO era do Firebird
  await addCol('produto_nuvem', 'saldo numeric');
  // vínculo comanda (300-400, a pessoa) -> mesa (o lugar)
  await sql`CREATE TABLE IF NOT EXISTS mesa_comanda (comanda integer PRIMARY KEY, mesa integer NOT NULL, aberta_em timestamptz DEFAULT now(), fechada_em timestamptz)`;
  // quem esta na comanda: identificacao por CPF (o nome curto e' o que aparece na tela)
  await addCol('mesa_comanda', 'cpf varchar(11)');
  await addCol('mesa_comanda', 'nome text');
  await addCol('mesa_comanda', 'nome_curto text');
  await addCol('mesa_comanda', 'contato_fb integer');
  // Quem está no lugar — serve pra MESA e pra COMANDA (o número é a chave).
  // Antes só dava pra identificar comanda, e a maioria das mesas não abre uma.
  await sql`CREATE TABLE IF NOT EXISTS identificacao (numero integer PRIMARY KEY,
    cpf varchar(11), telefone varchar(15), nome text, nome_curto text, contato_fb integer,
    criado_em timestamptz DEFAULT now(), fechada_em timestamptz)`;
  // log durável de TUDO que o nosso app lançou (a venda mora aqui mesmo se o FB falhar)
  await sql`CREATE TABLE IF NOT EXISTS venda_envio (id bigserial PRIMARY KEY, criado_em timestamptz DEFAULT now(), numero integer, mesa integer, comanda integer, pedido_fb integer, itens jsonb, total numeric, status text, erro text)`;
  // --- PAGAMENTO (Fase 2) ---
  // Log durável de todo pagamento que NÓS capturamos. Fonte da verdade do que
  // foi cobrado, mesmo que o write-back no Consumer falhe depois.
  // origem: 'tef' (pinpad comandado por nós) | 'manual' (operador cobrou na
  // maquininha e confirmou aqui) | 'dinheiro'.
  await sql`CREATE TABLE IF NOT EXISTS venda_pagamento (
    id bigserial PRIMARY KEY, criado_em timestamptz DEFAULT now(),
    numero integer, pedido_fb integer, forma_codigo integer, forma text,
    valor numeric, origem text, nsu text, autorizacao text, bandeira text,
    tef_ref text, status text, erro text, pagamento_fb integer)`;
  await addCol('venda_pagamento', 'pagamento_fb integer');
  // "servir tudo junto": escolha DO PEDIDO, não regra automática. Bebida
  // normalmente vem antes; só casa as praças quando alguém pediu pra casar.
  await addCol('venda_envio', 'junto boolean DEFAULT false');
  // assinatura do carrinho: pega reenvio idêntico em segundos (toque duplo
  // do cliente) — ver dedupe em apiVendaEnviar.
  await addCol('venda_envio', 'assinatura text');
  await sql`CREATE INDEX IF NOT EXISTS ix_venda_envio_dedupe ON venda_envio (numero, assinatura, criado_em)`;
  // CHAMADOS da mesa: "chamar garçom" e reclamação (avaliação ruim).
  // Reclamação muda a ordem da cozinha — a mesa insatisfeita passa na frente.
  await sql`CREATE TABLE IF NOT EXISTS chamado (id bigserial PRIMARY KEY,
    mesa integer, tipo text NOT NULL, origem text, nota integer, texto text,
    criado_em timestamptz DEFAULT now(), atendido_em timestamptz, atendido_por text)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_chamado_aberto ON chamado(atendido_em, criado_em)`;
  // PRAÇAS QUE A RECLAMAÇÃO TOCA. Reclamou da água de coco? o aviso é do BAR —
  // não faz sentido piscar na cozinha da batata frita (dono, 19/08). Vazio =
  // reclamação sem item (salão, conta): continua indo pra todo mundo.
  await addCol('chamado', 'areas integer[]');
  // QUANDO A CONTA DE UMA MESA ACABOU. Serve pra matar a sessao do celular do
  // cliente ANTERIOR: sem isto, quem estava na mesa 1 continuava com a tela
  // colada nela depois do fechamento, e podia lancar na conta do proximo.
  await sql`CREATE TABLE IF NOT EXISTS mesa_estado (numero integer PRIMARY KEY,
    conta_codigo bigint, fechada_em timestamptz)`;
  // ASSUNTO da reclamacao: demora, errado, frio, limpeza, outro. Sem isto o
  // chamado chegava como texto solto e a equipe nao sabia se corria pra
  // cozinha ou pro salao.
  await addCol('chamado', 'assunto text');
  // TEMPO DE PREPARO: cada praça tem o seu (bebida sai em 5min, carne em 25).
  // Prato demorado soma minutos EXTRA por cima do tempo da praça dele.
  await sql`CREATE TABLE IF NOT EXISTS pix_cobranca (txid text PRIMARY KEY, mesa integer, valor numeric,
    copia_cola text, criado_em timestamptz DEFAULT now(), pago_em timestamptz, e2e text)`;
  await addCol('pix_cobranca', "provedor text DEFAULT 'cielo'");
  await addCol('pix_cobranca', 'conferido_em timestamptz'); // última consulta do vigia
  // Pix que caiu quando a mesa JÁ tinha fechado: o dinheiro entrou e não achou
  // conta pra pousar. Fica marcado aqui pra alguém conciliar — ver /api/pix/orfaos.
  await addCol('pix_cobranca', 'sem_conta boolean');
  // consulta ao SPC e' PAGA por CPF — cache pra nunca cobrar o mesmo duas vezes.
  // Guarda o HASH do CPF, nao o CPF.
  // rastro de quem moveu conta de lugar — mexer em conta alheia deixa marca
  // itens que devem SAIR JUNTOS — marcados um a um no pedido, nao o envio todo
  await sql`CREATE TABLE IF NOT EXISTS item_junto (item_codigo bigint PRIMARY KEY,
    grupo text NOT NULL, numero integer, criado_em timestamptz DEFAULT now())`;
  await sql`CREATE INDEX IF NOT EXISTS ix_item_junto_grupo ON item_junto(grupo)`;
  await sql`CREATE TABLE IF NOT EXISTS observacao_sugerida (categoria text, texto text)`;
  await sql`CREATE TABLE IF NOT EXISTS transferencia (id bigserial PRIMARY KEY,
    de_numero integer NOT NULL, para_numero integer NOT NULL, tipo text NOT NULL,
    itens_movidos integer DEFAULT 0, por text, pedido_de integer, pedido_para integer,
    criado_em timestamptz DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS spc_cache (cpf_hash text PRIMARY KEY, nome text,
    criado_em timestamptz DEFAULT now())`;
  // TUDO que a consulta devolve, cru. A consulta e' PAGA — jogar fora o resto
  // da resposta e' desperdicio: nascimento, nome da mae, endereco e telefone
  // vem junto e servem pra completar o cadastro sem perguntar nada ao cliente.
  // Guarda o CPF (nao so o hash) porque agora o dado E' do cliente identificado
  // e precisa ser recuperavel pra preencher ficha e NFC-e.
  await addCol('spc_cache', 'cpf varchar(11)');
  await addCol('spc_cache', 'bruto jsonb');
  await addCol('spc_cache', 'nascimento date');
  await addCol('spc_cache', 'mae text');
  await addCol('spc_cache', 'telefone varchar(15)');
  await addCol('spc_cache', 'endereco text');
  await addCol('spc_cache', 'cidade text');
  await addCol('spc_cache', 'uf varchar(2)');
  await addCol('spc_cache', 'cep varchar(9)');
  // nome NULL = "o SPC ja foi consultado e nao devolveu nome util". Guardar
  // isso evita pagar de novo pelo mesmo CPF sem resposta.
  await sql`ALTER TABLE spc_cache ALTER COLUMN nome DROP NOT NULL`.catch(() => {});
  await sql`CREATE TABLE IF NOT EXISTS saida_qr (token text PRIMARY KEY, mesa integer,
    pessoas integer NOT NULL, adultos integer, criancas integer, usados integer NOT NULL DEFAULT 0,
    origem text, criado_em timestamptz DEFAULT now(), expira_em timestamptz, ultima_em timestamptz)`;
  await addCol('saida_qr', 'carros integer NOT NULL DEFAULT 0');
  // VEICULOS do passe: a cancela do patio le a placa (LPR) e precisa saber se
  // aquele carro pode sair. Uma linha por carro, consumida na saida — do mesmo
  // jeito que cada pessoa consome uma passagem na catraca.
  await sql`CREATE TABLE IF NOT EXISTS saida_veiculo (id bigserial PRIMARY KEY,
    token text NOT NULL, placa text NOT NULL, mesa integer,
    criado_em timestamptz DEFAULT now(), liberada_em timestamptz)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS saida_veiculo_un ON saida_veiculo (token, placa)`;
  await sql`CREATE INDEX IF NOT EXISTS saida_veiculo_placa ON saida_veiculo (placa)`;
  await sql`CREATE TABLE IF NOT EXISTS cartao_cobranca (ref text PRIMARY KEY, mesa integer, valor numeric,
    criado_em timestamptz DEFAULT now(), expira_em timestamptz, pago_em timestamptz, autorizacao text)`;
  await sql`CREATE TABLE IF NOT EXISTS praca_config (area_codigo integer PRIMARY KEY, minutos integer NOT NULL)`;
  // FECHAMENTO DE CAIXA: o que o operador DECLAROU × o que o sistema tinha,
  // forma a forma. O Consumer só guarda o dinheiro (SALDOFINALINFORMADO); a
  // conferência de cartão/Pix é nossa e é o que permite cobrar diferença.
  // USUÁRIO PRÓPRIO DO CONCILIA. Até aqui todo login vinha do Consumer (o
  // nosso guardava só o PIN). O dono precisou dar acesso a alguém SEM mexer
  // no cadastro do PDV — então existe esta tabela: mesmo PIN, mesmas
  // permissões (guardadas pelos códigos do Consumer, pra regra ser uma só).
  await sql`CREATE TABLE IF NOT EXISTS usuario_local (login text PRIMARY KEY,
    nome text, pin_hash text, salt text, perms integer[], admin boolean NOT NULL DEFAULT false,
    ativo boolean NOT NULL DEFAULT true, criado_em timestamptz DEFAULT now(), criado_por text)`;
  // TIRAR OS 10%: é dinheiro do garçom saindo — quem tirou e de qual mesa
  // fica registrado, senão vira boca a boca no fim do mês.
  await sql`CREATE TABLE IF NOT EXISTS servico_ajuste (id bigserial PRIMARY KEY,
    quando timestamptz DEFAULT now(), login text, numero integer, pedido_fb integer,
    acao text, valor numeric, motivo text)`;
  await sql`CREATE TABLE IF NOT EXISTS caixa_fechamento (id bigserial PRIMARY KEY,
    caixa_codigo integer, quando timestamptz DEFAULT now(), login text,
    informado jsonb, esperado jsonb, dif_dinheiro numeric, obs text)`;
  await sql`CREATE TABLE IF NOT EXISTS produto_tempo (codigo_pdv integer PRIMARY KEY, minutos_extra integer NOT NULL)`;
  // QUEM BAIXOU: foto de quem tocou "Pronto"/"Entregue", com o que foi baixado.
  // Sem login no KDS, a foto é a única referência de quem apertou — é o que
  // permite apurar baixa indevida e resolver "entregaram na mesa errada".
  // A imagem vai em disco (fotos/AAAA-MM-DD/<id>.jpg); aqui fica só o ponteiro,
  // pra não inchar o banco com binário.
  await sql`CREATE TABLE IF NOT EXISTS baixa_foto (id bigserial PRIMARY KEY,
    criado_em timestamptz DEFAULT now(), acao text NOT NULL,
    area_codigo integer, area_nome text, numero integer,
    item_codigos bigint[], itens_nome text, n_itens integer DEFAULT 0,
    arquivo text, sem_foto_motivo text)`;
  await sql`CREATE INDEX IF NOT EXISTS baixa_foto_quando ON baixa_foto (criado_em DESC)`;
  // RECEBIMENTO MANUAL: quando a maquininha não baixa a comanda sozinha, o
  // caixa registra na mão — e o comprovante vira FOTO. Sem a foto, "recebi no
  // Pix" é palavra; com ela, a conferência do dia tem o que olhar.
  await sql`CREATE TABLE IF NOT EXISTS comprovante_token (token text PRIMARY KEY,
    numero integer, valor numeric, forma text, arquivo text, login text,
    criado_em timestamptz DEFAULT now(), enviado_em timestamptz, usado_em timestamptz)`;
  // aberto_em: o caixa vê "o celular ABRIU o link" — separa 'não escaneou' de
  // 'escaneou mas o envio falhou' (celular caiu pro 4G na hora do POST).
  // addCol, NUNCA "IF NOT EXISTS": o PG da 0001 é 9.5 (derrubou o boot em 20/08).
  await addCol('comprovante_token', 'aberto_em timestamptz');
  await sql`CREATE TABLE IF NOT EXISTS recebimento_foto (id bigserial PRIMARY KEY,
    numero integer, pedido bigint, pagamento_codigo bigint, forma text, valor numeric,
    arquivo text, nsu text, login text, quando timestamptz DEFAULT now())`;
  await sql`CREATE INDEX IF NOT EXISTS rec_foto_quando ON recebimento_foto (quando DESC)`;
  // O que a IA leu do papel: NSU, operadora, via da loja, valor, id do Pix.
  // Fica no token (pro caixa ver antes de confirmar) e no recebimento (pra
  // conciliação achar depois).
  await addCol('comprovante_token', 'dados jsonb');
  await addCol('recebimento_foto', 'operadora text');
  await addCol('recebimento_foto', 'bandeira text');
  await addCol('recebimento_foto', 'tipo_transacao text');
  await addCol('recebimento_foto', 'via text');
  await addCol('recebimento_foto', 'autorizacao text');
  await addCol('recebimento_foto', 'valor_lido numeric');
  await addCol('recebimento_foto', 'id_pix text');
  await addCol('recebimento_foto', 'dados jsonb');
  // QUEM LANÇOU O ITEM. O Consumer guarda no CODIGOCOLABORADOR (69% dos itens);
  // o que sai do NOSSO garçom não tinha dono nenhum. Tabela separada porque
  // comanda_item leva TRUNCATE a cada espelho — mesma razão da `marca`.
  await sql`CREATE TABLE IF NOT EXISTS item_autor (item_codigo bigint PRIMARY KEY,
    login text, nome text, quando timestamptz DEFAULT now())`;
  await addCol('comanda_item', 'colaborador integer');
  await addCol('comanda_item', 'colaborador_nome text');
  // FOTO DO PRODUTO. Vem do Consumer como arquivo <PRODUTOS.CODIGO>.jpg — a
  // foto é do PRODUTO, não da variante: "T Gin" tem uma só, e as 17 frutas
  // usam a mesma. Guardar no banco (e não em disco) mantém tudo num lugar só,
  // entra no backup junto e não depende de caminho de pasta. São ~11 MB.
  // ---- PERGUNTAS DO CONSUMER (o "wizard") ----
  // "Qual o ponto da carne", "Qual o acompanhamento?", "Deseja mais algum
  // molho?" — 109 perguntas, 511 opções, e o preço muda conforme a resposta.
  // Sem isso o cliente não consegue pedir sozinho metade dos pratos.
  // O nome da opção vem de OBSERVACAO (texto puro: "Ao ponto") ou do PRODUTO
  // ligado ("Molho Gorgonzola") — DESCRICAO quase sempre está vazia.
  await sql`CREATE TABLE IF NOT EXISTS wizard_pergunta (codigo integer PRIMARY KEY,
    texto text, min integer DEFAULT 0, max integer DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS wizard_opcao (codigo integer PRIMARY KEY,
    pergunta integer NOT NULL, nome text, preco numeric DEFAULT 0, produto_pdv integer)`;
  await sql`CREATE TABLE IF NOT EXISTS wizard_produto (codigo_pdv integer NOT NULL,
    pergunta integer NOT NULL, ordem integer DEFAULT 0, PRIMARY KEY (codigo_pdv, pergunta))`;
  // ---- CONFIGURAÇÃO NOSSA DO PRODUTO ----
  // Onde cada item aparece. Hoje o Consumer também tem essas flags, mas a
  // ideia é virar com o NOSSO banco: aqui é que vai ficar a verdade.
  // Fica FORA do produto_local de propósito — aquele é espelho e leva TRUNCATE
  // a cada 5 min; isto aqui é cadastro e tem que sobreviver.
  // null = "não mexeram, vale o padrão"; true/false = decisão da casa.
  await sql`CREATE TABLE IF NOT EXISTS produto_config (codigo_pdv integer PRIMARY KEY,
    cliente boolean, garcom boolean, caixa boolean, delivery boolean,
    atualizado timestamptz DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS produto_foto (produto_codigo integer PRIMARY KEY,
    mime text NOT NULL, bytes bytea NOT NULL, tam integer, atualizado timestamptz DEFAULT now())`;
  // ---- LOGIN DO GARÇOM (PIN próprio) ----
  // Quem PODE entrar é definido pelo Consumer (permissão AcessarComandaMobile);
  // a SENHA do Consumer é cifrada com chave embutida no .exe da RAL e não deu
  // pra reverter — então a credencial aqui é um PIN nosso, com hash. O acesso
  // continua restrito: só entra login que tenha a permissão de venda no Consumer.
  await sql`CREATE TABLE IF NOT EXISTS garcom_pin (login text PRIMARY KEY, pin_hash text NOT NULL,
    salt text NOT NULL, nome text, criado_em timestamptz DEFAULT now(), atualizado_em timestamptz DEFAULT now())`;
  // Permissão GERENTE (nossa, por loja): quem vê reclamação na comanda mobile.
  // Vale ISTO ou ser Administrador/ter Excluir-Pedido(28) no Consumer (ehGerente).
  await addCol('garcom_pin', 'gerente boolean NOT NULL DEFAULT false');
  await sql`CREATE TABLE IF NOT EXISTS app_config (chave text PRIMARY KEY, valor text NOT NULL)`;
  // Vínculo CAIXA ↔ MAQUININHA: o caixa aberto na maquininha fica preso ao
  // serial daquele terminal — o mesmo operador não recebe em outra maquininha
  // sem fechar aqui. (Só trava quando o app manda o serial no pagamento.)
  await sql`CREATE TABLE IF NOT EXISTS caixa_maquininha (caixa_codigo integer PRIMARY KEY, terminal text NOT NULL, criado_em timestamptz DEFAULT now())`;
  // ---- COMANDA JÁ IMPRESSA na térmica ----
  // comanda_item leva TRUNCATE a cada espelho; o "já saiu na impressora" vive
  // aqui, chaveado por ITENSPEDIDO.CODIGO (estável — mesmo esquema da `marca`).
  await sql`CREATE TABLE IF NOT EXISTS comanda_impressa (item_codigo bigint PRIMARY KEY, impresso_em timestamptz DEFAULT now())`;
  // qual impressora atende CADA praça — cozinhas separadas têm impressoras
  // separadas (Petisco e Cozinha podem apontar pro MESMO IP; Drinks pra outro).
  // Praça sem linha usa a impressora geral (a do caixa) como padrão.
  await sql`CREATE TABLE IF NOT EXISTS praca_impressora (area_codigo integer PRIMARY KEY, ip text NOT NULL)`;
  // ---- AUDITORIA DE CANCELAMENTO (relatório de controle) ----
  // O Consumer só carimba DATADELETE (sem quem/por quê — conferido na base
  // real). Quem cancelou, o quê, quando, o motivo, o STATUS do item na hora
  // (a_produzir/pronto/entregue) e o gerente que autorizou ficam AQUI.
  await sql`CREATE TABLE IF NOT EXISTS cancelamento (id bigserial PRIMARY KEY,
    quando timestamptz DEFAULT now(), login text, gerente text, numero integer, pedido_fb integer,
    item_codigo bigint, nome text, valor numeric, status_item text, motivo text)`;
  // PRAÇA do item cancelado: cerveja cancelada é aviso do BAR, não da cozinha
  // da batata (mesma lógica da reclamação). Nulo = pedido inteiro: vai pra todas.
  await addCol('cancelamento', 'area_codigo integer');
  // DEVOLUÇÃO exige foto do produto devolvido (regra do dono, 22/08): caminho do arquivo em fotos/
  await addCol('cancelamento', 'foto text');
  // "Ok, vi": o aviso sumia sozinho em 10 min e não tinha como fechar — quem
  // já resolveu ficava olhando alarme velho (dono, 19/08).
  await addCol('cancelamento', 'visto_em timestamptz');
  await addCol('cancelamento', 'visto_por text');
  // NFC-e emitida pelo Concilia (log local — a verdade fiscal mora no central):
  // serve pro "já tem nota" na tela e pra reimpressão sem repetir a pergunta.
  await sql`CREATE TABLE IF NOT EXISTS nfce_log (
    pedido_fb bigint PRIMARY KEY, numero integer, quando timestamptz DEFAULT now(),
    chave text, nfce_numero integer, serie integer, ambiente integer,
    dest_documento text, valor numeric, status text, erro text, solicitado_por text)`;

  // ---- iFood: pedido que chega DIRETO na loja, sem passar pelo Consumer ----
  // Enquanto o Consumer for a integradora, estas tabelas ficam vazias e nada
  // aqui roda (ifood_ativo=0). Quando a loja for autorizada no NOSSO app, o
  // pedido do iFood deixa de existir no Firebird — ele passa a nascer aqui.
  await sql`CREATE TABLE IF NOT EXISTS ifood_pedido (
    id text PRIMARY KEY,
    seq bigserial UNIQUE,
    display_id text, merchant_id text,
    status text, tipo text, modo_entrega text,
    cliente_nome text, cliente_fone text, endereco text,
    total numeric, taxa_entrega numeric, pago_online boolean,
    agendado_para timestamptz, criado_em timestamptz,
    recebido_em timestamptz DEFAULT now(),
    confirmado_em timestamptz, despachado_em timestamptz,
    concluido_em timestamptz, cancelado_em timestamptz,
    cancel_pedido_em timestamptz, cancel_motivo text,
    erro text, payload jsonb)`;
  // item_codigo é NEGATIVO de propósito: o espelho do Firebird só tem código
  // positivo, então o pedido do iFood convive com ele nas mesmas tabelas
  // (comanda/comanda_item) sem risco de colisão — e o KDS, a entrega, o
  // "marca" e a impressora continuam funcionando sem saber que é iFood.
  await sql`CREATE TABLE IF NOT EXISTS ifood_item (
    item_codigo bigserial PRIMARY KEY,
    pedido_id text NOT NULL REFERENCES ifood_pedido(id) ON DELETE CASCADE,
    seq integer, codigo_pdv integer, nome text, quantidade numeric,
    valor_total numeric, detalhes text, area_codigo integer)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ifood_item_pedido ON ifood_item (pedido_id)`;
  // evento só sai do polling depois de PERSISTIDO aqui. Se o processo cair no
  // meio, o iFood devolve o mesmo evento no próximo ciclo — e o PK evita
  // processar duas vezes.
  await sql`CREATE TABLE IF NOT EXISTS ifood_evento (
    id text PRIMARY KEY, code text, order_id text,
    recebido_em timestamptz DEFAULT now(), ack_em timestamptz, erro text)`;
  await initSchemaNativo();
}

// ---- espelho (Firebird -> Postgres, snapshot) ----
let ultimoStatus = { ok: false, comandas: 0, itens: 0 };
/* ---- FAXINA: pedido vazio que sobrou de uma corrida ----
   A trava do pedidoDaMesa impede novas duplicatas, mas as antigas já estão no
   Firebird — cinco cartões "Mesa 12 · R$ 0,00" na tela do caixa desde 22/08.
   Aqui some com elas, com três cintos de segurança: só apaga pedido SEM item,
   SEM pagamento, e só quando a MESMA mesa tem OUTRO pedido aberto que valha
   mais: um com item, ou — se todos forem vazios — o de código menor. Ou seja,
   sobra exatamente UMA conta por mesa, e sobra a que tem o dinheiro. Mesa
   aberta e ainda sem nada lançado é normal e não é tocada (não tem duplicata).
   O corte de 2 minutos protege o pedido recém-nascido que está recebendo item
   agora. */
let ultimaFaxina = 0;
async function faxinaPedidosVazios() {
  if (nativo()) return;
  if (Date.now() - ultimaFaxina < 60000) return; // no máximo 1x por minuto
  ultimaFaxina = Date.now();
  const r = await q(`SELECT p.CODIGO, p.NUMERO FROM PEDIDOS p
    WHERE p.DATAFECHAMENTO IS NULL AND p.DATADELETE IS NULL AND p.NUMERO > 0
      AND p.DATAABERTURA < DATEADD(-2 MINUTE TO CURRENT_TIMESTAMP)
      AND NOT EXISTS (SELECT 1 FROM ITENSPEDIDO i
                       WHERE i.CODIGOPEDIDO = p.CODIGO AND i.DATADELETE IS NULL)
      AND NOT EXISTS (SELECT 1 FROM PAGAMENTOS g
                       WHERE g.CODIGOPEDIDO = p.CODIGO AND g.DATADELETE IS NULL)
      AND EXISTS (SELECT 1 FROM PEDIDOS o
                   WHERE o.NUMERO = p.NUMERO AND o.CODIGO <> p.CODIGO
                     AND o.DATAFECHAMENTO IS NULL AND o.DATADELETE IS NULL
                     AND (EXISTS (SELECT 1 FROM ITENSPEDIDO i2
                                   WHERE i2.CODIGOPEDIDO = o.CODIGO AND i2.DATADELETE IS NULL)
                          OR o.CODIGO < p.CODIGO))`);
  if (!r.ok) { console.error('[faxina] ' + r.err); return; }
  if (!r.rows.length) return;
  for (const x of r.rows) {
    const u = await qi(`UPDATE PEDIDOS SET DATADELETE=CURRENT_TIMESTAMP WHERE CODIGO=${N(x.CODIGO)} AND DATADELETE IS NULL`);
    if (!u.ok) console.error('[faxina] pedido ' + x.CODIGO + ': ' + u.err);
  }
  console.log('[faxina] ' + r.rows.length + ' pedido(s) vazio(s) duplicado(s) removido(s): mesas ' +
    [...new Set(r.rows.map((x) => N(x.NUMERO)))].join(', '));
}

async function espelho() {
  // ⚠️ NO MODO PRÓPRIO ISTO NÃO PODE RODAR. Aqui `comanda`/`comanda_item` são
  // o ORIGINAL, e esta função trunca as duas pra recarregar do Firebird — ou
  // seja, apagaria a operação em andamento. O espelho só existe enquanto o
  // Consumer for o dono do dado.
  if (nativo()) { ultimoStatus = { ok: true, comandas: 0, itens: 0, nativo: true }; return; }
  await faxinaPedidosVazios().catch((e) => console.error('[faxina] ' + e.message));
  const az = await q(`SELECT CODIGO, TRIM(DESCRICAO) D FROM COZINHAS ORDER BY CODIGO`);
  // ⚠️ O PAGO VEM DA SOMA DE PAGAMENTOS, NÃO DE SUBTOTALPAGO.
  // Conferido na base do Prainha Bar: o campo fica `null` mesmo em pedido
  // quitado — o Consumer não o mantém. Lendo o campo, pagamento parcial não
  // baixava nada: quem pagava R$ 40 de R$ 240 continuava vendo R$ 240, e
  // dividir a conta entre várias pessoas nunca fechava.
  const c = await q(`SELECT p.CODIGO, p.NUMERO, p.CODIGOPEDIDOORIGEM ORI, TRIM(p.NOME) NOME,
      p.VALORTOTAL, p.QUANTIDADEPESSOAS QP, p.DATAABERTURA, p.CONTASOLICITADA CS,
      (SELECT COALESCE(SUM(g.VALOR),0) FROM PAGAMENTOS g
        WHERE g.CODIGOPEDIDO = p.CODIGO AND g.DATADELETE IS NULL) SUBTOTALPAGO
    FROM PEDIDOS p WHERE p.DATAFECHAMENTO IS NULL AND p.DATADELETE IS NULL
      AND (p.DATAABERTURA >= ${DESDE} OR p.NUMERO > 0) ORDER BY p.NUMERO`);
  // ⚠️ MESA ABERTA APARECE INDEPENDENTE DO DIA. O garçom tem que ver toda mesa
  // com número real (NUMERO>0) aberta no Consumer, mesmo que a conta esteja
  // aberta há semanas (regular com fiado, ou mesa esquecida a fechar). O filtro
  // de ${DESDE} dias continua valendo só pro lixo de mesa=0 (entrega/online que
  // nunca fechou — havia pedido aberto de 2023). Os itens dessas mesas antigas
  // entram MARCADOS como entregues (ver ANTIGO abaixo) pra não cair na cozinha.
  if (!c.ok) throw new Error('FB comandas: ' + c.err);
  const it = await q(`SELECT i.CODIGO ITEM, i.CODIGOPAI PAI, i.CODIGOPEDIDO PED, i.CODIGOPRODUTODETALHE PDV, i.DATAHORACADASTRO CRIADO, TRIM(i.NOMEPRODUTO) NOME, i.QUANTIDADE QTD, i.VALORTOTAL VT, i.CODIGOITEMPEDIDOTIPO TIPO, TRIM(i.DETALHES) DET, i.DATAHORAPRODUZIDO PROD, i.DATAHORAENTREGUE ENTR, pr.CODIGOCOZINHA AREA, i.CODIGOCOLABORADOR COLAB, TRIM(COALESCE(col.NOME,'')) COLABNOME, CASE WHEN p.DATAABERTURA >= ${DESDE} THEN 0 ELSE 1 END ANTIGO
    FROM ITENSPEDIDO i JOIN PEDIDOS p ON p.CODIGO=i.CODIGOPEDIDO
    LEFT JOIN PRODUTODETALHE pd ON pd.CODIGO=i.CODIGOPRODUTODETALHE
    LEFT JOIN PRODUTOS pr ON pr.CODIGO=pd.CODIGOPRODUTO
    LEFT JOIN CONTATOS col ON col.CODIGO=i.CODIGOCOLABORADOR
    WHERE p.DATAFECHAMENTO IS NULL AND p.DATADELETE IS NULL AND (p.DATAABERTURA >= ${DESDE} OR p.NUMERO > 0) AND i.DATADELETE IS NULL ORDER BY i.CODIGO`);
  if (!it.ok) throw new Error('FB itens: ' + it.err);

  const areas = az.ok ? az.rows.map((x) => ({ codigo: N(x.CODIGO), nome: T(x.D) || ('Área ' + x.CODIGO) })) : [];
  const comandas = c.rows.map((x) => ({ codigo: N(x.CODIGO), numero: N(x.NUMERO), origem: N(x.ORI), nome: T(x.NOME), valor_total: N(x.VALORTOTAL) || 0, subtotal_pago: N(x.SUBTOTALPAGO) || 0, qtd_pessoas: N(x.QP), data_abertura: x.DATAABERTURA || null, conta_pedida: T(x.CS) === 'S' }));
  // Item de mesa ANTIGA (fora da janela de ${DESDE} dias, veio só porque a mesa
  // tem número real): entra JÁ como produzido+entregue, senão os itens nunca
  // baixados dessas contas velhas cairiam no "a produzir" da cozinha. O garçom
  // ainda vê o item na mesa (como entregue); a cozinha não vê. Carimbo = a
  // própria criação do item (histórico), com fallback pros campos do Consumer.
  const itens = it.rows.map((x) => {
    const antigo = Number(x.ANTIGO) === 1;
    const feito = x.CRIADO || x.PROD || x.ENTR || null;
    return { item_codigo: N(x.ITEM), codigo_pai: N(x.PAI), comanda_codigo: N(x.PED), codigo_pdv: N(x.PDV), criado: x.CRIADO || null, nome: T(x.NOME), quantidade: N(x.QTD) || 0, valor_total: N(x.VT) || 0, tipo: N(x.TIPO), detalhes: T(x.DET), area_codigo: N(x.AREA), produzido: x.PROD || (antigo ? feito : null), entregue: x.ENTR || (antigo ? feito : null), colaborador: N(x.COLAB), colaborador_nome: T(x.COLABNOME) || null };
  });
  // COMPLEMENTO (tipo 2) sai na cozinha do PRATO-PAI: se não tem área própria, herda a do pai (CODIGOPAI).
  const areaPorItem = new Map(itens.map((i) => [i.item_codigo, i.area_codigo]));
  for (const i of itens) {
    if (i.tipo === 2 && i.area_codigo == null && i.codigo_pai != null && areaPorItem.get(i.codigo_pai) != null) i.area_codigo = areaPorItem.get(i.codigo_pai);
  }
  // praça juntada com outra: o item entra já na cozinha que produz
  const redir = await mapaRedirPracas();
  if (redir.size) for (const i of itens) {
    if (i.area_codigo != null && redir.has(i.area_codigo)) i.area_codigo = redir.get(i.area_codigo);
  }
  // praça POR ITEM (ganha do redirect: é conserto de cadastro torto) e itens
  // que ninguém produz — o couvert entra já baixado, some do KDS e para de
  // contar atraso na mesa, sem sumir da conta do cliente.
  const porItem = await mapaItemPraca();
  const fora = await itensForaKds();
  if (porItem.length || fora.length) for (const i of itens) {
    const nm = semAcento(i.nome || '');
    if (porItem.length) {
      const achou = porItem.find((x) => nm.includes(x.termo));
      if (achou) i.area_codigo = achou.area;
    }
    if (fora.length && fora.some((t) => nm.includes(t))) {
      const quando = i.criado || new Date();
      if (!i.produzido) i.produzido = quando;
      if (!i.entregue) i.entregue = quando;
    }
  }

  // ⚠️ CARIMBA O FECHAMENTO ANTES DE TRUNCAR. Compara o que havia com o que
  // veio: numero cuja conta SUMIU (ou virou outra conta) teve a conta
  // encerrada, e toda sessao de celular anterior a este instante morre.
  // So carimba quando havia conta antes — mesa que ACABOU de abrir (null ->
  // conta) nao pode matar a sessao de quem escaneou com a mesa vazia e pediu.
  const antes = await sql`SELECT numero, codigo FROM comanda`;
  const agoraPorNumero = new Map(comandas.map((c) => [Number(c.numero), Number(c.codigo)]));
  const encerrados = antes
    .filter((a) => a.codigo != null && agoraPorNumero.get(Number(a.numero)) !== Number(a.codigo))
    .map((a) => Number(a.numero));

  await sql.begin(async (sql) => {
    if (areas.length) for (const a of areas) await sql`INSERT INTO area (codigo, nome) VALUES (${a.codigo}, ${a.nome}) ON CONFLICT (codigo) DO UPDATE SET nome=EXCLUDED.nome`;
    for (const n of encerrados) {
      await sql`INSERT INTO mesa_estado (numero, conta_codigo, fechada_em) VALUES (${n}, NULL, now())
        ON CONFLICT (numero) DO UPDATE SET conta_codigo=NULL, fechada_em=now()`;
    }
    // RECLAMAÇÃO DE MESA FECHADA É LIXO. O cliente foi embora; o aviso vermelho
    // seguia no KDS até alguém tocar "atender" — e no KDS não havia botão
    // nenhum. Ficaram 3 abertas, uma de 4 DIAS (19/08).
    if (encerrados.length) {
      await sql`UPDATE chamado SET atendido_em=now(), atendido_por='conta fechou'
        WHERE atendido_em IS NULL AND mesa = ANY(${encerrados})`;
    }
    // backstop: chamado que passou do turno some sozinho — alarme de ontem
    // ensina a equipe a ignorar alarme.
    await sql`UPDATE chamado SET atendido_em=now(), atendido_por='expirou'
      WHERE atendido_em IS NULL AND criado_em < now() - interval '6 hours'`;
    await sql`TRUNCATE comanda, comanda_item`;
    if (comandas.length) await sql`INSERT INTO comanda ${sql(comandas, 'codigo', 'numero', 'origem', 'nome', 'valor_total', 'subtotal_pago', 'qtd_pessoas', 'data_abertura', 'conta_pedida')}`;
    if (itens.length) await sql`INSERT INTO comanda_item ${sql(itens, 'item_codigo', 'codigo_pai', 'comanda_codigo', 'codigo_pdv', 'criado', 'nome', 'quantidade', 'valor_total', 'tipo', 'detalhes', 'area_codigo', 'produzido', 'entregue', 'colaborador', 'colaborador_nome')}`;
    await sql`UPDATE sync_estado SET ultimo_ok=now(), ultimo_erro=null, comandas=${comandas.length}, itens=${itens.length} WHERE id=1`;
  });
  // O TRUNCATE acima leva junto o pedido do iFood (que não vem do Firebird):
  // reinjeta agora. FORA da transação de propósito — erro na projeção do iFood
  // não pode abortar o espelho e deixar as MESAS sem atualizar.
  await projetarIfood().catch((e) => console.error('[ifood] projeção:', e.message));

  // ---- FECHOU A MESA, LIBERA TUDO QUE ESTAVA PRESO A ELA ----
  // O espelho so traz pedido ABERTO. Se a mesa sumiu daqui, ela fechou no
  // Consumer — e entao:
  //   · as comandas vinculadas voltam a ficar livres (senao a 301 fica presa
  //     pra sempre e nao pode ser usada em outra mesa)
  //   · a identificacao morre. Sem isso, o proximo cliente da mesa 1 apareceria
  //     com o nome de quem estava antes — confusao na comanda impressa e
  //     dado de gente que ja foi embora continuando na tela.
  //   · a sessao do celular tambem cai (ela compara o codigo da comanda)
  //
  // ⚠️ CARENCIA na identificacao: quem senta numa mesa VAZIA e se identifica
  // antes de pedir nao tem conta aberta ainda — e o sync, rodando segundos
  // depois, apagava o cadastro dele. Bastava atualizar a pagina pro nome
  // sumir. Agora so fecha identificacao mais velha que a propria sessao da
  // mesa (SESSAO_MESA_MIN): dentro dessa janela a pessoa ainda esta ali, e
  // depois dela a sessao do celular ja teria caido de qualquer jeito.
  const numerosAbertos = comandas.map((c) => c.numero).filter((n) => n != null);
  // ⚠️ A MESMA CARÊNCIA VALE PRA COMANDA RECÉM-ABERTA. O vínculo nasce quando
  // o garçom abre a comanda, mas o PEDIDOS no Consumer só nasce no primeiro
  // item lançado. Entre um e outro a comanda não está em numerosAbertos — e o
  // sync, segundos depois, fechava o vínculo: o garçom abria a comanda, tocava
  // nela e ela tinha sumido. Dentro da janela a comanda é nova, não órfã.
  const carencia = sql`(${String(SESSAO_MESA_MIN)} || ' minutes')::interval`;
  if (numerosAbertos.length) {
    await sql`UPDATE mesa_comanda SET fechada_em = now()
       WHERE fechada_em IS NULL AND (mesa <> ALL(${numerosAbertos}) OR comanda <> ALL(${numerosAbertos}))
         AND aberta_em < now() - ${carencia}`;
    await sql`UPDATE identificacao SET fechada_em = now()
       WHERE fechada_em IS NULL AND numero <> ALL(${numerosAbertos})
         AND criado_em < now() - ${carencia}`;
  } else {
    // nenhuma mesa aberta (casa fechada): libera tudo que já passou da carência
    await sql`UPDATE mesa_comanda SET fechada_em = now()
       WHERE fechada_em IS NULL AND aberta_em < now() - ${carencia}`;
    await sql`UPDATE identificacao SET fechada_em = now()
       WHERE fechada_em IS NULL AND criado_em < now() - ${carencia}`;
  }
  ultimoStatus = { ok: true, comandas: comandas.length, itens: itens.length };
  // a comanda na térmica pega carona em TODO refresh do espelho (o do loop e
  // os manuais do lançamento): pedido novo imprime na hora, sem esperar 15s
  imprimirComandasNovas().catch((e) => console.error('[impressora] comanda:', e.message));
  return ultimoStatus;
}
// watchdog: o espelho NUNCA pode travar o loop em silêncio (bug do node-firebird em queda de VPN).
// Se um ciclo passar de 90s, ele é abandonado, logado e o loop reprograma — nunca morre calado.
function comTimeout(p, ms, msg) { return Promise.race([p, sleep(ms).then(() => { throw new Error(msg); })]); }
/* ---- VIGIA DO PIX: o servidor confere sozinho ----
   Até aqui QUEM confirmava um Pix era o navegador: o celular do cliente ou a
   tela do caixa, batendo em /api/pix/conferir de 5 em 5 segundos. Se o cliente
   pagava e fechava a página — ou o celular dormia, ou o Wi-Fi caiu — ninguém
   perguntava mais nada: o dinheiro ficava no banco, o pagamento nunca entrava
   na conta e A MESA NÃO FECHAVA. Foi o que aconteceu em 21/08/2026.
   O servidor não fecha a página. Agora é ele quem pergunta.

   Cadência: cobrança nova (até 10min) de 20 em 20s, porque é quando o cliente
   está olhando; depois disso de 2 em 2 minutos, até 2h. Passou disso, o cliente
   não pagou mesmo — e o Pix expira. */
async function loopPixPendente() {
  try {
    const pend = await sql`SELECT txid FROM pix_cobranca
       WHERE pago_em IS NULL AND criado_em > now() - interval '2 hours'
         AND (conferido_em IS NULL
              OR (criado_em > now() - interval '10 minutes' AND conferido_em < now() - interval '20 seconds')
              OR conferido_em < now() - interval '2 minutes')
       ORDER BY criado_em LIMIT 20`;
    for (const c of pend) {
      // marca ANTES: consulta que estoura não pode virar consulta em looping
      await sql`UPDATE pix_cobranca SET conferido_em=now() WHERE txid=${c.txid}`;
      const r = await apiPixConferir(c.txid).catch((e) => ({ ok: false, erro: e.message }));
      if (r && r.ok && r.pago && !r.ja_registrado) console.log('[pix-vigia] ' + c.txid + ' caiu — registrado sem o celular do cliente');
    }
  } catch (e) { console.error('[pix-vigia] ' + e.message); }
  finally { setTimeout(loopPixPendente, 20000); }
}

/* ---- AUTO-ATUALIZAÇÃO: o servidor da loja se mantém em dia sozinho ----
   Até aqui, publicar correção exigia o dono colar um comando PowerShell na
   loja via Chrome Remote Desktop — toda vez. Pedido do dono, 23/08/2026.

   Regras de segurança (isto roda SOZINHO, sem ninguém olhando, então erra
   pra cautela em tudo):
     1. NUNCA sobrescreve o próprio arquivo em execução — no Windows um
        arquivo aberto por um processo não pode ser trocado por ele mesmo.
        Baixa pra server.novo.mjs e quem faz a troca de verdade é o
        auto-update.ps1, rodando como processo SEPARADO (spawn detached) —
        ele sobrevive ao passo em que mata este processo Node.
     2. CONFERE O HASH do que baixou antes de aplicar qualquer coisa — nunca
        aplica um download truncado/corrompido (já aconteceu na nuvem servir
        versão velha; aqui o hash pega isso na hora).
     3. Espera a loja ficar tranquila (sem item lançado nos últimos 3min)
        antes de aplicar — a troca leva ~15s no ar. Não força além de 4h de
        espera: correção crítica não pode ficar pra sempre atrás do
        movimento.
     4. auto-update.ps1 CONFERE se a versão nova subiu saudável e faz
        ROLLBACK AUTOMÁTICO se não — sem isso, um bug de boot (já aconteceu:
        PG 9.5 não aceita ADD COLUMN IF NOT EXISTS) derrubaria o caixa
        sozinho, sem ninguém rodando comando nenhum pra perceber.
   Kill switch: AUTO_UPDATE=off no start.bat desliga tudo isto. */
const AUTO_UPDATE = String(process.env.AUTO_UPDATE || '').toLowerCase() !== 'off';
const AUTO_UPDATE_POLL_MS = 20 * 60 * 1000; // 20min — não é urgente feito o Pix
const AUTO_UPDATE_FORCA_APOS_MS = 4 * 3600 * 1000; // 4h esperando: aplica mesmo ocupado
let autoUpdatePendenteDesde = null;

/** Loja "tranquila agora" = ninguém lançou item nos últimos 3min. Proxy
 *  simples e vale nos dois modos de banco (comanda_item existe sempre). */
async function autoUpdateLojaOcupada() {
  try {
    const r = await sql`SELECT 1 FROM comanda_item WHERE criado > now() - interval '3 minutes' LIMIT 1`;
    return r.length > 0;
  } catch { return false; } // não sabe dizer -> não bloqueia
}

/** Mantém o PRÓPRIO script de troca atualizado. Seguro fazer direto (sem
 *  passar pelo .ps1): nada tem esse arquivo aberto, ele só dorme na pasta. */
async function autoUpdateSincronizarScript(dir) {
  try {
    const r = await fetch(PAGAR_MESA_URL + '/agente-release/auto-update.ps1', { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return;
    const texto = await r.text();
    if (!texto || texto.length < 200 || !texto.includes('HashEsperado')) return; // salvaguarda: resposta vazia/errada
    const destino = path.join(dir, 'auto-update.ps1');
    const atual = existsSync(destino) ? readFileSync(destino, 'utf8') : '';
    if (texto !== atual) { writeFileSync(destino, texto); console.log('[auto-update] auto-update.ps1 atualizado'); }
  } catch { /* offline agora — tenta no próximo ciclo */ }
}

async function autoUpdateAplicar(dir, versaoEsperada) {
  const resp = await fetch(PAGAR_MESA_URL + '/agente-release/vendas-local-server.mjs', { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error('download HTTP ' + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 8);
  if (hash !== versaoEsperada) {
    console.error('[auto-update] hash baixado (' + hash + ') não bate com o esperado (' + versaoEsperada + ') — não aplica, tenta de novo no próximo ciclo');
    return;
  }
  writeFileSync(path.join(dir, 'server.novo.mjs'), buf);
  console.log('[auto-update] aplicando ' + hash + ' — a loja fica ~15s fora do ar');
  const script = path.join(dir, 'auto-update.ps1');
  if (!existsSync(script)) { console.error('[auto-update] auto-update.ps1 não está na pasta — não dá pra aplicar sozinho ainda'); return; }
  const ps = spawn('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-HashEsperado', hash],
    { detached: true, stdio: 'ignore', windowsHide: true, cwd: dir });
  ps.unref();
  autoUpdatePendenteDesde = null;
}

async function loopAutoUpdate() {
  if (!AUTO_UPDATE) { console.log('[auto-update] desligado (AUTO_UPDATE=off)'); return; }
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    await autoUpdateSincronizarScript(dir);
    const r = await fetch(PAGAR_MESA_URL + '/api/agente-release/vendas-local-versao', { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    const nova = j && j.versao;
    if (!nova || nova === VERSAO) { autoUpdatePendenteDesde = null; }
    else {
      if (!autoUpdatePendenteDesde) { autoUpdatePendenteDesde = Date.now(); console.log('[auto-update] versão ' + nova + ' disponível'); }
      const esperando = Date.now() - autoUpdatePendenteDesde;
      const ocupada = await autoUpdateLojaOcupada();
      if (!ocupada || esperando > AUTO_UPDATE_FORCA_APOS_MS) {
        if (ocupada) console.log('[auto-update] loja ocupada há ' + Math.round(esperando / 3600000) + 'h esperando — aplica mesmo assim');
        await autoUpdateAplicar(dir, nova);
      } else {
        console.log('[auto-update] ' + nova + ' disponível, aguardando a loja ficar tranquila');
      }
    }
  } catch (e) { console.error('[auto-update] ' + e.message); }
  finally { setTimeout(loopAutoUpdate, AUTO_UPDATE_POLL_MS); }
}

async function loopEspelho() {
  try { const r = await comTimeout(espelho(), 90000, 'espelho travou (>90s) — pulando ciclo'); console.log(`[espelho] ok — ${r.comandas} comandas, ${r.itens} itens (${new Date().toLocaleTimeString('pt-BR')})`); }
  catch (e) { ultimoStatus = { ...ultimoStatus, ok: false }; await sql`UPDATE sync_estado SET ultimo_erro=${String(e.message).slice(0, 200)} WHERE id=1`.catch(() => {}); console.error('[espelho] ERRO:', e.message); }
  finally { setTimeout(loopEspelho, INTERVALO_MS); }
}

// ==================== iFood (integração direta) ====================
// Hoje quem integra é o Consumer: o pedido do iFood nasce no Firebird e o
// espelho acima o traz como comanda origem=4. O iFood só aceita UMA
// integradora por loja — quando a loja for autorizada no NOSSO app, o Consumer
// para de receber e o pedido passa a nascer AQUI.
//
// Por isso tudo abaixo nasce DESLIGADO (ifood_ativo=0): enquanto você não
// parear a loja na tela /ifood, nenhuma chamada sai e nada muda na operação.
const IFOOD_BASE = process.env.IFOOD_BASE || 'https://merchant-api.ifood.com.br';
// 30s é o intervalo que o iFood manda usar e também o limite: uma chamada a
// cada 30s por token. Abaixo disso vem 429 e o cliente é bloqueado.
const IFOOD_POLL_MS = Number(process.env.IFOOD_POLL_MS || 30000);
const IFOOD_ORIGEM = 4; // mesmo código de origem que o Consumer usa pro iFood
let ifoodStatus = { ativo: false, pareado: false, ultimo_ok: null, ultimo_erro: null, abertos: 0 };

async function ifoodConf() {
  // DOIS tipos de app, e o fluxo de autenticação muda inteiro:
  //   centralizado — a loja é do mesmo dono do app: client_credentials e pronto.
  //   distribuído  — a loja autoriza o app no Portal do Parceiro (é assim que o
  //                  Consumer está autorizado na Prainha Bar), e aí vale
  //                  userCode → authorization_code → refresh_token rotativo.
  const modo = await cfgGet('ifood_auth', 'centralizado');
  const clientId = process.env.IFOOD_CLIENT_ID || (await cfgGet('ifood_client_id', ''));
  const clientSecret = process.env.IFOOD_CLIENT_SECRET || (await cfgGet('ifood_client_secret', ''));
  const refreshToken = await cfgGet('ifood_refresh_token', '');
  return {
    ativo: (await cfgGet('ifood_ativo', '0')) === '1',
    autoConfirmar: (await cfgGet('ifood_auto_confirmar', '1')) === '1',
    modo, clientId, clientSecret, refreshToken,
    merchantId: await cfgGet('ifood_merchant_id', ''),
    // "pronto pra falar com o iFood": no centralizado basta a credencial;
    // no distribuído só depois que a loja autorizar.
    pronto: !!(clientId && clientSecret) && (modo === 'centralizado' || !!refreshToken),
  };
}

/** Token de acesso. Vale ~6h; renovo com 10 min de folga pra nunca cair no meio
 *  de um polling. No distribuído o refresh_token é rotativo — o iFood devolve um
 *  novo a cada renovação, e perder ele significa parear a loja de novo na mão. */
async function ifoodToken(forcar = false) {
  const c = await ifoodConf();
  if (!c.clientId || !c.clientSecret) throw new Error('sem client_id/client_secret do iFood');
  const cache = await cfgGet('ifood_access_token', '');
  const expira = Number(await cfgGet('ifood_token_expira', '0'));
  if (!forcar && cache && Date.now() < expira - 10 * 60 * 1000) return cache;
  if (c.modo !== 'centralizado' && !c.refreshToken) throw new Error('loja não pareada — gere o código na tela /ifood');
  const corpo = c.modo === 'centralizado'
    ? new URLSearchParams({ grantType: 'client_credentials', clientId: c.clientId, clientSecret: c.clientSecret })
    : new URLSearchParams({
      grantType: 'refresh_token', clientId: c.clientId, clientSecret: c.clientSecret,
      refreshToken: c.refreshToken,
    });
  const r = await fetch(IFOOD_BASE + '/authentication/v1.0/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corpo,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('token iFood ' + r.status + ': ' + (j.error?.message || JSON.stringify(j).slice(0, 200)));
  await cfgSet('ifood_access_token', j.accessToken);
  await cfgSet('ifood_token_expira', String(Date.now() + Number(j.expiresIn || 21600) * 1000));
  if (j.refreshToken) await cfgSet('ifood_refresh_token', j.refreshToken);
  return j.accessToken;
}

/** Chamada autenticada. 401 renova o token e repete UMA vez — token expirado
 *  no meio do expediente não pode virar pedido perdido. */
async function ifoodApi(caminho, { metodo = 'GET', corpo = null, headers = {}, cru = false } = {}) {
  let tentou = false;
  for (;;) {
    const tk = await ifoodToken(tentou);
    const r = await fetch(IFOOD_BASE + caminho, {
      method: metodo,
      headers: { authorization: 'Bearer ' + tk, ...(corpo ? { 'content-type': 'application/json' } : {}), ...headers },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 401 && !tentou) { tentou = true; continue; }
    if (cru) return r;
    if (r.status === 204 || r.status === 202) return {};
    const txt = await r.text();
    const j = txt ? JSON.parse(txt) : {};
    if (!r.ok) throw new Error('iFood ' + metodo + ' ' + caminho + ' → ' + r.status + ': ' + txt.slice(0, 300));
    return j;
  }
}

/** Testa a credencial e descobre as lojas que ela enxerga. É o passo que diz
 *  se o app é centralizado (client_credentials passa) e qual merchant usar. */
async function ifoodTestar() {
  try {
    await ifoodToken(true);
    const lojas = await ifoodApi('/merchant/v1.0/merchants');
    const lista = (Array.isArray(lojas) ? lojas : []).map((m) => ({ id: m.id, nome: m.name || m.corporateName }));
    if (lista.length === 1) await cfgSet('ifood_merchant_id', lista[0].id);
    return { ok: true, lojas: lista };
  } catch (e) { return { ok: false, erro: String(e.message).slice(0, 300) }; }
}

// ---- pareamento da loja (app distribuído, o mesmo fluxo do Consumer) ----
/** Passo 1: pede o código que você digita no Portal do Parceiro. */
async function ifoodParear() {
  const c = await ifoodConf();
  if (!c.clientId) return { ok: false, erro: 'preencha o client_id antes' };
  const r = await fetch(IFOOD_BASE + '/authentication/v1.0/oauth/userCode', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ clientId: c.clientId }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, erro: 'iFood ' + r.status + ': ' + JSON.stringify(j).slice(0, 200) };
  // o verifier é a metade secreta do par: sem ele o código autorizado não vira token
  await cfgSet('ifood_code_verifier', j.authorizationCodeVerifier || '');
  return { ok: true, codigo: j.userCode, url: j.verificationUrlComplete || j.verificationUrl, expira_seg: j.expiresIn };
}

/** Passo 2: você autoriza no portal, ele mostra um código, e ele vira token. */
async function ifoodConcluirPareamento(authorizationCode) {
  const c = await ifoodConf();
  const verifier = await cfgGet('ifood_code_verifier', '');
  if (!authorizationCode) return { ok: false, erro: 'cole o código que o portal mostrou' };
  if (!verifier) return { ok: false, erro: 'gere o código de novo (o pareamento expirou)' };
  const r = await fetch(IFOOD_BASE + '/authentication/v1.0/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grantType: 'authorization_code', clientId: c.clientId, clientSecret: c.clientSecret,
      authorizationCode: String(authorizationCode).trim(), authorizationCodeVerifier: verifier,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, erro: 'iFood ' + r.status + ': ' + JSON.stringify(j).slice(0, 250) };
  await cfgSet('ifood_access_token', j.accessToken || '');
  await cfgSet('ifood_refresh_token', j.refreshToken || '');
  await cfgSet('ifood_token_expira', String(Date.now() + Number(j.expiresIn || 21600) * 1000));
  // já descobre a loja: com uma só, dispensa configuração manual do merchantId
  try {
    const lojas = await ifoodApi('/merchant/v1.0/merchants');
    if (Array.isArray(lojas) && lojas.length === 1) await cfgSet('ifood_merchant_id', lojas[0].id);
    return { ok: true, lojas: (lojas || []).map((m) => ({ id: m.id, nome: m.name })) };
  } catch { return { ok: true, lojas: [] }; }
}

// ---- recebimento: polling a cada 30s ----
const IFOOD_ST = { PLC: 'PLACED', CFM: 'CONFIRMED', DSP: 'DISPATCHED', CON: 'CONCLUDED', CAN: 'CANCELLED',
  RTP: 'READY_TO_PICKUP', SPS: 'SEPARATION_STARTED', CAR: 'CANCELLATION_REQUESTED' };

async function ifoodPoll() {
  const c = await ifoodConf();
  if (!c.ativo) { ifoodStatus = { ...ifoodStatus, ativo: false }; return; }
  const h = c.merchantId ? { 'x-polling-merchants': c.merchantId } : {};
  const r = await ifoodApi('/order/v1.0/events:polling', { headers: h, cru: true });
  if (!r.ok && r.status !== 204) throw new Error('polling ' + r.status + ': ' + (await r.text()).slice(0, 200));
  // 204 = nada novo, e é o caso NORMAL. Ainda assim segue pra projeção: é ela
  // que faz o agendado entrar na hora certa, que devolve o pedido pra cozinha
  // se o espelho tiver truncado, e que tira da tela o que já concluiu.
  const eventos = r.status === 204 ? [] : await r.json();
  const paraAck = [];
  for (const ev of eventos || []) {
    const code = IFOOD_ST[ev.code] || ev.code || ev.fullCode || '';
    // PERSISTE PRIMEIRO, dá o ack DEPOIS: se o processo morrer aqui, o iFood
    // devolve o evento no próximo ciclo e o PK evita processar duas vezes.
    const novo = await sql`INSERT INTO ifood_evento (id, code, order_id) VALUES (${ev.id}, ${code}, ${ev.orderId})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    paraAck.push({ id: ev.id });
    if (!novo.length) continue; // já tratado antes
    try {
      await ifoodAplicarEvento(ev.orderId, code, c);
      await sql`UPDATE ifood_evento SET ack_em=now() WHERE id=${ev.id}`;
    } catch (e) {
      await sql`UPDATE ifood_evento SET erro=${String(e.message).slice(0, 250)} WHERE id=${ev.id}`;
      console.error('[ifood] evento', code, ev.orderId, '—', e.message);
    }
  }
  if (paraAck.length) {
    await ifoodApi('/order/v1.0/events/acknowledgment', { metodo: 'POST', corpo: paraAck }).catch((e) =>
      console.error('[ifood] ack falhou:', e.message));
  }
  await projetarIfood();
  const [ab] = await sql`SELECT count(*)::int n FROM ifood_pedido WHERE concluido_em IS NULL AND cancelado_em IS NULL`;
  ifoodStatus = { ativo: true, pareado: true, ultimo_ok: new Date().toISOString(), ultimo_erro: null, abertos: ab?.n || 0 };
}

async function ifoodAplicarEvento(orderId, code, c) {
  if (!orderId) return;
  if (code === 'PLACED' || code === 'CONFIRMED') await ifoodBaixarPedido(orderId);
  // o lançamento financeiro segue o evento, não o comando: só o evento diz que
  // o iFood REALMENTE aceitou (o confirm responde 202 e pode não valer)
  if (code === 'CONFIRMED') await lancarReceberCanal(orderId, 'abrir').catch((e) => console.error('[ifood] receber-canal:', e.message));
  if (code === 'CANCELLED') await lancarReceberCanal(orderId, 'cancelar').catch((e) => console.error('[ifood] receber-canal:', e.message));
  const carimbo = { CONFIRMED: 'confirmado_em', DISPATCHED: 'despachado_em', CONCLUDED: 'concluido_em', CANCELLED: 'cancelado_em' }[code];
  if (carimbo) {
    await sql`UPDATE ifood_pedido SET status=${code}, ${sql(carimbo)}=COALESCE(${sql(carimbo)}, now()) WHERE id=${orderId}`;
  } else if (code === 'CANCELLATION_REQUESTED') {
    // cliente pediu pra cancelar: NÃO decide sozinho — a loja aceita ou nega
    await sql`UPDATE ifood_pedido SET cancel_pedido_em=now() WHERE id=${orderId}`;
  } else if (code) {
    await sql`UPDATE ifood_pedido SET status=${code} WHERE id=${orderId}`;
  }
  // aceitar o pedido é o que tira ele da fila do cliente. Manual atrasa e o
  // iFood cobra tempo de aceite — por isso o padrão é confirmar sozinho.
  if (code === 'PLACED' && c.autoConfirmar) {
    await ifoodComando(orderId, 'confirmar').catch((e) => console.error('[ifood] auto-confirmar:', e.message));
  }
}

/** O "Código de PDV" que o cardápio do iFood carrega em cada item é o que diz
 *  em QUAL praça o prato sai. Só que no Consumer existem DOIS códigos e eles se
 *  sobrepõem quase inteiros (na Prainha, 2042 números valem nos dois):
 *    · PRODUTODETALHE.CODIGO — a variante (o nosso produto_local.codigo_pdv)
 *    · PRODUTOS.CODIGO       — o produto (o nosso produto_local.produto_codigo)
 *  Chutar "tenta um, senão o outro" mandaria o PRATO ERRADO pra cozinha sem
 *  ninguém perceber. O dono confirmou em 23/08/2026 que o cardápio do iFood
 *  carrega o código do PRODUTO — por isso é esse o padrão. A config
 *  ifood_codigo_pdv continua existindo (uma casa pode ter cadastrado
 *  diferente), e o NOME vindo do iFood confere o que o código achou: se não
 *  bate, o item sai avisado — melhor a cozinha ler um alerta do que fritar
 *  outra coisa. */
function parecido(a, b) {
  const t = (s) => new Set(semAcento(String(s || '')).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const A = t(a), B = t(b);
  if (!A.size || !B.size) return true; // sem nome pra comparar: não acusa à toa
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) >= 0.34;
}
async function ifoodResolverProduto(cod, nomeIfood) {
  if (!cod) return { codigo_pdv: null, area_codigo: null, aviso: '[SEM CÓDIGO DE PDV]' };
  const modo = await cfgGet('ifood_codigo_pdv', 'produto');
  const porVariante = modo !== 'produto';
  const acha = async (v) => (await sql`SELECT codigo_pdv, produto_codigo, nome, area_codigo FROM produto_local
    WHERE ${v ? sql`codigo_pdv` : sql`produto_codigo`}=${cod} ORDER BY codigo_pdv LIMIT 1`)[0];
  const p = await acha(porVariante);
  if (!p) {
    // não existe no espaço configurado: se existir no outro, o cadastro do
    // cardápio está no formato oposto — dizer isso poupa caça ao erro
    const outro = await acha(!porVariante);
    return { codigo_pdv: null, area_codigo: null,
      aviso: outro ? '[CÓDIGO ' + cod + ' PARECE SER DE ' + (porVariante ? 'PRODUTO' : 'VARIANTE') + ' — ajuste em /ifood]'
                   : '[CÓDIGO ' + cod + ' NÃO EXISTE AQUI]' };
  }
  return { codigo_pdv: p.codigo_pdv, area_codigo: p.area_codigo,
    aviso: parecido(nomeIfood, p.nome) ? null : '[CONFERIR: código ' + cod + ' aqui é "' + p.nome + '"]' };
}

/** Detalhe do pedido → nossas tabelas. Reescreve os itens: pedido editado no
 *  iFood (item em falta, troca) chega como evento novo e tem que refletir. */
async function ifoodBaixarPedido(orderId) {
  const o = await ifoodApi('/order/v1.0/orders/' + encodeURIComponent(orderId));
  const ent = o.delivery || {};
  const end = ent.deliveryAddress || {};
  const endereco = [end.formattedAddress || [end.streetName, end.streetNumber].filter(Boolean).join(', '),
    end.complement, end.neighborhood, end.reference].filter(Boolean).join(' · ') || null;
  const pago = (o.payments?.methods || []).some((m) => String(m.type).toUpperCase() === 'ONLINE') || Number(o.payments?.prepaid || 0) > 0;
  const linha = {
    id: o.id, display_id: o.displayId || null, merchant_id: o.merchant?.id || null,
    status: o.status || 'PLACED', tipo: o.orderType || 'DELIVERY',
    // quem leva: IFOOD (entregador da plataforma) ou MERCHANT (nosso motoboy).
    // Muda o comando de saída: readyToPickup num caso, dispatch no outro.
    modo_entrega: ent.deliveredBy || (o.orderType === 'TAKEOUT' ? 'CLIENTE' : null),
    cliente_nome: o.customer?.name || null,
    cliente_fone: o.customer?.phone?.number || null,
    endereco, total: Number(o.total?.orderAmount ?? 0) || 0,
    taxa_entrega: Number(o.total?.deliveryFee ?? 0) || 0, pago_online: pago,
    agendado_para: o.schedule?.deliveryDateTimeStart || null,
    criado_em: o.createdAt || null, payload: JSON.stringify(o),
  };
  await sql`INSERT INTO ifood_pedido ${sql(linha)}
    ON CONFLICT (id) DO UPDATE SET
      display_id=EXCLUDED.display_id, merchant_id=EXCLUDED.merchant_id, status=EXCLUDED.status,
      tipo=EXCLUDED.tipo, modo_entrega=EXCLUDED.modo_entrega, cliente_nome=EXCLUDED.cliente_nome,
      cliente_fone=EXCLUDED.cliente_fone, endereco=EXCLUDED.endereco, total=EXCLUDED.total,
      taxa_entrega=EXCLUDED.taxa_entrega, pago_online=EXCLUDED.pago_online,
      agendado_para=EXCLUDED.agendado_para, payload=EXCLUDED.payload`;

  const itens = [];
  for (const [i, it] of (o.items || []).entries()) {
    const cod = Number(String(it.externalCode || '').replace(/\D/g, '')) || null;
    const alvo = await ifoodResolverProduto(cod, it.name);
    const extras = (it.options || []).map((op) => (Number(op.quantity) > 1 ? op.quantity + 'x ' : '') + op.name).join(', ');
    const det = [extras, it.observations, alvo.aviso].filter(Boolean).join(' · ');
    itens.push({ pedido_id: o.id, seq: i, codigo_pdv: alvo.codigo_pdv, nome: it.name || 'item',
      quantidade: Number(it.quantity || 1), valor_total: Number(it.totalPrice ?? it.price ?? 0) || 0,
      detalhes: det.trim() || null, area_codigo: alvo.area_codigo });
  }
  // item_codigo é bigserial e o KDS guarda "pronto/entregue" por ele: trocar os
  // itens reabre o que já foi marcado. Só reescreve quando MUDOU de verdade.
  const atuais = await sql`SELECT seq, codigo_pdv, nome, quantidade, detalhes FROM ifood_item WHERE pedido_id=${o.id} ORDER BY seq`;
  const chave = (l) => l.map((x) => [x.seq, x.codigo_pdv, x.nome, Number(x.quantidade), x.detalhes].join('|')).join('¬');
  if (chave(atuais) !== chave(itens)) {
    await sql`DELETE FROM ifood_item WHERE pedido_id=${o.id}`;
    if (itens.length) await sql`INSERT INTO ifood_item ${sql(itens, 'pedido_id', 'seq', 'codigo_pdv', 'nome', 'quantidade', 'valor_total', 'detalhes', 'area_codigo')}`;
  }
  return linha;
}

// ---- controle: os comandos que mudam o pedido lá no iFood ----
const IFOOD_ACOES = {
  confirmar: 'confirm', despachar: 'dispatch', pronto: 'readyToPickup',
  cancelar: 'requestCancellation', aceitar_cancel: 'acceptCancellation', negar_cancel: 'denyCancellation',
};
/** Cancelar EXIGE motivo, e o motivo tem que sair da lista que o iFood dá pra
 *  AQUELE pedido (é critério de homologação: quem cancela escolhe da lista, o
 *  PDV não inventa código). Sem isso o primeiro cancelamento voltaria erro. */
async function ifoodMotivosCancel(orderId) {
  const r = await ifoodApi('/order/v1.0/orders/' + encodeURIComponent(orderId) + '/cancellationReasons');
  const lista = Array.isArray(r) ? r : (r.reasons || []);
  return { ok: true, motivos: lista.map((m) => ({
    codigo: String(m.cancelCodeId ?? m.code ?? m.cancellationCode ?? ''),
    descricao: m.description || m.reason || '',
  })).filter((m) => m.codigo) };
}

async function ifoodComando(orderId, acao, extra = null) {
  const caminho = IFOOD_ACOES[acao];
  if (!caminho) return { ok: false, erro: 'ação desconhecida' };
  if (acao === 'cancelar') {
    const cod = String(extra?.codigo || '').trim();
    if (!cod) return { ok: false, erro: 'escolha o motivo do cancelamento' };
    // A documentação do iFood aparece nas DUAS formas: {reason, cancellationCode}
    // e {reason: "<código>"}. Manda a primeira e, se ela for recusada, repete na
    // segunda — cancelamento é raro e não pode falhar por causa de nome de campo.
    const url = '/order/v1.0/orders/' + encodeURIComponent(orderId) + '/' + caminho;
    try {
      await ifoodApi(url, { metodo: 'POST', corpo: { reason: extra.descricao || 'cancelamento pela loja', cancellationCode: cod } });
    } catch (e) {
      if (!/ 4\d\d/.test(String(e.message))) throw e;
      console.error('[ifood] cancelamento na 1ª forma falhou, tentando {reason:codigo}:', e.message);
      await ifoodApi(url, { metodo: 'POST', corpo: { reason: cod } });
    }
    await sql`UPDATE ifood_pedido SET cancelado_em=now(), cancel_motivo=${(extra.descricao || cod).slice(0, 120)} WHERE id=${orderId}`;
    return { ok: true };
  }
  await ifoodApi('/order/v1.0/orders/' + encodeURIComponent(orderId) + '/' + caminho, { metodo: 'POST', corpo: extra });
  // O iFood responde 202: o status só vale quando o evento correspondente
  // voltar no polling. O carimbo local aqui é otimista, pra tela não ficar
  // parada 30s — o evento depois confirma (ou corrige).
  const campo = { confirmar: 'confirmado_em', despachar: 'despachado_em' }[acao];
  if (campo) await sql`UPDATE ifood_pedido SET ${sql(campo)}=COALESCE(${sql(campo)}, now()) WHERE id=${orderId}`;
  if (acao === 'aceitar_cancel') await sql`UPDATE ifood_pedido SET cancelado_em=now(), cancel_pedido_em=NULL WHERE id=${orderId}`;
  if (acao === 'negar_cancel') await sql`UPDATE ifood_pedido SET cancel_pedido_em=NULL WHERE id=${orderId}`;
  return { ok: true };
}

/** O PULO DO GATO: o pedido do iFood entra nas MESMAS tabelas do espelho, com
 *  código negativo (o Firebird só tem positivo). Assim o KDS, a tela de
 *  entrega, o "marca" de pronto/entregue e a impressora de comanda funcionam
 *  sem saber que existe iFood — origem=4 já é lida como delivery lá em cima.
 *
 *  Roda em DOIS momentos: logo depois do espelho (que dá TRUNCATE nas duas
 *  tabelas) e a cada polling. O segundo é o que garante pedido na cozinha
 *  mesmo com o Consumer/Firebird fora do ar. */
async function projetarIfood() {
  const peds = await sql`SELECT * FROM ifood_pedido
    WHERE cancelado_em IS NULL AND concluido_em IS NULL
      AND (agendado_para IS NULL OR agendado_para <= now() + interval '1 hour')
      AND recebido_em > now() - interval '2 days'`;
  if (!peds.length) {
    await sql.begin(async (t) => {
      await t`DELETE FROM comanda_item WHERE comanda_codigo < 0`;
      await t`DELETE FROM comanda WHERE codigo < 0`;
    });
    return 0;
  }
  const ids = peds.map((p) => p.id);
  const itens = await sql`SELECT * FROM ifood_item WHERE pedido_id = ANY(${ids}) ORDER BY pedido_id, seq`;
  const comandas = peds.map((p) => ({
    codigo: -Number(p.seq), numero: 0, origem: IFOOD_ORIGEM,
    // o nome carrega o que a cozinha e a entrega precisam ler de relance
    nome: ('iFood #' + (p.display_id || '') + (p.cliente_nome ? ' · ' + p.cliente_nome : '')).trim(),
    valor_total: Number(p.total || 0), subtotal_pago: p.pago_online ? Number(p.total || 0) : 0,
    qtd_pessoas: 1, data_abertura: p.criado_em || p.recebido_em, conta_pedida: false,
  }));
  const porId = new Map(peds.map((p) => [p.id, p]));
  const linhas = itens.map((i) => ({
    item_codigo: -Number(i.item_codigo), codigo_pai: null,
    comanda_codigo: -Number(porId.get(i.pedido_id).seq), codigo_pdv: i.codigo_pdv,
    criado: porId.get(i.pedido_id).criado_em || porId.get(i.pedido_id).recebido_em,
    nome: i.nome, quantidade: Number(i.quantidade || 1), valor_total: Number(i.valor_total || 0),
    tipo: 1, detalhes: i.detalhes, area_codigo: i.area_codigo, produzido: null, entregue: null,
    colaborador: null, colaborador_nome: 'iFood',
  }));
  const gravar = async (t) => {
    await t`DELETE FROM comanda_item WHERE comanda_codigo < 0`;
    await t`DELETE FROM comanda WHERE codigo < 0`;
    await t`INSERT INTO comanda ${t(comandas, 'codigo', 'numero', 'origem', 'nome', 'valor_total', 'subtotal_pago', 'qtd_pessoas', 'data_abertura', 'conta_pedida')}`;
    if (linhas.length) await t`INSERT INTO comanda_item ${t(linhas, 'item_codigo', 'codigo_pai', 'comanda_codigo', 'codigo_pdv', 'criado', 'nome', 'quantidade', 'valor_total', 'tipo', 'detalhes', 'area_codigo', 'produzido', 'entregue', 'colaborador', 'colaborador_nome')}`;
  };
  await sql.begin(gravar);
  return comandas.length;
}

/** A configuração do iFood vem do Concilia (Configurações → iFood), não da
 *  tela local: cada casa é um merchant diferente e quem administra isso é o
 *  escritório, não quem está no caixa.
 *
 *  Só aplica quando o que veio da nuvem MUDOU desde a última vez. Sem isso,
 *  um ajuste feito aqui na loja (pra destravar alguma coisa no meio do
 *  expediente) seria desfeito no ciclo seguinte, sem ninguém entender por quê.
 *  Nuvem fora do ar ou filial sem cadastro lá: mantém o que está gravado. */
async function puxarConfigIfood() {
  if (!PAGAR_MESA_SECRET || PAGAR_MESA_SECRET.length < 16 || !FILIAL_ID) return;
  const e = Math.floor(Date.now() / 1000) + 120;
  const s = createHmac('sha256', PAGAR_MESA_SECRET).update([FILIAL_ID, String(e)].join('|')).digest('hex');
  const q = new URLSearchParams({ f: FILIAL_ID, e: String(e), s });
  const r = await fetch(`${PAGAR_MESA_URL}/api/loja/ifood-config?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('config do iFood: HTTP ' + r.status);
  const c = await r.json();
  if (!c || !c.configurada) return; // nada cadastrado lá: não mexe no que tem aqui

  const assinatura = createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 16);
  if ((await cfgGet('ifood_nuvem_hash', '')) === assinatura) return;

  const pares = [
    ['ifood_client_id', c.client_id || ''],
    ['ifood_client_secret', c.client_secret || ''],
    ['ifood_merchant_id', c.merchant_id || ''],
    ['ifood_auth', c.modo === 'distribuido' ? 'distribuido' : 'centralizado'],
    ['ifood_codigo_pdv', c.codigo_pdv === 'produto' ? 'produto' : 'variante'],
    ['ifood_auto_confirmar', c.auto_confirmar ? '1' : '0'],
    ['ifood_ativo', c.ativo ? '1' : '0'],
  ];
  for (const [k, v] of pares) { if (v !== '') await cfgSet(k, v); }
  await cfgSet('ifood_nuvem_hash', assinatura);
  console.log('[ifood] config atualizada pelo Concilia (ativo=' + (c.ativo ? 'sim' : 'nao') + ')');
}

async function loopIfood() {
  try {
    await puxarConfigIfood().catch((e) => console.error('[ifood] config da nuvem:', e.message));
    const c = await ifoodConf();
    if (c.ativo && c.pronto) {
      await comTimeout(ifoodPoll(), 25000, 'polling travou (>25s)');
      // a comanda do iFood sai no papel pelo mesmo caminho da comanda da mesa
      await imprimirComandasNovas().catch((e) => console.error('[ifood] impressora:', e.message));
    }
  } catch (e) {
    ifoodStatus = { ...ifoodStatus, ultimo_erro: String(e.message).slice(0, 200) };
    console.error('[ifood] ERRO:', e.message);
  } finally { setTimeout(loopIfood, IFOOD_POLL_MS); }
}

/** O dinheiro do pedido pago no app fica COM O IFOOD até o repasse. Sem este
 *  lançamento, o repasse cairia no banco sem contrapartida no sistema — e no
 *  caixa o pedido pareceria dívida do cliente, que é o erro que a conta a
 *  receber de canal veio corrigir.
 *
 *  Nasce no ACEITE (não na chegada): pedido recusado nunca vira dinheiro.
 *  Pedido pago na entrega não entra aqui — esse dinheiro passa pelo caixa. */
async function lancarReceberCanal(pedidoId, acao = 'abrir') {
  if (!PAGAR_MESA_SECRET || PAGAR_MESA_SECRET.length < 16 || !FILIAL_ID) return;
  const [p] = await sql`SELECT * FROM ifood_pedido WHERE id=${pedidoId}`;
  if (!p) return;
  if (acao === 'abrir' && !p.pago_online) return; // recebe na entrega: é do caixa
  const e = Math.floor(Date.now() / 1000) + 120;
  const s = createHmac('sha256', PAGAR_MESA_SECRET).update([FILIAL_ID, 'receber-canal', String(e)].join('|')).digest('hex');
  const r = await fetch(`${PAGAR_MESA_URL}/api/loja/receber-canal`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      f: FILIAL_ID, e, s, acao, canal: 'ifood', pedido_ref: p.id,
      display_id: p.display_id, nome_cliente: p.cliente_nome,
      data_pedido: p.criado_em || p.recebido_em, valor_bruto: Number(p.total || 0),
      observacao: acao === 'cancelar' ? 'cancelado no iFood' : undefined,
    }),
  });
  if (!r.ok) throw new Error('receber-canal HTTP ' + r.status);
}

// ---- LOJA ABERTA / PAUSADA no iFood (módulo Merchant) ----
// Pausar é a válvula de escape do dia a dia: cozinha afogada, faltou insumo,
// entregador sumiu. Sem isso o pedido continua entrando e a loja leva nota
// ruim por atraso. NÃO mexe no horário de funcionamento — a pausa é temporária
// e o iFood reabre sozinho na hora marcada.
async function ifoodLojaStatus() {
  const c = await ifoodConf();
  if (!c.merchantId) return { ok: false, erro: 'sem merchant_id configurado' };
  const base = '/merchant/v1.0/merchants/' + encodeURIComponent(c.merchantId);
  const [st, itr] = await Promise.all([
    ifoodApi(base + '/status').catch(() => null),
    ifoodApi(base + '/interruptions').catch(() => []),
  ]);
  const linha = Array.isArray(st) ? (st.find((x) => x.operation === 'DELIVERY' || x.operation === 'delivery') || st[0]) : st;
  // Uma pausa ATIVA agora é o sinal confiável de "não está recebendo": o
  // /status da loja de teste não reflete a interrupção (conferido em 23/08 —
  // pausa criada e listada, status seguiu "Loja aberta"). Confiar só no status
  // faria a tela dizer que está aberta com a loja pausada de verdade.
  const agora = Date.now();
  const dentro = (i) => {
    const ini = Date.parse(i.start), fim = Date.parse(i.end);
    return Number.isFinite(ini) && Number.isFinite(fim) && ini <= agora && agora <= fim;
  };
  const pausas = (Array.isArray(itr) ? itr : []);
  const pausada = pausas.some(dentro);
  return {
    ok: true,
    aberta: !!linha?.available && !pausada,
    pausada,
    titulo: pausada ? 'Pausada pela loja' : (linha?.message?.title || (linha?.available ? 'Loja aberta' : 'Loja fechada')),
    // o motivo de estar fechada vem nas validações (fora do horário, sem
    // conexão, pausada): é o que responde "por que não entra pedido?"
    motivos: (linha?.validations || []).filter((v) => v.state !== 'OK').map((v) => v.message?.title || v.code),
    pausas: pausas.map((i) => ({
      id: i.id, descricao: i.description || '', inicio: i.start, fim: i.end,
    })),
  };
}
async function ifoodPausar(minutos, motivo) {
  const c = await ifoodConf();
  if (!c.merchantId) return { ok: false, erro: 'sem merchant_id configurado' };
  const min = Math.min(24 * 60, Math.max(5, Number(minutos) || 30));
  const agora = new Date();
  // 1 min de folga no início: relógio da loja adiantado fazia o iFood recusar
  // a pausa por "start no passado".
  const inicio = new Date(agora.getTime() - 60 * 1000);
  const fim = new Date(agora.getTime() + min * 60 * 1000);
  // ⚠️ FUSO: o iFood lê start/end no fuso DA LOJA, e toISOString() devolve UTC.
  // Mandar UTC fazia a pausa das 12:00 BRT nascer marcada pras 12:00 no fuso da
  // loja — 3 horas no futuro. A loja continuava recebendo pedido e ninguém
  // entendia por quê (conferido em 23/08: pausa criada, aceita, e sem efeito).
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  await ifoodApi('/merchant/v1.0/merchants/' + encodeURIComponent(c.merchantId) + '/interruptions', {
    metodo: 'POST',
    corpo: { description: String(motivo || 'Pausa pela loja').slice(0, 100), start: iso(inicio), end: iso(fim) },
  });
  return { ok: true, minutos: min };
}
async function ifoodRetomar(id) {
  const c = await ifoodConf();
  if (!c.merchantId) return { ok: false, erro: 'sem merchant_id configurado' };
  const base = '/merchant/v1.0/merchants/' + encodeURIComponent(c.merchantId) + '/interruptions';
  // sem id = tira TODAS as pausas (é o que "voltar a receber" quer dizer pra
  // quem está no caixa; duas pausas sobrepostas manteriam a loja fechada)
  const alvos = id ? [id] : (await ifoodApi(base).catch(() => [])).map((i) => i.id);
  for (const a of alvos) {
    await ifoodApi(base + '/' + encodeURIComponent(a), { metodo: 'DELETE' }).catch((e) =>
      console.error('[ifood] retomar', a, e.message));
  }
  return { ok: true, removidas: alvos.length };
}

/** A NOTA do pedido, na térmica do caixa: é o papel que vai com a sacola.
 *  Traz endereço, telefone e a forma de pagamento — quem entrega precisa saber
 *  se cobra alguma coisa na porta ou se já está pago. */
async function imprimirNotaIfood(pedidoId) {
  const [p] = await sql`SELECT * FROM ifood_pedido WHERE id=${pedidoId} OR seq=${Number(pedidoId) || -1}`;
  if (!p) return { ok: false, erro: 'pedido não encontrado' };
  const ip = (await cfgGet('impressora_ip', '')).trim();
  if (!ip) return { ok: false, erro: 'esta loja não tem impressora configurada (Ajustes → impressora)' };
  const itens = await sql`SELECT * FROM ifood_item WHERE pedido_id=${p.id} ORDER BY seq`;

  const b = [IMP.init, IMP.centro, IMP.grande, impLn('iFood #' + (p.display_id || '')), IMP.norm];
  b.push(impLn(p.tipo === 'TAKEOUT' ? 'RETIRADA NA LOJA' : (p.modo_entrega === 'MERCHANT' ? 'ENTREGA NOSSA' : 'ENTREGADOR iFOOD')));
  b.push(IMP.esquerda, impTraco());
  b.push(impLn(p.cliente_nome || ''));
  if (p.cliente_fone) b.push(impLn('Fone: ' + p.cliente_fone));
  if (p.endereco) for (const l of String(p.endereco).split(' · ')) b.push(impLn(l));
  if (p.agendado_para) b.push(IMP.neg, impLn('AGENDADO ' + impHm(p.agendado_para)), IMP.negFim);
  b.push(impTraco());
  for (const i of itens) {
    b.push(...impLinhasItem(impQtd(i.quantidade) + ' ' + i.nome, impMoeda(i.valor_total)));
    for (const d of impDetalhes(i.detalhes)) b.push(impLn('   ' + d));
  }
  b.push(impTraco());
  if (Number(p.taxa_entrega)) b.push(impLR('Taxa de entrega', impMoeda(p.taxa_entrega)));
  b.push(IMP.neg, impLR('TOTAL', impMoeda(p.total)), IMP.negFim);
  // A linha que evita cobrar duas vezes — ou esquecer de cobrar.
  b.push(IMP.centro, IMP.alto, impLn(p.pago_online ? 'PAGO NO APP' : 'RECEBER NA ENTREGA'), IMP.norm, IMP.esquerda);
  b.push(impLn(impHm(p.recebido_em)), IMP.corte);
  await imprimirRaw(ip, Buffer.concat(b), 'nota iFood #' + (p.display_id || ''));
  return { ok: true };
}

/** Tela /ifood: estado + pedidos abertos, no mesmo formato da lista do Consumer. */
async function apiIfood() {
  const c = await ifoodConf();
  const peds = await sql`SELECT p.*, (SELECT count(*)::int FROM ifood_item i WHERE i.pedido_id=p.id) itens
    FROM ifood_pedido p
    WHERE p.recebido_em > now() - interval '2 days'
    ORDER BY (p.concluido_em IS NULL AND p.cancelado_em IS NULL) DESC, p.recebido_em DESC LIMIT 60`;
  return {
    ok: true, ativo: c.ativo, auto_confirmar: c.autoConfirmar, modo: c.modo, pronto: c.pronto,
    tem_credencial: !!(c.clientId && c.clientSecret), pareado: !!c.refreshToken,
    client_id: c.clientId ? c.clientId.slice(0, 8) + '…' : '', merchant_id: c.merchantId,
    status: ifoodStatus, poll_seg: Math.round(IFOOD_POLL_MS / 1000),
    codigo_pdv: await cfgGet('ifood_codigo_pdv', 'produto'),
    pedidos: peds.map((p) => ({
      id: p.id, display_id: p.display_id, status: p.status, tipo: p.tipo, modo_entrega: p.modo_entrega,
      cliente: p.cliente_nome, fone: p.cliente_fone, endereco: p.endereco,
      total: Number(p.total || 0), taxa: Number(p.taxa_entrega || 0), pago_online: p.pago_online,
      itens: p.itens, recebido_em: p.recebido_em, agendado_para: p.agendado_para,
      confirmado: !!p.confirmado_em, despachado: !!p.despachado_em,
      concluido: !!p.concluido_em, cancelado: !!p.cancelado_em, cancel_pedido: !!p.cancel_pedido_em,
    })),
  };
}

async function apiIfoodSalvar(b) {
  if (b.client_id != null) await cfgSet('ifood_client_id', String(b.client_id).trim());
  if (b.client_secret != null && String(b.client_secret).trim()) await cfgSet('ifood_client_secret', String(b.client_secret).trim());
  if (b.merchant_id != null) await cfgSet('ifood_merchant_id', String(b.merchant_id).trim());
  if (b.auto_confirmar != null) await cfgSet('ifood_auto_confirmar', b.auto_confirmar ? '1' : '0');
  if (b.codigo_pdv != null) await cfgSet('ifood_codigo_pdv', b.codigo_pdv === 'produto' ? 'produto' : 'variante');
  if (b.modo != null) {
    await cfgSet('ifood_auth', b.modo === 'distribuido' ? 'distribuido' : 'centralizado');
    await cfgSet('ifood_access_token', ''); // token do modo anterior não serve
  }
  if (b.ativo != null) {
    const c = await ifoodConf();
    // ligar sem credencial válida só encheria o log de erro a cada 30s
    if (b.ativo && !c.pronto) {
      return { ok: false, erro: c.modo === 'centralizado'
        ? 'preencha e teste a credencial antes de ligar'
        : 'pareie a loja no iFood antes de ligar' };
    }
    await cfgSet('ifood_ativo', b.ativo ? '1' : '0');
  }
  return { ok: true };
}

// ---- CATÁLOGO local (Firebird -> Postgres, a cada 5 min) ----
/** Traz as perguntas do Consumer pro espelho local. Sai junto do catalogo,
 *  no mesmo ciclo de 5 min — pergunta nova cadastrada la aparece aqui sozinha. */
async function espelhoPerguntas() {
  // no banco próprio o wizard chega pelo pacote da nuvem, não do Firebird
  if (nativo()) return;
  const pg = await q(`SELECT CODIGO, TRIM(DESCRICAO) D, QTDRESPOSTASMIN MN, QTDRESPOSTASMAX MX
      FROM WIZARDPERGUNTAS WHERE DATADELETE IS NULL`);
  if (!pg.ok) { console.error('[perguntas] ' + pg.err); return; }
  // nome da opcao: DESCRICAO -> OBSERVACAO -> nome do PRODUTO ligado
  const op = await q(`SELECT o.CODIGO, o.CODIGOWIZARDPERGUNTA PERG, o.PRECOPROMO PR,
        o.CODIGOPRODUTODETALHE PD,
        TRIM(COALESCE(NULLIF(TRIM(o.DESCRICAO),''), NULLIF(TRIM(o.OBSERVACAO),''), p.NOME)) NOME
      FROM WIZARDOPCOES o
      LEFT JOIN PRODUTODETALHE pd ON pd.CODIGO = o.CODIGOPRODUTODETALHE
      LEFT JOIN PRODUTOS p ON p.CODIGO = pd.CODIGOPRODUTO
      WHERE o.DATADELETE IS NULL`);
  const lig = await q(`SELECT CODIGOPRODUTODETALHE PDV, CODIGOWIZARDPERGUNTA PERG, ORDEM
      FROM WIZARD WHERE DATADELETE IS NULL`);
  if (!op.ok || !lig.ok) { console.error('[perguntas] opcoes/ligacoes indisponiveis'); return; }
  const perguntas = pg.rows.map((x) => ({ codigo: N(x.CODIGO), texto: T(x.D) || null,
    min: N(x.MN) || 0, max: N(x.MX) || 0 }));
  const opcoes = op.rows.map((x) => ({ codigo: N(x.CODIGO), pergunta: N(x.PERG),
    nome: T(x.NOME) || null, preco: N(x.PR) || 0, produto_pdv: N(x.PD) || null }))
    .filter((x) => x.nome);                       // opcao sem nome nao serve pra escolher
  const ligacoes = lig.rows.map((x) => ({ codigo_pdv: N(x.PDV), pergunta: N(x.PERG), ordem: N(x.ORDEM) || 0 }))
    .filter((x) => x.codigo_pdv && x.pergunta);
  await sql.begin(async (sql) => {
    await sql`TRUNCATE wizard_pergunta, wizard_opcao, wizard_produto`;
    if (perguntas.length) await sql`INSERT INTO wizard_pergunta ${sql(perguntas, 'codigo', 'texto', 'min', 'max')}`;
    if (opcoes.length) await sql`INSERT INTO wizard_opcao ${sql(opcoes, 'codigo', 'pergunta', 'nome', 'preco', 'produto_pdv')}`;
    if (ligacoes.length) await sql`INSERT INTO wizard_produto ${sql(ligacoes, 'codigo_pdv', 'pergunta', 'ordem')} ON CONFLICT DO NOTHING`;
  });
  console.log(`[perguntas] ok — ${perguntas.length} perguntas, ${opcoes.length} opções, ${ligacoes.length} vínculos`);
}
/** As perguntas de UM item, prontas pra tela. Só as que têm opção. */
async function apiPerguntas(codigoPdv) {
  const pdv = Number(codigoPdv);
  if (!(pdv > 0)) return { ok: false, erro: 'produto inválido' };
  const ps = await sql`SELECT p.codigo, p.texto, p.min, p.max, wp.ordem
    FROM wizard_produto wp JOIN wizard_pergunta p ON p.codigo = wp.pergunta
    WHERE wp.codigo_pdv = ${pdv} ORDER BY wp.ordem, p.codigo`;
  const out = [];
  for (const p of ps) {
    const ops = await sql`SELECT codigo, nome, preco FROM wizard_opcao
      WHERE pergunta = ${p.codigo} ORDER BY preco, nome`;
    if (!ops.length) continue;                    // pergunta sem opção não se responde
    out.push({ codigo: p.codigo, texto: p.texto || 'Escolha',
      min: Number(p.min) || 0, max: Number(p.max) || 0, opcoes: ops });
  }
  return { ok: true, perguntas: out };
}
async function espelhoCatalogo() {
  // No modo próprio o catálogo passa a vir da NUVEM (o cadastro já é nosso).
  // Enquanto essa parte não entra, o que existe em produto_local continua
  // valendo: melhor catálogo de ontem do que tela vazia no meio do serviço.
  if (nativo()) { await catalogoNativo().catch((e) => console.error('[catalogo]', e.message)); return; }
  // SALDO REAL de estoque: PRODUTOS.ESTOQUEATUAL e' CAMPO MORTO no Consumer
  // (zero nos 501 produtos controlados, positivo em nenhum). Quem tem a verdade
  // e' a ultima ESTOQUEMOVIMENTACAO de cada PRODUTODETALHE, no QTDFINAL.
  // Usar o campo errado marcava 156 produtos como "fora" — inclusive agua com
  // 131 em estoque. O certo sao 14.
  const est = await q(`SELECT em.CODIGOPRODUTODETALHE PDV, em.QTDFINAL QF
      FROM ESTOQUEMOVIMENTACAO em
      JOIN (SELECT CODIGOPRODUTODETALHE P, MAX(CODIGO) C FROM ESTOQUEMOVIMENTACAO
             WHERE DATADELETE IS NULL GROUP BY CODIGOPRODUTODETALHE) u ON u.C = em.CODIGO`);
  const saldo = new Map();
  if (est.ok) for (const x of est.rows) saldo.set(N(x.PDV), N(x.QF) || 0);
  else console.error('[catalogo] saldo de estoque indisponível:', est.err);

  // Pausado (pd.DATAPAUSADO) e descontinuado SOMEM do cardapio.
  // Estoque controlado zerado NAO some: vem marcado e a tela mostra cinza.
  const r = await q(`SELECT pd.CODIGO PDV, p.CODIGO PROD, TRIM(p.NOME) NOME, TRIM(pt.DESCRICAO) TAM, pd.PRECOVENDA PV, p.CODIGOCOZINHA COZ, pd.COMANDAMOBILE CM,
      TRIM(e.DESCRICAO) CAT, e.ORDEM CATORD, p.ESTOQUECONTROLADO ECTRL, p.ESTOQUEATUAL EATU,
      pd.CARDAPIODIGITAL CARDIG, TRIM(p.DESCRICAO) DESCR, TRIM(p.MODOPREPARO) PREPARO
    FROM PRODUTODETALHE pd JOIN PRODUTOS p ON p.CODIGO=pd.CODIGOPRODUTO
    LEFT JOIN PRODUTOTAMANHO pt ON pt.CODIGO=pd.CODIGOPRODUTOTAMANHO
    LEFT JOIN ETIQUETAS e ON e.CODIGO=p.CODIGOETIQUETA AND e.DATADELETE IS NULL
    WHERE pd.DATADELETE IS NULL AND pd.DATAPAUSADO IS NULL AND (p.DESCONTINUADO IS NULL OR p.DESCONTINUADO<>'S') AND pd.PRECOVENDA>0`);
  if (!r.ok) { console.error('[catalogo] ERRO:', r.err); return; }
  const rows = r.rows.map((x) => {
    const nome = T(x.NOME) || '?';
    const tam = T(x.TAM);
    // CHAR do Firebird vem com espaco a direita ("S   ") — T() apara antes de comparar.
    // Sem movimentação registrada não dá pra afirmar que zerou: trata como disponível.
    const pdv = N(x.PDV);
    const semEstoque = T(x.ECTRL) === 'S' && saldo.has(pdv) && saldo.get(pdv) <= 0;
    // quantidade em si: só faz sentido em produto de estoque controlado —
    // no resto fica null e a tela não mostra número nenhum.
    const estoque = T(x.ECTRL) === 'S' && saldo.has(pdv) ? saldo.get(pdv) : null;
    // nome_busca = nome+tamanho sem acento e minusculo. O garcom digita "acai",
    // "FILE", "caipirinha" e acha do mesmo jeito. Feito aqui em JS porque o
    // Postgres da loja e' o 9.5 legado (sem garantia da extensao unaccent).
    return { codigo_pdv: N(x.PDV), produto_codigo: N(x.PROD), nome, tamanho: tam, preco: N(x.PV) || 0, area_codigo: N(x.COZ), comanda_mobile: N(x.CM) === 1, nome_busca: semAcento(nome + ' ' + (tam || '')), categoria: T(x.CAT) || 'Outros', categoria_ordem: N(x.CATORD) ?? 999, sem_estoque: semEstoque, estoque,
      descricao: T(x.DESCR) || null, preparo: T(x.PREPARO) || null,
      // flag do proprio Consumer: o que NAO e' de cardapio digital some da
      // tela do cliente (servico, a maioria dos complementos), mas o garcom
      // continua vendo tudo — ele precisa lancar qualquer coisa.
      // ⚠️ A FLAG QUE VALE É A DA VARIANTE (PRODUTODETALHE), não a do produto.
      // São duas colunas com o mesmo nome e formatos diferentes: em PRODUTOS é
      // 'S'/'N', em PRODUTODETALHE é 1/0 — e discordam em 555 variantes. Lendo
      // a do produto, os 505 itens do Terraço ("T Absolut", "T Germana")
      // apareciam pro cliente, e outros 50 que deveriam aparecer sumiam.
      cardapio_digital: N(x.CARDIG) === 1 };
  });
  const redirCat = await mapaRedirPracas();
  if (redirCat.size) for (const r of rows) {
    if (r.area_codigo != null && redirCat.has(r.area_codigo)) r.area_codigo = redirCat.get(r.area_codigo);
  }
  // Produto que nasceu na NUVEM entra na mesma montagem. Sem isto ele sumiria
  // do cardápio a cada 5 minutos, no TRUNCATE. Faixa 900000+ não colide com o
  // Firebird (que está na casa dos 2 mil).
  const daNuvem = await sql`SELECT codigo_pdv, produto_codigo, nome, tamanho, preco, area_codigo,
      comanda_mobile, cardapio_digital, categoria, descricao FROM produto_nuvem`;
  const jaTem = new Set(rows.map((r) => r.codigo_pdv));
  for (const x of daNuvem) {
    if (jaTem.has(Number(x.codigo_pdv))) continue;
    const nome = T(x.nome) || '?';
    const tam = T(x.tamanho);
    rows.push({
      codigo_pdv: Number(x.codigo_pdv), produto_codigo: Number(x.produto_codigo), nome, tamanho: tam,
      preco: Number(x.preco) || 0, area_codigo: x.area_codigo == null ? null : Number(x.area_codigo),
      comanda_mobile: x.comanda_mobile !== false,
      nome_busca: semAcento(nome + ' ' + (tam || '')),
      categoria: T(x.categoria) || 'Outros', categoria_ordem: 999,
      sem_estoque: false, estoque: null, cardapio_digital: !!x.cardapio_digital,
      descricao: T(x.descricao) || null, preparo: null,
    });
  }
  await sql.begin(async (sql) => {
    await sql`TRUNCATE produto_local`;
    if (rows.length) await sql`INSERT INTO produto_local ${sql(rows, 'codigo_pdv', 'produto_codigo', 'nome', 'tamanho', 'preco', 'area_codigo', 'comanda_mobile', 'nome_busca', 'categoria', 'categoria_ordem', 'sem_estoque', 'estoque', 'cardapio_digital', 'descricao', 'preparo')}`;
  });
  // ---- perguntas do Consumer ----
  await espelhoPerguntas();
  // Observacoes que a casa ja tem cadastradas, ligadas ao GRUPO do produto:
  // "Mal passada" aparece em Porcoes, "Com gelo e limao" em Refrigerantes.
  // A casa nao usa COMPLEMENTOS (tabela vazia) — e' por aqui que o cliente
  // diz o ponto da carne sem precisar digitar.
  const obs = await q(`SELECT TRIM(e.DESCRICAO) GRUPO, TRIM(o.DESCRICAO) OBS
      FROM ETIQUETASOBSERVACOES eo
      JOIN ETIQUETAS e ON e.CODIGO = eo.CODIGOETIQUETA
      JOIN OBSERVACOES o ON o.CODIGO = eo.CODIGOOBSERVACAO`);
  if (obs.ok) {
    const linhas = obs.rows.map((x) => ({ categoria: T(x.GRUPO), texto: T(x.OBS) })).filter((x) => x.categoria && x.texto);
    await sql.begin(async (sql) => {
      await sql`TRUNCATE observacao_sugerida`;
      if (linhas.length) await sql`INSERT INTO observacao_sugerida ${sql(linhas, 'categoria', 'texto')}`;
    });
  }
  const fora = rows.filter((x) => x.sem_estoque).length;
  console.log(`[catalogo] ok — ${rows.length} produtos vendíveis (${fora} sem estoque)`);
}

// ---- WRITE-BACK no Consumer (caminho validado 13/06) ----
// Sequência: achar/criar PEDIDOS (BI trigger gera CODIGO) -> ITENSPEDIDO (IMPRESSO='N')
//            -> UPDATE VALORTOTAL -> job PEDIDOIMPRESSAO TIPO 1 (cozinha imprime ~3s)
const fbEsc = (s) => String(s == null ? '' : s).replace(/'/g, "''").slice(0, 190);
const fbNum = (v) => String(+Number(v || 0).toFixed(4));
// ─────────── operação no banco PRÓPRIO (BANCO=proprio) ───────────
// Mesmas primitivas do Firebird, escrevendo em `comanda`/`comanda_item` — as
// tabelas que o KDS, o garçom e o caixa JÁ leem. Por isso as telas não mudam
// uma linha: elas nunca falaram com o Firebird, falavam com o espelho.
async function pgAcharPedido(numero) {
  // igual ao Firebird: com duplicata, ganha o pedido que tem itens
  const r = await sql`SELECT c.codigo FROM comanda c WHERE c.numero=${Number(numero)}
      AND c.fechada_em IS NULL AND c.cancelada_em IS NULL
    ORDER BY (SELECT count(*) FROM comanda_item i
                WHERE i.comanda_codigo = c.codigo AND i.cancelado_em IS NULL) DESC,
             c.codigo DESC LIMIT 1`;
  return r.length ? Number(r[0].codigo) : null;
}
async function pgCriarPedido(numero) {
  const cod = await proxCodigo('pedido');
  await sql`INSERT INTO comanda (codigo, numero, origem, valor_total, subtotal_pago, qtd_pessoas,
      data_abertura, total_itens, total_servico, percentual_servico, total_desconto, total_acrescimo, valor_entrega)
    VALUES (${cod}, ${Number(numero)}, ${VENDA_ORIGEM_FB}, 0, 0, 1, now(), 0, 0, ${TAXA_SERVICO}, 0, 0, 0)`;
  return cod;
}
/** A praça do item, com as MESMAS regras que o espelho aplicava depois:
 *  redirect de praça juntada, praça por nome de item e itens fora do KDS. */
async function pgAreaDoItem(nome, areaBase) {
  let area = areaBase ?? null;
  const redir = await mapaRedirPracas();
  if (area != null && redir.has(area)) area = redir.get(area);
  const porItem = await mapaItemPraca();
  if (porItem.length) {
    const nm = semAcento(nome || '');
    const achou = porItem.find((x) => nm.includes(x.termo));
    if (achou) area = achou.area;
  }
  return area;
}
async function pgInserirItem(ped, it) {
  const cod = await proxCodigo('item');
  const nomeItem = [it.nome, it.tamanho].filter(Boolean).join(' ');
  const aviso = it.junto ? '>> SAI JUNTO C/ ' + String(it.junto).toUpperCase() : '';
  const detalhes = [it.obs, aviso].filter(Boolean).join(' | ') || 'NENHUM';
  const vt = +(Number(it.preco) * Number(it.qtd)).toFixed(2);
  const pdvCod = it.codigo_pdv == null ? null : Number(it.codigo_pdv);
  const [pl] = pdvCod == null ? [null]
    : await sql`SELECT area_codigo FROM produto_local WHERE codigo_pdv=${pdvCod} LIMIT 1`;
  const area = await pgAreaDoItem(nomeItem, pl ? pl.area_codigo : null);
  // item que ninguém produz (couvert) entra já baixado: some do KDS e para de
  // contar atraso, sem sumir da conta — mesma regra que o espelho aplicava.
  const fora = await itensForaKds();
  const nm = semAcento(nomeItem);
  const baixado = fora.length > 0 && fora.some((t) => nm.includes(t));
  const agora = new Date();
  await sql`INSERT INTO comanda_item (item_codigo, codigo_pai, comanda_codigo, codigo_pdv, produto_codigo,
      nome, quantidade, valor_unitario, valor_total, tipo, detalhes, area_codigo, criado, produzido, entregue, criado_por)
    VALUES (${cod}, ${it.codigo_pai ?? null}, ${Number(ped)}, ${pdvCod}, ${it.produto_codigo ?? null},
      ${nomeItem}, ${Number(it.qtd)}, ${Number(it.preco)}, ${vt}, ${it.tipo ?? 1}, ${detalhes}, ${area},
      ${agora}, ${baixado ? agora : null}, ${baixado ? agora : null}, ${it.login ?? null})`;
  return cod;
}
async function pgAtualizarTotal(ped) {
  const [s1] = await sql`SELECT COALESCE(SUM(valor_total),0) v FROM comanda_item
    WHERE comanda_codigo=${Number(ped)} AND cancelado_em IS NULL`;
  const itens = Number(s1.v) || 0;
  const isento = await servicoIsento(ped).catch(() => false);
  const svc = !isento && TAXA_SERVICO > 0 && itens > 0 ? +(itens * TAXA_SERVICO / 100).toFixed(2) : 0;
  // ⚠️ os dois primeiros parâmetros da soma precisam de cast explícito: sem
  // tipo conhecido dos dois lados, o Postgres não resolve qual operador '+'
  // usar ("operator is not unique: unknown + unknown"). COALESCE(...) já
  // tem tipo pela coluna, então só os literais soltos precisam do ::numeric.
  await sql`UPDATE comanda SET total_itens=${itens}, total_servico=${svc}, percentual_servico=${TAXA_SERVICO},
      valor_total = ${itens}::numeric + ${svc}::numeric - COALESCE(total_desconto,0) + COALESCE(total_acrescimo,0) + COALESCE(valor_entrega,0)
    WHERE codigo=${Number(ped)}`;
}
async function pgFecharPedido(ped) {
  await sql`UPDATE comanda SET fechada_em=now(), conta_pedida=false
    WHERE codigo=${Number(ped)} AND fechada_em IS NULL`;
}
async function pgPedirConta(ped, on) {
  await sql`UPDATE comanda SET conta_pedida=${!!on} WHERE codigo=${Number(ped)}`;
}
async function pgIdentificarPedido(ped, { nome, cpf, contatoFb }) {
  if (nome) await sql`UPDATE comanda SET nome=${nome} WHERE codigo=${Number(ped)}`;
  if (cpf) await sql`UPDATE comanda SET cpf=${cpf} WHERE codigo=${Number(ped)}`;
  if (contatoFb) await sql`UPDATE comanda SET contato_codigo=${Number(contatoFb)} WHERE codigo=${Number(ped)}`;
}
async function pgTotalPedido(ped) {
  const [r] = await sql`SELECT COALESCE(valor_total,0) v FROM comanda WHERE codigo=${Number(ped)}`;
  return r ? Number(r.v) || 0 : 0;
}
async function pgPagoDoPedido(ped) {
  const [r] = await sql`SELECT COALESCE(SUM(valor),0) v FROM pagamento_local
    WHERE pedido=${Number(ped)} AND cancelado_em IS NULL`;
  return Number(r.v) || 0;
}

// ─────────── primitivas de DOIS MODOS (conta e itens) ───────────
// As regras (dupla senha, cancelamento parcial, teto de desconto) são as
// mesmas nos dois bancos — o que muda é ONDE grava. Por isso o desvio fica
// aqui embaixo, e não espalhado em cada função de negócio.
//
// PEDIDOS            ↔ comanda            ITENSPEDIDO ↔ comanda_item
//   VALORTOTALITENS  ↔ total_itens          CODIGO      ↔ item_codigo
//   TOTALSERVICO     ↔ total_servico        CODIGOPAI   ↔ codigo_pai
//   VALORTOTAL       ↔ valor_total          DATADELETE  ↔ cancelado_em
//   TOTALDESCONTO    ↔ total_desconto       NOMEPRODUTO ↔ nome
//   TOTALACRESCIMO   ↔ total_acrescimo
async function pedTotais(ped) {
  if (nativo()) {
    const [r] = await sql`SELECT COALESCE(total_itens,0) i, COALESCE(total_servico,0) s,
        COALESCE(valor_total,0) t, COALESCE(total_desconto,0) d, COALESCE(total_acrescimo,0) a
      FROM comanda WHERE codigo=${Number(ped)}`;
    if (!r) return null;
    return { itens: Number(r.i) || 0, servico: Number(r.s) || 0, total: Number(r.t) || 0,
      desconto: Number(r.d) || 0, acrescimo: Number(r.a) || 0 };
  }
  const p = (await qi(`SELECT VALORTOTALITENS I, TOTALSERVICO S, VALORTOTAL T,
      TOTALDESCONTO D, TOTALACRESCIMO A FROM PEDIDOS WHERE CODIGO=${Number(ped)}`)).rows?.[0];
  if (!p) return null;
  return { itens: Number(p.I) || 0, servico: Number(p.S) || 0, total: Number(p.T) || 0,
    desconto: Number(p.D) || 0, acrescimo: Number(p.A) || 0 };
}
/** Grava só o que veio: {itens, servico, total, desconto, acrescimo, pctDesconto}. */
async function pedGravarTotais(ped, c) {
  if (nativo()) {
    const campos = [];
    if (c.itens != null) campos.push(sql`total_itens=${+c.itens}`);
    if (c.servico != null) campos.push(sql`total_servico=${+c.servico}`);
    if (c.total != null) campos.push(sql`valor_total=${+c.total}`);
    if (c.desconto != null) campos.push(sql`total_desconto=${+c.desconto}`);
    if (c.acrescimo != null) campos.push(sql`total_acrescimo=${+c.acrescimo}`);
    if (c.pctDesconto != null) campos.push(sql`percentual_desconto=${+c.pctDesconto}`);
    if (!campos.length) return true;
    let frag = campos[0];
    for (let i = 1; i < campos.length; i++) frag = sql`${frag}, ${campos[i]}`;
    await sql`UPDATE comanda SET ${frag} WHERE codigo=${Number(ped)}`;
    return true;
  }
  const sets = [];
  if (c.itens != null) sets.push(`VALORTOTALITENS=${fbNum(c.itens)}`);
  if (c.servico != null) sets.push(`TOTALSERVICO=${fbNum(c.servico)}`);
  if (c.total != null) sets.push(`VALORTOTAL=${fbNum(c.total)}`);
  if (c.desconto != null) sets.push(`TOTALDESCONTO=${fbNum(c.desconto)}`);
  if (c.acrescimo != null) sets.push(`TOTALACRESCIMO=${fbNum(c.acrescimo)}`);
  if (c.pctDesconto != null) sets.push(`PERCENTUALDESCONTO=${fbNum(c.pctDesconto)}`);
  if (!sets.length) return true;
  const r = await qi(`UPDATE PEDIDOS SET ${sets.join(', ')} WHERE CODIGO=${Number(ped)}`);
  return !!r.ok;
}
/** Some com o pedido (cancelado ou vazio depois de transferir). */
async function pedApagar(ped, { soAberto = false } = {}) {
  if (nativo()) {
    if (soAberto) await sql`UPDATE comanda SET cancelada_em=now() WHERE codigo=${Number(ped)} AND fechada_em IS NULL AND cancelada_em IS NULL`;
    else await sql`UPDATE comanda SET cancelada_em=now() WHERE codigo=${Number(ped)} AND cancelada_em IS NULL`;
    return true;
  }
  const onde = soAberto ? ` AND DATAFECHAMENTO IS NULL` : '';
  const r = await qi(`UPDATE PEDIDOS SET DATADELETE=CURRENT_TIMESTAMP WHERE CODIGO=${Number(ped)}${onde}`);
  return !!r.ok;
}
/** Itens vivos do pedido. `alvo` traz o item e os filhos dele. */
async function itensDoPedido(ped, { alvo = null, codigos = null } = {}) {
  if (nativo()) {
    let r;
    if (alvo != null) {
      r = await sql`SELECT item_codigo codigo, valor_total valor, nome, quantidade, codigo_pai
        FROM comanda_item WHERE comanda_codigo=${Number(ped)} AND cancelado_em IS NULL
          AND (item_codigo=${Number(alvo)} OR codigo_pai=${Number(alvo)})`;
    } else if (codigos != null) {
      const cs = codigos.map(Number).filter(Number.isFinite);
      if (!cs.length) return [];
      r = await sql`SELECT item_codigo codigo, valor_total valor, nome, quantidade, codigo_pai
        FROM comanda_item WHERE comanda_codigo=${Number(ped)} AND cancelado_em IS NULL
          AND (item_codigo = ANY(${cs}) OR codigo_pai = ANY(${cs}))`;
    } else {
      r = await sql`SELECT item_codigo codigo, valor_total valor, nome, quantidade, codigo_pai
        FROM comanda_item WHERE comanda_codigo=${Number(ped)} AND cancelado_em IS NULL`;
    }
    return r.map((x) => ({ codigo: Number(x.codigo), valor: Number(x.valor) || 0,
      nome: x.nome || '', quantidade: Number(x.quantidade) || 1, pai: x.codigo_pai == null ? null : Number(x.codigo_pai) }));
  }
  let onde = '';
  if (alvo != null) onde = ` AND (CODIGO=${Number(alvo)} OR CODIGOPAI=${Number(alvo)})`;
  else if (codigos != null) {
    const cs = codigos.map(Number).filter(Number.isFinite);
    if (!cs.length) return [];
    onde = ` AND (CODIGO IN (${cs.join(',')}) OR CODIGOPAI IN (${cs.join(',')}))`;
  }
  const r = await qi(`SELECT CODIGO, VALORTOTAL, TRIM(NOMEPRODUTO) NOME, QUANTIDADE, CODIGOPAI
    FROM ITENSPEDIDO WHERE CODIGOPEDIDO=${Number(ped)} AND DATADELETE IS NULL${onde}`);
  if (!r.ok) return [];
  return (r.rows || []).map((x) => ({ codigo: Number(x.CODIGO), valor: Number(x.VALORTOTAL) || 0,
    nome: T(x.NOME) || '', quantidade: Number(x.QUANTIDADE) || 1, pai: x.CODIGOPAI == null ? null : Number(x.CODIGOPAI) }));
}
async function itensContar(ped) {
  if (nativo()) {
    const [r] = await sql`SELECT count(*)::int n FROM comanda_item
      WHERE comanda_codigo=${Number(ped)} AND cancelado_em IS NULL`;
    return Number(r.n) || 0;
  }
  const r = await qi(`SELECT COUNT(*) N FROM ITENSPEDIDO WHERE CODIGOPEDIDO=${Number(ped)} AND DATADELETE IS NULL`);
  return r.ok && r.rows.length ? Number(r.rows[0].N) || 0 : 0;
}
/** Cancelamento PARCIAL: a linha continua, com menos unidades. */
async function itemMudarQtd(ped, item, qtd, valor) {
  if (nativo()) {
    await sql`UPDATE comanda_item SET quantidade=${+qtd}, valor_total=${+valor}
      WHERE item_codigo=${Number(item)} AND comanda_codigo=${Number(ped)} AND cancelado_em IS NULL`;
    return true;
  }
  const r = await qi(`UPDATE ITENSPEDIDO SET QUANTIDADE=${fbNum(qtd)}, VALORITEM=${fbNum(valor)},
    VALORTOTAL=${fbNum(valor)} WHERE CODIGO=${Number(item)} AND DATADELETE IS NULL`);
  return !!r.ok;
}
/** Cancela o item e os filhos dele (respostas do wizard vão junto). */
async function itensCancelar(ped, item, quem) {
  if (nativo()) {
    await sql`UPDATE comanda_item SET cancelado_em=now(), cancelado_por=${quem || null}
      WHERE comanda_codigo=${Number(ped)} AND cancelado_em IS NULL
        AND (item_codigo=${Number(item)} OR codigo_pai=${Number(item)})`;
    return true;
  }
  const r = await qi(`UPDATE ITENSPEDIDO SET DATADELETE=CURRENT_TIMESTAMP
    WHERE CODIGOPEDIDO=${Number(ped)} AND DATADELETE IS NULL
      AND (CODIGO=${Number(item)} OR CODIGOPAI=${Number(item)})`);
  return !!r.ok;
}
/** Move itens de uma conta pra outra. `codigos` nulo = leva tudo. */
async function itensMover(pedDe, pedPara, codigos = null) {
  if (nativo()) {
    if (codigos == null) {
      const r = await sql`UPDATE comanda_item SET comanda_codigo=${Number(pedPara)}
        WHERE comanda_codigo=${Number(pedDe)} AND cancelado_em IS NULL RETURNING item_codigo`;
      return r.length;
    }
    const cs = codigos.map(Number).filter(Number.isFinite);
    if (!cs.length) return 0;
    const r = await sql`UPDATE comanda_item SET comanda_codigo=${Number(pedPara)}
      WHERE item_codigo = ANY(${cs}) RETURNING item_codigo`;
    return r.length;
  }
  if (codigos == null) {
    const r = await qi(`UPDATE ITENSPEDIDO SET CODIGOPEDIDO=${Number(pedPara)}
      WHERE CODIGOPEDIDO=${Number(pedDe)} AND DATADELETE IS NULL`);
    return r.ok ? -1 : 0;
  }
  const cs = codigos.map(Number).filter(Number.isFinite);
  if (!cs.length) return 0;
  const r = await qi(`UPDATE ITENSPEDIDO SET CODIGOPEDIDO=${Number(pedPara)} WHERE CODIGO IN (${cs.join(',')})`);
  return r.ok ? cs.length : 0;
}

// ⚠️ QUANDO A MESA TEM MAIS DE UM PEDIDO ABERTO, GANHA O QUE TEM ITENS.
// Pegar sempre o mais novo é o que transforma um pedido vazio de sobra em
// sequestro de conta: o caixa abre a mesa 12, cai no vazio e vê R$ 0,00
// enquanto os R$ 1.805 do cliente estão no pedido do lado. Duplicata não
// deveria existir (ver pedidoDaMesa) — mas se existir, o dinheiro vem junto.
async function fbAcharPedido(numero) {
  if (nativo()) return pgAcharPedido(numero);
  const r = await q(`SELECT FIRST 1 p.CODIGO,
      (SELECT COUNT(*) FROM ITENSPEDIDO i WHERE i.CODIGOPEDIDO = p.CODIGO AND i.DATADELETE IS NULL) N
    FROM PEDIDOS p WHERE p.NUMERO=${Number(numero)} AND p.DATAFECHAMENTO IS NULL AND p.DATADELETE IS NULL
    ORDER BY 2 DESC, 1 DESC`);
  if (!r.ok) throw new Error('FB achar pedido: ' + r.err);
  return r.rows.length ? Number(r.rows[0].CODIGO) : null;
}
/* ---- ACHAR-OU-CRIAR É UMA COISA SÓ, POR MESA ----
   Em 22/08/2026 na 0001 a mesa 12 ganhou SEIS pedidos em 758ms: cinco vazios
   e um com os R$ 1.805 do cliente. Cinco cartões fantasma na tela do caixa.
   A causa é `achar` e `criar` serem dois passos: duas chamadas no mesmo
   instante acham "não tem conta" as duas e criam as duas. A fila abaixo
   serializa por número — a segunda chamada só corre depois que a primeira
   terminou, e aí ela ACHA em vez de criar. */
const filaMesa = new Map();
function naFilaDaMesa(numero, fn) {
  const n = Number(numero);
  const anterior = filaMesa.get(n) || Promise.resolve();
  const meu = anterior.then(fn, fn); // corre mesmo se a chamada anterior falhou
  const calado = meu.then(() => {}, () => {}); // a fila nunca rejeita
  filaMesa.set(n, calado);
  calado.then(() => { if (filaMesa.get(n) === calado) filaMesa.delete(n); });
  return meu;
}
/** Confere se o pedido existe, está ABERTO e é mesmo daquele número. */
async function pedAbertoDoNumero(ped, numero) {
  const p = Number(ped), n = Number(numero);
  if (!(p > 0)) return false;
  if (nativo()) {
    const r = await sql`SELECT 1 FROM comanda WHERE codigo=${p} AND numero=${n}
      AND fechada_em IS NULL AND cancelada_em IS NULL`;
    return r.length > 0;
  }
  const r = await qi(`SELECT FIRST 1 CODIGO FROM PEDIDOS WHERE CODIGO=${p} AND NUMERO=${n}
    AND DATAFECHAMENTO IS NULL AND DATADELETE IS NULL`);
  return !!(r.ok && r.rows.length);
}
/** ALVO de uma ação do caixa: o pedido em que a ação vai mexer.
 *
 *  Sem `ped`, é o de sempre — acha pelo número da mesa. Com `ped`, usa aquele
 *  pedido, e SÓ depois de conferir que está aberto e que é daquele número.
 *  É isso que deixa operar ENTREGA: no Consumer ela nasce com NUMERO=0, e com
 *  duas entregas abertas o número sozinho aponta pra qualquer uma das duas —
 *  receber na conta errada é pior que não receber. A validação é no servidor
 *  de propósito: a tela pede um alvo, ela não escolhe um. */
async function pedidoAlvo(numero, ped) {
  const p = Number(ped) || 0;
  if (!p) return fbAcharPedido(numero);
  return (await pedAbertoDoNumero(p, numero)) ? p : null;
}
/** Marca (memória, TTL 5s) que este carrinho está sendo processado nesta
 *  mesa; devolve {duplicado:true, pedido_fb, total} se já tinha marca viva
 *  pra essa MESMA assinatura. Chamar sempre dentro de naFilaDaMesa — fora
 *  dela, o check-then-mark tem a mesma corrida que o SELECT tinha. */
const enviosRecentesPorMesa = new Map(); // numero -> {assinatura, pedido_fb, total, expira}
function dedupeCarrinho(numero, assinatura) {
  const n = Number(numero);
  const atual = enviosRecentesPorMesa.get(n);
  if (atual && atual.assinatura === assinatura && atual.expira > Date.now()) {
    return { duplicado: true, pedido_fb: atual.pedido_fb, total: atual.total };
  }
  enviosRecentesPorMesa.set(n, { assinatura, pedido_fb: null, total: 0, expira: Date.now() + 5000 });
  return { duplicado: false };
}
/** Preenche pedido_fb/total reais depois que o envio de verdade terminou —
 *  se uma 3ª tentativa chegar em seguida, já responde com o dado completo
 *  em vez de null/0. Silenciosa: a marca já existir ou não não muda nada. */
function dedupeConcluir(numero, assinatura, pedidoFb, total) {
  const atual = enviosRecentesPorMesa.get(Number(numero));
  if (atual && atual.assinatura === assinatura) { atual.pedido_fb = pedidoFb; atual.total = total; }
}

/** O pedido aberto da mesa, criando se não houver. Único caminho pra criar.
 *  Devolve {ped, criado} — `criado` é pra quem só faz algo na conta que NASCE
 *  agora (amarrar a identificação, por exemplo). */
async function pedidoDaMesa(numero) {
  return naFilaDaMesa(numero, async () => {
    const ja = await fbAcharPedido(numero);
    if (ja) return { ped: ja, criado: false };
    return { ped: await fbCriarPedido(numero), criado: true };
  });
}
async function fbCriarPedido(numero) {
  if (nativo()) return pgCriarPedido(numero);
  // INSERT sem CODIGO (BI trigger gera). RETURNING crasha intermitente no FB4 -> insert simples + SELECT.
  const ins = await q(`INSERT INTO PEDIDOS (NUMERO, DATAABERTURA, CODIGOPEDIDOORIGEM, VALORENTREGA, QUANTIDADEPESSOAS, ICMSDESONDIMINUIVALORNF, TAG, CONTASOLICITADA, IMPRESSAOSOLICITADA, VALORTOTAL, SUBTOTALPAGO)
    VALUES (${Number(numero)}, CURRENT_TIMESTAMP, ${VENDA_ORIGEM_FB}, 0, 1, 0, '', 'N', 'N', 0, 0)`);
  if (!ins.ok) throw new Error('FB criar pedido: ' + ins.err);
  const ped = await fbAcharPedido(numero);
  if (!ped) throw new Error('FB criar pedido: inserido mas não encontrado');
  return ped;
}
/** Guarda quem lançou o item. Vale pros dois bancos e sobrevive ao espelho.
 *  O Consumer só sabe do garçom quando o pedido nasce nele; o que sai da nossa
 *  tela ficava órfão — e na hora de conferir a conta ninguém sabia de quem era. */
async function registrarAutor(itemCod, it) {
  if (!itemCod || !it || !it.login) return;
  try {
    await sql`INSERT INTO item_autor (item_codigo, login, nome)
      VALUES (${Number(itemCod)}, ${it.login}, ${it.nome_usuario || it.login})
      ON CONFLICT (item_codigo) DO NOTHING`;
  } catch (e) { console.error('[autor] item ' + itemCod + ': ' + e.message); }
}
async function fbInserirItem(ped, it) {
  if (nativo()) { const c = await pgInserirItem(ped, it); await registrarAutor(c, it); return c; }
  const vt = fbNum(it.preco * it.qtd);
  // O TAMANHO VAI NO NOME. "Germana" custa R$ 20 na dose e R$ 280 na garrafa —
  // gravar só o nome fazia os dois virarem a mesma linha no KDS e na comanda
  // impressa, e a cozinha não tinha como saber qual sair. O próprio Consumer
  // grava assim ("Destilados Germana Dose"), então o nosso item fica igual ao
  // que o PDV lança.
  const nomeItem = [it.nome, it.tamanho].filter(Boolean).join(' ');
  // DETALHES é o que sai impresso embaixo do item na comanda da cozinha.
  // Vai a observação do garçom e, quando o pedido está espalhado por mais de
  // uma praça, o aviso pra sair junto. Caixa alta porque é cupom térmico.
  const aviso = it.junto ? '>> SAI JUNTO C/ ' + String(it.junto).toUpperCase() : '';
  const detalhes = [it.obs, aviso].filter(Boolean).join(' | ') || 'NENHUM';
  const r = await q(`INSERT INTO ITENSPEDIDO (CODIGOPEDIDO, CODIGOPRODUTO, CODIGOPRODUTODETALHE, NOMEPRODUTO, QUANTIDADE, VALORUNITARIO, VALORITEM, VALORCOMPLEMENTO, VALORFILHO, VALORTOTAL, VALORDESCONTO, CODIGOITEMPEDIDOTIPO, DETALHES, DATAHORACADASTRO, IMPRESSO, CODIGOPEDIDOORIGEM)
    VALUES (${ped}, ${Number(it.produto_codigo)}, ${Number(it.codigo_pdv)}, '${fbEsc(nomeItem)}', ${fbNum(it.qtd)}, ${fbNum(it.preco)}, ${vt}, 0, 0, ${vt}, 0, 1, '${fbEsc(detalhes)}', CURRENT_TIMESTAMP, 'N', ${VENDA_ORIGEM_FB})`);
  if (!r.ok) throw new Error('FB item "' + nomeItem + '": ' + r.err);
  // RETURNING crasha intermitente no FB4 — pega o recem-inserido. E' seguro
  // porque a fila serializa: ninguem inseriu no meio.
  const g = await q(`SELECT FIRST 1 CODIGO FROM ITENSPEDIDO WHERE CODIGOPEDIDO=${ped} AND DATADELETE IS NULL ORDER BY CODIGO DESC`);
  const cod = g.ok && g.rows.length ? Number(g.rows[0].CODIGO) : null;
  await registrarAutor(cod, it);
  return cod;
}
/** Carimba quem é a pessoa da comanda no PEDIDOS do Consumer.
 *  NOME sai na comanda impressa e no KDS; o CPF fica pronto pra NFC-e. */
async function fbIdentificarPedido(ped, { nome, cpf, contatoFb }) {
  if (nativo()) return pgIdentificarPedido(ped, { nome, cpf, contatoFb });
  const sets = [];
  if (nome) sets.push(`NOME='${fbEsc(nome)}'`);
  if (cpf) sets.push(`NUMERODOCUMENTODESTINATARIO='${fbEsc(cpf)}'`, `TIPODOCUMENTODESTINATARIO=1`);
  if (contatoFb) sets.push(`CODIGOCONTATOCLIENTE=${Number(contatoFb)}`);
  if (!sets.length) return;
  const r = await qi(`UPDATE PEDIDOS SET ${sets.join(', ')} WHERE CODIGO=${Number(ped)}`);
  if (!r.ok) throw new Error('FB identificar: ' + r.err);
}
/** TIPOIMPRESSAO 2 = "Fechamento Conta": manda o cupom de conferência pra
 *  impressora do caixa, o mesmo caminho que o Consumer usa (8.754 jobs). */
async function fbImprimirConta(ped) {
  if (nativo()) return; // idem: a conta do caixa sai pela impressora da loja
  const r = await qi(`INSERT INTO PEDIDOIMPRESSAO (INSERIDOEM, CODIGOPEDIDO, CODIGOTIPOIMPRESSAO, CODIGOORIGEMIMPRESSAO, CODIGOSITUACAOIMPRESSAO, AUTORIZADOEM)
    VALUES (CURRENT_TIMESTAMP, ${Number(ped)}, 2, 0, 2, CURRENT_TIMESTAMP)`);
  if (!r.ok) throw new Error('FB imprimir conta: ' + r.err);
}
/** Marca que a mesa pediu a conta — é isso que deixa ela vermelha na tela. */
async function fbPedirConta(ped, on = true) {
  if (nativo()) return pgPedirConta(ped, on);
  const r = await qi(`UPDATE PEDIDOS SET CONTASOLICITADA='${on ? 'S' : 'N'}' WHERE CODIGO=${Number(ped)}`);
  if (!r.ok) throw new Error('FB pedir conta: ' + r.err);
}
/** Garante os 10% no PEDIDO (TOTALSERVICO + VALORTOTAL). REGRA DA CASA
 *  (dono, 10/08): toda conta JÁ NASCE com o serviço — não espera "pedir a
 *  conta". O fbAtualizarTotal aplica/recalcula a cada lançamento; esta função
 *  cobre pedido que nunca passou por lá (mesa aberta pelo Consumer) na hora
 *  em que o caixa abre a conta. Se já tem serviço (>0), não mexe. Tirar o
 *  serviço de um cliente = desconto no caixa, com permissão — não existe
 *  conta "sem os 10%". */
/** O caixa TIROU os 10% desta conta? Enquanto a última decisão for "tirou",
 *  ninguém recoloca — nem a abertura da conta, nem o próximo item lançado.
 *  Sem isto o serviço voltava sozinho e o cliente que se recusou a pagar via
 *  a taxa reaparecer no total (19/08). */
async function servicoIsento(ped) {
  const r = await sql`SELECT acao FROM servico_ajuste WHERE pedido_fb=${Number(ped)}
    ORDER BY id DESC LIMIT 1`;
  return r[0]?.acao === 'tirou';
}
async function fbAplicarServico(ped) {
  if (await servicoIsento(ped)) return 0;
  if (!(TAXA_SERVICO > 0)) return 0;
  const p = await pedTotais(ped);
  if (!p) return 0;
  if (p.servico > 0.009) return p.servico;
  const svc = +(p.itens * TAXA_SERVICO / 100).toFixed(2);
  if (!(svc > 0)) return 0;
  const ok = await pedGravarTotais(ped, { servico: svc, total: +(p.total + svc).toFixed(2) });
  return ok ? svc : 0;
}
async function fbRemoverServico(ped) {
  const p = await pedTotais(ped);
  if (!p || !(p.servico > 0.009)) return;
  await pedGravarTotais(ped, { servico: 0, total: +(p.total - p.servico).toFixed(2) });
}
/** As três ações do rodapé da mesa. NÃO fecha o pedido no Consumer:
 *  quem encerra e emite a nota continua sendo ele. */
async function apiVendaConta(body) {
  const numero = Number(body.numero);
  const acao = String(body.acao || '');
  if (!(numero >= 1 && numero <= NUMERO_MAX)) return { ok: false, erro: 'número inválido' };
  let ped;
  try { ped = await pedidoAlvo(numero, body.ped); } catch (e) { return { ok: false, erro: e.message }; }
  if (!ped) return { ok: false, erro: 'não há pedido aberto no ' + (numero >= COMANDA_DE ? 'comanda ' : 'mesa ') + numero };
  try {
    if (acao === 'imprimir') { await fbPedirConta(ped, true); await fbAplicarServico(ped);
      // térmica direta configurada? imprime daqui, sem depender da fila do
      // Consumer. Se o socket falhar, cai no caminho antigo (PEDIDOIMPRESSAO).
      let msg = 'Conta enviada pra impressora do caixa.'; let direto = false;
      const ipConta = (await cfgGet('impressora_ip', '')).trim();
      if (ipConta) {
        try { await imprimirRaw(ipConta, await cupomConta(numero, ped), 'conta ' + numero); direto = true; msg = 'Conta impressa.'; }
        catch (e) { console.error('[impressora] conta:', e.message); }
      }
      if (!direto) await fbImprimirConta(ped);
      espelho().catch(() => {});
      return { ok: true, pedido_fb: ped, msg }; }
    if (acao === 'fechar') { await fbPedirConta(ped, true); await fbAplicarServico(ped);
      // espelho na hora: senao a tela do cliente so descobre no proximo sync
      await sql`UPDATE comanda SET conta_pedida=true WHERE numero=${numero}`;
      espelho().catch(() => {});
      return { ok: true, pedido_fb: ped, msg: 'Conta pedida. Não entra mais lançamento.' }; }
    // reabrir NÃO tira mais o serviço: os 10% são permanentes (regra da casa)
    if (acao === 'reabrir') { await fbPedirConta(ped, false);
      await sql`UPDATE comanda SET conta_pedida=false WHERE numero=${numero}`;
      espelho().catch(() => {});
      return { ok: true, pedido_fb: ped, msg: 'Liberado. Pode lançar de novo.' }; }
    return { ok: false, erro: 'ação inválida' };
  } catch (e) { return { ok: false, erro: e.message }; }
}
/** BAIXA de comanda: libera o número quando a conta está zerada/paga.
 *  (Comanda aberta por engano, ou cliente que pagou e devolveu o cartão.)
 *  Com saldo, barra — recebe primeiro, baixa depois. */
async function apiComandaBaixa(body) {
  const n = Number(body.comanda);
  if (!(COMANDA_ATIVA && n >= COMANDA_DE && n <= COMANDA_MAX)) return { ok: false, erro: 'comanda inválida' };
  let ped = null;
  try { ped = await fbAcharPedido(n); } catch (e) { return { ok: false, erro: e.message }; }
  if (ped) {
    const tot = (await pedTotais(ped))?.total || 0;
    const pago = await fbPagoDoPedido(ped);
    const saldo = +(tot - pago).toFixed(2);
    if (saldo > 0.009) return { ok: false, erro: `comanda com saldo (R$ ${saldo.toFixed(2)}) — receba antes de dar baixa` };
  }
  await sql`UPDATE mesa_comanda SET fechada_em=now() WHERE comanda=${n} AND fechada_em IS NULL`;
  await sql`UPDATE identificacao SET fechada_em=now() WHERE numero=${n} AND fechada_em IS NULL`;
  espelho().catch(() => {});
  return { ok: true, comanda: n, msg: `Comanda ${n} liberada.` };
}

/** As RESPOSTAS das perguntas, do jeito que o Consumer monta: cada resposta é
 *  um ITEM-FILHO (CODIGOPAI + tipo 2), e é ESSE filho que aponta pra opção em
 *  ITEMPEDIDOWIZARDOPCAO — cuja PK é só CODIGOITEMPEDIDO, ou seja, UMA opção
 *  por item. Tentar empilhar as respostas no item pai dava violação de chave e
 *  só a primeira entrava.
 *  O preço da opção fica no FILHO; o pai continua com o preço do prato. */
async function fbGravarRespostas(ped, itemPai, it) {
  const ops = await sql`SELECT codigo, nome, preco, produto_pdv FROM wizard_opcao
    WHERE codigo = ANY(${it.respostas})`;
  const porCodigo = new Map(ops.map((x) => [Number(x.codigo), x]));
  for (const r of it.respostas) {                 // na ordem em que foram escolhidas
    const op = porCodigo.get(Number(r));
    if (!op) continue;
    if (nativo()) {
      // No banco próprio a resposta É o item filho — não existe tabela de
      // vínculo separada. Mesma forma do Firebird (tipo 2, codigo_pai), então
      // o KDS e a conta renderizam igual, sem mudar uma linha de tela.
      await pgInserirItem(ped, {
        codigo_pdv: op.produto_pdv ? Number(op.produto_pdv) : null,
        nome: op.nome, qtd: it.qtd, preco: Number(op.preco || 0),
        tipo: 2, codigo_pai: itemPai, login: it.login,
      }).catch((e) => console.error('[resposta] ' + op.nome + ': ' + e.message));
      continue;
    }
    const v = fbNum(Number(op.preco || 0) * it.qtd);
    const ins = await q(`INSERT INTO ITENSPEDIDO (CODIGOPEDIDO, CODIGOPAI, CODIGOPRODUTODETALHE,
        NOMEPRODUTO, QUANTIDADE, VALORUNITARIO, VALORITEM, VALORCOMPLEMENTO, VALORFILHO, VALORTOTAL,
        VALORDESCONTO, CODIGOITEMPEDIDOTIPO, DETALHES, DATAHORACADASTRO, IMPRESSO, CODIGOPEDIDOORIGEM)
      VALUES (${ped}, ${itemPai}, ${op.produto_pdv ? Number(op.produto_pdv) : 'NULL'},
        '${fbEsc(op.nome)}', ${fbNum(it.qtd)}, ${fbNum(op.preco || 0)}, ${v}, 0, 0, ${v},
        0, 2, 'NENHUM', CURRENT_TIMESTAMP, 'N', ${VENDA_ORIGEM_FB})`);
    if (!ins.ok) { console.error('[resposta] ' + op.nome + ': ' + ins.err); continue; }
    const g = await q(`SELECT FIRST 1 CODIGO FROM ITENSPEDIDO WHERE CODIGOPEDIDO=${ped}
      AND CODIGOPAI=${itemPai} AND DATADELETE IS NULL ORDER BY CODIGO DESC`);
    const filho = g.ok && g.rows.length ? Number(g.rows[0].CODIGO) : null;
    if (!filho) continue;
    const lig = await q(`INSERT INTO ITEMPEDIDOWIZARDOPCAO (CODIGOITEMPEDIDO, CODIGOWIZARDOPCAO)
      VALUES (${filho}, ${Number(r)})`);
    if (!lig.ok) console.error('[resposta] vínculo de "' + op.nome + '": ' + lig.err);
  }
}
async function fbAtualizarTotal(ped) {
  if (nativo()) return pgAtualizarTotal(ped);
  // Recalcula o pedido inteiro a cada lançamento, mantendo os campos que o
  // Consumer mantém (VALORTOTALITENS alimenta o teto da maquininha, o
  // Subtotal do caixa e o % de desconto). REGRA DA CASA (dono, 10/08): o
  // SERVIÇO DE 10% acompanha o consumo desde o primeiro item — não espera
  // "pedir a conta" — e é recalculado aqui a cada item que entra ou sai.
  const s = await q(`SELECT COALESCE(SUM(VALORTOTAL),0) V FROM ITENSPEDIDO WHERE CODIGOPEDIDO=${ped} AND DATADELETE IS NULL`);
  if (!s.ok) throw new Error('FB total (soma): ' + s.err);
  const itens = Number(s.rows?.[0]?.V) || 0;
  // conta isenta (o caixa tirou os 10%) continua isenta mesmo com item novo
  const isento = await servicoIsento(ped).catch(() => false);
  const svc = !isento && TAXA_SERVICO > 0 && itens > 0 ? +(itens * TAXA_SERVICO / 100).toFixed(2) : 0;
  const r = await q(`UPDATE PEDIDOS SET VALORTOTALITENS=${fbNum(itens)}, TOTALSERVICO=${fbNum(svc)}, PERCENTUALTAXASERVICO=${fbNum(TAXA_SERVICO)},
    VALORTOTAL=${fbNum(itens)} + ${fbNum(svc)} - COALESCE(TOTALDESCONTO,0) + COALESCE(TOTALACRESCIMO,0) + COALESCE(VALORENTREGA,0)
    WHERE CODIGO=${ped}`);
  if (!r.ok) throw new Error('FB total: ' + r.err);
}
async function fbJobCozinha(ped) {
  // PEDIDOIMPRESSAO é a fila de impressão DO CONSUMER. No modo próprio a loja
  // já imprime sozinha (ESC/POS por praça) — enfileirar lá seria pedir cupom
  // a um serviço que não existe mais.
  if (nativo()) return;
  const r = await q(`INSERT INTO PEDIDOIMPRESSAO (INSERIDOEM, CODIGOPEDIDO, CODIGOTIPOIMPRESSAO, CODIGOORIGEMIMPRESSAO, CODIGOSITUACAOIMPRESSAO, AUTORIZADOEM)
    VALUES (CURRENT_TIMESTAMP, ${ped}, 1, 0, 2, CURRENT_TIMESTAMP)`);
  if (!r.ok) throw new Error('FB job impressão: ' + r.err);
}

// ---- IMPRESSORA TÉRMICA (ESC/POS cru na rede, porta 9100) ----
// Térmica genérica de 80mm = 48 colunas na fonte A. Sem driver e sem a fila do
// Consumer: abre socket TCP e manda os bytes. Config POR LOJA (app_config):
//   producao_modo = kds | ambos | impressora  — onde a COMANDA da cozinha sai
//   impressora_ip = 192.168.10.9[:9100]       — vazio = loja sem impressora
// A CONTA do caixa imprime direto sempre que impressora_ip existir; se o socket
// falhar, cai no caminho antigo (PEDIDOIMPRESSAO, a impressora do Consumer).
async function cfgGet(chave, def = '') {
  const r = (await sql`SELECT valor FROM app_config WHERE chave=${chave}`)[0];
  return r ? r.valor : def;
}
async function cfgSet(chave, valor) {
  await sql`INSERT INTO app_config (chave, valor) VALUES (${chave}, ${String(valor)})
    ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor`;
}
const IMP_COLS = 48;
// CP850: a página de código clássica das térmicas pro pt-BR. O que não estiver
// nela sai sem acento (e, em último caso, '?') — nunca lixo.
const IMP_CP850 = { 'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'à': 0x85, 'è': 0x8A, 'ì': 0x8D, 'ò': 0x95, 'ù': 0x97, 'â': 0x83, 'ê': 0x88, 'î': 0x8C, 'ô': 0x93, 'û': 0x96, 'ã': 0xC6, 'õ': 0xE4, 'ç': 0x87, 'ü': 0x81, 'ö': 0x94, 'ä': 0x84, 'ñ': 0xA4, 'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9, 'À': 0xB7, 'Â': 0xB6, 'Ê': 0xD2, 'Î': 0xD7, 'Ô': 0xE2, 'Û': 0xEA, 'Ã': 0xC7, 'Õ': 0xE5, 'Ç': 0x80, 'Ü': 0x9A, 'Ñ': 0xA5, 'º': 0xA7, 'ª': 0xA6, '°': 0xF8, '·': 0xFA, '—': 0x2D, '–': 0x2D };
function impTexto(s) {
  const out = [];
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    if (c === 0x0A || (c >= 0x20 && c < 0x7F)) { out.push(c); continue; }
    if (IMP_CP850[ch] != null) { out.push(IMP_CP850[ch]); continue; }
    const sem = (ch.normalize('NFD').replace(/[̀-ͯ]/g, '') || '?')[0];
    const c2 = sem.codePointAt(0);
    out.push(c2 >= 0x20 && c2 < 0x7F ? c2 : 0x3F);
  }
  return Buffer.from(out);
}
const IMP = {
  // reset + FS. (desliga o modo caractere chinês — a genérica liga NELE e come
  // os bytes acentuados aos pares, virava tudo '?') + codepage CP850
  init: Buffer.from([0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 0x02]),
  centro: Buffer.from([0x1b, 0x61, 1]), esquerda: Buffer.from([0x1b, 0x61, 0]),
  neg: Buffer.from([0x1b, 0x45, 1]), negFim: Buffer.from([0x1b, 0x45, 0]),
  alto: Buffer.from([0x1d, 0x21, 0x01]),    // 2× altura (continua 48 col)
  grande: Buffer.from([0x1d, 0x21, 0x11]),  // 2× altura E largura (24 col)
  norm: Buffer.from([0x1d, 0x21, 0x00]),
  corte: Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00]),
};
const impLn = (s = '') => Buffer.concat([impTexto(s), Buffer.from([0x0a])]);
const impTraco = () => impLn('-'.repeat(IMP_COLS));
function impLR(esq, dir, cols = IMP_COLS) {
  esq = String(esq); dir = String(dir);
  const sobra = cols - esq.length - dir.length;
  if (sobra >= 1) return esq + ' '.repeat(sobra) + dir;
  return esq.slice(0, Math.max(1, cols - dir.length - 3)) + '.. ' + dir;
}
// nome que não cabe na linha do preço: sai inteiro (a impressora quebra) e o
// valor vai sozinho na linha de baixo, encostado à direita
function impLinhasItem(esq, dir) {
  if (String(esq).length + String(dir).length + 1 <= IMP_COLS) return [impLR(esq, dir)];
  return [String(esq), ' '.repeat(Math.max(0, IMP_COLS - String(dir).length)) + String(dir)];
}
const impMoeda = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const impQtd = (q) => { const n = Number(q) || 0; return (n % 1 ? n.toLocaleString('pt-BR') : String(n)) + 'x'; };
const impHm = (d) => new Date(d || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function impDetalhes(d) { return String(d || '').split(/\r?\n/).map((x) => x.trim()).filter((x) => temMod(x)); }
function impRotulo(numero, origem) {
  const n = Number(numero) || 0;
  if (COMANDA_ATIVA && n >= COMANDA_DE && n <= COMANDA_MAX) return 'COMANDA ' + n;
  if (DELIVERY_ORIGENS.has(Number(origem))) return String(ORIGEM_NOME[Number(origem)] || 'Delivery').toUpperCase() + (n > 0 ? ' ' + n : '');
  if (n > 0) return 'MESA ' + n;
  return String(ORIGEM_NOME[Number(origem)] || 'Balcão').toUpperCase();
}
/** Sonda a térmica: conecta (ligada?) e pergunta o papel via DLE EOT 4.
 *  Nem toda genérica responde ao status — sem resposta em 450ms, garante só
 *  que está ligada. Bits (padrão Epson): 0x60 = sem papel, 0x0C = acabando. */
function impStatus(ipCfg) {
  return new Promise((resolve) => {
    const [host, porta] = String(ipCfg).trim().split(':');
    const s = net.connect({ host, port: Number(porta) || 9100, timeout: 1500 });
    let done = false, timer = null;
    const fim = (r) => { if (done) return; done = true; clearTimeout(timer); try { s.destroy(); } catch { /* já era */ } resolve(r); };
    s.on('timeout', () => fim({ ligada: false, erro: 'não responde (desligada ou fora da rede)' }));
    s.on('error', (e) => fim({ ligada: false, erro: e.code === 'ECONNREFUSED' ? 'recusou conexão' : e.message }));
    s.on('connect', () => {
      s.write(Buffer.from([0x10, 0x04, 0x04]));
      timer = setTimeout(() => fim({ ligada: true, papel: null }), 450);
    });
    s.on('data', (b) => {
      const st = b[0] ?? 0;
      if (st & 0x60) return fim({ ligada: true, papel: 'sem_papel' });
      if (st & 0x0c) return fim({ ligada: true, papel: 'acabando' });
      fim({ ligada: true, papel: 'ok' });
    });
  });
}
/** Avisos prontos pro lançamento: sonda as impressoras das praças envolvidas.
 *  O cupom que falhar SAI SOZINHO quando a impressora voltar (fila do espelho)
 *  — o aviso é pra praça não ficar às cegas enquanto isso. */
async function avisosImpressora(areaCods) {
  const modo = await cfgGet('producao_modo', 'kds');
  if (modo !== 'ambos' && modo !== 'impressora') return [];
  const ipGeral = (await cfgGet('impressora_ip', '')).trim();
  const porPraca = new Map((await sql`SELECT area_codigo, ip FROM praca_impressora`)
    .map((r) => [Number(r.area_codigo), String(r.ip).trim()]).filter(([, v]) => v));
  const nomes = new Map((await sql`SELECT codigo, nome FROM area`).map((a) => [Number(a.codigo), a.nome]));
  const alvos = new Map();
  for (const a of new Set((areaCods || []).filter((x) => x != null).map(Number))) {
    const ip = porPraca.get(a) || ipGeral;
    if (!ip) continue;
    if (!alvos.has(ip)) alvos.set(ip, []);
    alvos.get(ip).push(nomes.get(a) || ('praça ' + a));
  }
  const avisos = [];
  await Promise.all([...alvos.entries()].map(async ([ip, pracas]) => {
    const st = await impStatus(ip);
    if (!st.ligada) avisos.push('🖨 Impressora de ' + pracas.join('/') + ' NÃO RESPONDE (' + ip + ') — o cupom sai sozinho quando ela voltar; avise a praça!');
    else if (st.papel === 'sem_papel') avisos.push('🖨 Impressora de ' + pracas.join('/') + ' SEM PAPEL — troque a bobina!');
    else if (st.papel === 'acabando') avisos.push('🖨 Impressora de ' + pracas.join('/') + ': papel ACABANDO — deixe a bobina à mão');
  }));
  return avisos;
}
let impUltimo = { quando: null, ok: null, erro: null, oque: null };
function imprimirRaw(ipCfg, buf, oque) {
  return new Promise((resolve, reject) => {
    const [host, porta] = String(ipCfg).trim().split(':');
    const s = net.connect({ host, port: Number(porta) || 9100, timeout: 5000 });
    let fim = false;
    const acaba = (erro) => {
      if (fim) return; fim = true;
      try { s.destroy(); } catch { /* já morreu */ }
      impUltimo = { quando: new Date().toISOString(), ok: !erro, erro: erro ? erro.message : null, oque: oque || null };
      if (erro) reject(erro); else resolve(true);
    };
    s.on('timeout', () => acaba(new Error('impressora não respondeu (5s) — confira IP e cabo')));
    s.on('error', (e) => acaba(new Error('impressora: ' + e.message)));
    // porta 9100 é cega (não confirma nada): conectou e entregou os bytes, foi
    s.on('connect', () => s.end(buf));
    s.on('finish', () => acaba(null));
  });
}

// ---- COMANDA na térmica: o que apareceu de NOVO no espelho e ainda não saiu.
// Roda de carona em todo refresh do espelho. Chaveia por ITENSPEDIDO.CODIGO na
// comanda_impressa (durável), então pega pedido lançado pelo app E direto no
// Consumer. Impressora fora do ar = não marca; o próximo ciclo tenta de novo.
let impRodando = false, impLimpouEm = 0;
async function imprimirComandasNovas() {
  if (impRodando) return; impRodando = true;
  try {
    const modo = await cfgGet('producao_modo', 'kds');
    if (modo !== 'ambos' && modo !== 'impressora') return;
    const ipGeral = (await cfgGet('impressora_ip', '')).trim();
    // cada praça imprime na SUA impressora; sem IP próprio, cai na geral
    const porPraca = new Map((await sql`SELECT area_codigo, ip FROM praca_impressora`)
      .map((r) => [Number(r.area_codigo), String(r.ip).trim()]).filter(([, v]) => v));
    if (!ipGeral && !porPraca.size) return;
    const novos = await sql`
      SELECT ci.item_codigo, ci.codigo_pai, ci.tipo, ci.nome, ci.quantidade, ci.detalhes,
             ci.criado, ci.area_codigo, ci.comanda_codigo, a.nome AS area_nome,
             c.numero, c.origem, c.nome AS cliente
        FROM comanda_item ci
        JOIN comanda c ON c.codigo = ci.comanda_codigo
        LEFT JOIN area a ON a.codigo = ci.area_codigo
        LEFT JOIN comanda_impressa fe ON fe.item_codigo = ci.item_codigo
        LEFT JOIN marca k ON k.item_codigo = ci.item_codigo
       WHERE fe.item_codigo IS NULL AND ci.produzido IS NULL AND ci.entregue IS NULL
         AND (k.item_codigo IS NULL OR (k.pronto_em IS NULL AND k.entregue_em IS NULL))
       ORDER BY ci.item_codigo`;
    if (novos.length) {
      // impressora religada horas depois: comanda velha não sai (a cozinha já
      // se virou de outro jeito); marca como vista e segue só com o fresco
      const velhos = novos.filter((x) => x.criado && Date.now() - new Date(x.criado).getTime() > 3 * 3600e3);
      if (velhos.length) await sql`INSERT INTO comanda_impressa ${sql(velhos.map((x) => ({ item_codigo: x.item_codigo })), 'item_codigo')} ON CONFLICT (item_codigo) DO NOTHING`;
      const velhosSet = new Set(velhos.map((x) => Number(x.item_codigo)));
      const frescos = novos.filter((x) => !velhosSet.has(Number(x.item_codigo)));
      const codigos = new Set(frescos.map((x) => Number(x.item_codigo)));
      // complemento (tipo 2) sai indentado dentro do prato-pai — e NUNCA como
      // cupom próprio. A corrida do espelho fazia o filho chegar um ciclo
      // depois do pai e sair um cupom órfão ("1x com gelo" sozinho na mesa 1):
      //  - pai JÁ impresso: as respostas já saíram na linha ">" do pai (obs) —
      //    marca o filho atrasado como visto, sem papel
      //  - pai ainda NÃO impresso: segura o filho pro cupom do pai no próximo ciclo
      const comps = new Map();
      for (const x of frescos) {
        if (Number(x.tipo) === 2 && x.codigo_pai != null && codigos.has(Number(x.codigo_pai))) {
          if (!comps.has(Number(x.codigo_pai))) comps.set(Number(x.codigo_pai), []);
          comps.get(Number(x.codigo_pai)).push(x);
        }
      }
      const semPai = frescos.filter((x) => Number(x.tipo) === 2 && x.codigo_pai != null && !codigos.has(Number(x.codigo_pai)));
      const paisSemPai = [...new Set(semPai.map((x) => Number(x.codigo_pai)))];
      const paisImpressos = paisSemPai.length
        ? new Set((await sql`SELECT item_codigo FROM comanda_impressa WHERE item_codigo = ANY(${paisSemPai})`).map((r) => Number(r.item_codigo)))
        : new Set();
      const tardios = semPai.filter((x) => paisImpressos.has(Number(x.codigo_pai)));
      if (tardios.length) await sql`INSERT INTO comanda_impressa ${sql(tardios.map((x) => ({ item_codigo: x.item_codigo })), 'item_codigo')} ON CONFLICT (item_codigo) DO NOTHING`;
      // filho com pai: só sai dentro do cupom do pai (comps); nunca como principal
      const principais = frescos.filter((x) => !(Number(x.tipo) === 2 && x.codigo_pai != null));
      // comanda vinculada a mesa: a cozinha precisa saber AONDE entregar
      const numsCom = [...new Set(principais.map((x) => Number(x.numero)).filter((n) => COMANDA_ATIVA && n >= COMANDA_DE && n <= COMANDA_MAX))];
      const vinc = numsCom.length ? await sql`SELECT comanda, mesa FROM mesa_comanda WHERE comanda = ANY(${numsCom}) AND fechada_em IS NULL` : [];
      const mesaDaComanda = new Map(vinc.map((v) => [Number(v.comanda), Number(v.mesa)]));
      const juntoRows = codigos.size ? await sql`SELECT item_codigo FROM item_junto WHERE item_codigo = ANY(${[...codigos]})` : [];
      const junto = new Set(juntoRows.map((r) => Number(r.item_codigo)));
      // um cupom por mesa+praça — a leva que o garçom mandou de uma vez
      const grupos = new Map();
      for (const x of principais) {
        const k = x.comanda_codigo + '|' + (x.area_codigo ?? 's');
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(x);
      }
      for (const itens of grupos.values()) {
        const um = itens[0];
        const marcar = itens.flatMap((x) => [Number(x.item_codigo), ...(comps.get(Number(x.item_codigo)) || []).map((c2) => Number(c2.item_codigo))]);
        const ipDest = porPraca.get(Number(um.area_codigo)) || ipGeral;
        if (!ipDest) {
          // praça sem impressora nenhuma (nem própria, nem geral): o KDS cobre;
          // marca pra não ficar re-checando esses itens a cada ciclo
          await sql`INSERT INTO comanda_impressa ${sql(marcar.map((v) => ({ item_codigo: v })), 'item_codigo')} ON CONFLICT (item_codigo) DO NOTHING`;
          continue;
        }
        let rotulo = impRotulo(um.numero, um.origem);
        const mesaV = mesaDaComanda.get(Number(um.numero));
        if (mesaV) rotulo += ' · MESA ' + mesaV;
        const b = [IMP.init, IMP.centro, IMP.neg, IMP.grande, impLn((um.area_nome || 'Sem praça').toUpperCase()), IMP.norm, IMP.negFim, IMP.esquerda, impTraco(),
          IMP.neg, IMP.grande, impLn(rotulo), IMP.norm, IMP.negFim,
          impLn([um.cliente, impHm(um.criado)].filter(Boolean).join(' · ')), impTraco()];
        for (const it of itens) {
          const nome = (Number(it.tipo) === 2 ? '+ ' : '') + (it.nome || '');
          b.push(IMP.neg, IMP.alto, impLn(impQtd(it.quantidade) + ' ' + nome), IMP.norm, IMP.negFim);
          // resposta de pergunta JÁ sai como filho "+" logo abaixo — não repete
          // na linha ">" (o cupom saía "com açucar" duas vezes). Observação
          // digitada pelo garçom não é filho, então continua saindo.
          const nomesFilhos = new Set((comps.get(Number(it.item_codigo)) || []).map((c2) => String(c2.nome || '').trim().toLowerCase()));
          for (const d of impDetalhes(it.detalhes)) {
            const resto = d.split(' | ').filter((seg) => !nomesFilhos.has(seg.trim().toLowerCase())).join(' | ');
            if (resto) b.push(IMP.alto, impLn('   > ' + resto), IMP.norm);
          }
          for (const c2 of comps.get(Number(it.item_codigo)) || []) {
            b.push(IMP.alto, impLn('   + ' + (Number(c2.quantidade) > 1 ? impQtd(c2.quantidade) + ' ' : '') + (c2.nome || '')), IMP.norm);
            for (const d of impDetalhes(c2.detalhes)) b.push(impLn('     > ' + d));
          }
        }
        if (itens.some((x) => junto.has(Number(x.item_codigo)))) b.push(impTraco(), IMP.neg, impLn('>> SERVIR JUNTO (grupo em mais de uma praça)'), IMP.negFim);
        b.push(IMP.corte);
        // impressora de UMA praça fora do ar não trava as outras: o grupo que
        // falhou fica sem marca e o próximo ciclo tenta de novo
        try { await imprimirRaw(ipDest, Buffer.concat(b), 'comanda ' + rotulo + ' (' + (um.area_nome || 'sem praça') + ')'); }
        catch (e) { console.error('[impressora] comanda falhou:', rotulo, '→', ipDest, '—', e.message); continue; }
        await sql`INSERT INTO comanda_impressa ${sql(marcar.map((v) => ({ item_codigo: v })), 'item_codigo')} ON CONFLICT (item_codigo) DO NOTHING`;
        console.log('[impressora] comanda:', rotulo, '→', ipDest, '—', marcar.length, 'item(ns)');
      }
    }
    if (Date.now() - impLimpouEm > 3600e3) {
      impLimpouEm = Date.now();
      await sql`DELETE FROM comanda_impressa WHERE impresso_em < now() - interval '30 days'`;
    }
  } finally { impRodando = false; }
}

// ---- CONTA na térmica: números REAIS do PEDIDOS (desconto/acréscimo/serviço,
// os mesmos da tela do caixa) + itens/comandas/pagamentos do apiContaTexto.
async function cupomConta(numero, ped) {
  const ct = await apiContaTexto(numero, false, true).catch(() => ({ ok: false }));
  const p = (await qi(`SELECT VALORTOTALITENS I, TOTALSERVICO S, TOTALDESCONTO D, TOTALACRESCIMO A, VALORTOTAL T, TRIM(COALESCE(NOME,'')) NOME FROM PEDIDOS WHERE CODIGO=${Number(ped)}`)).rows?.[0] || {};
  let pago = 0; try { pago = await fbPagoDoPedido(ped); } catch { /* sem FB agora: segue sem o pago */ }
  const subtotal = Number(p.I) || 0, servico = Number(p.S) || 0, desconto = Number(p.D) || 0, acrescimo = Number(p.A) || 0, total = Number(p.T) || 0;
  const falta = Math.max(0, +(total - pago).toFixed(2));
  const nome = (ct.ok && ct.nome) || T(p.NOME) || null;
  const b = [IMP.init, IMP.centro, IMP.neg, IMP.grande, impLn(LOJA_NOME.toUpperCase()), IMP.norm, IMP.negFim,
    impLn('CONFERÊNCIA DE CONSUMO - não é doc. fiscal'), IMP.esquerda, impTraco(),
    IMP.neg, IMP.alto, impLn(impRotulo(numero, null) + (nome ? ' · ' + nome : '')), IMP.norm, IMP.negFim,
    impLn(new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })), impTraco()];
  if (ct.ok) for (const it of ct.itens || []) {
    if (Number(it.tipo) === 2) { b.push(impLn('    + ' + (it.nome || ''))); continue; }
    for (const l of impLinhasItem(impQtd(it.quantidade) + ' ' + (it.nome || ''), (Number(it.valor_total) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }))) b.push(impLn(l));
  }
  if (ct.ok && (ct.itens || []).length) b.push(impTraco());
  b.push(impLn(impLR('Subtotal', impMoeda(subtotal))));
  if (servico > 0) b.push(impLn(impLR('Serviço (' + TAXA_SERVICO + '%)', impMoeda(servico))));
  if (desconto > 0) b.push(impLn(impLR('Desconto', '- ' + impMoeda(desconto))));
  if (acrescimo > 0) b.push(impLn(impLR('Acréscimo', impMoeda(acrescimo))));
  if (pago > 0) b.push(impLn(impLR('Já pago', '- ' + impMoeda(pago))));
  b.push(IMP.neg, IMP.alto, impLn(impLR(pago > 0 ? 'FALTA PAGAR' : 'TOTAL', impMoeda(falta))), IMP.norm, IMP.negFim);
  if (ct.ok && (ct.pagamentos || []).length) {
    b.push(impTraco(), impLn('Pagamentos:'));
    for (const g of ct.pagamentos) b.push(impLn(impLR('  ' + (g.forma || 'pagamento'), impMoeda(g.valor))));
  }
  if (ct.ok && (ct.comandas || []).length) {
    b.push(impTraco(), impLn('Comandas nesta mesa (contas separadas):'));
    for (const cc of ct.comandas) b.push(impLn(impLR('  ' + cc.numero + (cc.nome ? ' ' + String(cc.nome).slice(0, 18) : ''), cc.quitada ? 'paga' : impMoeda(cc.resta))));
    b.push(IMP.neg, impLn(impLR('Mesa + comandas', impMoeda(ct.geral))), IMP.negFim);
  }
  // FIADO: o saldo dele no papel que ele assina. Devedor e credor com nome —
  // "R$ -80,00" ninguém entende conferindo a conta na mesa.
  const fi = ct.ok ? ct.fiado : await fiadoDaConta(numero, ped, falta);
  if (fi) {
    b.push(impTraco(), IMP.neg, impLn('CONTA CORRENTE (FIADO)'), IMP.negFim);
    if (fi.nome) b.push(impLn(fi.nome));
    b.push(impLn(impLR('Saldo de hoje', fi.saldo >= 0 ? impMoeda(fi.saldo) + ' devendo' : impMoeda(-fi.saldo) + ' a favor')));
    if (fi.conta > 0.009) {
      b.push(impLn(impLR('Esta conta', impMoeda(fi.conta))));
      b.push(IMP.neg, impLn(impLR('Assinando, fica', fi.depois >= 0 ? impMoeda(fi.depois) + ' devendo' : impMoeda(-fi.depois) + ' a favor')), IMP.negFim);
    }
    if (fi.limite > 0) b.push(impLn(impLR('Limite ' + impMoeda(fi.limite), 'disp. ' + impMoeda(fi.disponivel))));
    if (fi.estoura) b.push(IMP.neg, impLn('*** PASSA DO LIMITE ***'), IMP.negFim);
    // é o papel da assinatura: tem que ter onde assinar
    b.push(impLn(''), impLn('Assinatura do cliente:'), impLn(''), impLn('__________________________________'));
  }
  b.push(impTraco(), IMP.centro, impLn('Obrigado pela preferência!'), IMP.corte);
  return Buffer.concat(b);
}

/* ---- COMPROVANTE DE MOVIMENTO DA GAVETA ----
   Pedido do dono (22/08): TODA saída de dinheiro do caixa tem que gerar papel.
   Sangria e despesa saem em DUAS VIAS — uma fica no caixa com a assinatura de
   quem levou, a outra vai com o dinheiro. O que o papel responde: o que é,
   pra que é, quanto, quem levou (o responsável pelo valor até o cofre), quem
   liberou (o operador logado) e de qual caixa saiu. Suprimento sai em uma via
   só: entrada de dinheiro não tem ninguém levando nada.
   Sem isso, sangria era uma linha no banco que ninguém assinava. */
function cupomGaveta(d, via) {
  const TIT = { sangria: 'SANGRIA - SAÍDA DE DINHEIRO', despesa: 'DESPESA PAGA DA GAVETA',
    suprimento: 'SUPRIMENTO - ENTRADA DE DINHEIRO' }[d.tipo] || 'MOVIMENTO DE CAIXA';
  const b = [IMP.init, IMP.centro, IMP.neg, IMP.grande, impLn(LOJA_NOME.toUpperCase()), IMP.norm,
    impLn(TIT), IMP.negFim, impLn('não é documento fiscal'),
    via ? impLn('-- ' + via + ' --') : impLn(''), IMP.esquerda, impTraco(),
    IMP.neg, IMP.alto, impLn(impLR(d.tipo === 'suprimento' ? 'ENTROU' : 'SAIU', impMoeda(d.valor))), IMP.norm, IMP.negFim,
    impTraco(),
    impLn('Motivo:'), impLn(d.motivo || '(sem motivo)')];
  if (d.para) b.push(impLn(''), impLn(d.tipo === 'despesa' ? 'Pago a:' : 'Entregue a:'), impLn(d.para));
  b.push(impTraco(),
    impLn(impLR('Caixa nº', String(d.caixa))),
    impLn(impLR('Operador', d.operador || '?')),
    impLn(impLR('Data', new Date(d.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }))),
    impLn(impLR('Gaveta depois', impMoeda(d.gaveta_depois))));
  // quem leva o dinheiro assina; suprimento não tem portador
  if (d.tipo !== 'suprimento') {
    b.push(impTraco(), impLn(''), impLn('Recebi o valor acima:'), impLn(''), impLn(''),
      impLn('__________________________________'),
      impLn(d.para || 'nome e assinatura'));
  }
  b.push(impTraco(), IMP.centro, impLn('Controle interno · guarde esta via'), IMP.corte);
  return Buffer.concat(b);
}
/** Imprime o comprovante da gaveta na térmica do caixa (2 vias na saída). */
async function imprimirGaveta(d) {
  const ip = (await cfgGet('impressora_ip', '')).trim();
  if (!ip) return false;
  try {
    if (d.tipo === 'suprimento') await imprimirRaw(ip, cupomGaveta(d, null), 'gaveta ' + d.tipo);
    else {
      await imprimirRaw(ip, cupomGaveta(d, '1ª VIA: FICA NO CAIXA'), 'gaveta ' + d.tipo + ' v1');
      await imprimirRaw(ip, cupomGaveta(d, '2ª VIA: VAI COM O DINHEIRO'), 'gaveta ' + d.tipo + ' v2');
    }
    return true;
  } catch (e) { console.error('[impressora] gaveta:', e.message); return false; }
}

/* ---- COMPROVANTE DO PIX ----
   Pedido do dono (22/08): quando a mesa fecha por Pix, tem que sair um
   comprovante do pagamento. Serve pros dois lados — o cliente leva a prova de
   que pagou, e a casa tem o papel com o E2E (o número que o banco reconhece)
   pra achar o dinheiro no extrato se alguém contestar depois.
   Os dados vêm daqui e alimentam tanto o cupom da térmica quanto a página. */
async function dadosComprovantePix(txid) {
  const c = (await sql`SELECT * FROM pix_cobranca WHERE txid=${String(txid)}`)[0];
  if (!c) return null;
  const numero = Number(c.mesa) || 0;
  const ct = await apiContaTexto(numero).catch(() => ({ ok: false }));
  const consumo = ct.ok ? Number(ct.total || 0) + (ct.comandas || []).reduce((a, x) => a + Number(x.subtotal || 0), 0) : 0;
  const pagoGeral = ct.ok ? Number(ct.pago_geral || 0) : 0;
  const falta = ct.ok ? Math.max(0, +(consumo - pagoGeral).toFixed(2)) : 0;
  return { txid: String(txid), mesa: numero, rotulo: impRotulo(numero, null),
    nome: (ct.ok && ct.nome) || null, valor: Number(c.valor) || 0, e2e: c.e2e || null,
    quando: c.pago_em || c.criado_em, provedor: c.provedor || 'cielo',
    consumo, pago_geral: pagoGeral, falta, quitada: falta <= 0.009, casa: LOJA_NOME };
}
function cupomPix(d) {
  const q = new Date(d.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const b = [IMP.init, IMP.centro, IMP.neg, IMP.grande, impLn(d.casa.toUpperCase()), IMP.norm,
    impLn('COMPROVANTE DE PAGAMENTO'), IMP.negFim, impLn('não é documento fiscal'),
    IMP.esquerda, impTraco(),
    IMP.neg, IMP.alto, impLn(d.rotulo + (d.nome ? ' · ' + d.nome : '')), IMP.norm, IMP.negFim,
    impLn(q), impTraco(),
    impLn(impLR('Forma', 'Pix')),
    IMP.neg, IMP.alto, impLn(impLR('PAGO', impMoeda(d.valor))), IMP.norm, IMP.negFim, impTraco(),
    impLn(impLR('Consumo da mesa', impMoeda(d.consumo))),
    impLn(impLR('Total pago', impMoeda(d.pago_geral)))];
  if (d.quitada) b.push(IMP.centro, IMP.neg, IMP.alto, impLn('CONTA QUITADA'), IMP.norm, IMP.negFim, IMP.esquerda);
  else b.push(IMP.neg, impLn(impLR('AINDA FALTA', impMoeda(d.falta))), IMP.negFim);
  b.push(impTraco());
  // o E2E é o que o banco reconhece — sem ele, contestação vira palavra contra palavra
  if (d.e2e) b.push(impLn('Pix E2E:'), impLn(d.e2e));
  b.push(impLn('ID: ' + d.txid), impTraco(), IMP.centro, impLn('Obrigado pela preferência!'), IMP.corte);
  return Buffer.concat(b);
}
/** Manda o comprovante pra térmica do caixa, se houver uma configurada. */
async function imprimirComprovantePix(txid) {
  const ip = (await cfgGet('impressora_ip', '')).trim();
  if (!ip) return false;
  const d = await dadosComprovantePix(txid);
  if (!d) return false;
  try { await imprimirRaw(ip, cupomPix(d), 'comprovante pix ' + txid); return true; }
  catch (e) { console.error('[impressora] comprovante pix:', e.message); return false; }
}

// ---- config e teste da impressora (tela /tempos) ----
async function apiImpressora() {
  const pracas = await sql`SELECT a.codigo, a.nome, pi.ip FROM area a
    LEFT JOIN praca_impressora pi ON pi.area_codigo=a.codigo ORDER BY a.nome`;
  return { ok: true, ip: await cfgGet('impressora_ip', ''), modo: await cfgGet('producao_modo', 'kds'),
    pracas: pracas.map((x) => ({ codigo: Number(x.codigo), nome: x.nome, ip: (x.ip || '').trim() })), ultimo: impUltimo };
}
const impIpValido = (ip) => !ip || /^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$/.test(ip);
async function apiImpressoraSalvar(body) {
  const ip = String(body.ip ?? '').trim();
  if (!impIpValido(ip)) return { ok: false, erro: 'IP inválido — ex.: 192.168.10.9 ou 192.168.10.9:9100' };
  // {area_codigo, ip} = impressora DA PRAÇA (vazio remove; volta pra geral)
  if (body.area_codigo != null) {
    if (!ip) await sql`DELETE FROM praca_impressora WHERE area_codigo=${Number(body.area_codigo)}`;
    else await sql`INSERT INTO praca_impressora (area_codigo, ip) VALUES (${Number(body.area_codigo)}, ${ip})
      ON CONFLICT (area_codigo) DO UPDATE SET ip=EXCLUDED.ip`;
    return { ok: true };
  }
  const modo = ['kds', 'ambos', 'impressora'].includes(String(body.modo)) ? String(body.modo) : null;
  const antes = await cfgGet('producao_modo', 'kds');
  await cfgSet('impressora_ip', ip);
  if (modo) {
    await cfgSet('producao_modo', modo);
    // ligou a impressão AGORA: o que já estava na casa não imprime (senão sai
    // um bolo de cupom velho de uma vez) — só pedido novo daqui pra frente
    if (modo !== 'kds' && antes === 'kds')
      await sql`INSERT INTO comanda_impressa (item_codigo) SELECT item_codigo FROM comanda_item ON CONFLICT (item_codigo) DO NOTHING`;
  }
  return { ok: true, ip, modo: modo || antes };
}
async function apiImpressoraTeste(body) {
  let ip = '', onde = 'geral (caixa)';
  if (body && body.area_codigo != null) {
    const r = (await sql`SELECT a.nome, pi.ip FROM area a LEFT JOIN praca_impressora pi ON pi.area_codigo=a.codigo
      WHERE a.codigo=${Number(body.area_codigo)}`)[0];
    ip = (r?.ip || '').trim() || (await cfgGet('impressora_ip', '')).trim();
    onde = (r?.nome || 'praça ' + body.area_codigo) + (r?.ip ? '' : ' (usando a geral)');
  } else ip = (await cfgGet('impressora_ip', '')).trim();
  if (!ip) return { ok: false, erro: 'sem impressora: preencha o IP da praça ou o geral' };
  const b = [IMP.init, IMP.centro, IMP.neg, IMP.grande, impLn(LOJA_NOME.toUpperCase()), IMP.norm, IMP.negFim, impLn('teste da impressora'), IMP.esquerda, impTraco(),
    impLn(impLR('Praça do teste:', onde)),
    impLn('Acentuação: ção põe água café útil ÁÉÍÓÚ Ç'),
    impLn('123456789012345678901234567890123456789012345678'),
    impLn('(48 números acima — devem caber numa linha só)'),
    IMP.neg, IMP.alto, impLn('A comanda sai neste tamanho'), IMP.norm, IMP.negFim,
    impTraco(), IMP.centro, impLn(new Date().toLocaleString('pt-BR')), IMP.corte];
  try { await imprimirRaw(ip, Buffer.concat(b), 'teste ' + onde); return { ok: true, ip }; }
  catch (e) { return { ok: false, erro: e.message }; }
}

// ---- PAGAMENTO no Consumer (Fase 2, Rota A) ----
// Grava em PAGAMENTOS o que NÓS cobramos, com NSU/autorização, do mesmo jeito
// que a integração "Smart POS Cielo" grava hoje (INTEGRADOAUTOMACAO='1'). Isso
// mantém o Consumer capaz de emitir a NFC-e enquanto a Fase 3 não chega.
// NÃO fecha o pedido — quem fecha/emite a nota segue sendo o Consumer.
const FORMA = { DINHEIRO: 1, CREDITO: 3, DEBITO: 4, PIX_MANUAL: 18, PIX_ONLINE: 21 };
async function fbCaixaAberto() {
  if (nativo()) {
    const [c] = await sql`SELECT codigo FROM caixa_local WHERE fechado_em IS NULL ORDER BY codigo DESC LIMIT 1`;
    if (!c) throw new Error('nenhum caixa aberto');
    return Number(c.codigo);
  }
  const r = await qi(`SELECT FIRST 1 CODIGO FROM CAIXA WHERE DATAFECHAMENTO IS NULL ORDER BY CODIGO DESC`);
  if (!r.ok) throw new Error('FB caixa: ' + r.err);
  if (!r.rows.length) throw new Error('nenhum caixa aberto no Consumer');
  return Number(r.rows[0].CODIGO);
}
async function fbInserirPagamento(ped, pg) {
  // Regra do dono: DINHEIRO só entra no caixa DO OPERADOR (o chamador manda
  // pg.caixa_codigo do caixa dele — sem caixa aberto, não recebe). Cartão/Pix
  // nunca travam por caixa: caem no aberto que houver, ou o sistema abre o
  // caixa "ser" sozinho (pagamento sem CODIGOCAIXA não existe na prática:
  // 2 em 185 mil no banco real — então aqui sempre tem caixa).
  let caixa = pg.caixa_codigo || null;
  if (!caixa) {
    if (Number(pg.forma_codigo) === FORMA.DINHEIRO) throw new Error('dinheiro exige caixa aberto do operador — abra o seu caixa');
    caixa = await fbCaixaAbertoOuSistema();
  }
  const nsu = pg.nsu ? Number(String(pg.nsu).replace(/\D/g, '')) || null : null;
  if (nativo()) {
    const cod = await proxCodigo('pagamento');
    await sql`INSERT INTO pagamento_local (codigo, pedido, forma_codigo, valor, caixa_codigo,
        nsu, autorizacao, bandeira, observacao, quando)
      VALUES (${cod}, ${Number(ped)}, ${Number(pg.forma_codigo)}, ${Number(pg.valor)}, ${Number(caixa)},
        ${nsu == null ? null : String(nsu)}, ${pg.autorizacao || null}, ${pg.bandeira || null},
        ${pg.observacao || 'Prainha Vendas'}, now())`;
    return cod;
  }
  const campos = ['CODIGOPEDIDO', 'CODIGOFORMAPAGAMENTO', 'VALOR', 'DATAPAGAMENTO', 'CODIGOCAIXA', 'CODIGOCATEGORIACONTAS', 'PERCENTUALTAXA', 'INTEGRADOAUTOMACAO', 'OBSERVACAO'];
  const vals = [String(ped), String(pg.forma_codigo), fbNum(pg.valor), 'CURRENT_TIMESTAMP', String(caixa), '1', '0', "'1'", `'${fbEsc(pg.observacao || 'Prainha Vendas')}'`];
  if (nsu != null) { campos.push('NSUTRANSACAO'); vals.push(String(nsu)); }
  if (pg.autorizacao) { campos.push('NUMEROAUTORIZACAOCARTAO'); vals.push(`'${fbEsc(pg.autorizacao)}'`); }
  if (pg.bandeira) { campos.push('BANDEIRAMFE'); vals.push(`'${fbEsc(pg.bandeira)}'`); }
  const r = await qi(`INSERT INTO PAGAMENTOS (${campos.join(', ')}) VALUES (${vals.join(', ')})`);
  if (!r.ok) throw new Error('FB pagamento: ' + r.err);
  // RETURNING crasha intermitente no FB4 -> busca o recém-inserido
  const g = await qi(`SELECT FIRST 1 CODIGO FROM PAGAMENTOS WHERE CODIGOPEDIDO=${ped} AND DATADELETE IS NULL ORDER BY CODIGO DESC`);
  return g.ok && g.rows.length ? Number(g.rows[0].CODIGO) : null;
}
/** Quanto já foi pago desse pedido no Consumer (fonte da verdade do saldo). */
async function fbPagoDoPedido(ped) {
  if (nativo()) return pgPagoDoPedido(ped);
  const r = await qi(`SELECT COALESCE(SUM(VALOR),0) PAGO FROM PAGAMENTOS WHERE CODIGOPEDIDO=${ped} AND DATADELETE IS NULL`);
  if (!r.ok) throw new Error('FB pago: ' + r.err);
  return Number(r.rows[0].PAGO) || 0;
}

// ---- COBRANÇA: adapter de provedor ----
// Dois modos, pela MESMA interface — a tela não muda quando trocar de provedor:
//
//  'manual' (default, funciona HOJE sem depender de ninguém): o operador cobra
//     na maquininha como já faz e confirma aqui; a gente registra com o NSU.
//  'lio'    (quando as credenciais chegarem): manda a cobrança pra LIO V3 pela
//     Order Manager API da Cielo; o garçom só confirma no terminal.
//
// A LIO está em fim de vida (Cielo migrando pra Smart) — por isso o provedor é
// trocável por env: quando virar Smart/Conecta, só entra outro caso no switch.
const PAG_PROVEDOR = process.env.PAG_PROVEDOR || 'manual';
const LIO_BASE = process.env.LIO_BASE || 'https://api.cielo.com.br/order-management/v1';
const LIO_CLIENT_ID = process.env.LIO_CLIENT_ID || '';
const LIO_ACCESS_TOKEN = process.env.LIO_ACCESS_TOKEN || '';
const LIO_MERCHANT = process.env.LIO_MERCHANT_CODE || '';
const lioConfigurado = () => !!(LIO_CLIENT_ID && LIO_ACCESS_TOKEN);

function pagStatus() {
  return {
    provedor: PAG_PROVEDOR,
    lio_configurado: lioConfigurado(),
    // 'manual' sempre disponível — é o que garante que a loja nunca trava.
    modos: PAG_PROVEDOR === 'lio' && lioConfigurado() ? ['lio', 'manual'] : ['manual'],
  };
}

const lioHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${LIO_ACCESS_TOKEN}`,
  'Client-Id': LIO_CLIENT_ID,
  ...(LIO_MERCHANT ? { 'Merchant-Code': LIO_MERCHANT } : {}),
});

/** Cria o pedido na Cielo e coloca na fila do terminal (operation=PLACE). */
async function lioCriarCobranca({ numero, valor, itens }) {
  if (!lioConfigurado()) throw new Error('LIO sem credenciais (LIO_CLIENT_ID/LIO_ACCESS_TOKEN)');
  const cent = Math.round(Number(valor) * 100);
  const body = {
    reference: 'PRAINHA-' + numero + '-' + Date.now(),
    price: cent,
    items: (itens || []).map((i) => ({
      name: String(i.nome).slice(0, 60),
      sku: String(i.codigo_pdv),
      unitPrice: Math.round(Number(i.preco) * 100),
      quantity: Number(i.qtd) || 1,
      unitOfMeasure: 'UNIT',
    })),
  };
  const r = await fetch(`${LIO_BASE}/orders`, { method: 'POST', headers: lioHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`LIO criar pedido ${r.status}: ${txt.slice(0, 200)}`);
  const ord = JSON.parse(txt);
  const place = await fetch(`${LIO_BASE}/orders/${ord.id}?operation=PLACE`, { method: 'PUT', headers: lioHeaders(), signal: AbortSignal.timeout(20000) });
  if (!place.ok) throw new Error(`LIO enviar pro terminal ${place.status}: ${(await place.text()).slice(0, 200)}`);
  return { orderId: ord.id, reference: body.reference };
}

/** Consulta o pedido na Cielo; retorna dados do pagamento quando aprovado. */
async function lioConsultar(orderId) {
  const r = await fetch(`${LIO_BASE}/orders/${orderId}`, { headers: lioHeaders(), signal: AbortSignal.timeout(15000) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`LIO consulta ${r.status}: ${txt.slice(0, 200)}`);
  const d = JSON.parse(txt);
  const pg = (d.payments && d.payments[0]) || {};
  const pago = String(d.status || '').toUpperCase() === 'PAID' || !!pg.authCode;
  return {
    pago,
    status: d.status,
    nsu: pg.cieloCode || pg.nsu || null,
    autorizacao: pg.authCode || null,
    bandeira: pg.brand || null,
    bruto: d,
  };
}

// ---- API de VENDA ----
// ---- VARIANTES DO MESMO PRODUTO ----
// No Consumer, "Dose/Garrafa" e o SABOR são o mesmo campo (PRODUTOTAMANHO):
// "Absolut" tem 2 variantes, "T Gin" tem 17 frutas — e o preço muda em cada
// uma (gin de R$ 25 a 29). Listar 17 linhas quase iguais é ruim de achar e
// fácil de errar. Então a lista mostra UM "T Gin" e, ao tocar, pergunta qual.
// Produto de variante única entra direto, sem pergunta nenhuma.
function agruparVariantes(rows) {
  const porProduto = new Map();
  for (const r of rows) {
    const k = r.produto_codigo != null ? 'p' + r.produto_codigo : 'v' + r.codigo_pdv;
    if (!porProduto.has(k)) porProduto.set(k, []);
    porProduto.get(k).push(r);
  }
  const out = [];
  for (const vs of porProduto.values()) {
    if (vs.length === 1) { out.push(vs[0]); continue; }
    const disp = vs.filter((v) => !v.sem_estoque);
    // a faixa de preço vem do que dá pra vender AGORA; se nada, do cadastro
    const base = disp[0] || vs[0];
    const precos = (disp.length ? disp : vs).map((v) => Number(v.preco || 0));
    // estoque do grupo = soma das variantes controladas (null se nenhuma tem)
    const comEst = vs.filter((x) => x.estoque != null);
    out.push({ grupo: true, produto_codigo: base.produto_codigo, nome: base.nome,
      descricao: base.descricao ?? null, tem_foto: !!base.tem_foto,
      area_codigo: base.area_codigo, variantes: vs.length, disponiveis: disp.length,
      preco: Math.min(...precos), preco_max: Math.max(...precos),
      estoque: comEst.length ? comEst.reduce((s, x) => s + Number(x.estoque || 0), 0) : null,
      sem_estoque: disp.length === 0 });
  }
  // fora de estoque por último, depois nome — mesma ordem de antes
  return out.sort((a, b) => (a.sem_estoque === b.sem_estoque
    ? String(a.nome).localeCompare(String(b.nome), 'pt-BR')
    : (a.sem_estoque ? 1 : -1)));
}
// ---- CADASTRO: onde cada produto aparece ----
/** Lista pro cadastro: mostra a decisão da casa e, quando não há, o padrão
 *  que veio do Consumer — pra ficar claro o que é escolha e o que é herança. */
async function apiProdutos(termo, so) {
  const t = '%' + semAcento(String(termo || '').trim()) + '%';
  const filtro = so === 'sem-foto' ? sql`AND f.produto_codigo IS NULL`
    : so === 'ajustados' ? sql`AND c.codigo_pdv IS NOT NULL` : sql``;
  const rows = await sql`SELECT p.codigo_pdv, p.produto_codigo, p.nome, p.tamanho, p.preco,
      p.categoria, p.sem_estoque, p.estoque, p.cardapio_digital AS padrao_cliente,
      c.cliente, c.garcom, c.caixa, c.delivery,
      (f.produto_codigo IS NOT NULL) AS tem_foto
    FROM produto_local p
    LEFT JOIN produto_config c ON c.codigo_pdv = p.codigo_pdv
    LEFT JOIN produto_foto f ON f.produto_codigo = p.produto_codigo
    WHERE p.nome_busca LIKE ${t} ${filtro}
    ORDER BY p.categoria, p.nome, p.tamanho LIMIT 200`;
  return { ok: true, produtos: rows };
}
/** Grava a decisão. null volta pro padrão do Consumer — dá pra desfazer. */
async function apiProdutoSalvar(body) {
  const pdv = Number(body.codigo_pdv);
  if (!(pdv > 0)) return { ok: false, erro: 'produto inválido' };
  const b = (v) => (v === true || v === false ? v : null);
  const cfg = { cliente: b(body.cliente), garcom: b(body.garcom),
    caixa: b(body.caixa), delivery: b(body.delivery) };
  // tudo null = a casa desfez: some o registro e volta a valer o Consumer
  if (Object.values(cfg).every((v) => v === null)) {
    await sql`DELETE FROM produto_config WHERE codigo_pdv=${pdv}`;
    return { ok: true, limpo: true };
  }
  await sql`INSERT INTO produto_config (codigo_pdv, cliente, garcom, caixa, delivery)
      VALUES (${pdv}, ${cfg.cliente}, ${cfg.garcom}, ${cfg.caixa}, ${cfg.delivery})
    ON CONFLICT (codigo_pdv) DO UPDATE SET cliente=EXCLUDED.cliente, garcom=EXCLUDED.garcom,
      caixa=EXCLUDED.caixa, delivery=EXCLUDED.delivery, atualizado=now()`;
  return { ok: true };
}
/** Troca a foto do PRODUTO (vale pra todas as variantes dele). */
async function apiProdutoFoto(body) {
  const prod = Number(body.produto_codigo);
  if (!(prod > 0)) return { ok: false, erro: 'produto inválido' };
  if (body.remover) {
    await sql`DELETE FROM produto_foto WHERE produto_codigo=${prod}`;
    return { ok: true, removida: true };
  }
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.foto || ''));
  if (!m) return { ok: false, erro: 'imagem inválida' };
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 2_000_000) return { ok: false, erro: 'imagem muito grande (máx. 2 MB)' };
  const mime = m[1] === 'png' ? 'image/png' : m[1] === 'webp' ? 'image/webp' : 'image/jpeg';
  await sql`INSERT INTO produto_foto (produto_codigo, mime, bytes, tam, atualizado)
      VALUES (${prod}, ${mime}, ${buf}, ${buf.length}, now())
    ON CONFLICT (produto_codigo) DO UPDATE SET mime=EXCLUDED.mime, bytes=EXCLUDED.bytes,
      tam=EXCLUDED.tam, atualizado=now()`;
  return { ok: true, tam: buf.length };
}

/** As variantes de um produto — só as que dá pra vender aparecem em primeiro. */
async function apiVendaVariantes(produtoCodigo, cliente) {
  const p = Number(produtoCodigo);
  if (!(p > 0)) return { ok: false, erro: 'produto inválido' };
  const rows = await sql`SELECT codigo_pdv, produto_codigo, nome, tamanho, preco, area_codigo, sem_estoque, estoque, descricao,
      EXISTS(SELECT 1 FROM produto_foto f WHERE f.produto_codigo=produto_local.produto_codigo) AS tem_foto
    FROM produto_local WHERE produto_codigo=${p} ${soCliente(cliente)}
    ORDER BY sem_estoque, preco, tamanho`;
  return { ok: true, nome: rows[0]?.nome ?? null, produtos: rows };
}
async function apiVendaBusca(termo, cliente) {
  // busca sem acento e sem caixa — nome_busca ja vem normalizada do catalogo
  // ⚠️ A BUSCA TAMBÉM FILTRA PRO CLIENTE. Ela não filtrava: bastava digitar
  // "couvert" pra achar e pedir couvert, serviço, complemento interno — tudo
  // que a casa marcou como fora do cardápio digital. A navegação por grupo já
  // respeitava; a busca era a porta dos fundos.
  const t = '%' + semAcento(String(termo || '').trim()) + '%';
  const rows = await sql`SELECT codigo_pdv, produto_codigo, nome, tamanho, preco, area_codigo, sem_estoque, estoque, descricao,
      EXISTS(SELECT 1 FROM produto_foto f WHERE f.produto_codigo=produto_local.produto_codigo) AS tem_foto
    FROM produto_local WHERE nome_busca LIKE ${t} ${soCliente(cliente)}
    ORDER BY sem_estoque, comanda_mobile DESC, nome LIMIT 60`;
  return { produtos: agruparVariantes(rows) };
}
// Navegacao por categoria: o garcom nem sempre lembra o nome do produto.
/** Filtro do cardápio do CLIENTE: respeita a flag do Consumer e a lista de
 *  grupos que a casa escondeu. O GARÇOM não passa por aqui — ele lança tudo. */
// A NOSSA config manda; sem decisão registrada, vale a flag do Consumer.
// O garçom não filtra por padrão — ele lança qualquer coisa —, só perde o que
// a casa DESLIGAR explicitamente pra ele.
const soCliente = (cliente) => (cliente
  ? sql`AND COALESCE((SELECT c.cliente FROM produto_config c WHERE c.codigo_pdv = produto_local.codigo_pdv), cardapio_digital)
        AND categoria NOT IN (SELECT categoria FROM grupo_oculto)`
  : sql`AND COALESCE((SELECT c.garcom FROM produto_config c WHERE c.codigo_pdv = produto_local.codigo_pdv), TRUE)`);
async function apiVendaCategorias(cliente) {
  // Só grupo que tem o que vender AGORA. Grupo inteiro fora de estoque não
  // aparece — o garçom não deve tocar num grupo pra descobrir que está vazio.
  // parenteses no FILTER antes do cast: sem eles a precedencia fica ambigua
  const rows = await sql`SELECT categoria, min(categoria_ordem) AS ordem, count(*)::int AS n,
      (count(*) FILTER (WHERE NOT sem_estoque))::int AS disp
    FROM produto_local WHERE TRUE ${soCliente(cliente)} GROUP BY categoria
    HAVING count(*) FILTER (WHERE NOT sem_estoque) > 0
    -- A SEQUÊNCIA É A DO CONSUMER (ETIQUETAS.ORDEM), não alfabética. A casa
    -- monta o cardápio numa hierarquia pensada — Drink, Petiscos, Parrilha,
    -- Pratos, Moquecas, e só então a carta de bar. Ordenar por nome jogava
    -- "Acompanhamentos" pro topo e enterrava "Pratos" no meio.
    ORDER BY ordem, categoria`;
  return { categorias: rows };
}
async function apiVendaCategoria(nome, cliente) {
  const rows = await sql`SELECT codigo_pdv, produto_codigo, nome, tamanho, preco, area_codigo, sem_estoque, estoque, descricao,
      EXISTS(SELECT 1 FROM produto_foto f WHERE f.produto_codigo=produto_local.produto_codigo) AS tem_foto
    FROM produto_local WHERE categoria=${String(nome || '')} ${soCliente(cliente)}
    ORDER BY sem_estoque, nome`;
  return { categoria: String(nome || ''), produtos: agruparVariantes(rows) };
}
/** Grupos que a casa escondeu do cardápio do cliente. */
async function apiGruposOcultos() {
  const todos = await sql`SELECT DISTINCT categoria FROM produto_local WHERE cardapio_digital ORDER BY categoria`;
  const ocultos = await sql`SELECT categoria FROM grupo_oculto`;
  const set = new Set(ocultos.map((x) => x.categoria));
  return { grupos: todos.map((x) => ({ categoria: x.categoria, oculto: set.has(x.categoria) })) };
}
async function apiGrupoOcultar(body) {
  const cat = String(body.categoria || '').slice(0, 120);
  if (!cat) return { ok: false, erro: 'categoria' };
  if (body.oculto) await sql`INSERT INTO grupo_oculto (categoria) VALUES (${cat}) ON CONFLICT DO NOTHING`;
  else await sql`DELETE FROM grupo_oculto WHERE categoria=${cat}`;
  return { ok: true };
}
// Mesas/comandas abertas AGORA — o garcom clica em vez de digitar o numero.
async function apiVendaAbertas() {
  // Status da mesa, pra cor na tela do garçom:
  //   vermelho = conta pedida (fechando)   amarelo = tem coisa atrasada
  //   verde    = em andamento, tudo em dia
  const rows = await sql`SELECT c.numero, c.codigo, c.valor_total, c.data_abertura, c.conta_pedida, c.origem,
      (count(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2))::int AS itens,
      (count(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2
        AND COALESCE(ci.produzido, m.pronto_em) IS NULL
        AND ci.criado < now() - (COALESCE(pc.minutos, ${LIMITE_ATRASO_MIN}) || ' minutes')::interval))::int AS atrasados,
      (count(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2
        AND COALESCE(ci.produzido, m.pronto_em) IS NOT NULL
        AND COALESCE(ci.entregue, m.entregue_em) IS NULL
        AND COALESCE(ci.produzido, m.pronto_em) < now() - interval '5 minutes'))::int AS parados
    FROM comanda c
    LEFT JOIN comanda_item ci ON ci.comanda_codigo=c.codigo
    LEFT JOIN marca m ON m.item_codigo=ci.item_codigo
    LEFT JOIN praca_config pc ON pc.area_codigo=ci.area_codigo
    GROUP BY c.numero, c.codigo, c.valor_total, c.data_abertura, c.conta_pedida, c.origem ORDER BY c.numero`;
  for (const r of rows) {
    r.status = r.conta_pedida ? 'fechando' : ((r.atrasados > 0 || r.parados > 0) ? 'atrasada' : 'andamento');
  }
  // a comanda leva junto a mesa dela: clicar na comanda abre a MESA certa
  const vinc = await sql`SELECT comanda, mesa FROM mesa_comanda WHERE fechada_em IS NULL`;
  const mapa = new Map(vinc.map((v) => [Number(v.comanda), Number(v.mesa)]));
  // Nome do dono, pra aparecer embaixo do número na lista. identificacao ganha
  // do cadastro antigo (mesa_comanda), igual em apiVendaMesa.
  const nomePorNum = new Map();
  for (const x of await sql`SELECT comanda AS numero, nome_curto FROM mesa_comanda WHERE fechada_em IS NULL AND nome_curto IS NOT NULL`) nomePorNum.set(Number(x.numero), x.nome_curto);
  for (const x of await sql`SELECT numero, nome_curto FROM identificacao WHERE fechada_em IS NULL AND nome_curto IS NOT NULL`) nomePorNum.set(Number(x.numero), x.nome_curto);
  for (const r of rows) r.nome = nomePorNum.get(Number(r.numero)) || null;

  // 🔔 CHAMOU GARÇOM na grade (funciona na maquininha SEM versão nova): marca a
  // mesa que apertou o botão com 🔔 no nome + cor amarela (o app já pinta por
  // status). A mesa que chamou mas ainda não tem conta aberta entra como chip
  // vazio — o garçom toca e já abre pra lançar.
  const chamando = await mesasChamandoGarcom();
  const numsAbertos = new Set(rows.map((r) => Number(r.numero)));
  for (const r of rows) {
    if (Number(r.numero) < COMANDA_DE && chamando.has(Number(r.numero))) {
      r.chamou_garcom = true;
      r.nome = '🔔 CHAMOU' + (r.nome ? ' · ' + r.nome : '');
      r.status = 'fechando'; // VERMELHO — cor mais forte que o app instalado pinta (piscar só com versão nova)
    }
  }
  const extras = [];
  for (const mesa of chamando) {
    if (mesa < COMANDA_DE && !numsAbertos.has(mesa)) {
      extras.push({ numero: mesa, valor_total: 0, itens: 0, status: 'fechando',
        conta_pedida: false, nome: '🔔 CHAMOU', chamou_garcom: true });
    }
  }
  const mesas = rows.filter((x) => Number(x.numero) < COMANDA_DE)
    .concat(extras).sort((a, b) => Number(a.numero) - Number(b.numero));
  return {
    mesas,
    comandas: rows.filter((x) => Number(x.numero) >= COMANDA_DE).map((x) => ({ ...x, mesa: mapa.get(Number(x.numero)) ?? null })),
  };
}
async function apiVendaMesa(mesa) {
  const m = Number(mesa);
  const comandas = await sql`SELECT comanda, nome_curto FROM mesa_comanda WHERE mesa=${m} AND fechada_em IS NULL ORDER BY comanda`;
  const numeros = [m, ...comandas.map((x) => x.comanda)];
  const abertos = await sql`SELECT c.numero, count(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2) AS itens, c.valor_total
    FROM comanda c LEFT JOIN comanda_item ci ON ci.comanda_codigo=c.codigo
    WHERE c.numero = ANY(${numeros}) GROUP BY c.numero, c.codigo ORDER BY c.numero`;
  const nums = [m, ...comandas.map((x) => Number(x.comanda))];
  const ids = await sql`SELECT numero, nome_curto FROM identificacao WHERE numero = ANY(${nums}) AND fechada_em IS NULL`;
  const nomes = Object.fromEntries(comandas.filter((x) => x.nome_curto).map((x) => [x.comanda, x.nome_curto]));
  for (const i of ids) if (i.nome_curto) nomes[i.numero] = i.nome_curto; // identificacao ganha da antiga
  // conta pedida: vem do ESPELHO (barato). apiVendaConta atualiza o espelho na
  // hora, entao nao ha janela em que a tela mostre "aberta" com a conta pedida.
  const cp = await sql`SELECT bool_or(conta_pedida) AS pedida FROM comanda WHERE numero = ANY(${numeros})`;
  return { mesa: m, comandas: comandas.map((x) => x.comanda), nomes, cliente: nomes[m] || null, abertos,
    conta_pedida: !!cp[0]?.pedida };
}
/** A comanda tem dono? Vale o cadastro novo (identificacao) ou o antigo
 *  (mesa_comanda, preenchido na hora de abrir). Basta CPF OU telefone — um
 *  nome solto não identifica ninguém e não serve pra cobrar depois. */
async function comandaIdentificada(numero) {
  const n = Number(numero);
  const id = (await sql`SELECT cpf, telefone, contato_fb FROM identificacao
    WHERE numero=${n} AND fechada_em IS NULL`)[0];
  if (id && (id.cpf || id.telefone || id.contato_fb)) return true;
  const mc = (await sql`SELECT cpf, contato_fb FROM mesa_comanda
    WHERE comanda=${n} AND fechada_em IS NULL`)[0];
  return !!(mc && (mc.cpf || mc.contato_fb));
}
async function apiVendaVincular(body) {
  const mesa = Number(body.mesa), comanda = Number(body.comanda);
  if (!(mesa >= 1 && mesa <= MESA_MAX)) return { ok: false, erro: 'mesa inválida (1–' + MESA_MAX + ')' };
  if (!(comanda >= COMANDA_DE && comanda <= NUMERO_MAX)) return { ok: false, erro: 'comanda é de ' + COMANDA_MIN + ' a ' + COMANDA_MAX };
  const jaEm = await sql`SELECT mesa FROM mesa_comanda WHERE comanda=${comanda} AND fechada_em IS NULL AND mesa<>${mesa}`;
  if (jaEm.length) return { ok: false, erro: 'comanda ' + comanda + ' já está na mesa ' + jaEm[0].mesa };
  // ⚠️ COMANDA NAO NASCE VAZIA. A comanda e' conta em aberto que a pessoa leva
  // no bolso e paga no fim — sem dono, e' prejuizo anonimo esperando acontecer.
  // Antes a tela criava o vinculo e SO DEPOIS pedia o CPF; quem apertasse
  // "voltar" deixava uma comanda solta, sem ninguem amarrado. Agora o vinculo
  // so nasce com nome + (CPF ou telefone ou cadastro do Consumer).
  // Vale so na CRIACAO: comanda que ja existe pode ser atualizada sem reenviar
  // tudo (mudar de mesa, completar o telefone depois).
  const jaExiste = (await sql`SELECT 1 FROM mesa_comanda WHERE comanda=${comanda} AND fechada_em IS NULL`).length > 0;
  if (!jaExiste) {
    const temNome = String(body.nome || '').trim().length > 1;
    const temDoc = !!(body.cpf || body.telefone || body.contato_fb);
    if (!temNome || !temDoc) {
      return { ok: false, precisa_dono: true,
        erro: 'A comanda ' + comanda + ' precisa do nome e do CPF (ou WhatsApp) de quem vai usar. Comanda sem dono não abre.' };
    }
  }
  // Quem está na comanda (opcional): CPF válido + nome do cadastro ou digitado.
  const cpf = body.cpf ? soDig(body.cpf) : null;
  if (cpf && !cpfValido(cpf)) return { ok: false, erro: 'CPF inválido' };
  const nome = String(body.nome || '').trim().slice(0, 120) || null;
  const curto = nome ? nomeCurto(nome) : null;
  const contatoFb = body.contato_fb ? Number(body.contato_fb) : null;
  await sql`INSERT INTO mesa_comanda (comanda, mesa, cpf, nome, nome_curto, contato_fb)
      VALUES (${comanda}, ${mesa}, ${cpf}, ${nome}, ${curto}, ${contatoFb})
    ON CONFLICT (comanda) DO UPDATE SET mesa=EXCLUDED.mesa, aberta_em=now(), fechada_em=NULL,
      cpf=COALESCE(EXCLUDED.cpf, mesa_comanda.cpf),
      nome=COALESCE(EXCLUDED.nome, mesa_comanda.nome),
      nome_curto=COALESCE(EXCLUDED.nome_curto, mesa_comanda.nome_curto),
      contato_fb=COALESCE(EXCLUDED.contato_fb, mesa_comanda.contato_fb)`;
  // Escreve no Consumer também: assim o nome aparece na comanda impressa, no
  // KDS (que espelha PEDIDOS.NOME) e o CPF já fica pronto pra NFC-e.
  if (curto || cpf) {
    try {
      const ped = await fbAcharPedido(comanda);
      if (ped) await fbIdentificarPedido(ped, { nome: curto, cpf, contatoFb });
    } catch (e) { console.error('[identificar] write-back falhou:', e.message); }
  }
  return { ok: true, comanda, mesa, nome_curto: curto };
}
/** Observacoes que a casa sugere pro grupo daquele produto. */
async function apiObservacoes(codigoPdv) {
  const p = (await sql`SELECT categoria FROM produto_local WHERE codigo_pdv=${Number(codigoPdv)}`)[0];
  if (!p?.categoria) return { sugestoes: [] };
  const r = await sql`SELECT DISTINCT texto FROM observacao_sugerida WHERE categoria=${p.categoria} ORDER BY texto`;
  return { categoria: p.categoria, sugestoes: r.map((x) => x.texto) };
}
// ---- SESSAO DA MESA ----
// O QR fica colado na mesa e o celular do cliente guarda a pagina aberta. Se
// ele vai embora e a mesa vira de outra pessoa, aquele celular NAO pode
// continuar lancando pedido ali. Duas travas:
//   1. a conta tem que ser A MESMA (PEDIDOS.CODIGO muda quando a mesa fecha
//      e reabre — e' a checagem que realmente protege)
//   2. tempo maximo desde que escaneou
// Sem sessao valida, a tela pede pra escanear o QR de novo.
const SESSAO_MESA_MIN = Number(process.env.SESSAO_MESA_MIN || 60);
async function apiMesaSessao(numero, comandaCliente, desde) {
  const n = Number(numero);
  if (!(n >= 1 && n <= NUMERO_MAX)) return { ok: false, motivo: 'mesa inválida' };
  const c = (await sql`SELECT codigo, data_abertura FROM comanda WHERE numero=${n} LIMIT 1`)[0];
  // atual = null quer dizer MESA VAZIA (ainda sem conta aberta), e isso NÃO é
  // erro: o primeiro pedido do cliente é que abre a conta — apiVendaEnviar faz
  // `pedidoDaMesa(numero)`.
  //
  // ⚠️ Tratar mesa vazia como "fechada" fechava um LAÇO: a tela mandava
  // escanear o QR de novo, mas escanear não abre conta nenhuma, então voltava
  // a mesma mensagem pra sempre. Quem chegava numa mesa livre — o caso mais
  // comum que existe — não conseguia nem ver o cardápio.
  const atual = c ? Number(c.codigo) : null;
  // ⚠️ O TEMPO E' SEMPRE DO SERVIDOR (`agora`). O celular do cliente pode estar
  // com qualquer relogio — e o proprio servidor da loja pode estar errado. Como
  // os dois lados usavam relogios diferentes, a sessao nascia velha: o Windows
  // da 0003 estava 4h adiantado e TODA sessao ja aparecia com 239 minutos.
  // Devolvendo `agora`, o cliente guarda o tempo do servidor e a comparacao
  // fica servidor-contra-servidor, imune a relogio de aparelho.
  const agora = Date.now();
  // ⚠️ A CONTA ANTERIOR ACABOU DEPOIS QUE ESTA SESSAO NASCEU?
  // Tem que vir ANTES do atalho de primeira entrada logo abaixo — senao o
  // celular com comanda=null (quem escaneou a mesa VAZIA) escapa por ali e
  // segue valido pra sempre, inclusive depois de a mesa ser fechada e entregue
  // a outra pessoa. Resolve por TEMPO, sem depender de o aparelho ter
  // capturado o numero da conta.
  if (desde != null && desde !== '') {
    const fe = (await sql`SELECT fechada_em FROM mesa_estado WHERE numero=${n}`)[0];
    if (fe?.fechada_em && new Date(fe.fechada_em).getTime() > Number(desde)) {
      return { ok: false, motivo: 'fechou', comanda_codigo: atual, agora,
        aviso: 'A conta desta mesa foi fechada. Escaneie o QR pra começar outra.' };
    }
  }
  // primeira entrada: o cliente ainda nao tem sessao, devolve a atual
  if (comandaCliente == null) return { ok: true, comanda_codigo: atual, agora, validade_min: SESSAO_MESA_MIN };
  if (Number(comandaCliente) !== atual) {
    // Aqui o cliente TINHA uma conta e ela mudou — a mesa virou. Reescanear
    // resolve de verdade: na volta ele vem sem sessão e pega a conta atual
    // (ou começa numa mesa vazia).
    return { ok: false, motivo: 'trocou', comanda_codigo: atual, agora,
      aviso: atual == null
        ? 'A conta desta mesa foi fechada. Escaneie o QR pra começar outra.'
        : 'Essa mesa foi fechada e aberta de novo. Escaneie o QR pra continuar.' };
  }
  // sem `desde` (sessao recem-criada que ainda nao fixou o tempo): nao expira
  const min = desde != null && desde !== '' ? (agora - Number(desde)) / 60000 : 0;
  if (min > SESSAO_MESA_MIN) {
    return { ok: false, motivo: 'expirou', comanda_codigo: atual, agora,
      aviso: `Faz mais de ${SESSAO_MESA_MIN} minutos que você abriu. Escaneie o QR pra continuar.` };
  }
  return { ok: true, comanda_codigo: atual, agora, validade_min: SESSAO_MESA_MIN };
}

/** O que a mesa JA pediu — evita pedir duas vezes a mesma coisa. */
/** Itens de UMA conta, já no formato que a tela do cliente mostra. */
async function jaPedidoDe(contaCodigo) {
  const r = await sql`SELECT ci.item_codigo, ci.codigo_pai, ci.nome, ci.quantidade, ci.detalhes, ci.tipo,
      COALESCE(ci.produzido, m.pronto_em) AS pronto, COALESCE(ci.entregue, m.entregue_em) AS entregue, ci.criado
    FROM comanda_item ci LEFT JOIN marca m ON m.item_codigo = ci.item_codigo
    WHERE ci.comanda_codigo=${contaCodigo}
    ORDER BY ci.criado NULLS LAST, ci.id`;
  const agora = Date.now();
  const pais = [];
  const porCodigo = new Map();
  for (const x of r) {
    if (Number(x.tipo) === 2) continue; // complementos penduram no pai (abaixo)
    // ">> SAI JUNTO C/ ..." e' recado pra COZINHA. O cliente nao precisa ver
    // como a casa se organiza por dentro — só a observação dele.
    const det = temMod(x.detalhes)
      ? String(x.detalhes).split('|').map((p) => p.trim()).filter((p) => p && !/^>>/.test(p)).join(' · ')
      : '';
    const criado = x.criado ? new Date(x.criado).getTime() : null;
    const it = {
      item_codigo: x.item_codigo != null ? Number(x.item_codigo) : null,
      nome: x.nome, quantidade: Number(x.quantidade) || 1,
      observacao: det || null,
      complementos: [],
      estado: x.entregue ? 'entregue' : x.pronto ? 'pronto' : 'preparando',
      pedido_em: x.criado, pronto_em: x.pronto, entregue_em: x.entregue,
      espera_min: criado ? Math.max(0, Math.floor((agora - criado) / 60000)) : null,
    };
    pais.push(it);
    if (x.item_codigo != null) porCodigo.set(Number(x.item_codigo), it);
  }
  // filho (tipo 2) aparece embaixo do pai — sem repetir o que a observação
  // do wizard já diz ("1 copo · com gelo" não sai duas vezes)
  for (const x of r) {
    if (Number(x.tipo) !== 2) continue;
    const pai = x.codigo_pai != null ? porCodigo.get(Number(x.codigo_pai)) : null;
    const nome = String(x.nome || '').trim();
    if (!pai || !nome) continue;
    if (!(pai.observacao || '').toLowerCase().includes(nome.toLowerCase())) pai.complementos.push(nome);
  }
  return pais;
}
// O que a mesa já pediu — INCLUINDO as comandas vinculadas.
// Antes lia só a conta da mesa, então a Heineken lançada na comanda 302 não
// aparecia em lugar nenhum pro cliente: ele tinha pedido, o item existia, e a
// tela dizia que não havia nada. Agora sai em blocos: primeiro a mesa, depois
// cada comanda com o número, pra dar pra saber de quem foi o quê.
async function apiJaPedido(numero) {
  const n = Number(numero);
  const c = (await sql`SELECT codigo FROM comanda WHERE numero=${n} LIMIT 1`)[0];
  const grupos = [];
  if (c) {
    const its = await jaPedidoDe(c.codigo);
    if (its.length) grupos.push({ numero: n, tipo: 'mesa', nome: null, itens: its });
  }
  if (n < COMANDA_DE) {
    const vinc = await sql`SELECT comanda, nome_curto FROM mesa_comanda
      WHERE mesa=${n} AND fechada_em IS NULL ORDER BY comanda`;
    for (const v of vinc) {
      const cc = (await sql`SELECT codigo FROM comanda WHERE numero=${Number(v.comanda)} LIMIT 1`)[0];
      if (!cc) continue;                       // sem conta ainda: nada pedido
      const its = await jaPedidoDe(cc.codigo);
      if (!its.length) continue;
      const idc = (await sql`SELECT nome_curto FROM identificacao
        WHERE numero=${Number(v.comanda)} AND fechada_em IS NULL`)[0];
      grupos.push({ numero: Number(v.comanda), tipo: 'comanda',
        nome: idc?.nome_curto || v.nome_curto || null, itens: its });
    }
  }
  // `itens` continua saindo achatado pra não quebrar quem já consumia assim
  return { grupos, itens: grupos.flatMap((g) => g.itens) };
}

// ---- TRANSFERIR comanda/mesa ----
// A mesa mudou de lugar, ou a comanda foi pra outra mesa. Dois casos:
//  - comanda (300-400) -> outra mesa: muda só o vínculo, os itens seguem nela
//  - mesa -> mesa:      move os ITENS no Firebird (ITENSPEDIDO.CODIGOPEDIDO)
// Tudo fica registrado: quem move uma conta inteira precisa deixar rastro.
async function apiTransferir(body) {
  const de = Number(body.de), para = Number(body.para);
  if (!(de >= 1 && de <= NUMERO_MAX) || !(para >= 1 && para <= NUMERO_MAX)) return { ok: false, erro: 'número inválido' };
  if (de === para) return { ok: false, erro: 'origem e destino são iguais' };
  const quem = String(body.por || '').slice(0, 60) || null;

  // comanda mudando de mesa: só o vínculo
  if (de >= COMANDA_DE) {
    if (para >= COMANDA_DE) return { ok: false, erro: 'destino tem que ser uma mesa (1–' + MESA_MAX + ')' };
    const antes = (await sql`SELECT mesa FROM mesa_comanda WHERE comanda=${de} AND fechada_em IS NULL`)[0];
    await sql`INSERT INTO mesa_comanda (comanda, mesa) VALUES (${de}, ${para})
      ON CONFLICT (comanda) DO UPDATE SET mesa=${para}, fechada_em=NULL`;
    await sql`INSERT INTO transferencia (de_numero, para_numero, tipo, itens_movidos, por)
      VALUES (${de}, ${para}, 'comanda', 0, ${quem})`;
    return { ok: true, tipo: 'comanda', de, para, mesa_anterior: antes?.mesa ?? null,
      msg: `Comanda ${de} agora é da mesa ${para}.` };
  }

  // mesa -> mesa: move os itens de verdade no Consumer
  let pedDe, pedPara;
  try {
    pedDe = await fbAcharPedido(de);
    if (!pedDe) return { ok: false, erro: `não há conta aberta na mesa ${de}` };
    pedPara = (await pedidoDaMesa(para)).ped;
  } catch (e) { return { ok: false, erro: e.message }; }

  const n = await itensContar(pedDe);
  if (!n) return { ok: false, erro: `a mesa ${de} não tem itens pra mover` };

  const movidos = await itensMover(pedDe, pedPara, null);
  if (movidos === 0 && n > 0) return { ok: false, erro: 'não consegui mover os itens' };
  try { await fbAtualizarTotal(pedPara); await fbAtualizarTotal(pedDe); } catch { /* total recalcula no próximo ciclo */ }
  // ⚠️ A CASCA DA ORIGEM. Levou TODOS os itens embora e o pedido da mesa de
  // origem ficava aberto com zero item — a mesa seguia "ocupada" na tela pra
  // sempre (mesa 129, 19/08). Sem item e sem pagamento não há o que guardar:
  // some, do mesmo jeito que o Consumer faz com pedido aberto por engano.
  const sobrou = await itensContar(pedDe);
  const pagoDe = await fbPagoDoPedido(pedDe).catch(() => 0);
  if (sobrou === 0 && pagoDe <= 0.009) {
    const rm = await pedApagar(pedDe, { soAberto: true });
    if (!rm) console.error('[transferir] casca da mesa ' + de + ' ficou aberta');
    await sql`UPDATE identificacao SET fechada_em=now() WHERE numero=${de} AND fechada_em IS NULL`;
  }

  // as comandas que estavam nessa mesa vão junto
  await sql`UPDATE mesa_comanda SET mesa=${para} WHERE mesa=${de} AND fechada_em IS NULL`;
  await sql`INSERT INTO transferencia (de_numero, para_numero, tipo, itens_movidos, por, pedido_de, pedido_para)
    VALUES (${de}, ${para}, 'mesa', ${n}, ${quem}, ${pedDe}, ${pedPara})`;
  return { ok: true, tipo: 'mesa', de, para, itens: n,
    msg: `${n} item(ns) da mesa ${de} foram para a mesa ${para}.` };
}
async function apiTransferencias() {
  const r = await sql`SELECT * FROM transferencia ORDER BY criado_em DESC LIMIT 30`;
  return { transferencias: r };
}

/** A conta ja foi pedida? Le do FIREBIRD, nao do espelho: o espelho so
 *  atualiza no proximo ciclo de sync, e nesse intervalo o garcom ja marcou
 *  "conta pedida" e o cliente ainda conseguiria lancar. Quem manda e' o PDV.
 *  Numa comanda vale a dela E a da mesa: se a MESA esta fechando, a comanda
 *  pendurada nela tambem para. */
async function contaPedidaDe(numero, mesa) {
  const alvos = [Number(numero)];
  if (mesa != null && Number(mesa) !== Number(numero)) alvos.push(Number(mesa));
  for (const n of alvos) {
    let ped;
    try { ped = await fbAcharPedido(n); } catch { continue; }
    if (!ped) continue;
    // ⚠️ q(), NAO qi(). fbAcharPedido logo acima roda na fila q; trocar de fila
    // no meio da mesma operacao trava as duas — foi o que pendurou o servidor
    // no teste de 01/08.
    const r = await q(`SELECT FIRST 1 CONTASOLICITADA CS FROM PEDIDOS WHERE CODIGO=${Number(ped)}`);
    if (r.ok && r.rows.length && String(r.rows[0].CS || '').trim().toUpperCase() === 'S') {
      return { pedida: true, onde: n, ehMesa: Number(n) !== Number(numero) };
    }
  }
  return { pedida: false };
}

async function apiVendaEnviar(body) {
  const numero = Number(body.numero);
  if (!(numero >= 1 && numero <= NUMERO_MAX)) return { ok: false, erro: 'número inválido' };
  const ehComanda = numero >= COMANDA_DE;
  const mesa = ehComanda ? (await sql`SELECT mesa FROM mesa_comanda WHERE comanda=${numero} AND fechada_em IS NULL`)[0]?.mesa ?? null : numero;

  // ⚠️ CONTA PEDIDA = NAO ENTRA MAIS NADA. Vale pro cliente E pro garcom —
  // e' por isso que a trava fica AQUI, no unico funil por onde os dois passam
  // (/api/mesa/pedir do celular do cliente cai neste mesmo apiVendaEnviar).
  // Item lancado depois da conta fechada nao e' cobrado de ninguem: ou a casa
  // perde, ou o cliente e' surpreendido com um valor que ele ja conferiu. E
  // com o passe de saida em jogo, pior ainda: a pessoa ja pagou, ja tem o QR,
  // e um item novo deixaria a conta devendo de novo.
  // Quem destrava e' a CASA, no botao "liberar novos pedidos" do garcom.
  const trava = await contaPedidaDe(numero, mesa);
  if (trava.pedida) {
    return { ok: false, conta_pedida: true, onde: trava.onde,
      erro: trava.ehMesa
        ? `A conta da mesa ${trava.onde} já foi pedida — não dá pra lançar mais nada nesta comanda. Se o cliente quiser pedir de novo, o garçom libera na tela da mesa.`
        : `A conta ${numero >= COMANDA_DE ? 'da comanda' : 'da mesa'} ${numero} já foi pedida. Pra lançar de novo, o garçom precisa liberar.` };
  }
  const pedidos = Array.isArray(body.itens) ? body.itens : [];
  if (!pedidos.length) return { ok: false, erro: 'sem itens' };
  // assinatura do carrinho — mesma fórmula usada pra gravar e pra comparar.
  // Calculada cedo (é síncrona e barata); a CHECAGEM de dedupe fica lá
  // embaixo, só depois de tudo que pode legitimamente rejeitar o pedido sem
  // tê-lo processado (comanda sem cadastro, produto fora do catálogo) — não
  // faz sentido bloquear um reenvio de algo que nunca foi de fato lançado.
  const assinaturaEnvio = JSON.stringify(pedidos
    .map((p) => [Number(p.codigo_pdv) || 0, Number(p.qtd) || 0, String(p.obs || '').trim()])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  // ⚠️ COMANDA EXIGE CADASTRO — sempre, não só pra transferir.
  // A comanda é conta em aberto no bar: a pessoa leva o cartão, consome a noite
  // toda e paga no fim. Sem saber quem é, o que sobra pra casa é prejuízo
  // anônimo. Então item nenhum entra numa comanda sem identificação.
  // A trava fica AQUI, no lançamento, e não na tela de abrir: cobre todos os
  // caminhos de uma vez — garçom, celular do cliente, qualquer um.
  // Mesa não exige: quem senta na mesa está à vista e paga antes de sair.
  if (ehComanda && !(await comandaIdentificada(numero))) {
    return { ok: false, precisa_cadastro: true, numero,
      erro: `A comanda ${numero} não tem cadastro. Identifique quem vai usar antes de lançar.` };
  }
  // resolve cada item no catálogo local (preço/nome/área da NOSSA cópia — nunca confiar no client)
  const itens = [];
  for (const p of pedidos) {
    const cat = (await sql`SELECT codigo_pdv, produto_codigo, nome, tamanho, preco, area_codigo FROM produto_local WHERE codigo_pdv=${Number(p.codigo_pdv)}`)[0];
    if (!cat) return { ok: false, erro: 'produto ' + p.codigo_pdv + ' não está no catálogo' };
    const qtd = Math.max(1, Math.min(99, Number(p.qtd) || 1));
    itens.push({ ...cat, preco: Number(cat.preco), qtd, obs: String(p.obs || '').trim() });
  }
  // QUEM LANÇOU vai em cada item. `_garcom` já vinha do middleware da rota e
  // NUNCA era usado — resultado: nenhum item lançado pelas nossas telas tinha
  // autor, e na hora de conferir a conta ninguém sabia de quem era. O pedido
  // que nasce no celular do cliente (/api/mesa/pedir) não tem login nenhum,
  // então ganha um autor próprio: é informação, não é lacuna.
  const autor = body._cliente
    ? { login: 'cliente', nome_usuario: 'CLIENTE (celular)' }
    : (body._garcom ? { login: String(body._garcom), nome_usuario: body._garcom_nome || String(body._garcom) } : null);
  if (autor) for (const it of itens) { it.login = autor.login; it.nome_usuario = autor.nome_usuario; }
  // Quem imprime separado por cozinha é o Consumer (usa PRODUTOS.CODIGOCOZINHA).
  // O que falta é a cozinha SABER que o pedido tem acompanhamento em outra praça:
  // sem isso o petisco sai sozinho e o prato chega frio (ou vice-versa). Só que
  // isso é pedido a pedido — quem marca "servir junto" é quem atende a mesa.
  // "sai junto" ITEM A ITEM: cada item traz o proprio flag. Antes era uma
  // marca do envio inteiro, o que obrigava a mandar dois pedidos quando so
  // parte da mesa queria esperar.
  itens.forEach((it, ix) => { it.junto_item = pedidos[ix]?.junto === true; });
  // RESPOSTAS DAS PERGUNTAS ("Ao ponto", "Arroz Biro-biro"): entram no
  // DETALHES pra sair na comanda impressa — a cozinha precisa saber o ponto
  // da carne — e os códigos vão pro Consumer em ITEMPEDIDOWIZARDOPCAO, que é
  // onde o PDV guarda a mesma coisa.
  for (const [ix, it] of itens.entries()) {
    const cods = Array.isArray(pedidos[ix]?.respostas) ? pedidos[ix].respostas.map(Number).filter(Boolean) : [];
    it.respostas = cods;
    if (cods.length) {
      const ops = await sql`SELECT codigo, nome, preco FROM wizard_opcao WHERE codigo = ANY(${cods})`;
      const porCod = new Map(ops.map((x) => [Number(x.codigo), x]));
      // na ordem em que o cliente respondeu, não na ordem do banco — senão o
      // ponto da carne sai depois do acompanhamento na comanda impressa
      const nomes = cods.map((c) => porCod.get(c)?.nome).filter(Boolean);
      if (nomes.length && !it.obs) it.obs = nomes.join(' | ');
      // o preço das opções fica nos itens-filho; o pai mantém o preço do prato
    }
  }
  const marcados = itens.filter((i) => i.junto_item);
  const areasJunto = [...new Set(marcados.map((i) => i.area_codigo).filter((a) => a != null))];
  // so faz sentido parear se os marcados estao em pracas DIFERENTES
  const parear = marcados.length > 1 && areasJunto.length > 1;

  const junto = body.junto === true || parear; // body.junto = modo antigo, do envio todo
  const areas = parear ? areasJunto : [...new Set(itens.map((i) => i.area_codigo).filter((a) => a != null))];
  if (junto && areas.length > 1) {
    const as = await sql`SELECT codigo, nome FROM area WHERE codigo = ANY(${areas})`;
    const nomeArea = new Map(as.map((a) => [Number(a.codigo), a.nome]));
    for (const i of itens) {
      if (parear && !i.junto_item) continue; // item nao marcado nao leva aviso
      const outras = areas.filter((a) => a !== i.area_codigo).map((a) => nomeArea.get(a) || 'Área ' + a);
      if (outras.length) i.junto = outras.join(' + ');
    }
  }
  const total = itens.reduce((s, i) => s + i.preco * i.qtd, 0);
  // ⚠️ DEDUPE DO CLIENTE: toque duplo no botão (ou rede lenta escondendo que
  // já enviou) manda o MESMO carrinho duas vezes em segundos — sem trava, o
  // prato entra 2x na conta. Vale SÓ pro celular do cliente (body._cliente):
  // o garçom pode genuinamente lançar "2 chopps" duas vezes seguidas pra
  // clientes diferentes da mesma mesa, e bloquear isso perderia venda real.
  //
  // Um SELECT solto contra venda_envio TEM CORRIDA: duas chamadas de 300ms
  // de diferença chegam aqui quase juntas, as duas fazem o SELECT ANTES de
  // qualquer uma ter gravado, as duas veem "nada ainda" e as duas passam —
  // medido na prática, duplicou igual. O marcador precisa nascer ATÔMICO, e
  // isso só existe checando-e-marcando dentro da MESMA fila por mesa que já
  // serializa a criação de pedido (pedidoDaMesa) — dentro dela, JS é
  // single-thread: não existe "os dois chegam juntos".
  const dedupe = body._cliente
    ? await naFilaDaMesa(numero, () => dedupeCarrinho(numero, assinaturaEnvio))
    : { duplicado: false };
  if (dedupe.duplicado) {
    console.log('[dedupe] carrinho repetido em <5s na mesa ' + numero + ' — ignorado (toque duplo)');
    return { ok: true, pedido_fb: dedupe.pedido_fb, n_itens: pedidos.length,
      total: dedupe.total, avisos_impressora: [] };
  }
  const [log] = await sql`INSERT INTO venda_envio (numero, mesa, comanda, itens, total, status, junto, assinatura)
    VALUES (${numero}, ${mesa}, ${ehComanda ? numero : null}, ${JSON.stringify(itens)}, ${total}, 'enviando', ${junto && areas.length > 1}, ${assinaturaEnvio}) RETURNING id`;
  try {
    const { ped, criado } = await pedidoDaMesa(numero);
    if (criado) {
      // A pessoa pode ter se identificado numa mesa AINDA SEM CONTA — nesse
      // momento não havia PEDIDOS pra carimbar, e o Consumer nunca ficava
      // sabendo quem estava ali. Agora que a conta acabou de nascer, amarra.
      // Sem isto o consumo dela não entra no histórico (CODIGOCONTATOCLIENTE
      // é o que liga o pedido à pessoa, e é o que o CDC leva pro concilia).
      try {
        const id = (await sql`SELECT nome_curto, cpf, contato_fb FROM identificacao
          WHERE numero=${numero} AND fechada_em IS NULL`)[0];
        if (id && (id.nome_curto || id.cpf || id.contato_fb)) {
          await fbIdentificarPedido(ped, { nome: id.nome_curto, cpf: id.cpf, contatoFb: id.contato_fb });
        }
      } catch (e) { console.error('[identificar] amarrar na conta nova falhou:', e.message); }
    }
    const grupo = parear ? 'G' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36) : null;
    const paresGrupo = [];
    // "5x arroz" fica numa LINHA SÓ (QUANTIDADE=5), como o Consumer grava —
    // o cancelamento PARCIAL no caixa reduz a quantidade da linha (o split
    // em 5 linhas foi testado em 11/08 e rejeitado pelo dono: poluía a conta).
    for (const it of itens) {
      const cod = await fbInserirItem(ped, it);
      if (grupo && it.junto_item && cod) paresGrupo.push({ item_codigo: cod, grupo, numero });
      // mesmo lugar onde o PDV guarda as respostas — assim o Consumer enxerga
      // o pedido do nosso app exatamente como enxerga o dele
      if (cod && it.respostas?.length) await fbGravarRespostas(ped, cod, it);
    }
    if (paresGrupo.length > 1) {
      await sql`INSERT INTO item_junto ${sql(paresGrupo, 'item_codigo', 'grupo', 'numero')}
        ON CONFLICT (item_codigo) DO NOTHING`;
    }
    await fbAtualizarTotal(ped);
    await fbJobCozinha(ped);
    await sql`UPDATE venda_envio SET status='ok', pedido_fb=${ped} WHERE id=${log.id}`;
    if (body._cliente) dedupeConcluir(numero, assinaturaEnvio, ped, total);
    espelho().catch(() => {}); // KDS atualiza já, sem esperar os 15s
    // impressora da praça desligada/sem papel? avisa QUEM LANÇOU, na hora
    const avisosImp = await avisosImpressora(itens.map((i) => i.area_codigo)).catch(() => []);
    return { ok: true, pedido_fb: ped, numero, mesa, total, n_itens: itens.length, avisos_impressora: avisosImp };
  } catch (e) {
    await sql`UPDATE venda_envio SET status='erro', erro=${String(e.message).slice(0, 300)} WHERE id=${log.id}`;
    // ⚠️ NÃO deixa a marca do dedupe viva numa falha: senão o cliente tenta
    // de novo (com razão — o pedido dele NÃO foi) e a segunda tentativa,
    // legítima, seria barrada como "duplicada" e devolveria sucesso falso.
    if (body._cliente) enviosRecentesPorMesa.delete(Number(numero));
    return { ok: false, erro: 'Falha ao gravar no Consumer: ' + e.message + ' (lançamento guardado localmente, id ' + log.id + ')' };
  }
}

// ---- API de CONTA / PAGAMENTO (Fase 2) ----
// A conta lê do Consumer (fonte da verdade do total e do que já foi pago) —
// assim nunca cobramos a mais por causa de espelho atrasado.
async function apiConta(numero) {
  const n = Number(numero);
  if (!(n >= 1 && n <= NUMERO_MAX)) return { ok: false, erro: 'número inválido' };
  const ped = await fbAcharPedido(n);
  if (!ped) return { ok: false, erro: 'nenhuma comanda aberta com o número ' + n };
  const it = await qi(`SELECT TRIM(NOMEPRODUTO) NOME, QUANTIDADE QTD, VALORTOTAL VT, CODIGOITEMPEDIDOTIPO TIPO
    FROM ITENSPEDIDO WHERE CODIGOPEDIDO=${ped} AND DATADELETE IS NULL ORDER BY CODIGO`);
  if (!it.ok) throw new Error('FB itens: ' + it.err);
  const cab = await qi(`SELECT VALORTOTAL, TOTALSERVICO, NUMERO FROM PEDIDOS WHERE CODIGO=${ped}`);
  if (!cab.ok) throw new Error('FB pedido: ' + cab.err);
  const total = Number(cab.rows[0]?.VALORTOTAL) || 0;
  const servico = Number(cab.rows[0]?.TOTALSERVICO) || 0;
  const pago = await fbPagoDoPedido(ped);
  const mesa = n >= COMANDA_DE ? (await sql`SELECT mesa FROM mesa_comanda WHERE comanda=${n} AND fechada_em IS NULL`)[0]?.mesa ?? null : n;
  // conta pedida: e' o que apaga o botao de lancar e acende o "liberar"
  const cs = await qi(`SELECT FIRST 1 CONTASOLICITADA V FROM PEDIDOS WHERE CODIGO=${ped}`);
  const contaPedida = cs.ok && cs.rows.length && String(cs.rows[0].V || '').trim().toUpperCase() === 'S';
  return {
    ok: true, numero: n, mesa, pedido_fb: ped, conta_pedida: contaPedida,
    itens: it.rows.map((x) => ({ nome: x.NOME, qtd: Number(x.QTD), valor: Number(x.VT), tipo: Number(x.TIPO) })),
    total, servico, pago: +pago.toFixed(2), saldo: +(total - pago).toFixed(2),
    pagamentos: await sql`SELECT id, forma, valor, origem, nsu, status, criado_em FROM venda_pagamento WHERE pedido_fb=${ped} ORDER BY id`,
  };
}

// Cartão/Pix DIGITADOS estão DESLIGADOS por decisão (10/08/2026): com a
// maquininha integrada, NSU na mão é furo no batimento automático (e fraude
// fácil). Só entra pagamento COM PROVA: maquininha (lio-sdk), ponte lio,
// Pix online — e, desde 20/08, o RECEBIMENTO MANUAL COM FOTO do comprovante.
// A foto é a prova que faltava: fica guardada com mesa, valor, forma e quem
// recebeu (recebimento_foto). Sem foto o caminho continua fechado, que é o
// que a regra sempre quis dizer.
// Dinheiro segue permitido (conferência é a gaveta do caixa).
// EMERGÊNCIA (maquininha quebrada): PAGAMENTO_MANUAL=on no start.bat religa.
const PAGAMENTO_MANUAL = process.env.PAGAMENTO_MANUAL || 'off';

/** Registra um pagamento. body: {numero, forma, valor, modo, nsu?, autorizacao?, bandeira?,
 *  origem?, observacao?, pix_online?} — os três últimos vêm do app da maquininha (/api/lio/pagar). */
async function apiContaPagar(body) {
  const n = Number(body.numero);
  const valor = +Number(body.valor || 0).toFixed(2);
  const forma = String(body.forma || '').toLowerCase(); // dinheiro|credito|debito|pix
  const modo = String(body.modo || 'manual').toLowerCase(); // manual|lio
  const origem = String(body.origem || modo); // o que fica no log (ex.: 'lio-sdk')
  if (!(valor > 0)) return { ok: false, erro: 'valor inválido' };
  const integrado = origem === 'lio-sdk' || modo === 'lio' || body.pix_online === true;
  // comprovante:true só vem de apiCaixaReceberManual, e SÓ quando a imagem foi
  // gravada de verdade — não é flag que a tela possa mandar sozinha.
  const comProva = integrado || body.comprovante === true;
  if (PAGAMENTO_MANUAL !== 'on' && forma !== 'dinheiro' && !comProva) {
    return { ok: false, erro: 'Lançamento manual de cartão/Pix está desligado — receba pela ' +
      'maquininha (ou Pix da tela). Emergência: PAGAMENTO_MANUAL=on no start.bat e reiniciar.' };
  }
  const MAPA = {
    dinheiro: { cod: FORMA.DINHEIRO, nome: 'Dinheiro' },
    credito: { cod: FORMA.CREDITO, nome: 'Cartão de Crédito' },
    debito: { cod: FORMA.DEBITO, nome: 'Cartão de Débito' },
    // Pix cobrado NA maquininha liquida pela Cielo (canal adquirente) → Pix
    // Online; Pix avulso conferido no app do banco continua Pix Manual.
    pix: body.pix_online ? { cod: FORMA.PIX_ONLINE, nome: 'Pix Online' } : { cod: FORMA.PIX_MANUAL, nome: 'Pix Manual' },
  };
  const fp = MAPA[forma];
  if (!fp) return { ok: false, erro: 'forma inválida' };
  const ped = await pedidoAlvo(n, body.ped);
  if (!ped) return { ok: false, erro: 'comanda não está aberta' };
  const cab = (await pedTotais(ped)) || {};
  const pagoAtual = await fbPagoDoPedido(ped);
  const saldo = +((cab.total || 0) - pagoAtual).toFixed(2);
  // Maquininha (permitir_servico): cobra consumo + serviço ESCOLHIDO na hora
  // (10/15%, os mesmos chips do Pix da tela do celular) — o teto acompanha,
  // mesmo quando o serviço não está gravado no pedido.
  // pedido criado por nós pode ter VALORTOTALITENS nulo (histórico): o total
  // serve de base — senão o teto desabava pro saldo e a maquininha com 10%
  // era recusada ("valor maior que o saldo")
  const baseItens = cab.itens || cab.total || 0;
  const teto = body.permitir_servico
    ? Math.max(saldo, +((baseItens * 1.15) - pagoAtual).toFixed(2))
    : saldo;
  if (valor > teto + 0.01) return { ok: false, erro: `valor maior que o saldo (R$ ${Math.max(saldo, 0).toFixed(2)})` };
  // o serviço escolhido NA MAQUININHA entra no pedido: sem isso ficava
  // pago > total (o R$ do serviço existia no PAGAMENTOS e não no PEDIDOS,
  // descasando relatório e nota)
  if (body.permitir_servico && modo !== 'lio' && valor > saldo + 0.009) {
    const extra = +(valor - saldo).toFixed(2);
    const at = await pedTotais(ped);
    const rs = { ok: await pedGravarTotais(ped, { servico: +((at?.servico || 0) + extra).toFixed(2),
      total: +((at?.total || 0) + extra).toFixed(2) }) };
    if (!rs.ok) return { ok: false, erro: 'não deu pra somar o serviço da maquininha' };
  }

  const [log] = await sql`INSERT INTO venda_pagamento (numero, pedido_fb, forma_codigo, forma, valor, origem, status)
    VALUES (${n}, ${ped}, ${fp.cod}, ${fp.nome}, ${valor}, ${origem}, 'iniciado') RETURNING id`;

  let dados = { nsu: body.nsu || null, autorizacao: body.autorizacao || null, bandeira: body.bandeira || null };
  try {
    if (modo === 'lio') {
      // Manda pro terminal e espera o garçom confirmar lá (polling curto).
      const cob = await lioCriarCobranca({ numero: n, valor, itens: [] });
      await sql`UPDATE venda_pagamento SET tef_ref=${cob.orderId}, status='aguardando' WHERE id=${log.id}`;
      return { ok: true, aguardando: true, pagamento_id: log.id, order_id: cob.orderId,
        msg: 'Cobrança enviada pra maquininha. Conclua na LIO e a tela confirma sozinha.' };
    }
    // modo manual: já foi cobrado na maquininha, só registramos
    const pagFb = await fbInserirPagamento(ped, {
      forma_codigo: fp.cod, valor, nsu: dados.nsu, autorizacao: dados.autorizacao,
      bandeira: dados.bandeira, observacao: body.observacao || 'Prainha Vendas',
      caixa_codigo: body.caixa_codigo || null,
    });
    await sql`UPDATE venda_pagamento SET status='ok', nsu=${dados.nsu}, autorizacao=${dados.autorizacao},
      bandeira=${dados.bandeira}, pagamento_fb=${pagFb} WHERE id=${log.id}`;
    const pagoAgora = await fbPagoDoPedido(ped);
    const totalPed = (await pedTotais(ped))?.total || 0;
    return { ok: true, pagamento_id: log.id, pagamento_fb: pagFb, pago: +pagoAgora.toFixed(2),
      saldo: +(totalPed - pagoAgora).toFixed(2), quitada: pagoAgora >= totalPed - 0.01 };
  } catch (e) {
    await sql`UPDATE venda_pagamento SET status='erro', erro=${String(e.message).slice(0, 300)} WHERE id=${log.id}`;
    return { ok: false, erro: e.message, pagamento_id: log.id };
  }
}

/** Confere na Cielo se a cobrança da LIO foi paga; se sim, grava no Consumer. */
async function apiContaConferir(pagamentoId) {
  const [p] = await sql`SELECT * FROM venda_pagamento WHERE id=${Number(pagamentoId)}`;
  if (!p) return { ok: false, erro: 'pagamento não encontrado' };
  if (p.status === 'ok') return { ok: true, pago: true, ja_registrado: true };
  if (!p.tef_ref) return { ok: false, erro: 'pagamento sem referência na Cielo' };
  const r = await lioConsultar(p.tef_ref);
  if (!r.pago) return { ok: true, pago: false, status: r.status };
  const pagFb = await fbInserirPagamento(p.pedido_fb, {
    forma_codigo: p.forma_codigo, valor: p.valor, nsu: r.nsu,
    autorizacao: r.autorizacao, bandeira: r.bandeira, observacao: 'Prainha Vendas LIO',
  });
  await sql`UPDATE venda_pagamento SET status='ok', nsu=${r.nsu}, autorizacao=${r.autorizacao},
    bandeira=${r.bandeira}, pagamento_fb=${pagFb} WHERE id=${p.id}`;
  return { ok: true, pago: true, nsu: r.nsu, autorizacao: r.autorizacao, pagamento_fb: pagFb };
}

// ---- LIO/DX8000: baixa do que o APP DA MAQUININHA (lio-app) já cobrou ----
// O cartão foi cobrado NO terminal (Order Manager SDK); aqui é só o registro.
// O app reenvia em caso de falha de rede — dinheiro capturado não pode nem
// sumir nem dobrar — então antes de gravar a rota deduplica pelo NSU: primeiro
// no log local, depois no próprio PAGAMENTOS (cobre a janela em que o Consumer
// gravou mas o UPDATE do log falhou). Sem NSU (raro), não há chave — registra.
async function apiLioPagar(body, garcom) {
  const n = Number(body.numero);
  const valor = +Number(body.valor || 0).toFixed(2);
  const nsu = String(body.nsu || '').trim();
  if (nsu) {
    const [dup] = await sql`SELECT id, pagamento_fb FROM venda_pagamento
      WHERE numero=${n} AND nsu=${nsu} AND valor=${valor} AND origem='lio-sdk' AND status='ok'
        AND criado_em > now() - interval '2 days' LIMIT 1`;
    if (dup) return { ok: true, ja_registrado: true, pagamento_id: dup.id, pagamento_fb: dup.pagamento_fb };
    const nsuNum = Number(nsu.replace(/\D/g, '')) || null;
    const ped = nsuNum != null ? await fbAcharPedido(n).catch(() => null) : null;
    if (ped) {
      // ⚠️ q(), NÃO qi(): fbAcharPedido logo acima roda na fila q (ver contaPedidaDe).
      const r = await q(`SELECT FIRST 1 CODIGO FROM PAGAMENTOS WHERE CODIGOPEDIDO=${Number(ped)} AND NSUTRANSACAO=${nsuNum} AND VALOR=${fbNum(valor)} AND DATADELETE IS NULL`);
      if (r.ok && r.rows.length) return { ok: true, ja_registrado: true, pagamento_fb: Number(r.rows[0].CODIGO) };
    }
  }
  // Caixa do OPERADOR: usa o caixa aberto dele; se estiver fechado, abre o DELE
  // sozinho (fundo = saldo anterior) pra o recebimento cair no caixa dele e o
  // fechamento bater. Antes caía no 1º caixa aberto/'ser' e sumia do dele.
  // Se o caixa dele estiver aberto em OUTRA maquininha (serial diferente),
  // bloqueia. Falha na resolução = caminho antigo (caixa_codigo null → 'ser').
  let caixaCodigo = null;
  try {
    const cx = await fbCaixaMaquininha(garcom.login, body.terminal);
    if (cx.erro) return { ok: false, erro: cx.erro };
    caixaCodigo = cx.codigo;
  } catch (e) { console.error('[lio] caixa do operador:', e.message); }
  const r = await apiContaPagar({
    numero: n, ped: body.ped, forma: body.forma, valor, modo: 'manual', origem: 'lio-sdk', pix_online: true,
    permitir_servico: true, caixa_codigo: caixaCodigo,
    nsu: nsu || null, autorizacao: body.autorizacao || null, bandeira: body.bandeira || null,
    observacao: `Prainha LIO · ${garcom.login}`,
  });
  // Quitou pela maquininha = mesmo ato final do caixa (commit 625761e): fecha
  // o pedido do jeito que o Consumer fecha e libera a mesa/comanda na hora.
  if (r.ok && r.quitada) {
    try { const f = await apiCaixaFechar(n, body.ped); r.fechada = !!f.ok; } catch { r.fechada = false; }
  }
  return r;
}

// FECHAMENTO DO DIA da maquininha: tudo que o app registrou hoje (origem
// lio-sdk), por forma e com NSUs — a tela do app compara com as vendas do
// próprio terminal e o caixa fecha sem conferência manual. Dia em horário
// de Sergipe (UTC-3 fixo): meia-noite local = 03:00Z.
async function apiLioResumoDia(u, garcom) {
  const dataParam = String((u && u.searchParams.get('data')) || '').trim();
  let inicio;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dataParam)) inicio = new Date(dataParam + 'T03:00:00Z');
  else {
    inicio = new Date();
    if (inicio.getUTCHours() < 3) inicio.setUTCDate(inicio.getUTCDate() - 1);
    inicio.setUTCHours(3, 0, 0, 0);
  }
  const fim = new Date(inicio.getTime() + 24 * 3600 * 1000);
  const rows = await sql`SELECT criado_em, numero, forma, valor, nsu, observacao FROM venda_pagamento
    WHERE origem='lio-sdk' AND status='ok' AND criado_em >= ${inicio} AND criado_em < ${fim}
    ORDER BY criado_em`;
  const somar = (lista) => {
    const formas = {};
    let total = 0;
    for (const r of lista) {
      const f = r.forma || '?';
      formas[f] = formas[f] || { qtd: 0, total: 0 };
      formas[f].qtd += 1;
      formas[f].total = +(formas[f].total + Number(r.valor)).toFixed(2);
      total = +(total + Number(r.valor)).toFixed(2);
    }
    return { formas, total };
  };
  const mapear = (lista) => lista.map((r) => ({ criado_em: r.criado_em, numero: r.numero, forma: r.forma,
    valor: Number(r.valor), nsu: r.nsu || null }));
  const tudo = somar(rows);
  // "SEU dia": só o do garçom LOGADO (a observacao carimba 'Prainha LIO · login').
  // O topo continua sendo o dia inteiro — o app antigo usa pra bater com o
  // terminal; o app novo mostra o `meu` primeiro (troca de turno no aparelho).
  const login = String(garcom?.login || '').trim().toLowerCase();
  const meuRows = login ? rows.filter((r) => String(r.observacao || '').toLowerCase().endsWith('· ' + login)) : [];
  const meuTot = somar(meuRows);
  return { ok: true, inicio: inicio.toISOString(), qtd: rows.length, total: tudo.total, formas: tudo.formas,
    pagamentos: mapear(rows),
    meu: login ? { login, qtd: meuRows.length, total: meuTot.total, formas: meuTot.formas, pagamentos: mapear(meuRows) } : null };
}

// Config da loja pros clientes nativos (app da maquininha): limites de
// numeração, nome da casa e taxa de serviço — até aqui esses valores só
// existiam interpolados nos HTML na partida do servidor.
// IP da LAN da máquina (RFC1918), pro app aprender o endereço LOCAL e preferir
// ele quando estiver na loja (rápido/offline), caindo pro Funnel só quando fora.
// Pula o 100.x do Tailscale (não é RFC1918). Prefere 10.x > 192.168 > 172.
function lanIp() {
  const cands = [];
  try {
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs || []) {
        if (a.family !== 'IPv4' || a.internal) continue;
        const p = a.address.split('.').map(Number);
        if (p[0] === 10) cands.push([0, a.address]);
        else if (p[0] === 192 && p[1] === 168) cands.push([1, a.address]);
        else if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) cands.push([2, a.address]);
      }
    }
  } catch {}
  cands.sort((a, b) => a[0] - b[0]);
  return cands.length ? cands[0][1] : null;
}
function apiConfig() {
  const ip = lanIp();
  return { ok: true, loja: LOJA_NOME, versao: VERSAO, mesa_max: MESA_MAX,
    comanda_ativa: COMANDA_ATIVA, comanda_min: COMANDA_ATIVA ? COMANDA_MIN : 0,
    comanda_max: COMANDA_ATIVA ? COMANDA_MAX : 0, numero_max: NUMERO_MAX,
    taxa_servico: TAXA_SERVICO, lan: ip ? ip + ':' + APP_PORT : null };
}

// ---- status efetivo = timestamp do Firebird OU a nossa marca local ----
// pronto  = COALESCE(ci.produzido, m.pronto_em)
// entregue= COALESCE(ci.entregue,  m.entregue_em)

// ---- API: seleção de áreas (produção) ----
// ---- IDENTIFICAÇÃO da comanda por CPF ----
// Objetivo: a comanda deixa de ser só um número. "Comanda 301 · João S."
// aparece no celular do garçom, na conta e na comanda impressa da cozinha.
const soDig = (s) => String(s || '').replace(/\D/g, '');
/** Dígito verificador — de graça e local, evita bater na API à toa. */
function cpfValido(cpf) {
  const c = soDig(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const [len, pos] of [[9, 10], [10, 11]]) {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(c[i]) * (pos - i);
    let d = (soma * 10) % 11;
    if (d === 10) d = 0;
    if (d !== Number(c[len])) return false;
  }
  return true;
}
/** "RYAN DA SILVA SANTOS" -> "Ryan S." — identifica sem expor o nome inteiro. */
function nomeCurto(nome) {
  const partes = String(nome || '').trim().split(/\s+/)
    .filter((p) => !/^(da|de|do|das|dos|e)$/i.test(p));
  if (!partes.length) return '';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const primeiro = cap(partes[0]);
  return partes.length > 1 ? `${primeiro} ${partes[1][0].toUpperCase()}.` : primeiro;
}
/** Cliente que já esteve na casa: nome sai de graça, sem consultar nada fora. */
async function contatoPorCpf(cpf) {
  const c = soDig(cpf);
  // ⚠️ SÓ CLIENTE (TIPO='CF'). CONTATOS guarda cliente E colaborador no mesmo
  // lugar, e o CPF 024.589.335-05 esta em 13 cadastros de GARÇOM (tipo 'AA') —
  // alguem usou como preenchimento pra vencer o campo obrigatorio em 2019 e
  // foi repetindo. Com FIRST 1 sem filtro, digitar esse CPF na comanda trazia
  // "ROSANA", uma operadora, como se fosse a cliente. Na base ha 33 documentos
  // repetidos assim.
  const r = await qi(`SELECT CODIGO, TRIM(NOME) NOME, TRIM(COALESCE(TIPO,'')) TIPO FROM CONTATOS
    WHERE DATADELETE IS NULL AND REPLACE(REPLACE(REPLACE(CNPJOUCPF,'.',''),'-',''),'/','') = '${c}'
    ORDER BY CODIGO DESC`);
  // banco fora do ar NÃO é "cliente não cadastrado" — o garçom precisa saber a diferença
  if (!r.ok) throw new Error('cadastro indisponível: ' + r.err);
  const clientes = r.rows.filter((x) => String(x.TIPO || '').trim().toUpperCase() === 'CF');
  // ⚠️ CPF que existe na casa SO como colaborador nao e' "nao encontrado" — e'
  // "nao e' de cliente". A diferenca importa: devolvendo null, a busca seguia
  // pras outras fontes e a base do GRUPO (nuvem), onde o mesmo nome errado ja
  // tinha sido publicado, trazia "ROSANA" de volta. Nossa base e' quem manda
  // sobre quem e' cliente AQUI, entao a busca para aqui.
  if (!clientes.length) return r.rows.length ? { fonte: 'so_colaborador' } : null;
  // ⚠️ CPF REPETIDO ENTRE CLIENTES: nao escolha por conta propria. Devolver um
  // nome errado com cara de certo e' pior que nao devolver nada — o garcom
  // aceita e a comanda sai no nome de outra pessoa.
  if (clientes.length > 1) {
    // ⚠️ CPF repetido nem sempre e' pessoa diferente. Quase sempre e' a MESMA
    // pessoa cadastrada duas vezes com grafias diferentes ("Elson Vencimento de
    // Bonfim" e "Elson Bonfim"). Perguntar nesse caso e' ruido: o garcom para,
    // le dois nomes iguais e escolhe no chute.
    // Regra: mesmo PRIMEIRO nome e mesmo ULTIMO sobrenome = mesma pessoa, e
    // fica o cadastro com o nome mais completo. Nomes com raiz diferente
    // ("Otavio Leite" x "Marcela Escariz", que existe de verdade na base) sao
    // pessoas distintas e AI SIM tem que perguntar — o risco de sair a conta no
    // nome errado e' real.
    const chave = (nome) => {
      const partes = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/)
        .filter((x) => x && !/^(DA|DE|DO|DAS|DOS|E)$/.test(x));
      return partes.length ? partes[0] + '|' + partes[partes.length - 1] : '';
    };
    const chaves = new Set(clientes.map((x) => chave(T(x.NOME))));
    if (chaves.size === 1) {
      const melhor = clientes.slice().sort((x, y) => T(y.NOME).length - T(x.NOME).length)[0];
      return { contato_fb: Number(melhor.CODIGO), nome: T(melhor.NOME), fonte: 'consumer' };
    }
    return { contato_fb: null, nome: null, fonte: 'ambiguo',
      candidatos: clientes.slice(0, 5).map((x) => T(x.NOME)) };
  }
  return { contato_fb: Number(clientes[0].CODIGO), nome: T(clientes[0].NOME), fonte: 'consumer' };
}
// Consulta externa: mesmo padrão do pagamento — trocável por env, sem mexer na
// tela. 'off' (default) = só o cadastro local. 'spc' quando a credencial chegar.
// SPC Brasil — formato validado no projeto "Melhores do Ano" da CDL:
// POST JSON (não GET), Basic auth, e o erro vem DENTRO do corpo mesmo com
// HTTP 200/500. Consulta é PAGA por CPF, daí o cache local abaixo.
const CPF_PROVEDOR = process.env.CPF_PROVEDOR || 'off';
const SPC_URL = process.env.SPC_API_URL || 'https://api.spcbrasil.com.br/spcconsulta/recurso/consulta/padrao';
const SPC_PRODUTO = process.env.SPC_CODIGO_PRODUTO || '11';
// ---- BASE DE CLIENTES DO GRUPO (compartilhada entre as filiais) ----
// Cada loja tem seu Consumer: quem é cliente da Prainha Bar não existe pro
// Tabuará. Esta ponte faz o cliente ser reconhecido em qualquer casa.
// Trafega só o HASH do CPF — o documento não sai da loja.
// Endereco e segredo da nuvem — usados tanto pelo cartao quanto pela base de
// clientes do grupo, entao ficam declarados aqui, antes de qualquer uso.
const PAGAR_MESA_URL = process.env.PAGAR_MESA_URL || 'https://app.prainhabar.com';
const PAGAR_MESA_SECRET = process.env.PAGAR_MESA_SECRET || '';
const FILIAL_ID = process.env.FILIAL_ID || '';
const CLIENTE_SALT = process.env.CLIENTE_HASH_SALT || '';
function hashCpfGrupo(cpf) {
  return createHash('sha256').update(`${CLIENTE_SALT}::${soDig(cpf)}`).digest('hex');
}
function assinaGrupo(h, expira) {
  return createHmac('sha256', PAGAR_MESA_SECRET).update([FILIAL_ID, h, String(expira)].join('|')).digest('hex');
}
function grupoDisponivel() { return !!(PAGAR_MESA_SECRET && FILIAL_ID); }
// Assinatura do CENTRAL (app.prainhabar.com) pra falar com a loja pelo Funnel —
// mesmo segredo/HMAC do canal da NFC-e, escopo 'caixa'. É o que deixa a
// Conferência de Caixa do web ler relatório/analítico e FECHAR caixa, sem PIN.
function centralAssinou(u) {
  if (!PAGAR_MESA_SECRET || PAGAR_MESA_SECRET.length < 16) return false;
  const e = Number(u.searchParams.get('e') || 0);
  const s = String(u.searchParams.get('s') || '');
  if (!(e > Math.floor(Date.now() / 1000))) return false;
  const esperada = createHmac('sha256', PAGAR_MESA_SECRET).update([FILIAL_ID, 'caixa', String(e)].join('|')).digest('hex');
  try { const a = Buffer.from(s), b = Buffer.from(esperada); return a.length === b.length && timingSafeEqual(a, b); } catch { return false; }
}
async function clienteDoGrupo(cpf) {
  if (!grupoDisponivel()) return null;
  const h = hashCpfGrupo(cpf);
  const e = Math.floor(Date.now() / 1000) + 120;
  const q = new URLSearchParams({ h, f: FILIAL_ID, e: String(e), s: assinaGrupo(h, e) });
  const r = await fetch(`${PAGAR_MESA_URL}/api/cliente-documento?${q}`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.achou && j.nome ? { nome: j.nome, origem: j.origem, telefone_fim: j.telefone_fim || null } : null;
}
/** Publica na base do grupo — quem se identificar aqui é conhecido nas outras. */
async function publicarNoGrupo({ cpf, nome, telefone, origem }) {
  if (!grupoDisponivel() || !cpf || !nome) return;
  // ⚠️ Nao espalhar nome de colaborador pela rede. Foi assim que "ROSANA"
  // chegou na base do grupo: a busca antiga trouxe a operadora, alguem
  // confirmou, e o erro foi publicado pras outras filiais.
  try {
    const chk = await contatoPorCpf(cpf);
    if (chk?.fonte === 'so_colaborador') return;
  } catch { /* sem Firebird: nao publica por precaucao */ return; }
  const h = hashCpfGrupo(cpf);
  const e = Math.floor(Date.now() / 1000) + 120;
  await fetch(`${PAGAR_MESA_URL}/api/cliente-documento`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ h, f: FILIAL_ID, e, s: assinaGrupo(h, e), nome, tel: telefone || '', origem: origem || 'manual' }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {}); // publicar é best-effort: não pode travar o atendimento
}

// ---- NFC-e (emitida pelo CENTRAL, oferecida ao fechar a conta) ----
// O vendas-local NÃO fala com a SEFAZ: junta itens/pagamentos do pedido no
// Firebird (com NCM/CFOP que o contador mantém no Consumer), manda pro
// app.prainhabar.com assinado com o MESMO segredo do /pagar-mesa, e imprime
// o DANFE que volta pronto em blocos (térmica 48 col aqui; a LIO imprime os
// blocos de 32 na própria maquininha). Liga/desliga na config fiscal do
// painel central — a loja descobre sozinha (cache de 5 min), sem env novo.
function nfceAssina(pedidoChave, expira) {
  return createHmac('sha256', PAGAR_MESA_SECRET).update([FILIAL_ID, pedidoChave, String(expira)].join('|')).digest('hex');
}
let nfceStatusCache = { quando: 0, ativo: false, ambiente: 2 };
async function nfceAtiva() {
  if (!grupoDisponivel()) return false;
  if (Date.now() - nfceStatusCache.quando < 5 * 60e3) return nfceStatusCache.ativo;
  try {
    const e = Math.floor(Date.now() / 1000) + 120;
    const q2 = new URLSearchParams({ f: FILIAL_ID, e: String(e), s: nfceAssina('status', e) });
    const r = await fetch(`${PAGAR_MESA_URL}/api/nfce/emitir?${q2}`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    nfceStatusCache = { quando: Date.now(), ativo: !!(j && j.ok && j.ativo), ambiente: j?.ambiente || 2 };
  } catch { nfceStatusCache = { quando: Date.now() - 4 * 60e3, ativo: nfceStatusCache.ativo, ambiente: nfceStatusCache.ambiente }; }
  return nfceStatusCache.ativo;
}
/** A nota vem DEPOIS do fechamento — o fbAcharPedido (só abertos) não serve.
 *  Pega o aberto ou o fechado mais recente do número (janela de 12h). */
async function fbAcharPedidoNfce(numero) {
  const aberto = await fbAcharPedido(numero).catch(() => null);
  if (aberto) return aberto;
  const r = await q(`SELECT FIRST 1 CODIGO FROM PEDIDOS WHERE NUMERO=${Number(numero)} AND DATADELETE IS NULL
    AND DATAFECHAMENTO > DATEADD(-12 HOUR TO CURRENT_TIMESTAMP) ORDER BY CODIGO DESC`);
  if (!r.ok) throw new Error('FB pedido p/ nota: ' + r.err);
  return r.rows.length ? Number(r.rows[0].CODIGO) : null;
}
/** CPF/CNPJ que o cliente já deu antes (identificação da mesa ou Consumer). */
async function nfceDocSugerido(numero, ped) {
  const p = (await qi(`SELECT TRIM(COALESCE(NUMERODOCUMENTODESTINATARIO,'')) DOC FROM PEDIDOS WHERE CODIGO=${Number(ped)}`)).rows?.[0];
  const doFb = soDig(p?.DOC || '');
  if (doFb.length === 11 || doFb.length === 14) return doFb;
  const i = (await sql`SELECT cpf FROM identificacao WHERE numero=${Number(numero)} AND cpf IS NOT NULL
    AND criado_em > now() - interval '12 hours' ORDER BY criado_em DESC LIMIT 1`)[0];
  if (i?.cpf && soDig(i.cpf).length === 11) return soDig(i.cpf);
  const mc = (await sql`SELECT cpf FROM mesa_comanda WHERE comanda=${Number(numero)} AND cpf IS NOT NULL
    AND aberta_em > now() - interval '12 hours' ORDER BY aberta_em DESC LIMIT 1`)[0];
  if (mc?.cpf && soDig(mc.cpf).length === 11) return soDig(mc.cpf);
  return null;
}
const NFCE_TPAG = { 1: '01', 3: '03', 4: '04', 18: '20', 21: '17' }; // Consumer -> tPag da NFe
function nfceTBand(bandeira) {
  const b = String(bandeira || '').toLowerCase();
  if (b.includes('visa')) return '01';
  if (b.includes('master')) return '02';
  if (b.includes('amex') || b.includes('american')) return '03';
  if (b.includes('diners')) return '05';
  if (b.includes('elo')) return '06';
  if (b.includes('hiper')) return '07';
  if (b.includes('cabal')) return '09';
  return '99';
}
/** Junta o payload da nota a partir do PEDIDOS/ITENSPEDIDO/PAGAMENTOS.
 *  vNF alvo = VALORTOTAL do pedido (o que o cliente pagou de fato): o
 *  desconto/acréscimo é recalibrado por cima dos itens pra fechar exato. */
async function nfceDadosDoPedido(ped, numero) {
  const p = (await qi(`SELECT VALORTOTALITENS I, TOTALSERVICO S, TOTALDESCONTO D, TOTALACRESCIMO A, VALORTOTAL T
    FROM PEDIDOS WHERE CODIGO=${Number(ped)}`)).rows?.[0];
  if (!p) throw new Error('pedido não encontrado no Consumer');
  const it = await qi(`SELECT i.CODIGO, TRIM(i.NOMEPRODUTO) NOME, i.QUANTIDADE QTD, i.VALORTOTAL VT,
      i.CODIGOITEMPEDIDOTIPO TIPO, i.CODIGOPRODUTODETALHE PDV, pr.NCM, pr.CFOP
    FROM ITENSPEDIDO i
    LEFT JOIN PRODUTODETALHE pd ON pd.CODIGO=i.CODIGOPRODUTODETALHE
    LEFT JOIN PRODUTOS pr ON pr.CODIGO=pd.CODIGOPRODUTO
    WHERE i.CODIGOPEDIDO=${Number(ped)} AND i.DATADELETE IS NULL ORDER BY i.CODIGO`);
  if (!it.ok) throw new Error('FB itens p/ nota: ' + it.err);
  const itens = it.rows
    .map((r) => ({
      codigo: String(r.PDV || r.CODIGO || ''), descricao: T(r.NOME) || 'ITEM',
      quantidade: Number(r.QTD) || 0, valorTotal: +(Number(r.VT) || 0).toFixed(2),
      ncm: T(r.NCM) || undefined, cfop: T(r.CFOP) || undefined,
    }))
    .filter((x) => x.quantidade > 0 && x.valorTotal > 0);
  if (!itens.length) throw new Error('pedido sem itens com valor');

  const r2c = (v) => Math.round(v * 100) / 100;
  const base = r2c(itens.reduce((s, x) => s + x.valorTotal, 0));
  const alvo = r2c(Number(p.T) || 0);
  let extra = r2c((Number(p.S) || 0) + (Number(p.A) || 0));
  let desc = r2c(base + extra - alvo);
  if (desc < 0) { extra = r2c(extra - desc); desc = 0; } // acréscimo não mapeado: vira vOutro
  if (desc > 0) {
    // rateia o desconto proporcional ao item; o resto de centavo vai no último
    let acumulado = 0;
    itens.forEach((x, ix) => {
      const d = ix === itens.length - 1 ? r2c(desc - acumulado) : r2c(desc * (x.valorTotal / base));
      x.valorDesconto = Math.min(d, x.valorTotal); acumulado = r2c(acumulado + x.valorDesconto);
    });
  }
  if (extra > 0) itens[0].valorOutro = extra; // serviço/acréscimo (vOutro no 1º item)

  const pg = await qi(`SELECT g.VALOR, g.CODIGOFORMAPAGAMENTO F, g.NSUTRANSACAO NSU
    FROM PAGAMENTOS g WHERE g.CODIGOPEDIDO=${Number(ped)} AND g.DATADELETE IS NULL ORDER BY g.CODIGO`);
  if (!pg.ok) throw new Error('FB pagamentos p/ nota: ' + pg.err);
  const bandeiras = await sql`SELECT nsu, bandeira FROM venda_pagamento
    WHERE pedido_fb=${Number(ped)} AND status='ok' AND bandeira IS NOT NULL`;
  const bandPorNsu = new Map(bandeiras.map((b) => [String(b.nsu || ''), b.bandeira]));
  const pagamentos = pg.rows
    .map((g) => {
      const tPag = NFCE_TPAG[Number(g.F)] || '99';
      const nsu = g.NSU != null ? String(g.NSU) : '';
      const out = { tPag, valor: +(Number(g.VALOR) || 0).toFixed(2) };
      if (tPag === '03' || tPag === '04') {
        const band = bandPorNsu.get(nsu);
        if (band) out.tBand = nfceTBand(band);
        if (nsu && nsu !== '0') out.cAut = nsu.slice(0, 20);
      }
      return out;
    })
    .filter((x) => x.valor > 0);
  if (!pagamentos.length) throw new Error('pedido sem pagamentos — receba antes de emitir a nota');

  return { itens, pagamentos, total: alvo };
}
/** Pergunta da tela: tem nota? tem CPF já informado? NFC-e está ligada? */
async function apiNfceInfo(nRaw) {
  const numero = Number(nRaw);
  const ativo = await nfceAtiva();
  if (!ativo) return { ok: true, ativo: false };
  let ped = null;
  try { ped = await fbAcharPedidoNfce(numero); } catch { /* FB fora */ }
  if (!ped) return { ok: true, ativo: true, sem_pedido: true };
  const jaTem = (await sql`SELECT chave, nfce_numero, serie, status, erro, dest_documento FROM nfce_log WHERE pedido_fb=${ped}`)[0];
  // CPF pedido na tentativa anterior tem prioridade sobre o do cadastro
  const docSugerido = (jaTem && soDig(jaTem.dest_documento || '')) ||
    (await nfceDocSugerido(numero, ped).catch(() => null));
  const falhou = jaTem && (jaTem.status === 'REJEITADA' || jaTem.status === 'PENDENTE_ENVIO' || jaTem.status === 'ERRO');
  return { ok: true, ativo: true, pedido: ped, ambiente: nfceStatusCache.ambiente,
    emitida: !!(jaTem && jaTem.status === 'AUTORIZADA'),
    na_fila: !!(jaTem && jaTem.status === 'PENDENTE_ENVIO'),
    nota: jaTem ? { chave: jaTem.chave, numero: Number(jaTem.nfce_numero) || null, serie: Number(jaTem.serie) || null, status: jaTem.status } : null,
    ultima_falha: falhou ? { status: jaTem.status, erro: jaTem.erro || null } : null,
    documento_sugerido: docSugerido };
}
/** Miolo da emissão — usado pela tela (caixa/LIO) e pela FILA de reenvio.
 *  Falha de transporte (loja sem internet, central/SEFAZ fora) NUNCA é erro
 *  final: vira PENDENTE_ENVIO e o loopNfceFila reenvia sozinho (o central é
 *  idempotente e consulta a chave antes de reenviar — não duplica nota).
 *  A mesa NÃO depende disto: o fechamento já aconteceu antes. */
async function nfceEmitirCore({ ped, numero, documento, destino, solicitante }) {
  const doc = soDig(documento || '');
  let dados;
  try { dados = await nfceDadosDoPedido(ped, numero); }
  catch (e) { return { ok: false, erro: e.message }; }

  const pedidoChave = 'fb:' + ped;
  const e = Math.floor(Date.now() / 1000) + 300;
  const rotulo = impRotulo(numero, null);
  let resp = null;
  let falhaTransporte = null;
  try {
    const r = await fetch(`${PAGAR_MESA_URL}/api/nfce/emitir`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        f: FILIAL_ID, e, s: nfceAssina(pedidoChave, e),
        pedido: {
          pedidoChave, mesa: rotulo, documento: doc || null,
          itens: dados.itens, pagamentos: dados.pagamentos,
          infoExtra: rotulo + ' - Pedido ' + ped + ' - ' + LOJA_NOME,
          solicitadoPor: solicitante || null,
        },
      }),
      signal: AbortSignal.timeout(45000),
    });
    resp = await r.json().catch(() => null);
    if (!resp) falhaTransporte = 'central respondeu HTTP ' + r.status + ' sem JSON';
  } catch (err) { falhaTransporte = err.message; }

  if (!resp || !resp.ok) {
    // transitório (rede/SEFAZ fora) = fila; rejeição de verdade = parar e mostrar
    const transitorio = !!falhaTransporte || !!(resp && resp.transitorio);
    const msg = falhaTransporte || (resp && resp.erro) || 'falha na emissão';
    const status = transitorio ? 'PENDENTE_ENVIO' : 'REJEITADA';
    await sql`INSERT INTO nfce_log (pedido_fb, numero, dest_documento, status, erro, solicitado_por)
      VALUES (${ped}, ${numero}, ${doc || null}, ${status}, ${String(msg).slice(0, 300)}, ${solicitante || null})
      ON CONFLICT (pedido_fb) DO UPDATE SET dest_documento=EXCLUDED.dest_documento, status=EXCLUDED.status,
        erro=EXCLUDED.erro, solicitado_por=COALESCE(EXCLUDED.solicitado_por, nfce_log.solicitado_por), quando=now()`;
    if (transitorio) {
      return { ok: false, pendente: true,
        erro: 'Sem resposta da SEFAZ/central agora. A nota ficou NA FILA e será emitida sozinha — a mesa já está liberada.' };
    }
    return { ok: false, erro: msg, pendencias: resp && resp.pendencias };
  }

  const n = resp.nota || {};
  await sql`INSERT INTO nfce_log (pedido_fb, numero, chave, nfce_numero, serie, ambiente, dest_documento, valor, status, erro, solicitado_por)
    VALUES (${ped}, ${numero}, ${n.chave || null}, ${n.numero || null}, ${n.serie || null}, ${n.ambiente || null}, ${n.destDocumento || null}, ${n.valorTotal || null}, ${'AUTORIZADA'}, ${null}, ${solicitante || null})
    ON CONFLICT (pedido_fb) DO UPDATE SET chave=EXCLUDED.chave, nfce_numero=EXCLUDED.nfce_numero, serie=EXCLUDED.serie,
      ambiente=EXCLUDED.ambiente, dest_documento=EXCLUDED.dest_documento, valor=EXCLUDED.valor, status='AUTORIZADA', erro=NULL, quando=now()`;

  // DANFE: caixa e fila imprimem na térmica da loja; lio imprime na maquininha
  let impresso = false, impErro = null;
  if (destino === 'caixa' || destino === 'fila') {
    try {
      const ip = (await cfgGet('impressora_ip', '')).trim();
      if (ip) { await imprimirRaw(ip, nfceBlocosEscpos(resp.danfe48 || []), 'DANFE NFC-e ' + rotulo); impresso = true; }
      else impErro = 'sem impressora configurada';
    } catch (e2) { impErro = e2.message; }
  }
  return { ok: true, ja_existia: !!resp.jaExistia, impresso, imp_erro: impErro,
    nota: { chave: n.chave, numero: n.numero, serie: n.serie, valor: n.valorTotal },
    blocos: destino === 'lio' ? (resp.danfe32 || []) : undefined };
}
/** Emite (ou reimprime — o central é idempotente por pedido). */
async function apiNfceEmitir(body, quem) {
  const numero = Number(body.numero);
  const destino = String(body.destino || 'caixa'); // caixa = imprime na térmica; lio = devolve blocos 32
  if (!(await nfceAtiva())) return { ok: false, erro: 'NFC-e desligada na config fiscal do painel' };
  // com `ped` explícito (entrega: número 0 serve pra várias), é ELE que leva a
  // nota — senão a busca por número pegaria a entrega errada
  const ped = Number(body.ped) > 0 ? Number(body.ped) : await fbAcharPedidoNfce(numero);
  if (!ped) return { ok: false, erro: 'não achei pedido recente no número ' + numero };
  let doc = soDig(body.documento || '');
  if (doc && !(doc.length === 11 || doc.length === 14)) return { ok: false, erro: 'CPF/CNPJ incompleto' };
  // Reenvio/reimpressão sem documento na chamada (botão "Tentar agora" etc):
  // mantém o CPF que o cliente pediu na tentativa anterior — não se perde.
  if (!doc) {
    const log = (await sql`SELECT dest_documento FROM nfce_log WHERE pedido_fb=${ped}`)[0];
    if (log && log.dest_documento) doc = soDig(log.dest_documento);
  }
  return nfceEmitirCore({ ped, numero, documento: doc, destino, solicitante: (quem && quem.login) || null });
}
// ---- FILA de reenvio: nota que não saiu (rede/SEFAZ fora) tenta de novo
// sozinha a cada 2 min, por até 48h. Sucesso imprime o DANFE na térmica do
// caixa. REJEITADA não entra aqui (precisa de gente: corrigir e re-emitir).
let nfceFilaRodando = false;
async function loopNfceFila() {
  if (nfceFilaRodando) return; nfceFilaRodando = true;
  try {
    if (!grupoDisponivel()) return;
    const fila = await sql`SELECT pedido_fb, numero, dest_documento, solicitado_por FROM nfce_log
      WHERE status='PENDENTE_ENVIO' AND quando > now() - interval '48 hours'
      ORDER BY quando LIMIT 5`;
    if (!fila.length) return;
    if (!(await nfceAtiva())) return;
    for (const f of fila) {
      try {
        const r = await nfceEmitirCore({ ped: Number(f.pedido_fb), numero: Number(f.numero),
          documento: f.dest_documento || null, destino: 'fila', solicitante: f.solicitado_por || 'fila' });
        if (r.ok) console.log(`[nfce] fila: nota do pedido ${f.pedido_fb} saiu (nº ${r.nota?.numero})${r.impresso ? ' e impressa' : ''}`);
        else if (!r.pendente) console.log(`[nfce] fila: pedido ${f.pedido_fb} rejeitado — parou de tentar: ${r.erro}`);
      } catch (e) { console.error('[nfce] fila:', e.message); }
    }
  } catch (e) { console.error('[nfce] fila:', e.message); }
  finally { nfceFilaRodando = false; }
}
// ---- FILA DE REIMPRESSÃO vinda do painel: o botão "DANFE na loja" do
// Concilia enfileira no central; aqui a gente puxa (~20s), imprime na
// térmica do caixa e confirma. Sem impressora/erro = não confirma, tenta
// no próximo ciclo (o central descarta jobs com mais de 24h).
let nfceImpRodando = false;
async function loopNfceImpressao() {
  if (nfceImpRodando || !grupoDisponivel()) return; nfceImpRodando = true;
  try {
    const e = Math.floor(Date.now() / 1000) + 120;
    const q2 = new URLSearchParams({ f: FILIAL_ID, e: String(e), s: nfceAssina('fila', e) });
    const r = await fetch(`${PAGAR_MESA_URL}/api/nfce/fila-impressao?${q2}`, { signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => null);
    if (!j || !j.ok || !(j.jobs || []).length) return;
    const ip = (await cfgGet('impressora_ip', '')).trim();
    if (!ip) return; // sem impressora configurada: deixa na fila
    const feitos = [];
    for (const job of j.jobs) {
      try {
        await imprimirRaw(ip, nfceBlocosEscpos(job.blocos || []), '2ª via ' + (job.rotulo || 'DANFE'));
        feitos.push(job.id);
        console.log('[nfce] 2ª via impressa:', job.rotulo);
      } catch (e2) { console.error('[nfce] 2ª via falhou:', e2.message); }
    }
    if (feitos.length) {
      const e3 = Math.floor(Date.now() / 1000) + 120;
      await fetch(`${PAGAR_MESA_URL}/api/nfce/fila-impressao`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ f: FILIAL_ID, e: e3, s: nfceAssina('fila', e3), ids: feitos }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {}); // não confirmou = reimprime no próximo ciclo (papel a mais, nota a menos não)
    }
  } catch { /* central fora: próximo ciclo */ }
  finally { nfceImpRodando = false; }
}

// ---- DANFE em ESC/POS: blocos de texto + QR raster (GS v 0) ----
// O QR NÃO usa o comando nativo (GS ( k) porque a genérica 80mm nem sempre
// implementa: rasteriza os módulos do qrcode-svg (4px/módulo + quiet zone)
// e centraliza no papel de 576 px (72 bytes/linha).
function nfceQrRaster(texto) {
  const qr = new QRCode({ content: texto, padding: 0, width: 200, height: 200, ecl: 'M', join: true });
  const mods = qr.qrcode.modules;
  const n = mods.length, escala = 4, quiet = 16;
  const px = n * escala + quiet * 2;
  const bytesLinha = Math.ceil(px / 8);
  const cheio = 72; // 576 px úteis nas 80mm — centraliza com pad de bytes
  const pad = Math.max(0, Math.floor((cheio - bytesLinha) / 2));
  const larg = Math.min(cheio, bytesLinha + pad);
  const out = Buffer.alloc(larg * px);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!mods[y][x]) continue;
    for (let dy = 0; dy < escala; dy++) {
      const py = quiet + y * escala + dy;
      for (let dx = 0; dx < escala; dx++) {
        const p2 = quiet + x * escala + dx + pad * 8;
        out[py * larg + (p2 >> 3)] |= 0x80 >> (p2 & 7);
      }
    }
  }
  return Buffer.concat([
    Buffer.from([0x1d, 0x76, 0x30, 0x00, larg & 0xff, (larg >> 8) & 0xff, px & 0xff, (px >> 8) & 0xff]),
    out,
    Buffer.from([0x0a]),
  ]);
}
function nfceBlocosEscpos(blocos) {
  const b = [IMP.init, IMP.centro];
  for (const bl of blocos || []) {
    if (bl.qr) { b.push(nfceQrRaster(bl.qr)); continue; }
    const linhas = String(bl.texto || '').split('\n');
    const grande = (Number(bl.tamanho) || 16) >= 21 && linhas.every((l) => l.length <= 24);
    const alto = !grande && (Number(bl.tamanho) || 16) >= 21;
    if (bl.negrito) b.push(IMP.neg);
    if (grande) b.push(IMP.grande); else if (alto) b.push(IMP.alto);
    for (const l of linhas) b.push(impLn(l));
    if (grande || alto) b.push(IMP.norm);
    if (bl.negrito) b.push(IMP.negFim);
  }
  b.push(IMP.corte);
  return Buffer.concat(b);
}

/** O SPC devolve o STATUS do CPF dentro do campo `nome`. Sem isto, um CPF
 *  inexistente viraria um cliente chamado "Cpf Nao Existe Na Base Recfederal
 *  Situacao Em 23052015" — visto no primeiro teste real. */
function ehStatusNaoNome(nome) {
  const n = semAcento(nome);
  if (/\d/.test(n)) return true;          // nome de gente não tem número
  if (n.split(/\s+/).length > 7) return true; // frase, não nome
  return /\bcpf\b|nao existe|nao consta|nao localizad|situacao|regulariz|cancelad|suspens|falecid|inexistent|\bnula\b|\bpendente\b/.test(n);
}
/** Diagnostico da consulta externa, no mesmo espirito do pixStatus: diz se a
 *  credencial EXISTE e se parece sadia, sem NUNCA devolver o valor. Serve pra
 *  descobrir a distancia por que o SPC nao responde — aspas sobrando do .bat e
 *  senha truncada dao "credencial recusada" e sao invisiveis de outro jeito. */
function cpfStatus() {
  const fmt = (v) => (v ? { tamanho: v.length, comeca: v.slice(0, 2) + '…',
    aspas: /["']/.test(v), espaco: /^\s|\s$/.test(v) } : null);
  return {
    provedor: CPF_PROVEDOR,
    ligado: CPF_PROVEDOR === 'spc',
    url: SPC_URL,
    produto: SPC_PRODUTO,
    usuario: fmt(process.env.SPC_USER),
    senha: fmt(process.env.SPC_PASSWORD),
    cache: null,
  };
}
/** Cata os campos uteis em QUALQUER lugar da resposta do SPC. Os produtos
 *  mudam o formato (consumidorPessoaFisica, enderecos[], telefones[]…), entao
 *  em vez de fixar um caminho a gente varre a arvore procurando as chaves —
 *  e o JSON cru fica guardado de todo jeito. */
function colhe(obj) {
  const out = {};
  const data = (v) => {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(v)) || /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v));
    if (!m) return null;
    return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
  };
  const anda = (o, prof) => {
    if (!o || typeof o !== 'object' || prof > 6) return;
    for (const [k, v] of Object.entries(o)) {
      const K = k.toLowerCase();
      if (v && typeof v === 'object') { anda(v, prof + 1); continue; }
      const t = v == null ? '' : String(v).trim();
      if (!t) continue;
      if (!out.nascimento && /nascimento|dtnasc|datanasc/.test(K)) out.nascimento = data(t);
      else if (!out.mae && /(nomemae|mae)$/.test(K)) out.mae = t;
      else if (!out.telefone && /telefone|celular|fone/.test(K) && soDig(t).length >= 10) out.telefone = soDig(t).slice(0, 15);
      else if (!out.endereco && /logradouro|endereco/.test(K)) out.endereco = t;
      else if (!out.cidade && /cidade|municipio/.test(K)) out.cidade = t;
      else if (!out.uf && /^uf$|estado|sigla/.test(K) && t.length === 2) out.uf = t.toUpperCase();
      else if (!out.cep && /cep/.test(K) && soDig(t).length === 8) out.cep = soDig(t);
    }
  };
  anda(obj, 0);
  return out;
}
async function consultarCpfExterno(cpf) {
  if (CPF_PROVEDOR !== 'spc') return null;
  const user = process.env.SPC_USER, senha = process.env.SPC_PASSWORD;
  if (!user || !senha) throw new Error('SPC sem credencial (SPC_USER/SPC_PASSWORD)');
  const doc = soDig(cpf);
  // Cache: o mesmo CPF não pode ser cobrado duas vezes. Guarda só o hash.
  const hash = createHash('sha256').update(doc).digest('hex');
  const cache = (await sql`SELECT * FROM spc_cache WHERE cpf_hash=${hash}`)[0];
  if (cache) {
    // Já consultamos esse CPF antes. Se veio sem nome útil (ou com mensagem
    // de status, de quando o filtro ainda não existia), responde "não achei"
    // SEM consultar de novo — a consulta é paga.
    if (!cache.nome || ehStatusNaoNome(cache.nome)) {
      if (cache.nome) await sql`UPDATE spc_cache SET nome=NULL WHERE cpf_hash=${hash}`.catch(() => {});
      return null;
    }
    return { nome: cache.nome, fonte: 'spc-cache',
      nascimento: cache.nascimento || null, mae: cache.mae || null,
      telefone: cache.telefone || null, endereco: cache.endereco || null,
      cidade: cache.cidade || null, uf: cache.uf || null, cep: cache.cep || null };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000); // a mesa não pode esperar demais
  // ⚠️ O documento vai FORMATADO (000.000.000-00), igual ao projeto da CDL onde
  // esta consulta foi validada. Com os dígitos crus o SPC respondia "Cpf Nao
  // Existe Na Base Recfederal..." pra CPF válido — o filtro descartava o
  // "nome", o null ia pro cache, e o CPF nunca mais era procurado.
  const docFmt = doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  try {
    const r = await fetch(SPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json',
        authorization: 'Basic ' + Buffer.from(`${user}:${senha}`).toString('base64') },
      body: JSON.stringify({ codigoProduto: SPC_PRODUTO, tipoConsumidor: 'F',
        documentoConsumidor: docFmt, codigoInsumoOpcional: [] }),
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => null);
    if (r.status === 401 || r.status === 403) throw new Error('SPC recusou as credenciais');
    if (r.status === 429) throw new Error('SPC: limite de consultas atingido');
    // erro estruturado chega no corpo mesmo com HTTP 200
    if (j?.result?.error === true || j?.result?.error === 'true') {
      throw new Error('SPC: ' + (j?.result?.message || 'erro na consulta'));
    }
    if (!r.ok) throw new Error('SPC HTTP ' + r.status);
    const pf = j?.result?.return_object?.resultado?.consumidor?.consumidorPessoaFisica;
    const cru = pf?.nome ? String(pf.nome).trim() : null;
    const nome = cru && !ehStatusNaoNome(cru) ? cru : null;
    // ⚠️ A CONSULTA E' PAGA — aproveita a resposta inteira, nao so o nome.
    // Os nomes de campo variam entre produtos do SPC, entao a busca e' por
    // aproximacao em toda a arvore, e o JSON cru fica guardado pra dar pra
    // extrair o que faltar depois sem consultar (e sem pagar) de novo.
    const extra = pf ? colhe(pf) : {};
    // Só grava quando a resposta DISSE algo sobre a pessoa (pf presente).
    // Resposta sem pf = formato inesperado/instabilidade — gravar esse "nada"
    // custava a consulta pra sempre: o CPF ficava "não achei" até alguém
    // limpar o cache na mão.
    if (pf) await sql`INSERT INTO spc_cache (cpf_hash, cpf, nome, bruto, nascimento, mae, telefone, endereco, cidade, uf, cep)
      VALUES (${hash}, ${doc}, ${nome}, ${pf ? JSON.stringify(pf) : null},
              ${extra.nascimento || null}, ${extra.mae || null}, ${extra.telefone || null},
              ${extra.endereco || null}, ${extra.cidade || null}, ${extra.uf || null}, ${extra.cep || null})
      ON CONFLICT (cpf_hash) DO UPDATE SET cpf=EXCLUDED.cpf, nome=EXCLUDED.nome, bruto=EXCLUDED.bruto,
        nascimento=EXCLUDED.nascimento, mae=EXCLUDED.mae, telefone=EXCLUDED.telefone,
        endereco=EXCLUDED.endereco, cidade=EXCLUDED.cidade, uf=EXCLUDED.uf, cep=EXCLUDED.cep`.catch(() => {});
    return nome ? { nome, fonte: 'spc', ...extra } : null;
  } finally { clearTimeout(t); }
}
/** Reparo 02/08/2026 — roda UMA vez, guardado por sentinela. Enquanto o
 *  documento ia sem formato, o SPC respondia "não existe" pra CPF válido e o
 *  cache guardava esse nada pra sempre. Apaga as entradas sem nome pra elas
 *  terem nova chance com o formato certo; a sentinela impede repetir (e pagar
 *  de novo por CPF realmente inexistente) a cada boot. */
async function repararCacheSpc() {
  const ja = await sql`SELECT 1 FROM spc_cache WHERE cpf_hash='reparo:documento-formatado'`;
  if (ja.length) return;
  const n = await sql`DELETE FROM spc_cache WHERE nome IS NULL`;
  await sql`INSERT INTO spc_cache (cpf_hash) VALUES ('reparo:documento-formatado')
    ON CONFLICT (cpf_hash) DO NOTHING`;
  console.log(`[spc] cache: ${n.count} entrada(s) sem nome liberadas pra nova consulta`);
}
/** Telefone/WhatsApp como chave alternativa: nem todo cliente dá o CPF. */
async function contatoPorTelefone(tel) {
  const t = soDig(tel);
  if (t.length < 10) return null;
  const ult8 = t.slice(-8); // ignora DDD e o 9 extra, que variam no cadastro
  const r = await qi(`SELECT FIRST 1 CODIGO, TRIM(NOME) NOME FROM CONTATOS
    WHERE DATADELETE IS NULL AND (
      REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(FONECELULAR,''),'(',''),')',''),'-',''),' ','') LIKE '%${ult8}'
      OR REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(FONEPRINCIPAL,''),'(',''),')',''),'-',''),' ','') LIKE '%${ult8}')`);
  if (!r.ok) throw new Error('cadastro indisponível: ' + r.err);
  if (!r.rows.length) return null;
  return { contato_fb: Number(r.rows[0].CODIGO), nome: T(r.rows[0].NOME), fonte: 'consumer' };
}
/** Cadastra o cliente no CONTATOS do Consumer — a trigger CONTATOS_BI gera o
 *  CODIGO. Assim ele existe pra fiado, NFC-e e pra próxima visita. */
async function fbCriarContato({ nome, cpf, telefone, nascimento, endereco, cidade, uf, cep }) {
  const n = String(nome || '').trim().slice(0, 100);
  if (!n) throw new Error('nome é obrigatório pra cadastrar');
  if (nativo()) {
    // Cliente novo nasce aqui e sobe pro Concilia pelo espelho — o cadastro
    // completo (endereço, nascimento) é do Financeiro; a loja guarda o que a
    // conta precisa: nome, documento e telefone.
    const cod = await proxCodigo('cliente');
    await sql`INSERT INTO cliente_local (codigo, nome, cpf, telefone, limite_credito, saldo_atual, ativo, atualizado_em)
      VALUES (${cod}, ${n}, ${cpf ? soDig(cpf) : null}, ${telefone ? soDig(telefone) : null}, 0, 0, true, now())`;
    return cod;
  }
  const campos = ['NOME', 'TIPO', 'DATAINSERT', 'LIMITECREDITOCONTACORRENTE', 'SALDOATUALCONTACORRENTE',
    'COMISSAOCOLABORADOR', 'ICMSDESONDIMINUIVALORNF', 'BLOQUEARVENDAAPOSLIMITE', 'ARQUIVARFIADO'];
  const vals = [`'${fbEsc(n)}'`, `'CF'`, 'CURRENT_TIMESTAMP', '0', '0', '0', '0', `'N'`, `'N'`];
  if (cpf) { campos.push('CNPJOUCPF'); vals.push(`'${fbEsc(soDig(cpf))}'`); }
  if (telefone) { campos.push('FONECELULAR'); vals.push(`'${fbEsc(soDig(telefone))}'`); }
  // O que a consulta trouxe entra no cadastro: ninguem precisa perguntar
  // nascimento nem endereco pro cliente que ja esta com a conta na mao.
  if (nascimento) { campos.push('DATANASCIMENTO'); vals.push(`'${fbEsc(nascimento)}'`); }
  if (endereco) { campos.push('ENDERECO'); vals.push(`'${fbEsc(String(endereco).slice(0, 60))}'`); }
  if (cidade) { campos.push('CIDADE'); vals.push(`'${fbEsc(String(cidade).slice(0, 40))}'`); }
  if (uf) { campos.push('UF'); vals.push(`'${fbEsc(String(uf).slice(0, 2))}'`); }
  if (cep) { campos.push('CEP'); vals.push(`'${fbEsc(soDig(cep))}'`); }
  const r = await qi(`INSERT INTO CONTATOS (${campos.join(', ')}) VALUES (${vals.join(', ')})`);
  if (!r.ok) throw new Error('FB cadastrar cliente: ' + r.err);
  const g = await qi(`SELECT FIRST 1 CODIGO FROM CONTATOS WHERE DATADELETE IS NULL AND TRIM(NOME)='${fbEsc(n)}' ORDER BY CODIGO DESC`);
  return g.ok && g.rows.length ? Number(g.rows[0].CODIGO) : null;
}
async function apiVendaIdentificar(cpf, telefone) {
  // CPF ou WhatsApp — o que a pessoa tiver
  if (telefone && !cpf) {
    try {
      const t = await contatoPorTelefone(telefone);
      if (t) return { ok: true, ...t, nome_curto: nomeCurto(t.nome) };
    } catch (e) { return { ok: true, nome: null, fonte: 'erro', aviso: String(e.message).slice(0, 120) }; }
    // ⚠️ SIMETRIA COM O CPF. O caminho do CPF ja consultava quem a gente mesmo
    // identificou antes; o do telefone parava no Consumer. Resultado: o garcom
    // cadastrava a pessoa com nome+CPF+WhatsApp, e no dia seguinte, procurando
    // pelo WhatsApp, ela "nao existia". Os ultimos 8 digitos casam DDD e o 9
    // extra, que variam do jeito que cada um digitou.
    const ult8 = soDig(telefone).slice(-8);
    const ja = (await sql`SELECT nome, contato_fb FROM identificacao
      WHERE nome IS NOT NULL AND right(regexp_replace(coalesce(telefone,''), '\\D', '', 'g'), 8) = ${ult8}
      ORDER BY criado_em DESC LIMIT 1`)[0];
    if (ja?.nome) return { ok: true, nome: ja.nome, contato_fb: ja.contato_fb ?? null,
      fonte: 'ja-atendido', nome_curto: nomeCurto(ja.nome) };
    return { ok: true, nome: null, fonte: 'nao_cadastrado' };
  }
  if (!cpfValido(cpf)) return { ok: false, erro: 'CPF inválido' };
  let duplicado = null;   // CPF em cadastros conflitantes: pula o local, vai pro SPC
  // 1º) cadastro do Consumer — a base oficial da casa
  try {
    const local = await contatoPorCpf(cpf);
    // ⚠️ CPF que so existe como COLABORADOR: o nome do cadastro da casa nao
    // serve (e' funcionario, nao cliente) e o ja-atendido/grupo tambem nao —
    // foi por essas bases que "ROSANA" voltava depois de limpa. Mas a pessoa
    // EXISTE e pode ser cliente (o dono tambem janta aqui): pula DIRETO pro
    // SPC, que traz o nome oficial. Com "cadastrar" marcado ela vira cliente
    // (CF) no Consumer e, da proxima vez, sai da base da casa como qualquer um.
    if (local?.fonte === 'so_colaborador') duplicado = true;
    // ⚠️ CPF E' CHAVE UNICA DE UMA PESSOA. Dois cadastros com o mesmo CPF e
    // nomes diferentes = o dado local nao presta. Nao escolhe, nao pergunta:
    // DESCARTA OS DOIS e segue pro SPC, que e' a fonte autoritativa. Perguntar
    // ao garcom so transferia pra ele um erro de cadastro da casa.
    // (Em 02/08 os 34 CPFs duplicados da base tiveram o documento removido —
    // os clientes e o historico ficaram; so o CPF saiu.)
    if (local?.fonte === 'ambiguo') duplicado = local.candidatos;
    else if (local && local.fonte !== 'so_colaborador') return { ok: true, ...local, nome_curto: nomeCurto(local.nome) };
  } catch (e) { return { ok: true, nome: null, fonte: 'erro', aviso: String(e.message).slice(0, 120) }; }
  // 2º) quem já identificamos em alguma mesa antes, mesmo sem cadastrar no
  //     Consumer. Sem isto, essa pessoa seria consultada (e cobrada) de novo.
  const jaVisto = duplicado ? null : (await sql`SELECT nome, contato_fb FROM identificacao
    WHERE cpf=${soDig(cpf)} AND nome IS NOT NULL ORDER BY criado_em DESC LIMIT 1`)[0];
  if (jaVisto?.nome) return { ok: true, nome: jaVisto.nome, contato_fb: jaVisto.contato_fb ?? null,
    fonte: 'ja-atendido', nome_curto: nomeCurto(jaVisto.nome) };
  // 3º) base do GRUPO: quem já foi identificado em QUALQUER filial. Um cliente
  //     conhecido no Tabuará não pode ser consultado de novo na Prainha Bar.
  try {
    const grupo = duplicado ? null : await clienteDoGrupo(cpf);
    if (grupo) return { ok: true, nome: grupo.nome, fonte: 'grupo',
      telefone_fim: grupo.telefone_fim, nome_curto: nomeCurto(grupo.nome) };
  } catch { /* sem internet: segue pro SPC, que também precisaria dela */ }
  // 4º) só agora o SPC — e ele ainda passa pelo próprio cache antes de cobrar
  try {
    const ext = await consultarCpfExterno(cpf);
    if (ext) return { ok: true, ...ext, nome_curto: nomeCurto(ext.nome) };
  } catch (e) {
    return { ok: true, nome: null, fonte: 'erro', aviso: String(e.message).slice(0, 120) };
  }
  return { ok: true, nome: null, fonte: CPF_PROVEDOR === 'off' ? 'nao_cadastrado' : 'nao_encontrado' };
}
/** Carimba quem está na MESA ou na COMANDA (o número é a chave dos dois). */
async function apiIdentificarSalvar(body) {
  const numero = Number(body.numero);
  if (!(numero >= 1 && numero <= NUMERO_MAX)) return { ok: false, erro: 'número inválido' };
  const cpf = body.cpf ? soDig(body.cpf) : null;
  if (cpf && !cpfValido(cpf)) return { ok: false, erro: 'CPF inválido' };
  const tel = body.telefone ? soDig(body.telefone) : null;
  const nome = String(body.nome || '').trim().slice(0, 120) || null;
  if (!nome) return { ok: false, erro: 'informe o nome' };
  const curto = nomeCurto(nome);
  let contatoFb = body.contato_fb ? Number(body.contato_fb) : null;
  // Cliente novo: cadastra no Consumer pra existir na próxima visita
  if (!contatoFb && body.cadastrar) {
    // recupera o que o SPC ja trouxe pra este CPF (cache — nao consulta de novo)
    let ex = {};
    if (cpf) {
      const h = createHash('sha256').update(soDig(cpf)).digest('hex');
      ex = (await sql`SELECT nascimento, endereco, cidade, uf, cep, telefone FROM spc_cache
        WHERE cpf_hash=${h}`)[0] || {};
    }
    try { contatoFb = await fbCriarContato({ nome, cpf, telefone: tel || ex.telefone,
      nascimento: ex.nascimento ? new Date(ex.nascimento).toISOString().slice(0, 10) : null,
      endereco: ex.endereco, cidade: ex.cidade, uf: ex.uf, cep: ex.cep }); }
    catch (e) { return { ok: false, erro: e.message }; }
  }
  // ---- O DONO DA MESA NÃO MUDA ----
  // O primeiro que se cadastra fica responsável. Antes, o ON CONFLICT trocava
  // nome e nome_curto em silêncio: o segundo a se identificar virava o dono, e
  // a conta impressa saía no nome errado.
  // A MESMA pessoa continua podendo completar o cadastro (dar o telefone
  // depois do CPF) — só troca de pessoa é que é barrada.
  const dono = (await sql`SELECT nome_curto, cpf, telefone, contato_fb FROM identificacao
    WHERE numero=${numero} AND fechada_em IS NULL`)[0];
  if (dono) {
    const mesma = (cpf && dono.cpf === cpf)
      || (tel && dono.telefone === tel)
      || (contatoFb && Number(dono.contato_fb) === Number(contatoFb));
    if (!mesma) {
      const onde = numero >= COMANDA_DE ? 'comanda' : 'mesa';
      return { ok: false, ja_tem_dono: true, dono: dono.nome_curto || null,
        // nome_curto já termina em ponto ("Elison B.") — sem isto sai "B.."
        erro: `Esta ${onde} já está no nome de ${dono.nome_curto || 'outra pessoa'}`.replace(/\.?$/, '.') +
              (numero >= COMANDA_DE ? ' Peça uma comanda sua ao garçom.'
                                    : ' Peça a sua comanda ao garçom pra pedir e pagar separado.') };
    }
  }
  await sql`INSERT INTO identificacao (numero, cpf, telefone, nome, nome_curto, contato_fb)
      VALUES (${numero}, ${cpf}, ${tel}, ${nome}, ${curto}, ${contatoFb})
    ON CONFLICT (numero) DO UPDATE SET cpf=COALESCE(EXCLUDED.cpf, identificacao.cpf),
      telefone=COALESCE(EXCLUDED.telefone, identificacao.telefone),
      nome=EXCLUDED.nome, nome_curto=EXCLUDED.nome_curto,
      contato_fb=COALESCE(EXCLUDED.contato_fb, identificacao.contato_fb),
      criado_em=now(), fechada_em=NULL`;
  try {
    const ped = await fbAcharPedido(numero);
    if (ped) await fbIdentificarPedido(ped, { nome: curto, cpf, contatoFb });
  } catch (e) { console.error('[identificar] write-back:', e.message); }
  // leva pra base do grupo: identificou aqui, é conhecido nas outras filiais
  publicarNoGrupo({ cpf, nome, telefone: tel, origem: contatoFb ? 'consumer' : 'manual' });
  return { ok: true, numero, nome_curto: curto, contato_fb: contatoFb, cadastrado: !!(body.cadastrar && contatoFb) };
}

// ================== LOGIN DO GARÇOM (PIN próprio) ==================
// Quem PODE entrar vem do Consumer: só login ATIVO com a permissão
// AcessarComandaMobile (PERMISSAO.CODIGO=53). A senha do Consumer é cifrada com
// chave embutida no .exe da RAL e não deu pra reverter — então a credencial é
// um PIN nosso (hash scrypt no Postgres). A lista de QUEM pode é a do Consumer.
const PERM_COMANDA_MOBILE = 53;
// Segredo pra assinar o token de sessão. Fica no Postgres pra sobreviver a
// restart/deploy — senão todo deploy deslogava a loja inteira (e a gente faz
// deploy toda hora). Carregado uma vez no boot.
let GARCOM_SECRET = null;
async function carregarGarcomSecret() {
  const r = (await sql`SELECT valor FROM app_config WHERE chave='garcom_token_secret'`)[0];
  if (r?.valor) { GARCOM_SECRET = r.valor; return; }
  GARCOM_SECRET = randomBytes(32).toString('hex');
  await sql`INSERT INTO app_config (chave, valor) VALUES ('garcom_token_secret', ${GARCOM_SECRET})
    ON CONFLICT (chave) DO NOTHING`;
  // corrida entre dois boots: relê pra ficar todo mundo com o mesmo
  const r2 = (await sql`SELECT valor FROM app_config WHERE chave='garcom_token_secret'`)[0];
  if (r2?.valor) GARCOM_SECRET = r2.valor;
}
const GARCOM_TOKEN_HORAS = Number(process.env.GARCOM_TOKEN_HORAS || 16); // um turno
function garcomAssina(login, exp) {
  return createHmac('sha256', GARCOM_SECRET || '').update(`${login}|${exp}`).digest('hex').slice(0, 32);
}
function garcomGeraToken(login) {
  const exp = Date.now() + GARCOM_TOKEN_HORAS * 3600 * 1000;
  return `${encodeURIComponent(login)}.${exp}.${garcomAssina(login, exp)}`;
}
function garcomVerificaToken(token) {
  const t = String(token || '');
  const parts = t.split('.');
  if (parts.length !== 3) return null;
  const login = decodeURIComponent(parts[0]); const exp = Number(parts[1]); const sig = parts[2];
  if (!login || !(exp > Date.now())) return null;
  const bom = garcomAssina(login, exp);
  try { if (!timingSafeEqual(Buffer.from(sig), Buffer.from(bom))) return null; } catch { return null; }
  return { login };
}
// Cache de 60s da lista de quem pode: evita bater no Firebird a cada ação.
let _permCache = { em: 0, mapa: null };
async function garcomPermitidos() {
  if (_permCache.mapa && Date.now() - _permCache.em < 60000) return _permCache.mapa;
  // Pode entrar: quem tem AcessarComandaMobile OU quem é ADMINISTRADOR — no
  // Consumer o Administrador tem acesso a tudo, mesmo sem a permissão listada.
  const r = await qi(`SELECT TRIM(u.LOGIN) LOGIN, TRIM(COALESCE(u.NOME,'')) NOME
    FROM VWUSUARIOS u
    WHERE u.ATIVO='S' AND (
      UPPER(TRIM(COALESCE(u.TIPO,'')))='ADMINISTRADOR'
      OR EXISTS (SELECT 1 FROM ACESSO a WHERE a.USUARIO=u.CODIGO AND a.PERMISSAO=${PERM_COMANDA_MOBILE})
    )`);
  if (!r.ok) throw new Error('cadastro de usuários indisponível: ' + r.err);
  const mapa = new Map();
  for (const x of r.rows) { const l = T(x.LOGIN).toLowerCase(); if (l) mapa.set(l, T(x.NOME) || T(x.LOGIN)); }
  _permCache = { em: Date.now(), mapa };
  return mapa;
}
async function garcomPodeEntrar(login) {
  const mapa = await garcomPermitidos();
  const l = String(login || '').trim().toLowerCase();
  return mapa.has(l) ? { ok: true, nome: mapa.get(l), login: l } : { ok: false };
}
function pinHash(pin, salt) { return scryptSync(String(pin), salt, 32).toString('hex'); }
function pinConfere(pin, salt, hash) {
  try { return timingSafeEqual(Buffer.from(pinHash(pin, salt), 'hex'), Buffer.from(hash, 'hex')); }
  catch { return false; }
}
/** Sessão a partir do header x-garcom (ou ?t=). Retorna {login,nome} ou null.
 *  Revalida a permissão no Consumer: tirou a permissão lá, cai aqui na hora. */
async function garcomDaRequisicao(req, u) {
  const tok = (req.headers['x-garcom'] || (u && u.searchParams.get('t')) || '').toString();
  const v = garcomVerificaToken(tok);
  if (!v) return null;
  try {
    const pode = await garcomPodeEntrar(v.login);
    if (pode.ok) return { login: v.login, nome: pode.nome };
    // o CAIXA também vende ("abre mesa e lança como na maquininha"): quem tem
    // PedidosCaixa (5) no Consumer entra na venda mesmo sem a Comanda Mobile
    const p = await permsDoUsuario(v.login);
    if (p.ok && p.pedidos) return { login: v.login, nome: p.nome };
    return null;
  }
  catch { return { login: v.login, nome: null }; } // Firebird fora: não desloga quem já entrou
}
// GERENTE = permissão nossa (garcom_pin.gerente) OU Administrador / Excluir-
// Pedido(28) no Consumer (mesma régua da dupla-senha do caixa). É quem vê as
// RECLAMAÇÕES na comanda mobile (as reclamações também vão pro KDS).
async function ehGerente(login) {
  const l = String(login || '').trim().toLowerCase();
  if (!l) return false;
  try {
    const local = (await sql`SELECT gerente FROM garcom_pin WHERE login=${l}`)[0];
    if (local && local.gerente) return true;
  } catch {}
  try { const p = await permsDoUsuario(l); return !!(p.ok && (p.admin || p.excluir_pedido)); }
  catch { return false; }
}

// GET /api/garcom/sessao — o celular pergunta "ainda estou logado?"
async function apiGarcomSessao(req, u) {
  const g = await garcomDaRequisicao(req, u);
  if (!g) return { ok: false };
  return { ok: true, login: g.login, nome: g.nome, gerente: await ehGerente(g.login) };
}

// ---- GESTÃO da permissão GERENTE (só um gerente mexe) ----
async function apiGerentesListar(req, u) {
  const g = await garcomDaRequisicao(req, u);
  if (!g || !(await ehGerente(g.login))) return { ok: false, erro: 'só gerente vê isto' };
  const linhas = await sql`SELECT login, nome, gerente FROM garcom_pin ORDER BY COALESCE(nome, login)`;
  const out = [];
  for (const l of linhas) {
    // quem já é gerente pelo Consumer (admin/28) vem travado — não dá pra tirar
    // aqui o que a loja definiu lá.
    let porConsumer = false;
    try { const p = await permsDoUsuario(l.login); porConsumer = !!(p.ok && (p.admin || p.excluir_pedido)); } catch {}
    out.push({ login: l.login, nome: l.nome || l.login, gerente: !!l.gerente || porConsumer, por_consumer: porConsumer });
  }
  return { ok: true, gerentes: out, eu: g.login };
}
async function apiGerenteSet(req, u, body) {
  const g = await garcomDaRequisicao(req, u);
  if (!g || !(await ehGerente(g.login))) return { ok: false, erro: 'só gerente pode mexer nisso' };
  const login = String(body.login || '').trim().toLowerCase();
  if (!login) return { ok: false, erro: 'informe o login' };
  const val = !!body.gerente;
  const r = await sql`UPDATE garcom_pin SET gerente=${val}, atualizado_em=now() WHERE login=${login} RETURNING login`;
  if (!r.length) return { ok: false, erro: 'esse login ainda não tem PIN aqui — ele precisa entrar 1x primeiro' };
  return { ok: true, login, gerente: val };
}
// POST /api/garcom/entrar {login, pin, pin2?}
//  - login sem permissão no Consumer -> negado
//  - primeira vez (sem PIN): exige pin==pin2 e cria
//  - já tem PIN: confere
async function apiGarcomEntrar(body) {
  const login = String(body.login || '').trim().toLowerCase();
  const pin = String(body.pin || '').replace(/\D/g, '');
  if (!login) return { ok: false, erro: 'informe o login' };
  if (!(pin.length >= 4 && pin.length <= 8)) return { ok: false, erro: 'o PIN tem de 4 a 8 números' };
  let pode;
  try {
    pode = await garcomPodeEntrar(login);
    // quem tem PedidosCaixa (5) entra também — o caixa lança como na maquininha
    if (!pode.ok) {
      const p = await permsDoUsuario(login);
      // ⚠️ usuário NOSSO (usuario_local) não está no mapa do Consumer: vale a
      // permissão que o perfil dele carrega — 53 (comanda) ou 5 (pedido no caixa).
      if (p.ok && (p.pedidos || p.comanda)) pode = { ok: true, nome: p.nome };
    }
  }
  catch (e) { return { ok: false, erro: e.message }; }
  if (!pode.ok) return { ok: false, erro: 'Este login não tem acesso à Comanda Mobile nem a Pedidos no Caixa. Fale com o gerente.' };
  const atual = (await sql`SELECT pin_hash, salt FROM garcom_pin WHERE login=${login}`)[0];
  if (!atual) {
    // primeira vez: cria o PIN (precisa confirmar digitando de novo)
    const pin2 = String(body.pin2 || '').replace(/\D/g, '');
    if (!pin2) return { ok: true, primeira_vez: true, nome: pode.nome };
    if (pin2 !== pin) return { ok: false, primeira_vez: true, erro: 'os dois PINs não são iguais' };
    const salt = randomBytes(16).toString('hex');
    await sql`INSERT INTO garcom_pin (login, pin_hash, salt, nome) VALUES (${login}, ${pinHash(pin, salt)}, ${salt}, ${pode.nome})
      ON CONFLICT (login) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, salt=EXCLUDED.salt, nome=EXCLUDED.nome, atualizado_em=now()`;
    return { ok: true, token: garcomGeraToken(login), nome: pode.nome, criado: true, gerente: await ehGerente(login) };
  }
  if (!pinConfere(pin, atual.salt, atual.pin_hash)) return { ok: false, erro: 'PIN incorreto' };
  return { ok: true, token: garcomGeraToken(login), nome: pode.nome, gerente: await ehGerente(login) };
}

// ---- CAIXA: acesso e ajuste de conta (Bloco 1) ----
// O caixa é a MESMA pessoa logando (mesmo PIN/token do garçom); o que muda é a
// PERMISSÃO exigida, lida do Consumer: AbrirTelaPagamento (10)=entra no caixa;
// AplicarDesconto (12)=pode dar desconto; ContaCorrente (16)=fiado (Bloco 2).
// Administrador tem tudo. Assim "quem pode" é o que a loja já define no Consumer.
const PERM_CAIXA = 10, PERM_DESCONTO = 12, PERM_FIADO = 16, PERM_PEDIDO_CAIXA = 5;
// controle de caixa: 1 = operação completa, 30 = simplificada (abrir/fechar),
// 48 = pode fechar com saldo divergente do esperado, 26 = entradas/saídas da gaveta
const PERM_ABRIR_COMPLETO = 1, PERM_ABRIR_SIMPLES = 30, PERM_DIVERGENTE = 48, PERM_MOVIMENTO = 26;
const PERM_TRANSFERIR = 50; // Consumer: "Permitir transferir/copiar itens de um pedido para o outro"
// 22 = excluir item do pedido, 28 = excluir o pedido inteiro (na 0003: 22 =
// todo o time do caixa; 28 = só LILIAN — quem pode é decisão do Consumer)
const PERM_EXCLUIR_ITEM = 22, PERM_EXCLUIR_PEDIDO = 28;
/** Monta o perfil a partir de um conjunto de códigos de permissão do Consumer.
 *  Uma função só pros dois cadastros (o do PDV e o nosso) — regra duplicada é
 *  regra que diverge. */
function perfilDeCodigos(login, nome, admin, codigos) {
  const perms = new Set((codigos || []).map(Number).filter(Boolean));
  const tem = (cod) => admin || perms.has(cod);
  return { ok: true, login, nome: nome || login, admin,
    caixa: tem(PERM_CAIXA), desconto: tem(PERM_DESCONTO), fiado: tem(PERM_FIADO),
    abrir: tem(PERM_ABRIR_COMPLETO) || tem(PERM_ABRIR_SIMPLES),
    movimentar: tem(PERM_ABRIR_COMPLETO) || tem(PERM_MOVIMENTO),
    transferir: tem(PERM_TRANSFERIR),
    divergente: tem(PERM_ABRIR_COMPLETO) || tem(PERM_DIVERGENTE),
    pedidos: tem(PERM_PEDIDO_CAIXA),
    comanda: tem(53), // AcessarComandaMobile — é o que deixa entrar na venda
    excluir_item: tem(PERM_EXCLUIR_ITEM), excluir_pedido: tem(PERM_EXCLUIR_PEDIDO) };
}
/** Usuário criado por nós (não existe no Consumer). */
async function permsLocal(l) {
  const u = (await sql`SELECT * FROM usuario_local WHERE login=${l} AND ativo`)[0];
  if (!u) return null;
  return { ...perfilDeCodigos(l, u.nome, !!u.admin, u.perms || []), local: true };
}
async function permsDoUsuario(login) {
  const l = String(login || '').trim().toLowerCase();
  if (!l) return { ok: false };
  let r;
  try {
    r = await qi(`SELECT TRIM(u.LOGIN) LOGIN, TRIM(COALESCE(u.NOME,'')) NOME, TRIM(COALESCE(u.TIPO,'')) TIPO, a.PERMISSAO
      FROM VWUSUARIOS u LEFT JOIN ACESSO a ON a.USUARIO=u.CODIGO
      WHERE u.ATIVO='S' AND LOWER(TRIM(u.LOGIN))='${fbEsc(l)}'`);
  } catch (e) { r = { ok: false, err: e.message }; }
  // Consumer fora do ar não pode derrubar o caixa inteiro: se o login é nosso,
  // ele entra do mesmo jeito.
  if (!r.ok) {
    const loc = await permsLocal(l);
    if (loc) return loc;
    throw new Error('cadastro de usuários indisponível: ' + r.err);
  }
  if (!r.rows.length) {
    const loc = await permsLocal(l);
    return loc || { ok: false };
  }
  const admin = String(r.rows[0].TIPO || '').trim().toUpperCase() === 'ADMINISTRADOR';
  const perms = new Set(r.rows.map((x) => Number(x.PERMISSAO)).filter(Boolean));
  const tem = (cod) => admin || perms.has(cod);
  return { ok: true, login: l, nome: T(r.rows[0].NOME) || l, admin,
    caixa: tem(PERM_CAIXA), desconto: tem(PERM_DESCONTO), fiado: tem(PERM_FIADO),
    abrir: tem(PERM_ABRIR_COMPLETO) || tem(PERM_ABRIR_SIMPLES),
    movimentar: tem(PERM_ABRIR_COMPLETO) || tem(PERM_MOVIMENTO),
    transferir: tem(PERM_TRANSFERIR),
    divergente: tem(PERM_ABRIR_COMPLETO) || tem(PERM_DIVERGENTE),
    pedidos: tem(PERM_PEDIDO_CAIXA),
    excluir_item: tem(PERM_EXCLUIR_ITEM), excluir_pedido: tem(PERM_EXCLUIR_PEDIDO) };
}
async function caixaDaRequisicao(req, u) {
  const tok = (req.headers['x-garcom'] || (u && u.searchParams.get('t')) || '').toString();
  const v = garcomVerificaToken(tok);
  if (!v) return null;
  try { const p = await permsDoUsuario(v.login); return (p.ok && p.caixa) ? p : null; }
  catch { return null; } // Firebird fora: melhor barrar o caixa do que liberar errado
}
async function apiCaixaSessao(req, u) {
  const p = await caixaDaRequisicao(req, u);
  return p ? { ok: true, login: p.login, nome: p.nome, pode_desconto: p.desconto, pode_fiado: p.fiado,
    admin: p.admin, pode_abrir: p.abrir, pode_divergente: p.divergente, pode_mov: p.movimentar, pode_transf: p.transferir,
    pode_lancar: p.pedidos, pode_canc_item: p.excluir_item, pode_canc_pedido: p.excluir_pedido } : { ok: false };
}
async function apiCaixaEntrar(body) {
  const login = String(body.login || '').trim().toLowerCase();
  const pin = String(body.pin || '').replace(/\D/g, '');
  if (!login) return { ok: false, erro: 'informe o login' };
  if (!(pin.length >= 4 && pin.length <= 8)) return { ok: false, erro: 'o PIN tem de 4 a 8 números' };
  let p;
  try { p = await permsDoUsuario(login); } catch (e) { return { ok: false, erro: e.message }; }
  if (!p.ok || !p.caixa) return { ok: false, erro: 'Este login não tem acesso ao caixa. Fale com o gerente.' };
  const atual = (await sql`SELECT pin_hash, salt FROM garcom_pin WHERE login=${login}`)[0];
  if (!atual) {
    const pin2 = String(body.pin2 || '').replace(/\D/g, '');
    if (!pin2) return { ok: true, primeira_vez: true, nome: p.nome };
    if (pin2 !== pin) return { ok: false, primeira_vez: true, erro: 'os dois PINs não são iguais' };
    const salt = randomBytes(16).toString('hex');
    await sql`INSERT INTO garcom_pin (login, pin_hash, salt, nome) VALUES (${login}, ${pinHash(pin, salt)}, ${salt}, ${p.nome})
      ON CONFLICT (login) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, salt=EXCLUDED.salt, nome=EXCLUDED.nome, atualizado_em=now()`;
    return { ok: true, token: garcomGeraToken(login), nome: p.nome, admin: p.admin, pode_desconto: p.desconto, pode_fiado: p.fiado, pode_abrir: p.abrir, pode_divergente: p.divergente, pode_mov: p.movimentar, pode_transf: p.transferir, pode_lancar: p.pedidos, pode_canc_item: p.excluir_item, pode_canc_pedido: p.excluir_pedido, criado: true };
  }
  if (!pinConfere(pin, atual.salt, atual.pin_hash)) return { ok: false, erro: 'PIN incorreto' };
  return { ok: true, token: garcomGeraToken(login), nome: p.nome, admin: p.admin, pode_desconto: p.desconto, pode_fiado: p.fiado, pode_abrir: p.abrir, pode_divergente: p.divergente, pode_mov: p.movimentar, pode_transf: p.transferir, pode_lancar: p.pedidos, pode_canc_item: p.excluir_item, pode_canc_pedido: p.excluir_pedido };
}
// Conta do CAIXA: números REAIS do pedido (VALORTOTAL já reflete desconto e
// acréscimo), não a estimativa do espelho. Itens vêm do espelho só pra mostrar.
/* ---- FIADO NO CUPOM DA CONTA ----
   Pedido do dono (22/08): quando o cliente pede a conta e tem fiado, o
   cuponzinho tem que mostrar o saldo dele — é o papel que ele ASSINA, então
   ele precisa ver o que já devia, o que está assinando agora, e como fica.
   Só aparece pra quem TEM conta corrente: cliente comum não vê nada disso. */
async function clienteDaConta(numero, ped) {
  // 1º o carimbo no próprio pedido (CODIGOCONTATOCLIENTE) — é o mais forte
  let cod = null;
  if (!nativo() && ped) {
    try {
      const r = await qi(`SELECT COALESCE(CODIGOCONTATOCLIENTE,0) C FROM PEDIDOS WHERE CODIGO=${Number(ped)}`);
      const v = Number(r.ok && r.rows?.[0]?.C) || 0;
      if (v > 0) cod = v;
    } catch { /* FB instável: tenta o caminho local abaixo */ }
  }
  // 2º a identificação da mesa aqui do lado
  if (!cod) {
    const i = (await sql`SELECT contato_fb FROM identificacao
      WHERE numero=${Number(numero)} AND fechada_em IS NULL AND contato_fb IS NOT NULL
      ORDER BY criado_em DESC LIMIT 1`)[0];
    if (i?.contato_fb) cod = Number(i.contato_fb);
  }
  if (!cod) {
    const m = (await sql`SELECT contato_fb FROM mesa_comanda
      WHERE comanda=${Number(numero)} AND fechada_em IS NULL AND contato_fb IS NOT NULL LIMIT 1`)[0];
    if (m?.contato_fb) cod = Number(m.contato_fb);
  }
  return cod;
}
/** O bloco de fiado do cupom. null = não mostra nada (o normal). */
async function fiadoDaConta(numero, ped, aPagar) {
  try {
    const cod = await clienteDaConta(numero, ped);
    if (!cod) return null;
    const cli = await fbClienteFiado(cod);
    if (!cli) return null;
    // sem conta corrente e sem saldo = cliente comum, não polui o cupom
    if (!cli.habilitado && Math.abs(cli.saldo) < 0.009) return null;
    const conta = Math.max(0, Number(aPagar) || 0);
    const depois = +(cli.saldo + conta).toFixed(2);
    return { nome: cli.nome, saldo: cli.saldo, limite: cli.limite,
      disponivel: cli.disponivel, conta, depois,
      estoura: cli.limite > 0 && depois > cli.limite + 0.009, bloqueia: cli.bloqueia };
  } catch (e) { console.error('[fiado-cupom] ' + e.message); return null; }
}

/** A conta de um pedido do iFood no caixa.
 *
 *  Ele NÃO existe no Firebird — nasce da nossa integração e vive só aqui, com
 *  código negativo. Por isso não passa pelo pedidoAlvo(): o caixa abre, vê os
 *  itens e o total, e não tem o que receber (o cliente já pagou no app). É
 *  informação, não caixa. */
async function contaIfoodCaixa(ped) {
  const [p] = await sql`SELECT * FROM ifood_pedido WHERE seq=${-Number(ped)}`;
  if (!p) return { ok: false, erro: 'pedido do iFood não encontrado' };
  const itens = await sql`SELECT * FROM ifood_item WHERE pedido_id=${p.id} ORDER BY seq`;
  const agora = Date.now();
  const t0 = new Date(p.criado_em || p.recebido_em).getTime();
  const total = Number(p.total || 0);
  const pago = p.pago_online ? total : 0;
  return {
    ok: true, numero: 0, ped, canal: 'ifood',
    nome: 'iFood #' + (p.display_id || '') + (p.cliente_nome ? ' · ' + p.cliente_nome : ''),
    ifood: {
      id: p.id, display_id: p.display_id, status: p.status,
      cliente: p.cliente_nome, fone: p.cliente_fone, endereco: p.endereco,
      pago_online: !!p.pago_online, modo_entrega: p.modo_entrega,
      confirmado: !!p.confirmado_em, despachado: !!p.despachado_em,
    },
    comandas_mesa: [], geral: null,
    itens: itens.map((i) => ({
      item_codigo: -Number(i.item_codigo), tipo: 1, codigo_pai: null,
      nome: i.nome, quantidade: Number(i.quantidade) || 0, valor_total: Number(i.valor_total) || 0,
      detalhes: i.detalhes, status: null, quem: 'iFood',
      espera_min: Math.max(0, Math.round((agora - t0) / 60000)), esperando: !p.despachado_em, atrasado: false,
    })),
    subtotal: +(total - Number(p.taxa_entrega || 0)).toFixed(2), servico: 0,
    desconto: 0, acrescimo: Number(p.taxa_entrega || 0),
    total, pago, falta: Math.max(0, +(total - pago).toFixed(2)),
  };
}

async function apiCaixaConta(n, pedRaw) {
  // código negativo = pedido do iFood (o Firebird só tem positivo)
  if (Number(pedRaw) < 0) return contaIfoodCaixa(pedRaw);
  const num = Number(n);
  const agora = Date.now();
  const ped = await pedidoAlvo(num, pedRaw);
  if (!ped) return { ok: false, erro: 'não há conta aberta no número ' + num };
  // mesa aberta pelo Consumer pode chegar aqui sem os 10%: garante na entrada
  await fbAplicarServico(ped).catch(() => {});
  const p = (await qi(`SELECT VALORTOTALITENS I, TOTALSERVICO S, TOTALDESCONTO D, TOTALACRESCIMO A, VALORTOTAL T, TRIM(COALESCE(NOME,'')) NOME FROM PEDIDOS WHERE CODIGO=${ped}`)).rows?.[0] || {};
  const pago = await fbPagoDoPedido(ped);
  const total = Number(p.T) || 0;
  const c = (await sql`SELECT codigo FROM comanda WHERE numero=${num} LIMIT 1`)[0];
  // status efetivo (Consumer OU baixa do KDS) vai junto: cancelar item pronto/
  // entregue muda de liturgia na tela (dupla senha)
  // complementos (tipo 2) VÊM JUNTO: o caixa precisa ver "com gelo"/"1 copo"
  // pendurados no prato — sem eles a conta parecia só "os itens secos"
  // TEMPO DE ESPERA POR ITEM (pedido do dono, 22/08): o caixa conferindo a
  // conta com o cliente na frente precisa saber há quanto tempo cada coisa foi
  // pedida. Entregue = quanto o cliente ESPEROU de verdade; não entregue = o
  // relógio ainda correndo. O limite é o da praça do item (praca_config).
  const itens = c ? await sql`SELECT ci.item_codigo, ci.codigo_pai, ci.tipo, ci.nome, ci.quantidade, ci.valor_total, ci.detalhes,
      -- quem lançou: o garçom do Consumer, ou quem estava logado na nossa tela
      COALESCE(NULLIF(ci.colaborador_nome,''), a.nome, a.login) AS quem,
      ci.criado,
      COALESCE(ci.entregue, k.entregue_em) AS entregue_em,
      COALESCE(pc.minutos, ${LIMITE_ATRASO_MIN})::int AS limite,
      CASE WHEN ci.entregue IS NOT NULL OR k.entregue_em IS NOT NULL THEN 'entregue'
           WHEN ci.produzido IS NOT NULL OR k.pronto_em IS NOT NULL THEN 'pronto'
           ELSE 'a_produzir' END AS status
    FROM comanda_item ci LEFT JOIN marca k ON k.item_codigo = ci.item_codigo
    LEFT JOIN item_autor a ON a.item_codigo = ci.item_codigo
    LEFT JOIN praca_config pc ON pc.area_codigo = ci.area_codigo
    WHERE ci.comanda_codigo=${c.codigo} ORDER BY ci.criado NULLS LAST, ci.id` : [];
  const ident = (await sql`SELECT nome_curto FROM identificacao WHERE numero=${num} AND fechada_em IS NULL`)[0];
  // COMANDAS DA MESA vêm JUNTO (atômico): o refresher de 10s substitui a CONTA
  // inteira — enriquecer no cliente fazia as comandas piscarem e sumirem.
  let comandasMesa = null, geral = null;
  if (num < COMANDA_DE) {
    const vinc = await sql`SELECT comanda, nome_curto FROM mesa_comanda WHERE mesa=${num} AND fechada_em IS NULL ORDER BY comanda`;
    if (vinc.length) {
      comandasMesa = [];
      geral = Math.max(0, +(total - pago).toFixed(2));
      for (const v of vinc) {
        const cn = Number(v.comanda);
        let totC = 0, pagoC = 0;
        try {
          const pedC = await fbAcharPedido(cn);
          if (pedC) {
            totC = (await pedTotais(pedC))?.total || 0;
            pagoC = await fbPagoDoPedido(pedC);
          }
        } catch { /* FB instável: mostra a comanda sem valores */ }
        const resta = Math.max(0, +(totC - pagoC).toFixed(2));
        const idc = (await sql`SELECT nome_curto FROM identificacao WHERE numero=${cn} AND fechada_em IS NULL`)[0];
        comandasMesa.push({ numero: cn, nome: idc?.nome_curto || v.nome_curto || null, resta, quitada: resta <= 0.009 && totC > 0 });
        geral = +(geral + resta).toFixed(2);
      }
    }
  }
  return { ok: true, numero: num, nome: ident?.nome_curto || (p.NOME || null),
    comandas_mesa: comandasMesa, geral,
    itens: itens.map((i) => {
      // minutos entre lançar e entregar; sem entrega ainda, conta até agora
      const t0 = i.criado ? new Date(i.criado).getTime() : null;
      const t1 = i.entregue_em ? new Date(i.entregue_em).getTime() : agora;
      const min = t0 ? Math.max(0, Math.round((t1 - t0) / 60000)) : null;
      const esperando = !i.entregue_em;
      return { item_codigo: Number(i.item_codigo) || null, tipo: Number(i.tipo) || 1,
        codigo_pai: i.codigo_pai != null ? Number(i.codigo_pai) : null, nome: i.nome,
        quantidade: Number(i.quantidade) || 0, valor_total: Number(i.valor_total) || 0,
        detalhes: i.detalhes, status: i.status,
        // 👤 quem lançou: a consulta já buscava e o retorno JOGAVA FORA — o
        // nome nunca chegou na tela desde que a coluna foi criada.
        quem: i.quem || null,
        espera_min: min, esperando, atrasado: esperando && min != null && min > (Number(i.limite) || 0) };
    }),
    subtotal: Number(p.I) || 0, servico: Number(p.S) || 0, desconto: Number(p.D) || 0, acrescimo: Number(p.A) || 0,
    total, pago: +pago.toFixed(2), falta: Math.max(0, +(total - pago).toFixed(2)) };
}
// Desconto/acréscimo SEGURO: ajusta o VALORTOTAL pelo delta exato e registra em
// TOTALDESCONTO/TOTALACRESCIMO. Fica consistente com o total do Consumer sem
// depender de recalcular a fórmula inteira (que não é limpa — serviço/entrega
// interagem de formas diferentes por pedido). Só mexe nos campos do delta.
async function apiCaixaAjuste(body, quem) {
  const n = Number(body.numero);
  const tipo = String(body.tipo || '');
  const modo = String(body.modo || 'valor');
  // desconto E acréscimo caem na MESMA permissão do Consumer: 12 = "Aplicar
  // Descontos / Modificar Taxas" (acréscimo é mexer em taxa). Sem a trava,
  // qualquer login de caixa alterava o total da conta.
  if (!(quem && quem.desconto)) return { ok: false, erro: 'sem permissão (Aplicar Descontos / Modificar Taxas)' };
  const ped = await pedidoAlvo(n, body.ped);
  if (!ped) return { ok: false, erro: 'comanda não está aberta' };
  const p = await pedTotais(ped);
  if (!p) return { ok: false, erro: 'pedido não encontrado' };
  const itens = p.itens, total = p.total;
  if (tipo === 'desconto') {
    let delta = modo === 'pct' ? +(itens * (Number(body.valor) || 0) / 100).toFixed(2) : +Number(body.valor || 0).toFixed(2);
    if (modo === 'pct' && !((Number(body.valor) || 0) > 0 && (Number(body.valor) || 0) <= 100)) return { ok: false, erro: 'percentual inválido (1 a 100)' };
    if (!(delta > 0)) return { ok: false, erro: 'valor inválido' };
    if (delta > total + 0.01) return { ok: false, erro: `desconto maior que o total (R$ ${total.toFixed(2)})` };
    const novoDesc = +(p.desconto + delta).toFixed(2);
    const novoTot = +(total - delta).toFixed(2);
    const pct = itens > 0 ? +(novoDesc / itens * 100).toFixed(2) : 0;
    const ok = await pedGravarTotais(ped, { desconto: novoDesc, pctDesconto: pct, total: novoTot });
    if (!ok) return { ok: false, erro: 'não deu pra gravar o desconto' };
    espelho().catch(() => {});
    return { ok: true, tipo, delta, novo_total: novoTot };
  }
  if (tipo === 'acrescimo') {
    const delta = +Number(body.valor || 0).toFixed(2);
    if (!(delta > 0)) return { ok: false, erro: 'valor inválido' };
    const novoAcr = +(p.acrescimo + delta).toFixed(2);
    const novoTot = +(total + delta).toFixed(2);
    const ok = await pedGravarTotais(ped, { acrescimo: novoAcr, total: novoTot });
    if (!ok) return { ok: false, erro: 'não deu pra gravar o acréscimo' };
    espelho().catch(() => {});
    return { ok: true, tipo, delta, novo_total: novoTot };
  }
  return { ok: false, erro: 'tipo inválido' };
}

// ---- CANCELAMENTO no caixa (excluir item / pedido inteiro) ----
// Permissões do Consumer: 22 = Excluir Item, 28 = Excluir Pedido (na 0003 a 28
// é só da LILIAN). Item que JÁ ESTÁ pronto ou entregue exige DUAS senhas: o
// PIN do caixa logado + o PIN de um GERENTE (Administrador ou quem tem a 28);
// se o próprio caixa já é gerente, o PIN dele cobre as duas figuras.
// O Consumer só carimba DATADELETE; total sai por DELTA (nunca refaz a fórmula
// — mesma regra do desconto). Estorno de pagamento (31) NÃO acontece aqui:
// cancelar jamais deixa o total abaixo do que já entrou.
async function statusDoItem(item) {
  const fb = (await qi(`SELECT DATAHORAPRODUZIDO P, DATAHORAENTREGUE E FROM ITENSPEDIDO WHERE CODIGO=${Number(item)}`)).rows?.[0] || {};
  const mk = (await sql`SELECT pronto_em, entregue_em FROM marca WHERE item_codigo=${Number(item)}`)[0] || {};
  return (fb.E || mk.entregue_em) ? 'entregue' : (fb.P || mk.pronto_em) ? 'pronto' : 'a_produzir';
}
/** Valida a dupla senha. Devolve o login do gerente que autorizou, ou {erro}. */
async function validarDuplaSenha(body, quem, status) {
  const pinCx = String(body.caixa_pin || '').replace(/\D/g, '');
  if (!pinCx) return { precisa: true, erro: 'Item já ' + status + ' — digite o SEU PIN e a autorização do gerente.' };
  const meu = (await sql`SELECT pin_hash, salt FROM garcom_pin WHERE login=${quem.login}`)[0];
  if (!meu || !pinConfere(pinCx, meu.salt, meu.pin_hash)) return { precisa: true, erro: 'O seu PIN não confere.' };
  if (quem.admin || quem.excluir_pedido) return { gerente: quem.login }; // o caixa JÁ é gerente
  const gl = String(body.gerente_login || '').trim().toLowerCase();
  const gp = String(body.gerente_pin || '').replace(/\D/g, '');
  if (!gl || !gp) return { precisa: true, erro: 'Falta a autorização do gerente.' };
  const gpin = (await sql`SELECT pin_hash, salt FROM garcom_pin WHERE login=${gl}`)[0];
  if (!gpin || !pinConfere(gp, gpin.salt, gpin.pin_hash)) return { precisa: true, erro: 'PIN do gerente não confere.' };
  let g; try { g = await permsDoUsuario(gl); } catch (e) { return { erro: 'não deu pra validar o gerente: ' + e.message }; }
  if (!(g.ok && (g.admin || g.excluir_pedido))) return { precisa: true, erro: gl + ' não é gerente (precisa de Administrador ou Excluir Pedido no Consumer).' };
  return { gerente: gl };
}
/** Aviso no papel pra praça quando o cupom do item já tinha saído. */
async function cupomCancelado(itens, numero) {
  try {
    const modo = await cfgGet('producao_modo', 'kds');
    if (modo !== 'ambos' && modo !== 'impressora') return;
    const ipGeral = (await cfgGet('impressora_ip', '')).trim();
    const porPraca = new Map((await sql`SELECT area_codigo, ip FROM praca_impressora`)
      .map((r) => [Number(r.area_codigo), String(r.ip).trim()]).filter(([, v]) => v));
    const cods = itens.map((i) => Number(i.item_codigo)).filter(Boolean);
    if (!cods.length) return;
    const ja = await sql`SELECT item_codigo FROM comanda_impressa WHERE item_codigo = ANY(${cods})`;
    const jaSet = new Set(ja.map((x) => Number(x.item_codigo)));
    const grupos = new Map();
    for (const it of itens) {
      if (!jaSet.has(Number(it.item_codigo))) continue;
      const k = it.area_codigo ?? 's';
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(it);
    }
    for (const g of grupos.values()) {
      const ip = porPraca.get(Number(g[0].area_codigo)) || ipGeral;
      if (!ip) continue;
      const b = [IMP.init, IMP.centro, IMP.neg, IMP.grande, impLn('** CANCELADO **'), IMP.norm, IMP.negFim, IMP.esquerda, impTraco(),
        IMP.neg, IMP.grande, impLn(impRotulo(numero, null)), IMP.norm, IMP.negFim, impLn(impHm()), impTraco()];
      for (const it of g) b.push(IMP.neg, IMP.alto, impLn(impQtd(it.quantidade) + ' ' + (it.nome || '')), IMP.norm, IMP.negFim);
      b.push(impTraco(), IMP.neg, impLn('NÃO PRODUZIR / TIRAR DA FILA'), IMP.negFim, IMP.corte);
      await imprimirRaw(ip, Buffer.concat(b), 'cancelado ' + numero);
    }
  } catch (e) { console.error('[impressora] cancelado:', e.message); }
}
/** "Devolução" = o produto voltou fisicamente (garrafa, lata) — é o único
 *  motivo que exige FOTO do produto devolvido (regra do dono, 22/08/2026).
 *  Reclamação do cliente ou "tira da conta" seguem sem foto. */
function ehDevolucao(motivo) { return /^devolu/i.test(String(motivo || '').trim()); }
async function apiCaixaCancelarItem(body, quem) {
  if (!(quem && quem.excluir_item)) return { ok: false, erro: 'sem permissão (Excluir Item do Pedido)' };
  const numero = Number(body.numero), item = Number(body.item_codigo);
  if (!(numero > 0 && item > 0)) return { ok: false, erro: 'dados inválidos' };
  const ped = await pedidoAlvo(numero, body.ped);
  if (!ped) return { ok: false, erro: 'não há pedido aberto nesse número' };
  const p = await pedTotais(ped);
  if (!p) return { ok: false, erro: 'pedido não encontrado' };
  const status = await statusDoItem(item);
  let gerente = null;
  if (status !== 'a_produzir') {
    const v = await validarDuplaSenha(body, quem, status);
    if (!v.gerente) return { ok: false, precisa_gerente: !!v.precisa, status, erro: v.erro };
    gerente = v.gerente;
  }
  // DEVOLUÇÃO: só com a foto do produto devolvido — do celular (token do QR,
  // mesmo caminho do comprovante) ou da câmera do tablet (dataUrl).
  let foto = null;
  if (ehDevolucao(body.motivo)) {
    if (body.token) {
      const st = await apiComprovanteStatus(body.token, numero, 'devolucao');
      if (st.ok && st.arquivo) {
        foto = st.arquivo;
        await sql`UPDATE comprovante_token SET usado_em=now() WHERE token=${String(st.token || body.token)}`;
      }
    } else if (body.foto) {
      foto = guardaFoto(body.foto);
    }
    if (!foto) return { ok: false, precisa_foto: true, erro: 'devolução exige a foto do produto devolvido (garrafa, lata…)' };
  }
  const alvos = await itensDoPedido(ped, { alvo: item });
  const principal = alvos.find((x) => x.codigo === item);
  if (!principal) return { ok: false, erro: 'esse item não está mais na conta' };
  // CANCELAMENTO PARCIAL: "lancei 5, cancela 2" — a linha continua com 3.
  // body.qtd = quantas unidades cancelar; ausente/maior que a linha = tudo.
  const qtdLinha = principal.quantidade || 1;
  const qtdCanc = Math.min(qtdLinha, Math.max(1, Math.round(Number(body.qtd) || qtdLinha)));
  const parcial = qtdCanc < qtdLinha && Number.isInteger(qtdLinha);
  const valorLinha = principal.valor || 0;
  const valor = parcial
    ? +(valorLinha * (qtdCanc / qtdLinha)).toFixed(2)
    : alvos.reduce((s, x) => s + (x.valor || 0), 0);
  const pago = await fbPagoDoPedido(ped);
  // serviço aplicado NÃO trava mais o cancelamento (a conta pedida tem os 10%
  // e a mesa continua ABERTA — travar aqui era só atrito): o item leva junto a
  // fatia PROPORCIONAL do serviço, por delta — a fórmula nunca é refeita.
  const itensAtual = p.itens, servAtual = p.servico;
  let servDelta = 0;
  if (servAtual > 0.009 && itensAtual > 0.009) {
    servDelta = +(valor * (servAtual / itensAtual)).toFixed(2);
    // cancelou o último item (ou arredondou além): zera o serviço sem sobra de centavos
    if (itensAtual - valor <= 0.009 || servDelta > servAtual) servDelta = servAtual;
  }
  const novoItens = +(itensAtual - valor).toFixed(2);
  const novoServ = +(servAtual - servDelta).toFixed(2);
  const novoTot = +(p.total - valor - servDelta).toFixed(2);
  if (novoTot < -0.009) return { ok: false, erro: 'cancelar esse item deixaria o total negativo (tem desconto — ajuste antes)' };
  if (novoTot + 0.009 < pago) return { ok: false, erro: `já entraram R$ ${pago.toFixed(2)} nessa conta — o total não pode ficar abaixo do pago (estorno é no Consumer)` };
  if (parcial) {
    // reduz a quantidade da linha; VALORITEM acompanha o VALORTOTAL (mesma
    // convenção do write-back). Filhos (respostas) ficam — valem pra linha.
    const resta = qtdLinha - qtdCanc;
    const novoVt = +(valorLinha - valor).toFixed(2);
    const rp = await itemMudarQtd(ped, item, resta, novoVt);
    if (!rp) return { ok: false, erro: 'não deu pra reduzir a quantidade' };
  } else {
    const rd = await itensCancelar(ped, item, quem.login);
    if (!rd) return { ok: false, erro: 'não deu pra excluir o item' };
  }
  const ru = await pedGravarTotais(ped, { itens: Math.max(0, novoItens),
    servico: Math.max(0, novoServ), total: Math.max(0, novoTot) });
  if (!ru) return { ok: false, erro: 'o item saiu, mas o total não atualizou' };
  const nomeLog = (parcial ? qtdCanc + ' de ' + qtdLinha + '× ' : '') + principal.nome;
  const areaRows = await sql`SELECT item_codigo, area_codigo, nome, quantidade FROM comanda_item
    WHERE item_codigo = ANY(${alvos.map((x) => x.codigo)})`;
  // praça do item que saiu: o aviso acende só na cozinha dona dele
  const areaCanc = areaRows.find((a) => Number(a.item_codigo) === item)?.area_codigo ?? null;
  await sql`INSERT INTO cancelamento (login, gerente, numero, pedido_fb, item_codigo, nome, valor, status_item, motivo, area_codigo, foto)
    VALUES (${quem.login}, ${gerente}, ${numero}, ${ped}, ${item}, ${nomeLog}, ${valor}, ${status}, ${T(body.motivo)}, ${areaCanc == null ? null : Number(areaCanc)}, ${foto})`;
  cupomCancelado(parcial
    ? areaRows.filter((a) => Number(a.item_codigo) === item).map((a) => ({ ...a, nome: a.nome, quantidade: qtdCanc }))
    : areaRows, numero).catch(() => {});
  espelho().catch(() => {});
  return { ok: true, valor, status, parcial, qtd_cancelada: qtdCanc, restam: parcial ? qtdLinha - qtdCanc : 0,
    servico_removido: servDelta, novo_total: Math.max(0, novoTot) };
}
/** Desbloqueio da tela do caixa: valida SÓ o PIN de quem já está logado
 *  (o token continua o mesmo — o bloqueio é pra caixa largado, não logout). */
async function apiCaixaDesbloquear(body, quem) {
  const pin = String(body.pin || '').replace(/\D/g, '');
  if (!pin) return { ok: false, erro: 'digite o PIN' };
  const reg = (await sql`SELECT pin_hash, salt FROM garcom_pin WHERE login=${quem.login}`)[0];
  if (!reg || !pinConfere(pin, reg.salt, reg.pin_hash)) return { ok: false, erro: 'PIN não confere' };
  return { ok: true };
}
/** Destrava os botões de cancelar na tela (a "dificuldade" pedida pelo dono):
 *  os ✕ ficam ESCONDIDOS até um GERENTE (Administrador ou Excluir Pedido)
 *  autorizar com o PIN — caixa comum chama o gerente; caixa que já é gerente
 *  usa o próprio PIN. O server só valida; quem lembra do destrave é a tela. */
async function apiCaixaLiberarCancel(body, quem) {
  if (!(quem && quem.excluir_item)) return { ok: false, erro: 'sem permissão de cancelar (Excluir Item do Pedido)' };
  const souGerente = !!(quem.admin || quem.excluir_pedido);
  const gerente = souGerente ? quem.login : String(body.gerente_login || '').trim().toLowerCase();
  const pin = String(body.pin || '').replace(/\D/g, '');
  if (!gerente || !pin) return { ok: false, erro: 'informe login e PIN de quem autoriza' };
  const reg = (await sql`SELECT pin_hash, salt FROM garcom_pin WHERE login=${gerente}`)[0];
  if (!reg || !pinConfere(pin, reg.salt, reg.pin_hash)) return { ok: false, erro: 'PIN não confere' };
  if (!souGerente) {
    let g; try { g = await permsDoUsuario(gerente); } catch (e) { return { ok: false, erro: 'não deu pra validar o gerente: ' + e.message }; }
    if (!(g.ok && (g.admin || g.excluir_pedido))) return { ok: false, erro: gerente + ' não pode autorizar (precisa Administrador ou Excluir Pedido)' };
  }
  return { ok: true, autorizou: gerente };
}
async function apiCaixaCancelarPedido(body, quem) {
  if (!(quem && quem.excluir_pedido)) return { ok: false, erro: 'sem permissão (Excluir Pedido)' };
  const numero = Number(body.numero);
  if (!(numero > 0)) return { ok: false, erro: 'número inválido' };
  const ped = await pedidoAlvo(numero, body.ped);
  if (!ped) return { ok: false, erro: 'não há pedido aberto nesse número' };
  const pago = await fbPagoDoPedido(ped);
  if (pago > 0.009) return { ok: false, erro: `essa conta já tem R$ ${pago.toFixed(2)} pagos — estorno é no Consumer, aqui não` };
  const tot = (await pedTotais(ped))?.total || 0;
  // o aviso pras praças sai ANTES do pedido sumir do espelho
  const vivos = await sql`SELECT ci.item_codigo, ci.area_codigo, ci.nome, ci.quantidade FROM comanda_item ci
    JOIN comanda c ON c.codigo = ci.comanda_codigo
    WHERE c.numero=${numero} AND ci.tipo IS DISTINCT FROM 2 AND ci.produzido IS NULL AND ci.entregue IS NULL`;
  const rd = await pedApagar(ped);
  if (!rd) return { ok: false, erro: 'não deu pra excluir o pedido' };
  await sql`INSERT INTO cancelamento (login, gerente, numero, pedido_fb, item_codigo, nome, valor, status_item, motivo)
    VALUES (${quem.login}, ${quem.login}, ${numero}, ${ped}, ${null}, ${'PEDIDO INTEIRO'}, ${tot}, ${'pedido'}, ${T(body.motivo)})`;
  cupomCancelado(vivos, numero).catch(() => {});
  espelho().catch(() => {});
  return { ok: true, valor: tot };
}
/** Relatório de controle: o que foi cancelado, por quem, autorizado por quem. */
async function apiCaixaCancelamentos() {
  const rows = await sql`SELECT quando, login, gerente, numero, nome, valor, status_item, motivo
    FROM cancelamento WHERE quando > now() - interval '30 days' ORDER BY quando DESC LIMIT 200`;
  return { ok: true, cancelamentos: rows };
}
// Fecha o pedido DO JEITO QUE O CONSUMER FECHA — conferido em pedidos reais
// fechados pelo próprio Consumer na 0003: fechar = gravar DATAFECHAMENTO
// (CONTASOLICITADA volta pra 'N'; SUBTOTALPAGO/VALORTROCO ficam como estão).
// A quitação é responsabilidade do CHAMADOR — aqui só se fecha.
async function fbFecharPedido(ped) {
  if (nativo()) return pgFecharPedido(ped);
  const r = await qi(`UPDATE PEDIDOS SET DATAFECHAMENTO=CURRENT_TIMESTAMP, CONTASOLICITADA='N' WHERE CODIGO=${ped} AND DATAFECHAMENTO IS NULL`);
  if (!r.ok) throw new Error('FB fechar: ' + r.err);
}
// Fechar a conta é o ato final do caixa: o pedido sai das listas (garçom,
// caixa, Consumer) e a mesa fica livre pro próximo cliente. Só com a conta
// QUITADA — receber dinheiro é outra rota; esta não movimenta valor nenhum.
async function apiCaixaFechar(nRaw, pedRaw) {
  const n = Number(nRaw);
  const ped = await pedidoAlvo(n, pedRaw);
  if (!ped) return { ok: false, erro: 'comanda não está aberta' };
  const total = (await pedTotais(ped))?.total || 0;
  const pago = await fbPagoDoPedido(ped);
  const falta = +(total - pago).toFixed(2);
  if (falta > 0.01) return { ok: false, erro: `ainda falta R$ ${falta.toFixed(2)} — receba antes de fechar` };
  await fbFecharPedido(ped);
  // A NOTA NÃO SAI SOZINHA (decisão do dono): fechar libera a mesa e a tela
  // PERGUNTA se emite — nem toda conta leva nota, e emitir sem pedir tira a
  // escolha de quem está no caixa. Quem oferece é o nfceOferecer da tela.
  // fecha o lado local na hora (o espelho faria isso no próximo ciclo)
  await sql`UPDATE mesa_comanda SET fechada_em=now() WHERE comanda=${n} AND fechada_em IS NULL`;
  await sql`UPDATE identificacao SET fechada_em=now() WHERE numero=${n} AND fechada_em IS NULL`;
  espelho().catch(() => {});
  return { ok: true, fechada: true };
}

// ---- CONTROLE DE CAIXA: abertura/fechamento diário + relatório ----
// O Consumer trabalha com UM CAIXA POR OPERADOR/TURNO (conferido no banco da
// 0003): CAIXA(CODIGOUSUARIO, DATAABERTURA, SALDOINICIAL=fundo de troco,
// DATAFECHAMENTO, SALDOFINAL=esperado, SALDOFINALINFORMADO=contado,
// OBSERVACAO "Aberto às HH:MM por NOME"). Replicamos exatamente esse formato.
function fbHoraLocal() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Maceio' });
}
async function fbUsuarioCodigo(login) {
  const r = await qi(`SELECT FIRST 1 CODIGO, TRIM(COALESCE(NOME,'')) NOME FROM VWUSUARIOS WHERE ATIVO='S' AND LOWER(TRIM(LOGIN))='${fbEsc(String(login || '').toLowerCase())}'`);
  if (!r.ok || !r.rows.length) return null;
  return { codigo: Number(r.rows[0].CODIGO), nome: T(r.rows[0].NOME) };
}
async function fbCaixaDoOperador(login) {
  if (nativo()) {
    // sem Consumer o caixa é do LOGIN — não existe CODIGOUSUARIO de lá
    const [c] = await sql`SELECT codigo, aberto_em, COALESCE(fundo,0) fundo FROM caixa_local
      WHERE lower(login)=${String(login || '').toLowerCase()} AND fechado_em IS NULL ORDER BY codigo DESC LIMIT 1`;
    if (!c) return null;
    return { codigo: Number(c.codigo), desde: c.aberto_em, fundo: Number(c.fundo) || 0,
      usuario: { codigo: null, nome: login, login } };
  }
  const u = await fbUsuarioCodigo(login);
  if (!u) return null;
  const r = await qi(`SELECT FIRST 1 CODIGO, DATAABERTURA, SALDOINICIAL FROM CAIXA WHERE CODIGOUSUARIO=${u.codigo} AND DATAFECHAMENTO IS NULL ORDER BY CODIGO DESC`);
  if (!r.ok || !r.rows.length) return null;
  return { codigo: Number(r.rows[0].CODIGO), desde: r.rows[0].DATAABERTURA, fundo: Number(r.rows[0].SALDOINICIAL) || 0, usuario: u };
}
async function fbAbrirCaixa(usuarioCodigo, fundo, obs, login = null) {
  if (nativo()) {
    const cod = await proxCodigo('caixa');
    await sql`INSERT INTO caixa_local (codigo, login, usuario_codigo, aberto_em, fundo, obs)
      VALUES (${cod}, ${login || (usuarioCodigo == null ? 'ser' : String(usuarioCodigo))},
        ${usuarioCodigo == null ? null : Number(usuarioCodigo)}, now(), ${Number(fundo) || 0}, ${obs || null})`;
    return cod;
  }
  const r = await qi(`INSERT INTO CAIXA (CODIGOUSUARIO, DATAABERTURA, SALDOINICIAL, OBSERVACAO) VALUES (${usuarioCodigo}, CURRENT_TIMESTAMP, ${fbNum(fundo)}, '${fbEsc(obs)}')`);
  if (!r.ok) throw new Error('FB abrir caixa: ' + r.err);
  const g = await qi(`SELECT FIRST 1 CODIGO FROM CAIXA WHERE CODIGOUSUARIO=${usuarioCodigo} AND DATAFECHAMENTO IS NULL ORDER BY CODIGO DESC`);
  return g.ok && g.rows.length ? Number(g.rows[0].CODIGO) : null;
}
// "Saldo anterior" pra reabrir o caixa do operador: o MESMO fundo do último
// caixa dele (SALDOINICIAL), não o total do dia. Assim o fechamento bate (não
// carrega as vendas de ontem como fundo). 0 se ele nunca teve caixa.
async function fbSaldoAnterior(usuarioCodigo, login = null) {
  if (nativo()) {
    const [c] = await sql`SELECT COALESCE(fundo,0) f FROM caixa_local
      WHERE fechado_em IS NOT NULL AND (${login} IS NULL OR lower(login)=lower(${login}))
      ORDER BY codigo DESC LIMIT 1`;
    return c ? Number(c.f) || 0 : 0;
  }
  const r = await qi(`SELECT FIRST 1 COALESCE(SALDOINICIAL, 0) S FROM CAIXA
    WHERE CODIGOUSUARIO=${usuarioCodigo} AND DATAFECHAMENTO IS NOT NULL ORDER BY CODIGO DESC`);
  return r.ok && r.rows.length ? Number(r.rows[0].S) || 0 : 0;
}
// Caixa do operador pra RECEBER NA MAQUININHA:
//  - tem caixa aberto → usa ele (mas se estiver preso a OUTRA maquininha e o
//    serial vier diferente, BLOQUEIA: uma pessoa não recebe em 2 maquininhas);
//  - não tem → abre o DELE automaticamente com o saldo anterior de fundo.
// `terminal` (serial da maquininha) só vem quando o app manda; sem ele, não
// trava (mas o auto-abrir funciona igual).
async function fbCaixaMaquininha(login, terminal) {
  const term = String(terminal || '').trim();
  const meu = await fbCaixaDoOperador(login);
  if (meu) {
    if (term) {
      const [v] = await sql`SELECT terminal FROM caixa_maquininha WHERE caixa_codigo=${meu.codigo}`;
      if (v && v.terminal && v.terminal !== term)
        return { erro: 'Seu caixa está aberto em OUTRA maquininha. Feche o caixa lá antes de receber aqui.' };
      if (!v) await sql`INSERT INTO caixa_maquininha (caixa_codigo, terminal) VALUES (${meu.codigo}, ${term})
        ON CONFLICT (caixa_codigo) DO NOTHING`;
    }
    return { codigo: meu.codigo };
  }
  const u = await fbUsuarioCodigo(login);
  if (!u) return { codigo: null }; // sem usuário no Consumer: cai no caminho antigo ('ser')
  const fundo = await fbSaldoAnterior(u.codigo);
  const cod = await fbAbrirCaixa(u.codigo, fundo,
    `Aberto automaticamente às ${fbHoraLocal()} (maquininha ${login}${term ? ' ' + term : ''})`);
  if (cod && term) await sql`INSERT INTO caixa_maquininha (caixa_codigo, terminal) VALUES (${cod}, ${term})
    ON CONFLICT (caixa_codigo) DO NOTHING`;
  return { codigo: cod };
}
// Caixa pro pagamento ELETRÔNICO: o aberto que houver; sem nenhum, abre o do
// usuário "ser" (sistema) sozinho — a maquininha não pode travar por caixa.
async function fbCaixaAbertoOuSistema() {
  try { return await fbCaixaAberto(); } catch { /* nenhum aberto: abre o do sistema */ }
  if (nativo()) {
    const cod = await fbAbrirCaixa(null, 0,
      `Aberto automaticamente às ${fbHoraLocal()} (maquininha/Pix, sem caixa aberto)`, 'ser');
    if (cod == null) throw new Error('não consegui abrir o caixa automático');
    return cod;
  }
  // 'ser' é o usuário de sistema da Prainha — a Tabuará NÃO tem (conferido no
  // Consumer dela em 21/08). Sem esta reserva, cartão e Pix quebravam em toda
  // loja sem esse login, justamente quando não havia caixa aberto.
  let s = await qi(`SELECT FIRST 1 CODIGO FROM VWUSUARIOS WHERE LOWER(TRIM(LOGIN))='ser' AND ATIVO='S'`);
  if (!s.ok || !s.rows.length) {
    s = await qi(`SELECT FIRST 1 CODIGO FROM VWUSUARIOS WHERE ATIVO='S' ORDER BY CODIGO`);
  }
  if (!s.ok || !s.rows.length) throw new Error('nenhum caixa aberto e nenhum usuário ativo pra abrir um');
  const cod = await fbAbrirCaixa(Number(s.rows[0].CODIGO), 0, `Aberto automaticamente às ${fbHoraLocal()} (maquininha/Pix, sem caixa aberto)`);
  if (cod == null) throw new Error('não consegui abrir o caixa automático');
  return cod;
}
/** Fecha o caixa nos dois bancos. Idempotente: só fecha o que está aberto. */
async function caixaFecharNoBanco(cod, esperado, informado) {
  if (nativo()) {
    const r = await sql`UPDATE caixa_local SET fechado_em=now(), saldo_final=${+esperado},
        saldo_informado=${+informado} WHERE codigo=${Number(cod)} AND fechado_em IS NULL RETURNING codigo`;
    return { ok: r.length > 0 };
  }
  const up = await qi(`UPDATE CAIXA SET DATAFECHAMENTO=CURRENT_TIMESTAMP, SALDOFINAL=${fbNum(esperado)},
    SALDOFINALINFORMADO=${fbNum(informado)} WHERE CODIGO=${Number(cod)} AND DATAFECHAMENTO IS NULL`);
  return { ok: !!up.ok, err: up.err };
}
/** Caixas abertos agora — com quem abriu e desde quando. */
async function caixasAbertos() {
  if (nativo()) {
    const r = await sql`SELECT codigo, COALESCE(fundo,0) fundo, COALESCE(login,'?') quem,
        aberto_em::text abriu, obs FROM caixa_local WHERE fechado_em IS NULL ORDER BY codigo`;
    return r.map((x) => ({ codigo: Number(x.codigo), fundo: Number(x.fundo) || 0,
      quem: x.quem, abriu: x.abriu, obs: x.obs || '' }));
  }
  const r = await qi(`SELECT c.CODIGO, COALESCE(c.SALDOINICIAL,0) FUNDO, TRIM(COALESCE(u.NOME,u.LOGIN)) QUEM,
      CAST(c.DATAABERTURA AS VARCHAR(30)) ABRIU, CAST(c.OBSERVACAO AS VARCHAR(120)) OBS
    FROM CAIXA c LEFT JOIN VWUSUARIOS u ON u.CODIGO=c.CODIGOUSUARIO WHERE c.DATAFECHAMENTO IS NULL ORDER BY c.CODIGO`);
  if (!r.ok) return null;
  return (r.rows || []).map((x) => ({ codigo: Number(x.CODIGO), fundo: Number(x.FUNDO) || 0,
    quem: T(x.QUEM) || '?', abriu: T(x.ABRIU), obs: T(x.OBS) || '' }));
}
/** Fundo + observação de um caixa específico. */
async function caixaInfo(cod) {
  if (nativo()) {
    const [c] = await sql`SELECT COALESCE(fundo,0) fundo, obs FROM caixa_local WHERE codigo=${Number(cod)}`;
    return c ? { fundo: Number(c.fundo) || 0, obs: c.obs || '' } : null;
  }
  const r = await qi(`SELECT COALESCE(SALDOINICIAL,0) FUNDO, CAST(OBSERVACAO AS VARCHAR(120)) OBS
    FROM CAIXA WHERE CODIGO=${Number(cod)}`);
  if (!r.ok || !r.rows.length) return null;
  return { fundo: Number(r.rows[0].FUNDO) || 0, obs: T(r.rows[0].OBS) || '' };
}
/** O que passou pela GAVETA deste caixa (pra conferência do fechamento). */
async function fbResumoCaixa(caixaCodigo) {
  if (nativo()) {
    const [d] = await sql`SELECT COALESCE(SUM(valor),0) v FROM pagamento_local
      WHERE caixa_codigo=${Number(caixaCodigo)} AND forma_codigo=${FORMA.DINHEIRO} AND cancelado_em IS NULL`;
    const [m] = await sql`SELECT
        COALESCE(SUM(valor) FILTER (WHERE tipo='suprimento'),0) e,
        COALESCE(SUM(valor) FILTER (WHERE tipo <> 'suprimento'),0) s
      FROM caixa_operacao_local WHERE caixa_codigo=${Number(caixaCodigo)}`;
    return { dinheiro: Number(d.v) || 0, entradas: Number(m.e) || 0, saidas: Number(m.s) || 0 };
  }
  const din = await qi(`SELECT COALESCE(SUM(VALOR),0) V FROM PAGAMENTOS WHERE CODIGOCAIXA=${caixaCodigo} AND CODIGOFORMAPAGAMENTO=${FORMA.DINHEIRO} AND DATADELETE IS NULL`);
  const mov = await qi(`SELECT COALESCE(SUM(COALESCE(VALORENTRADA,0)),0) E, COALESCE(SUM(COALESCE(VALORSAIDA,0)),0) S FROM CAIXAOPERACAO WHERE CODIGOCAIXA=${caixaCodigo} AND DATADELETE IS NULL`);
  return { dinheiro: Number(din.rows?.[0]?.V) || 0, entradas: Number(mov.rows?.[0]?.E) || 0, saidas: Number(mov.rows?.[0]?.S) || 0 };
}
/** O que o SISTEMA registrou neste caixa, agrupado como o operador confere:
 *  dinheiro (gaveta), crédito e débito (vias da maquininha), Pix (extrato). */
async function fbResumoPorForma(caixaCodigo) {
  let por;
  if (nativo()) {
    const rows = await sql`SELECT forma_codigo f, COALESCE(SUM(valor),0) v, COUNT(*) n
      FROM pagamento_local WHERE caixa_codigo=${Number(caixaCodigo)} AND cancelado_em IS NULL
      GROUP BY forma_codigo`;
    por = new Map(rows.map((x) => [Number(x.f), { valor: Number(x.v) || 0, n: Number(x.n) || 0 }]));
  } else {
  const r = await qi(`SELECT CODIGOFORMAPAGAMENTO F, COALESCE(SUM(VALOR),0) V, COUNT(*) N
    FROM PAGAMENTOS WHERE CODIGOCAIXA=${caixaCodigo} AND DATADELETE IS NULL GROUP BY CODIGOFORMAPAGAMENTO`);
  por = new Map((r.rows || []).map((x) => [Number(x.F), { valor: Number(x.V) || 0, n: Number(x.N) || 0 }]));
  }
  const som = (...cods) => cods.reduce((t, c) => t + (por.get(c)?.valor || 0), 0);
  const cnt = (...cods) => cods.reduce((t, c) => t + (por.get(c)?.n || 0), 0);
  return {
    dinheiro: { valor: +som(FORMA.DINHEIRO).toFixed(2), n: cnt(FORMA.DINHEIRO) },
    credito: { valor: +som(FORMA.CREDITO).toFixed(2), n: cnt(FORMA.CREDITO) },
    debito: { valor: +som(FORMA.DEBITO).toFixed(2), n: cnt(FORMA.DEBITO) },
    pix: { valor: +som(FORMA.PIX_MANUAL, FORMA.PIX_ONLINE).toFixed(2), n: cnt(FORMA.PIX_MANUAL, FORMA.PIX_ONLINE) },
  };
}
async function apiCaixaEstado(quem) {
  const cx = await fbCaixaDoOperador(quem.login);
  if (!cx) return { ok: true, aberto: null };
  const r = await fbResumoCaixa(cx.codigo);
  const esperado = +(cx.fundo + r.dinheiro + r.entradas - r.saidas).toFixed(2);
  return { ok: true, aberto: { codigo: cx.codigo, desde: cx.desde, fundo: cx.fundo,
    dinheiro: +r.dinheiro.toFixed(2), entradas: r.entradas, saidas: r.saidas, esperado } };
}
async function apiCaixaAbrir(body, quem) {
  if (!quem.abrir) return { ok: false, erro: 'sem permissão de abrir caixa (Operação de caixa no Consumer)' };
  if (await fbCaixaDoOperador(quem.login)) return { ok: false, erro: 'você já tem um caixa aberto — feche antes de abrir outro' };
  const fundo = +Number(body.fundo || 0).toFixed(2);
  if (!(fundo >= 0)) return { ok: false, erro: 'fundo inválido' };
  const u = await fbUsuarioCodigo(quem.login);
  if (!u) return { ok: false, erro: 'não achei seu usuário no Consumer' };
  const cod = await fbAbrirCaixa(u.codigo, fundo, `Aberto às ${fbHoraLocal()} por ${u.nome || quem.nome}`);
  return { ok: true, codigo: cod, fundo };
}
/** Conferência do fechamento: recebe o que o operador CONTOU e devolve o
 *  comparativo. É o passo que dá controle — antes o caixa informava um número
 *  só, com o esperado já na tela (dava pra "bater" digitando o esperado).
 *  Aqui a declaração vem ANTES de ver o sistema, e forma a forma. */
function _decl(body) {
  const n = (v) => (v == null || v === '' ? null : +Number(v).toFixed(2));
  return { dinheiro: n(body.dinheiro), credito: n(body.credito), debito: n(body.debito), pix: n(body.pix) };
}
function _comparar(dec, sis, fundo, entradas, saidas) {
  const espDin = +(fundo + sis.dinheiro.valor + entradas - saidas).toFixed(2);
  const linha = (rot, informado, esperado, obs) => ({ rotulo: rot, informado, esperado,
    dif: informado == null ? null : +(informado - esperado).toFixed(2), obs: obs || null });
  return [
    linha('Dinheiro na gaveta', dec.dinheiro, espDin, 'fundo ' + impMoeda(fundo) + (saidas ? ' · saídas ' + impMoeda(saidas) : '')),
    linha('Cartão crédito', dec.credito, sis.credito.valor, sis.credito.n + ' venda(s)'),
    linha('Cartão débito', dec.debito, sis.debito.valor, sis.debito.n + ' venda(s)'),
    linha('Pix', dec.pix, sis.pix.valor, sis.pix.n + ' venda(s)'),
  ];
}
async function apiCaixaConferir(body, quem) {
  const cx = await fbCaixaDoOperador(quem.login);
  if (!cx) return { ok: false, erro: 'você não tem caixa aberto' };
  const dec = _decl(body);
  if (dec.dinheiro == null) return { ok: false, erro: 'conte a gaveta e informe o dinheiro' };
  const r = await fbResumoCaixa(cx.codigo);
  const sis = await fbResumoPorForma(cx.codigo);
  const linhas = _comparar(dec, sis, cx.fundo, r.entradas, r.saidas);
  const difDin = linhas[0].dif || 0;
  const eletronico = linhas.slice(1).filter((l) => l.informado != null && Math.abs(l.dif) > 0.01);
  return { ok: true, linhas, dif_dinheiro: difDin,
    precisa_permissao: Math.abs(difDin) > 0.01 && !quem.divergente,
    eletronico_divergente: eletronico.map((l) => l.rotulo),
    total_sistema: +(linhas.reduce((t, l) => t + l.esperado, 0)).toFixed(2) };
}
/** Comprovante do fechamento na térmica — papel é o que sobra pra conferência
 *  no dia seguinte, quando ninguém lembra dos números. */
async function imprimirFechamento(cx, quem, linhas, difDin) {
  try {
    const ip = (await cfgGet('impressora_ip', '')).trim();
    if (!ip) return;
    const b = [IMP.init, IMP.centro, IMP.neg, IMP.grande, impLn('FECHAMENTO DE CAIXA'), IMP.norm, IMP.negFim,
      impLn(LOJA_NOME.toUpperCase()), IMP.esquerda, impTraco(),
      impLn(impLR('Caixa ' + cx.codigo, quem.nome || quem.login)),
      impLn(new Date().toLocaleString('pt-BR')), impTraco()];
    for (const l of linhas) {
      b.push(IMP.neg, impLn(l.rotulo), IMP.negFim);
      b.push(impLn(impLR('  sistema', impMoeda(l.esperado))));
      b.push(impLn(impLR('  contado', l.informado == null ? '-' : impMoeda(l.informado))));
      if (l.dif != null && Math.abs(l.dif) > 0.01) b.push(IMP.neg, impLn(impLR('  DIFERENCA', impMoeda(l.dif))), IMP.negFim);
    }
    b.push(impTraco(), IMP.neg, IMP.alto,
      impLn(impLR('DIF. DINHEIRO', impMoeda(difDin))), IMP.norm, IMP.negFim,
      impLn(''), impLn('Assinatura: ____________________'), IMP.corte);
    await imprimirRaw(ip, Buffer.concat(b), 'fechamento caixa ' + cx.codigo);
  } catch (e) { console.error('[caixa] comprovante do fechamento:', e.message); }
}
async function apiCaixaFecharCaixa(body, quem) {
  const cx = await fbCaixaDoOperador(quem.login);
  if (!cx) return { ok: false, erro: 'você não tem caixa aberto' };
  const r = await fbResumoCaixa(cx.codigo);
  const sis = await fbResumoPorForma(cx.codigo);
  const esperado = +(cx.fundo + r.dinheiro + r.entradas - r.saidas).toFixed(2);
  // compatível com quem só manda o dinheiro (contado), mas o caminho normal
  // agora é a conferência por forma vinda da tela
  const dec = _decl(body.contado != null ? { ...body, dinheiro: body.contado } : body);
  if (dec.dinheiro == null) return { ok: false, erro: 'conte a gaveta e informe o dinheiro' };
  const contado = dec.dinheiro;
  if (!(contado >= 0)) return { ok: false, erro: 'valor contado inválido' };
  const dif = +(contado - esperado).toFixed(2);
  const linhas = _comparar(dec, sis, cx.fundo, r.entradas, r.saidas);
  // bateu = fecha; divergiu = só quem tem a permissão 48 (ou operação
  // completa/admin) confirma — é a mesma regra do Consumer
  if (Math.abs(dif) > 0.01 && !quem.divergente)
    return { ok: false, divergente: true, esperado, contado, dif,
      erro: `o contado difere do esperado em R$ ${dif.toFixed(2)} — chame quem pode fechar divergente` };
  const up = await caixaFecharNoBanco(cx.codigo, esperado, contado);
  if (!up.ok) return { ok: false, erro: 'não deu pra fechar o caixa' + (up.err ? ': ' + up.err : '') };
  // registro durável da conferência (o Consumer só guarda o dinheiro)
  await sql`INSERT INTO caixa_fechamento (caixa_codigo, login, informado, esperado, dif_dinheiro, obs)
    VALUES (${cx.codigo}, ${quem.login}, ${sql.json(dec)},
      ${sql.json({ dinheiro: esperado, credito: sis.credito.valor, debito: sis.debito.valor, pix: sis.pix.valor })},
      ${dif}, ${String(body.obs || '').slice(0, 300) || null})`;
  imprimirFechamento(cx, quem, linhas, dif).catch(() => {});
  return { ok: true, esperado, contado, dif, linhas };
}
// ---- FECHAR TODOS OS CAIXAS ABERTOS (só Administrador) ----
// Organização: fecha em lote TODO caixa aberto, cada um pelo esperado (fundo +
// dinheiro + entradas − saídas). Pega inclusive caixa curinga velho deixado
// aberto (ex.: o da Marta, aberto desde 2025, que engolia pagamento de quem
// recebia sem caixa próprio). Cartão/Pix já estão conciliados por NSU; isto só
// carimba o fechamento pra dar um ponto de partida limpo.
async function apiCaixaFecharTodos(quem) {
  if (!quem || !quem.admin) return { ok: false, erro: 'só Administrador pode fechar todos os caixas' };
  const abertos = await caixasAbertos();
  if (!abertos) return { ok: false, erro: 'não consegui listar os caixas abertos' };
  const fechados = [];
  for (const c of abertos) {
    const cod = c.codigo;
    const fundo = c.fundo;
    let esperado = fundo;
    try { const r = await fbResumoCaixa(cod); esperado = +(fundo + r.dinheiro + r.entradas - r.saidas).toFixed(2); } catch {}
    const up = await caixaFecharNoBanco(cod, esperado, esperado);
    if (up.ok) {
      fechados.push({ codigo: cod, quem: T(c.QUEM), esperado, abriu: T(c.ABRIU) });
      try { await sql`INSERT INTO caixa_fechamento (caixa_codigo, login, informado, esperado, dif_dinheiro, obs)
        VALUES (${cod}, ${quem.login}, ${sql.json({ dinheiro: esperado })}, ${sql.json({ dinheiro: esperado })}, 0, ${'Fechamento em lote por ' + (quem.nome || quem.login)})`; } catch {}
    }
  }
  return { ok: true, fechados, total: fechados.length };
}
// Fecha UM caixa específico (Administrador — caixa de outro operador). Mesmo
// cálculo do fechar-todos, só que num só.
async function apiCaixaFecharUm(body, quem) {
  if (!quem || !quem.admin) return { ok: false, erro: 'só Administrador fecha o caixa de outro operador' };
  const cod = Number(body.codigo);
  if (!cod) return { ok: false, erro: 'caixa inválido' };
  const c = await caixaInfo(cod);
  if (!c) return { ok: false, erro: 'esse caixa não está aberto' };
  const fundo = c.fundo;
  let esperado = fundo;
  try { const r = await fbResumoCaixa(cod); esperado = +(fundo + r.dinheiro + r.entradas - r.saidas).toFixed(2); } catch {}
  const up = await caixaFecharNoBanco(cod, esperado, esperado);
  if (!up.ok) return { ok: false, erro: 'não deu pra fechar' + (up.err ? ': ' + up.err : '') };
  try { await sql`INSERT INTO caixa_fechamento (caixa_codigo, login, informado, esperado, dif_dinheiro, obs)
    VALUES (${cod}, ${quem.login}, ${sql.json({ dinheiro: esperado })}, ${sql.json({ dinheiro: esperado })}, 0, ${'Fechado por ' + (quem.nome || quem.login)})`; } catch {}
  return { ok: true, codigo: cod, esperado };
}
// ANALÍTICO de um caixa: cada pagamento (hora, forma, NSU, pedido, valor).
async function apiCaixaDetalhe(codigo) {
  const cod = Number(codigo);
  if (!cod) return { ok: false, erro: 'caixa inválido' };
  const cx = (await qi(`SELECT c.CODIGO, TRIM(COALESCE(u.NOME,u.LOGIN)) QUEM, c.DATAABERTURA, c.DATAFECHAMENTO, COALESCE(c.SALDOINICIAL,0) FUNDO, c.SALDOFINAL, c.SALDOFINALINFORMADO
    FROM CAIXA c LEFT JOIN VWUSUARIOS u ON u.CODIGO=c.CODIGOUSUARIO WHERE c.CODIGO=${cod}`)).rows?.[0];
  if (!cx) return { ok: false, erro: 'caixa não encontrado' };
  const pg = await qi(`SELECT p.CODIGOPEDIDO PED, p.CODIGOFORMAPAGAMENTO F, TRIM(COALESCE(f.DESCRICAO,'')) FORMA, CAST(p.VALOR AS NUMERIC(12,2)) V,
      CAST(p.NSUTRANSACAO AS VARCHAR(30)) NSU, CAST(p.DATAPAGAMENTO AS VARCHAR(30)) QUANDO
    FROM PAGAMENTOS p LEFT JOIN FORMASPAGAMENTO f ON f.CODIGO=p.CODIGOFORMAPAGAMENTO
    WHERE p.CODIGOCAIXA=${cod} AND p.DATADELETE IS NULL ORDER BY p.DATAPAGAMENTO`);
  return { ok: true,
    caixa: { codigo: cod, quem: T(cx.QUEM), aberto_em: cx.DATAABERTURA, fechado_em: cx.DATAFECHAMENTO,
      fundo: Number(cx.FUNDO) || 0, esperado: cx.SALDOFINAL == null ? null : Number(cx.SALDOFINAL), contado: cx.SALDOFINALINFORMADO == null ? null : Number(cx.SALDOFINALINFORMADO) },
    pagamentos: (pg.ok ? pg.rows : []).map((x) => ({ pedido: Number(x.PED) || null, forma: T(x.FORMA) || ('forma ' + x.F), valor: Number(x.V) || 0, nsu: T(x.NSU) || null, quando: T(x.QUANDO) })) };
}
// A régua do BATER (regra do dono: só fecha se bater): todo pagamento do caixa
// com NSU, com par exato no venda_pagamento (mesmo NSU e valor), e ZERO
// dinheiro. Usada pelo autofechamento (04:00) e pelo fechar-caixa da maquininha.
async function caixaMaquininhaConfere(cod) {
  const pg = await qi(`SELECT CODIGOFORMAPAGAMENTO F, CAST(VALOR AS NUMERIC(12,2)) V, NSUTRANSACAO NSU
    FROM PAGAMENTOS WHERE CODIGOCAIXA=${cod} AND DATADELETE IS NULL`);
  if (!pg.ok) return { bate: false, motivo: 'FB: ' + pg.err, n: 0 };
  for (const p of pg.rows) {
    if (Number(p.F) === FORMA.DINHEIRO) return { bate: false, motivo: 'tem DINHEIRO lançado (maquininha não recebe dinheiro)', n: pg.rows.length };
    const nsu = p.NSU != null ? String(p.NSU) : '';
    if (!nsu) return { bate: false, motivo: `pagamento de R$ ${p.V} sem NSU`, n: pg.rows.length };
    const [par] = await sql`SELECT id FROM venda_pagamento
      WHERE status='ok' AND nsu IS NOT NULL AND regexp_replace(nsu, '\\D', '', 'g') = ${nsu}
        AND valor = ${Number(p.V)} LIMIT 1`;
    if (!par) return { bate: false, motivo: `NSU ${nsu} (R$ ${p.V}) sem par no registro do sistema`, n: pg.rows.length };
  }
  return { bate: true, n: pg.rows.length };
}
// Fechar o caixa da MAQUININHA do próprio garçom (troca de turno no aparelho).
// Só o caixa nascido na maquininha, e só se BATER — não bateu, fica aberto
// pro gerente ver na Conferência (com o motivo na cara).
async function apiLioFecharCaixa(garcom) {
  const cx = await fbCaixaDoOperador(garcom.login);
  if (!cx) return { ok: false, erro: 'Você não tem caixa aberto — nada a fechar.' };
  const o = await caixaInfo(cx.codigo);
  // ⚠️ caixaInfo devolve {fundo, obs} minúsculo (é primitiva dos dois bancos).
  // Lendo .OBS aqui dava undefined → SEMPRE caía no "é do SISTEMA" e o caixa
  // da maquininha nunca fechava pelo app. Regressão do refactor de 20/08.
  if (!String(o?.obs || '').startsWith('Aberto automaticamente'))
    return { ok: false, erro: 'Seu caixa aberto é do SISTEMA (gaveta) — o fechamento dele é no caixa, com conferência.' };
  const c = await caixaMaquininhaConfere(cx.codigo);
  if (!c.bate) return { ok: false, nao_bateu: true,
    erro: `NÃO BATEU: ${c.motivo}. O caixa fica ABERTO pro gerente conferir — nada se perde.` };
  let esperado = cx.fundo;
  try { const r = await fbResumoCaixa(cx.codigo); esperado = +(cx.fundo + r.dinheiro + r.entradas - r.saidas).toFixed(2); } catch {}
  const up = await caixaFecharNoBanco(cx.codigo, esperado, esperado);
  if (!up.ok) return { ok: false, erro: 'não deu pra fechar' + (up.err ? ': ' + up.err : '') };
  try { await sql`INSERT INTO caixa_fechamento (caixa_codigo, login, informado, esperado, dif_dinheiro, obs)
    VALUES (${cx.codigo}, ${garcom.login}, ${sql.json({ dinheiro: esperado })}, ${sql.json({ dinheiro: esperado })}, 0,
      ${'Fechado na maquininha por ' + (garcom.nome || garcom.login) + ' — BATEU (' + c.n + ' pagamento(s) conferido(s) por NSU)'})`; } catch {}
  // Detalhamento pro COMPROVANTE impresso na própria maquininha (app ≥1.10.9):
  // por forma + período. O fechamento do turno merece papel.
  let formas = [];
  try {
    const fr = await qi(`SELECT TRIM(COALESCE(f.DESCRICAO,'')) NOME, COUNT(*) N, CAST(SUM(p.VALOR) AS NUMERIC(12,2)) V
      FROM PAGAMENTOS p LEFT JOIN FORMASPAGAMENTO f ON f.CODIGO=p.CODIGOFORMAPAGAMENTO
      WHERE p.CODIGOCAIXA=${cx.codigo} AND p.DATADELETE IS NULL GROUP BY f.DESCRICAO ORDER BY 3 DESC`);
    if (fr.ok) formas = fr.rows.map((x) => ({ nome: T(x.NOME) || 'Outros', n: Number(x.N), total: Number(x.V) || 0 }));
  } catch {}
  return { ok: true, codigo: cx.codigo, pagamentos: c.n, esperado,
    operador: garcom.nome || garcom.login, abriu: cx.desde || null, formas,
    total: +formas.reduce((s, f) => s + f.total, 0).toFixed(2) };
}
// ---- FECHAMENTO AUTOMÁTICO (04:00) — SÓ caixas da MAQUININHA ----
// Separação do dono: caixa da MAQUININHA (nasce sozinho ao receber no terminal,
// só cartão/Pix, sem gaveta) fecha SOZINHO de madrugada — não há o que contar.
// Caixa do SISTEMA (aberto por gente no /caixa, tem dinheiro) fecha com
// conferência humana — o loop NÃO toca nele. Desligar: app_config
// caixa_autofechar='0'. Marca o dia em caixa_autofechar_dia (não repete).
let cxAutoRodando = false;
async function loopFecharCaixasMaquininha() {
  if (cxAutoRodando) return; cxAutoRodando = true;
  try {
    const agora = new Date(Date.now() - 3 * 3600 * 1000); // BRT
    const h = agora.getUTCHours();
    if (h < 4 || h >= 7) return; // janela 04:00–07:00
    if ((await cfgGet('caixa_autofechar', '1')) !== '1') return;
    const hoje = agora.toISOString().slice(0, 10);
    if ((await cfgGet('caixa_autofechar_dia', '')) === hoje) return; // já rodou
    const abertos = await caixasAbertos();
    if (!abertos) return;
    let n = 0, pulados = 0;
    for (const c of abertos) {
      if (!String(c.obs || '').startsWith('Aberto automaticamente')) continue; // sistema: não toca
      const cod = c.codigo;
      // ⚠️ REGRA DO DONO: só fecha se o caixa BATER (régua única em
      // caixaMaquininhaConfere). Não bateu = fica ABERTO pra conferência.
      const conf = await caixaMaquininhaConfere(cod);
      if (!conf.bate) { pulados++; console.log(`[caixa] autofechar: caixa ${cod} NÃO bateu (${conf.motivo}) — fica aberto`); continue; }
      const fundo = c.fundo;
      let esperado = fundo;
      try { const r = await fbResumoCaixa(cod); esperado = +(fundo + r.dinheiro + r.entradas - r.saidas).toFixed(2); } catch {}
      const up = await caixaFecharNoBanco(cod, esperado, esperado);
      if (up.ok) {
        n++;
        try { await sql`INSERT INTO caixa_fechamento (caixa_codigo, login, informado, esperado, dif_dinheiro, obs)
          VALUES (${cod}, ${'sistema'}, ${sql.json({ dinheiro: esperado })}, ${sql.json({ dinheiro: esperado })}, 0, ${'Fechamento automático 04:00 — caixa da maquininha BATEU (' + conf.n + ' pagamento(s) conferido(s) por NSU)'})`; } catch {}
      }
    }
    await cfgSet('caixa_autofechar_dia', hoje);
    if (n || pulados) console.log(`[caixa] fechamento automático: ${n} fechado(s), ${pulados} não bateu/ficou aberto`);
  } catch (e) { console.error('[caixa] autofechar:', e.message); }
  finally { cxAutoRodando = false; }
}
// ---- USUÁRIOS PRÓPRIOS (sem passar pelo Consumer) ----
// Perfis prontos, com os MESMOS códigos de permissão do PDV — assim a regra
// do sistema continua uma só, e amanhã dá pra migrar o usuário pro Consumer
// sem reescrever nada.
const PERFIS_LOCAIS = {
  // ⚠️ A 28 (Excluir Pedido) é o que faz alguém AUTORIZAR cancelamento — é a
  // chave do cadeado do caixa. Sem ela nenhum perfil nosso conseguia liberar,
  // e o gerente ficava dependendo de admin (o paulao esbarrou nisso 19/08).
  gerente: { nome: 'Gerente (autoriza cancelamento, fiado, tudo do caixa)',
    perms: [3, 4, 5, 7, 10, 12, 16, 22, 26, 28, 30, 31, 35, 38, 40, 41, 44, 46, 48, 50, 52, 53, 54, 58] },
  caixa: { nome: 'Caixa (recebe, desconto, gaveta, fecha)', perms: [5, 10, 12, 22, 26, 30, 50, 53, 54] },
  garcom: { nome: 'Garçom (comanda mobile)', perms: [53, 54, 40, 41] },
};
async function apiUsuariosLocais(quem) {
  if (!quem?.admin) return { ok: false, erro: 'só administrador' };
  const rows = await sql`SELECT login, nome, perms, admin, ativo, criado_em, criado_por
    FROM usuario_local ORDER BY login`;
  return { ok: true, usuarios: rows, perfis: Object.entries(PERFIS_LOCAIS).map(([k, v]) => ({ id: k, nome: v.nome })) };
}
async function apiUsuarioLocalSalvar(body, quem) {
  if (!quem?.admin) return { ok: false, erro: 'só administrador cria usuário' };
  const login = String(body.login || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!/^[a-z0-9._-]{3,20}$/.test(login)) return { ok: false, erro: 'login: 3 a 20 letras/números, sem espaço' };
  const nome = String(body.nome || '').trim().slice(0, 60) || login;
  const perfil = PERFIS_LOCAIS[String(body.perfil || 'garcom')] || PERFIS_LOCAIS.garcom;
  const pin = String(body.pin || '').replace(/\D/g, '');
  // login que já existe no Consumer fica com o Consumer — dois cadastros com
  // o mesmo nome é confusão garantida na hora de apurar quem fez o quê
  let doPdv = null;
  try { doPdv = await qi(`SELECT FIRST 1 CODIGO FROM VWUSUARIOS WHERE LOWER(TRIM(LOGIN))='${fbEsc(login)}'`); } catch { /* FB fora: segue */ }
  if (doPdv?.ok && doPdv.rows.length) return { ok: false, erro: `"${login}" já existe no Consumer — use outro nome ou dê a permissão por lá` };
  const ja = (await sql`SELECT login FROM usuario_local WHERE login=${login}`)[0];
  if (!ja && !(pin.length >= 4 && pin.length <= 8)) return { ok: false, erro: 'o PIN tem de 4 a 8 números' };
  if (pin && !(pin.length >= 4 && pin.length <= 8)) return { ok: false, erro: 'o PIN tem de 4 a 8 números' };
  const salt = randomBytes(16).toString('hex');
  if (ja) {
    await sql`UPDATE usuario_local SET nome=${nome}, perms=${perfil.perms}, ativo=${body.ativo !== false}
      WHERE login=${login}`;
    if (pin) await sql`UPDATE usuario_local SET pin_hash=${pinHash(pin, salt)}, salt=${salt} WHERE login=${login}`;
    // o PIN do garçom e o do caixa são o mesmo cadastro: mantém alinhado
    if (pin) await sql`INSERT INTO garcom_pin (login, pin_hash, salt, nome) VALUES (${login}, ${pinHash(pin, salt)}, ${salt}, ${nome})
      ON CONFLICT (login) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, salt=EXCLUDED.salt, nome=EXCLUDED.nome, atualizado_em=now()`;
    return { ok: true, atualizado: true, login };
  }
  await sql`INSERT INTO usuario_local (login, nome, pin_hash, salt, perms, admin, criado_por)
    VALUES (${login}, ${nome}, ${pinHash(pin, salt)}, ${salt}, ${perfil.perms}, ${false}, ${quem.login})`;
  await sql`INSERT INTO garcom_pin (login, pin_hash, salt, nome) VALUES (${login}, ${pinHash(pin, salt)}, ${salt}, ${nome})
    ON CONFLICT (login) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, salt=EXCLUDED.salt, nome=EXCLUDED.nome, atualizado_em=now()`;
  return { ok: true, criado: true, login, perfil: perfil.nome };
}
/** TRANSFERIR ITENS ESCOLHIDOS pra outra mesa. O "Transferir" que já existia
 *  leva a mesa INTEIRA; aqui o caixa marca o que vai (a cerveja que era da
 *  mesa ao lado, o prato lançado no número errado). Move os complementos
 *  junto — molho não fica órfão na mesa antiga — e se a origem ficar vazia,
 *  a casca é encerrada (senão a mesa fica "ocupada" pra sempre). */
async function apiCaixaTransferirItens(body, quem) {
  if (!(quem && (quem.transferir || quem.admin))) return { ok: false, erro: 'sem permissão (Transferir itens de um pedido para o outro)' };
  const de = Number(body.de), para = Number(body.para);
  const cods = Array.isArray(body.itens) ? body.itens.map(Number).filter(Boolean) : [];
  if (!(de >= 1 && para >= 1)) return { ok: false, erro: 'número inválido' };
  if (de === para) return { ok: false, erro: 'origem e destino são iguais' };
  if (!cods.length) return { ok: false, erro: 'marque o que vai' };
  let pedDe, pedPara;
  try {
    pedDe = await fbAcharPedido(de);
    if (!pedDe) return { ok: false, erro: `não há conta aberta na ${de >= COMANDA_DE ? 'comanda' : 'mesa'} ${de}` };
    pedPara = (await pedidoDaMesa(para)).ped;
  } catch (e) { return { ok: false, erro: e.message }; }
  // o item só sai se for MESMO da conta de origem (o número pode ter mudado
  // entre a tela e o toque) e leva os filhos dele
  const lista = await itensDoPedido(pedDe, { codigos: cods });
  const mover = lista.map((x) => x.codigo);
  if (!mover.length) return { ok: false, erro: 'esses itens não estão mais nessa conta' };
  const movidos = await itensMover(pedDe, pedPara, mover);
  if (!movidos) return { ok: false, erro: 'não consegui mover os itens' };
  try { await fbAtualizarTotal(pedPara); await fbAtualizarTotal(pedDe); } catch { /* recalcula no ciclo */ }
  // origem esvaziou? mesma regra da transferência de mesa inteira
  const sobrou = await itensContar(pedDe);
  const pagoDe = await fbPagoDoPedido(pedDe).catch(() => 0);
  if (sobrou === 0 && pagoDe <= 0.009) {
    await pedApagar(pedDe, { soAberto: true });
    await sql`UPDATE identificacao SET fechada_em=now() WHERE numero=${de} AND fechada_em IS NULL`;
  }
  await sql`INSERT INTO transferencia (de_numero, para_numero, tipo, itens_movidos, por, pedido_de, pedido_para)
    VALUES (${de}, ${para}, 'item', ${mover.length}, ${quem.login}, ${pedDe}, ${pedPara})`;
  espelho().catch(() => {});
  return { ok: true, itens: mover.length, msg: `${cods.length} item(ns) foram pra mesa ${para}.` };
}
// ---- FIADO (conta corrente do cliente) ----
// Conferido no banco real da 0001 antes de escrever (10.917 lançamentos):
//  · fiado entra como CREDITO (não DEBITO — a memória do projeto estava
//    errada), com IMPORTADO='N'; pagar depois é CREDITO com IMPORTADO='S'.
//  · SALDOINICIAL/SALDOFINAL são o extrato corrido: FINAL = INICIAL + valor.
//  · OBSERVACAO no formato do Consumer: "Fiado - pedido nº N no valor de R$ X".
//  · o pedido NÃO ganha linha em PAGAMENTOS — fiado não é forma de pagamento:
//    o pedido fecha devendo e a dívida vive na conta corrente.
//  · CONTATOS.SALDOATUALCONTACORRENTE acompanha o último SALDOFINAL.
// Habilitado pra fiado = LIMITECREDITOCONTACORRENTE > 0 (regra do dono).
// BLOQUEARVENDAAPOSLIMITE='S' impede estourar o limite.
async function fbClienteFiado(cod) {
  if (nativo()) {
    const [x] = await sql`SELECT codigo, COALESCE(nome,'') nome, COALESCE(cpf,'') doc,
        COALESCE(limite_credito,0) lim, COALESCE(saldo_atual,0) saldo, COALESCE(bloqueia_apos_limite,false) bloq
      FROM cliente_local WHERE codigo=${Number(cod)} AND ativo`;
    if (!x) return null;
    const limite = Number(x.lim) || 0, saldo = Number(x.saldo) || 0;
    return { codigo: Number(x.codigo), nome: x.nome, doc: x.doc, limite, saldo,
      bloqueia: !!x.bloq, habilitado: limite > 0, disponivel: +(limite - saldo).toFixed(2) };
  }
  const r = await qi(`SELECT FIRST 1 CODIGO, TRIM(COALESCE(NOME,'')) NOME, TRIM(COALESCE(CNPJOUCPF,'')) DOC,
      COALESCE(LIMITECREDITOCONTACORRENTE,0) LIM, COALESCE(SALDOATUALCONTACORRENTE,0) SALDO,
      TRIM(COALESCE(BLOQUEARVENDAAPOSLIMITE,'N')) BLOQ
    FROM CONTATOS WHERE CODIGO=${Number(cod)} AND DATADELETE IS NULL`);
  const x = r.ok ? r.rows?.[0] : null;
  if (!x) return null;
  const limite = Number(x.LIM) || 0, saldo = Number(x.SALDO) || 0;
  return { codigo: Number(x.CODIGO), nome: T(x.NOME), doc: T(x.DOC),
    limite, saldo, bloqueia: T(x.BLOQ).toUpperCase() === 'S',
    habilitado: limite > 0, disponivel: +(limite - saldo).toFixed(2) };
}
async function apiCaixaFiadoBusca(termo) {
  const t = String(termo || '').trim().toUpperCase();
  if (t.length < 3) return { ok: true, clientes: [] };
  const so = t.replace(/\D/g, '');
  const cond = so.length >= 3
    ? `(UPPER(NOME) LIKE '%${fbEsc(t)}%' OR REPLACE(REPLACE(REPLACE(CNPJOUCPF,'.',''),'-',''),'/','') LIKE '%${fbEsc(so)}%')`
    : `UPPER(NOME) LIKE '%${fbEsc(t)}%'`;
  const r = await qi(`SELECT FIRST 12 CODIGO, TRIM(COALESCE(NOME,'')) NOME, TRIM(COALESCE(CNPJOUCPF,'')) DOC,
      COALESCE(LIMITECREDITOCONTACORRENTE,0) LIM, COALESCE(SALDOATUALCONTACORRENTE,0) SALDO
    FROM CONTATOS WHERE DATADELETE IS NULL AND ${cond} ORDER BY NOME`);
  if (!r.ok) return { ok: false, erro: r.err };
  return { ok: true, clientes: (r.rows || []).map((x) => ({
    codigo: Number(x.CODIGO), nome: T(x.NOME), doc: T(x.DOC),
    limite: Number(x.LIM) || 0, saldo: Number(x.SALDO) || 0,
    habilitado: (Number(x.LIM) || 0) > 0,
    disponivel: +(((Number(x.LIM) || 0) - (Number(x.SALDO) || 0))).toFixed(2) })) };
}
/** Grava UM lançamento na conta corrente, do jeito que o Consumer grava.
 *  tipo 'credito'  = cliente passou a dever (CREDITO + IMPORTADO='N')
 *  tipo 'pagamento'= cliente pagou (DEBITO NEGATIVO, IMPORTADO nulo) — foi
 *  assim que achei nos lançamentos reais do "Registrar Pagamento" do PDV.
 *  Mantém CONTATOS.SALDOATUALCONTACORRENTE alinhado com o último saldo. */
async function fbLancarContaCorrente({ cliente, tipo, valor, obs, pedido = null, usuarioCod = null, forma = null }) {
  const cli = await fbClienteFiado(cliente);
  if (!cli) return { ok: false, erro: 'cliente não encontrado' };
  const v = +Number(valor).toFixed(2);
  if (!(v > 0)) return { ok: false, erro: 'valor inválido' };
  const credito = tipo !== 'pagamento';
  // FORMA DE PAGAMENTO: o movimento não tem essa coluna — quem guarda é
  // PAGAMENTOS, amarrado nos dois sentidos (CONTACORRENTE.CODIGOPAGAMENTO e
  // PAGAMENTOS.CODIGOCONTACORRENTE). É o padrão do próprio Consumer: dos 3.955
  // pagamentos sem pedido do banco real, 3.953 são exatamente isto. Só vale
  // quando entra dinheiro (crédito é dívida, não tem forma).
  let formaCod = null;
  if (!credito && forma && !nativo()) {
    const f = await qi(`SELECT FIRST 1 CODIGO FROM FORMASPAGAMENTO WHERE CODIGO=${Number(forma) || 0}`);
    if (f.ok && f.rows.length) formaCod = Number(f.rows[0].CODIGO);
    else console.error('[fiado] forma ' + forma + ' não existe no PDV — lança só o movimento');
  }
  const novoSaldo = +(credito ? cli.saldo + v : cli.saldo - v).toFixed(2);
  if (nativo()) {
    const cod = await proxCodigo('contacorrente');
    let pagCod = null;
    if (!credito && forma) {
      // mesma amarração do Consumer: o pagamento carrega a FORMA e aponta pro
      // movimento; sem caixa, porque recebimento de fiado não é gaveta.
      pagCod = await proxCodigo('pagamento');
      await sql`INSERT INTO pagamento_local (codigo, pedido, forma_codigo, valor, caixa_codigo,
          observacao, conta_corrente, quando)
        VALUES (${pagCod}, ${pedido ? Number(pedido) : null}, ${Number(forma)}, ${v}, null,
          ${String(obs || 'Pagamento de fiado').slice(0, 120)}, ${cod}, now())`;
    }
    await sql`INSERT INTO conta_corrente_local (codigo, cliente_codigo, pedido, credito, debito,
        saldo_inicial, saldo_final, observacao, pagamento_codigo, login, quando)
      VALUES (${cod}, ${Number(cli.codigo)}, ${pedido ? Number(pedido) : null},
        ${credito ? v : null}, ${credito ? null : -v}, ${cli.saldo}, ${novoSaldo},
        ${String(obs || '').slice(0, 200)}, ${pagCod}, ${usuarioCod ? String(usuarioCod) : null}, now())`;
    await sql`UPDATE cliente_local SET saldo_atual=${novoSaldo}, atualizado_em=now() WHERE codigo=${Number(cli.codigo)}`;
    return { ok: true, codigo: cod, pagamento: pagCod, saldo: novoSaldo, cliente: cli.nome };
  }
  const campos = ['CODIGO', 'CODIGOCLIENTE', 'DATAHORA', 'SALDOINICIAL', 'SALDOFINAL', 'OBSERVACAO'];
  const vals = ['GEN_ID(GEN_CONTACORRENTE_ID,1)', String(cli.codigo), 'CURRENT_TIMESTAMP',
    fbNum(cli.saldo), fbNum(novoSaldo), `'${fbEsc(String(obs || '').slice(0, 200))}'`];
  if (credito) { campos.push('CREDITO', 'IMPORTADO'); vals.push(fbNum(v), "'N'"); }
  else { campos.push('DEBITO'); vals.push(fbNum(-v)); }
  if (pedido) { campos.push('CODIGOPEDIDO'); vals.push(String(pedido)); }
  if (usuarioCod) { campos.push('CODIGOUSUARIO'); vals.push(String(usuarioCod)); }
  const ins = await qi(`INSERT INTO CONTACORRENTE (${campos.join(', ')}) VALUES (${vals.join(', ')})`);
  if (!ins.ok) return { ok: false, erro: 'FB conta corrente: ' + ins.err };
  const up = await qi(`UPDATE CONTATOS SET SALDOATUALCONTACORRENTE=${fbNum(novoSaldo)} WHERE CODIGO=${cli.codigo}`);
  if (!up.ok) console.error('[fiado] saldo do cadastro não atualizou: ' + up.err);
  const g = await qi(`SELECT FIRST 1 CODIGO FROM CONTACORRENTE WHERE CODIGOCLIENTE=${cli.codigo} ORDER BY CODIGO DESC`);
  const codigoCC = g.ok && g.rows.length ? Number(g.rows[0].CODIGO) : null;
  let pagamentoCod = null;
  if (formaCod && codigoCC) {
    // SEM CODIGOCAIXA de propósito: recebimento lançado pelo Financeiro não é
    // dinheiro na gaveta de ninguém. Se caísse num caixa, a conferência
    // daquele caixa fecharia com sobra que o operador não tem pra mostrar.
    const ip = await qi(`INSERT INTO PAGAMENTOS (CODIGOFORMAPAGAMENTO, VALOR, DATAPAGAMENTO, CODIGOCONTACORRENTE, CODIGOCATEGORIACONTAS, PERCENTUALTAXA, OBSERVACAO)
      VALUES (${formaCod}, ${fbNum(v)}, CURRENT_TIMESTAMP, ${codigoCC}, 1, 0, '${fbEsc(String(obs || 'Pagamento de fiado').slice(0, 120))}')`);
    if (!ip.ok) console.error('[fiado] forma não registrada (movimento já entrou): ' + ip.err);
    else {
      const gp = await qi(`SELECT FIRST 1 CODIGO FROM PAGAMENTOS WHERE CODIGOCONTACORRENTE=${codigoCC} ORDER BY CODIGO DESC`);
      pagamentoCod = gp.ok && gp.rows.length ? Number(gp.rows[0].CODIGO) : null;
      if (pagamentoCod) await qi(`UPDATE CONTACORRENTE SET CODIGOPAGAMENTO=${pagamentoCod} WHERE CODIGO=${codigoCC}`);
    }
  }
  return { ok: true, codigo: codigoCC, pagamento: pagamentoCod, saldo: novoSaldo, cliente: cli.nome };
}
// ---- CANCELAMENTOS → NUVEM: o dono quer o histórico (com motivo) no dashboard ----
// A tabela `cancelamento` só existe aqui; o Consumer marca DATADELETE e nada mais.
// Manda em lotes de 200 por minuto, guardando até que id já foi; a nuvem faz
// upsert por (filial, id) — reenviar não duplica. Mesma assinatura HMAC da
// fila de fiado ([FILIAL_ID,'cancel',e]).
let cancelNuvemRodando = false;
async function loopCancelNuvem() {
  if (cancelNuvemRodando || !FILIAL_ID || !PAGAR_MESA_SECRET) return;
  cancelNuvemRodando = true;
  try {
    const desde = Number(await cfgGet('cancel_nuvem_ate', '0')) || 0;
    const rows = await sql`SELECT id, quando, login, gerente, numero, pedido_fb, item_codigo, nome, valor, status_item, motivo, area_codigo, foto
      FROM cancelamento WHERE id > ${desde} ORDER BY id LIMIT 200`;
    if (!rows.length) return;
    // A foto da devolução vai junto (base64). A Vercel aceita ~4,5 MB por
    // requisição: o lote para antes de 3 MB de foto e o resto vai no minuto seguinte.
    const lote = [];
    let bytes = 0;
    for (const x of rows) {
      let foto_b64 = null;
      if (x.foto) {
        try {
          const caminho = path.join(DIR_FOTOS, x.foto);
          if (existsSync(caminho)) foto_b64 = readFileSync(caminho).toString('base64');
        } catch { /* foto já apagada (30 dias) ou ilegível: manda sem */ }
      }
      if (foto_b64 && lote.length && bytes + foto_b64.length > 3_000_000) break;
      lote.push({
        id: Number(x.id), quando: x.quando, login: x.login, gerente: x.gerente, numero: x.numero,
        pedido_fb: x.pedido_fb, item_codigo: x.item_codigo == null ? null : Number(x.item_codigo),
        nome: x.nome, valor: x.valor == null ? null : Number(x.valor), status_item: x.status_item,
        motivo: x.motivo, area_codigo: x.area_codigo,
        foto_b64, foto_mime: foto_b64 ? 'image/jpeg' : null });
      if (foto_b64) bytes += foto_b64.length;
    }
    const e = Math.floor(Date.now() / 1000) + 120;
    const r = await fetch(`${PAGAR_MESA_URL}/api/loja/cancelamentos`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ f: FILIAL_ID, e, s: nfceAssina('cancel', e), cancelamentos: lote }),
      signal: AbortSignal.timeout(25000),
    });
    const j = await r.json().catch(() => null);
    if (!j?.ok) { console.error('[cancel] nuvem recusou:', j?.erro || r.status); return; }
    await cfgSet('cancel_nuvem_ate', String(lote[lote.length - 1].id));
    console.log(`[cancel] ${lote.length} cancelamento(s) na nuvem (até id ${lote[lote.length - 1].id}${bytes ? ', ' + Math.round(bytes / 1024) + ' KB de foto' : ''})`);
  } catch (err) { console.error('[cancel] nuvem:', err.message); }
  finally { cancelNuvemRodando = false; }
}
// ---- FILA DA NUVEM: o Financeiro lança, a LOJA aplica ----
// A tela do Concilia não alcança o Firebird (o banco é daqui). Ela enfileira e
// este laço busca, aplica e devolve o resultado — mesma assinatura HMAC da
// NFC-e, que a loja já tem no start.bat.
let fiadoFilaRodando = false;
async function loopFiadoFila() {
  if (fiadoFilaRodando || !FILIAL_ID || !PAGAR_MESA_SECRET) return;
  fiadoFilaRodando = true;
  try {
    const e = Math.floor(Date.now() / 1000) + 120;
    const q = new URLSearchParams({ f: FILIAL_ID, e: String(e), s: nfceAssina('fiado', e) });
    const r = await fetch(`${PAGAR_MESA_URL}/api/loja/fiado-fila?${q}`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => null);
    if (!j?.ok || !j.lancamentos?.length) return;
    for (const l of j.lancamentos) {
      let res;
      try {
        res = await fbLancarContaCorrente({ cliente: Number(l.cliente), tipo: l.tipo,
          valor: Number(l.valor), forma: l.forma || null,
          obs: l.observacao || (l.tipo === 'pagamento' ? 'Pagamento de fiado.' : 'Lançamento manual') });
      } catch (err) { res = { ok: false, erro: err.message }; }
      const e2 = Math.floor(Date.now() / 1000) + 120;
      await fetch(`${PAGAR_MESA_URL}/api/loja/fiado-fila`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ f: FILIAL_ID, e: e2, s: nfceAssina('fiado', e2), id: l.id,
          ok: !!res.ok, erro: res.erro || null, codigo: res.codigo || null, saldo: res.saldo ?? null,
          pagamento: res.pagamento || null }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
      console.log('[fiado] ' + l.tipo + ' R$ ' + l.valor + ' cliente ' + l.cliente
        + (l.forma_nome ? ' (' + l.forma_nome + ')' : '') + ' → ' + (res.ok ? 'aplicado' : 'ERRO: ' + res.erro));
    }
  } catch (err) { console.error('[fiado] fila:', err.message); }
  finally { fiadoFilaRodando = false; }
}
// ---- FILA DE PRODUTO: o Concilia altera o cadastro, a LOJA aplica ----
// O Consumer é o dono do produto e o Firebird é daqui. A tela da nuvem
// enfileira campo a campo e este laço aplica. Whitelist explícita: campo que
// não está aqui não vira UPDATE, nem que a fila mande.
//
// ⚠️ Preço de VENDA e pausa moram no PRODUTODETALHE (por tamanho), não em
// PRODUTOS — quem mistura acaba mudando o preço de um tamanho só e achando
// que mudou tudo (ou o contrário).
const CAMPO_FB = {
  nome:               { tab: 'PRODUTOS',       col: 'NOME',              tipo: 'texto' },
  descricao:          { tab: 'PRODUTOS',       col: 'DESCRICAO',         tipo: 'texto' },
  modo_preparo:       { tab: 'PRODUTOS',       col: 'MODOPREPARO',       tipo: 'texto' },
  preco_custo:        { tab: 'PRODUTOS',       col: 'PRECOCUSTO',        tipo: 'num'   },
  estoque_minimo:     { tab: 'PRODUTOS',       col: 'ESTOQUEMINIMO',     tipo: 'num'   },
  estoque_controlado: { tab: 'PRODUTOS',       col: 'ESTOQUECONTROLADO', tipo: 'sn'    },
  descontinuado:      { tab: 'PRODUTOS',       col: 'DESCONTINUADO',     tipo: 'sn'    },
  categoria:          { tab: 'PRODUTOS',       col: 'CODIGOETIQUETA',    tipo: 'int'   },
  cozinha:            { tab: 'PRODUTOS',       col: 'CODIGOCOZINHA',     tipo: 'int'   },
  preco_venda:        { tab: 'PRODUTODETALHE', col: 'PRECOVENDA',        tipo: 'num'   },
  // 'S'/'N' em PRODUTOS × 1/0 em PRODUTODETALHE: aqui é sempre o detalhe (1/0)
  comanda_mobile:     { tab: 'PRODUTODETALHE', col: 'COMANDAMOBILE',     tipo: 'i01'   },
  cardapio_digital:   { tab: 'PRODUTODETALHE', col: 'CARDAPIODIGITAL',   tipo: 'i01'   },
  pausado:            { tab: 'PRODUTODETALHE', col: 'DATAPAUSADO',       tipo: 'pausa' },
  // WIZARD (perguntas de acompanhamento). Chaveado pelo código da própria
  // pergunta/opção — não pelo produto, porque a MESMA pergunta serve vários
  // pratos ("ponto da carne" vale pra picanha, contra e maminha).
  pergunta_texto:     { tab: 'WIZARDPERGUNTAS', col: 'DESCRICAO',        tipo: 'texto', alvo: 'pergunta' },
  pergunta_min:       { tab: 'WIZARDPERGUNTAS', col: 'QTDRESPOSTASMIN',  tipo: 'int',   alvo: 'pergunta' },
  pergunta_max:       { tab: 'WIZARDPERGUNTAS', col: 'QTDRESPOSTASMAX',  tipo: 'int',   alvo: 'pergunta' },
  opcao_nome:         { tab: 'WIZARDOPCOES',    col: 'DESCRICAO',        tipo: 'texto', alvo: 'opcao' },
  opcao_preco:        { tab: 'WIZARDOPCOES',    col: 'PRECOPROMO',       tipo: 'num',   alvo: 'opcao' },
};
async function fbAlterarProduto({ produto, variante, campo, valor, alvo_codigo }) {
  const def = CAMPO_FB[campo];
  if (!def) return { ok: false, erro: 'campo não permitido: ' + campo };
  const alvoCod = alvo_codigo == null ? null : Number(alvo_codigo);
  const wizard = def.alvo === 'pergunta' || def.alvo === 'opcao';
  if (wizard && !(Number.isFinite(alvoCod) && alvoCod > 0)) {
    return { ok: false, erro: 'faltou o código da ' + def.alvo };
  }
  const prod = wizard ? 0 : Number(produto);
  if (!wizard && (!Number.isFinite(prod) || prod <= 0)) return { ok: false, erro: 'produto inválido' };
  const varc = variante == null ? null : Number(variante);
  if (def.tab === 'PRODUTODETALHE' && !(Number.isFinite(varc) && varc > 0)) {
    return { ok: false, erro: 'esse campo é por tamanho e veio sem o tamanho' };
  }
  let sqlVal;
  if (valor == null || valor === '') {
    sqlVal = def.tipo === 'pausa' ? 'NULL' : 'NULL';
  } else if (def.tipo === 'num') {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0) return { ok: false, erro: 'número inválido' };
    sqlVal = fbNum(n);
  } else if (def.tipo === 'int') {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0) return { ok: false, erro: 'código inválido' };
    sqlVal = String(n);
  } else if (def.tipo === 'i01') {
    sqlVal = String(valor) === '1' ? '1' : '0';
  } else if (def.tipo === 'sn') {
    sqlVal = String(valor) === '1' ? "'S'" : "'N'";
  } else if (def.tipo === 'pausa') {
    sqlVal = String(valor) === '1' ? 'CURRENT_TIMESTAMP' : 'NULL';
  } else {
    sqlVal = `'${fbEsc(String(valor).slice(0, 200))}'`;
  }
  // Existe mesmo? UPDATE que não acha linha volta "ok" no Firebird e a tela
  // mostraria "aplicado" sem nada ter mudado.
  const alvo = wizard
    ? await qi(`SELECT FIRST 1 CODIGO FROM ${def.tab} WHERE CODIGO=${alvoCod} AND DATADELETE IS NULL`)
    : def.tab === 'PRODUTOS'
      ? await qi(`SELECT FIRST 1 CODIGO FROM PRODUTOS WHERE CODIGO=${prod}`)
      : await qi(`SELECT FIRST 1 CODIGO FROM PRODUTODETALHE WHERE CODIGO=${varc} AND CODIGOPRODUTO=${prod} AND DATADELETE IS NULL`);
  if (!alvo.ok) return { ok: false, erro: 'FB consulta: ' + alvo.err };
  if (!alvo.rows.length) {
    return { ok: false, erro: wizard ? (def.alvo === 'pergunta' ? 'pergunta não existe no PDV' : 'opção não existe no PDV')
      : def.tab === 'PRODUTOS' ? 'produto não existe no PDV' : 'tamanho não existe (ou foi excluído) neste produto' };
  }
  // Etiqueta e cozinha são FK: código inexistente derrubaria o produto do
  // cardápio sem ninguém entender por quê.
  if (campo === 'categoria' && sqlVal !== 'NULL') {
    const e = await qi(`SELECT FIRST 1 CODIGO FROM ETIQUETAS WHERE CODIGO=${sqlVal} AND DATADELETE IS NULL`);
    if (!e.ok || !e.rows.length) return { ok: false, erro: 'categoria (etiqueta) não existe no PDV' };
  }
  const onde = wizard ? `CODIGO=${alvoCod}` : def.tab === 'PRODUTOS' ? `CODIGO=${prod}` : `CODIGO=${varc}`;
  const up = await qi(`UPDATE ${def.tab} SET ${def.col}=${sqlVal} WHERE ${onde}`);
  if (!up.ok) return { ok: false, erro: 'FB update: ' + up.err };
  return { ok: true };
}
// ---- ESPELHO DO WIZARD + ETIQUETAS: a loja EMPURRA pra nuvem ----
// Estas quatro tabelas ficaram fora do CDC (WIZARDPERGUNTAS, WIZARDOPCOES,
// WIZARD, ETIQUETAS). Antes só subiam por script rodado do Mac com VPN até a
// loja — o espelho vivia meses atrasado. Agora sobe daqui, de graça, junto
// com o resto do canal HMAC.
let espelhoWizardRodando = false;
async function loopEspelhoWizard() {
  if (espelhoWizardRodando || !FILIAL_ID || !PAGAR_MESA_SECRET) return;
  espelhoWizardRodando = true;
  try {
    const perg = await qi(`SELECT CODIGO C, TRIM(DESCRICAO) D, QTDRESPOSTASMIN MN, QTDRESPOSTASMAX MX
      FROM WIZARDPERGUNTAS WHERE DATADELETE IS NULL`);
    if (!perg.ok) throw new Error('perguntas: ' + perg.err);
    // nome da opção: DESCRICAO, senão OBSERVACAO, senão o nome do produto que ela lança
    const opc = await qi(`SELECT o.CODIGO C, o.CODIGOWIZARDPERGUNTA P, o.PRECOPROMO PR, o.CODIGOPRODUTODETALHE PD,
        TRIM(COALESCE(NULLIF(TRIM(o.DESCRICAO),''), NULLIF(TRIM(o.OBSERVACAO),''), pr.NOME)) N
      FROM WIZARDOPCOES o
      LEFT JOIN PRODUTODETALHE pd ON pd.CODIGO=o.CODIGOPRODUTODETALHE
      LEFT JOIN PRODUTOS pr ON pr.CODIGO=pd.CODIGOPRODUTO
      WHERE o.DATADELETE IS NULL`);
    if (!opc.ok) throw new Error('opções: ' + opc.err);
    const lig = await qi(`SELECT CODIGOPRODUTODETALHE V, CODIGOWIZARDPERGUNTA P, ORDEM O
      FROM WIZARD WHERE DATADELETE IS NULL`);
    if (!lig.ok) throw new Error('ligações: ' + lig.err);
    const eti = await qi(`SELECT CODIGO C, TRIM(DESCRICAO) D FROM ETIQUETAS WHERE DATADELETE IS NULL`);
    // Praças do KDS, observações prontas e usuários: nunca entraram no CDC e
    // são exatamente o que a operação precisa no dia em que o Firebird sair.
    const coz = await qi(`SELECT CODIGO C, TRIM(DESCRICAO) D FROM COZINHAS`);
    const obs = await qi(`SELECT o.CODIGO C, TRIM(o.DESCRICAO) T, eo.CODIGOETIQUETA E, TRIM(e.DESCRICAO) CAT
      FROM OBSERVACOES o
      LEFT JOIN ETIQUETASOBSERVACOES eo ON eo.CODIGOOBSERVACAO = o.CODIGO
      LEFT JOIN ETIQUETAS e ON e.CODIGO = eo.CODIGOETIQUETA`);
    // ACESSO tem uma linha por permissão — junta em array por usuário.
    const usu = await qi(`SELECT u.CODIGO C, TRIM(u.LOGIN) L, TRIM(COALESCE(u.NOME,'')) N,
        TRIM(COALESCE(u.TIPO,'')) T, a.PERMISSAO P
      FROM VWUSUARIOS u LEFT JOIN ACESSO a ON a.USUARIO = u.CODIGO
      WHERE u.ATIVO='S'`);
    const porUsuario = new Map();
    if (usu.ok) for (const x of usu.rows) {
      const cod = N(x.C); const login = T(x.L);
      if (!cod || !login) continue;
      let u2 = porUsuario.get(cod);
      if (!u2) {
        const tipo = T(x.T) || '';
        u2 = { c: cod, l: login, n: T(x.N) || login, t: tipo, adm: tipo.toUpperCase() === 'ADMINISTRADOR', perms: [] };
        porUsuario.set(cod, u2);
      }
      const perm = N(x.P);
      if (perm != null && !u2.perms.includes(perm)) u2.perms.push(perm);
    }
    const e = Math.floor(Date.now() / 1000) + 120;
    const corpo = {
      f: FILIAL_ID, e, s: nfceAssina('espelho', e),
      perguntas: perg.rows.map((x) => ({ c: N(x.C), d: T(x.D), mn: N(x.MN) || 0, mx: N(x.MX) || 0 })),
      opcoes: opc.rows.map((x) => ({ c: N(x.C), p: N(x.P), n: T(x.N), pr: N(x.PR) || 0, pd: N(x.PD) })),
      ligacoes: lig.rows.map((x) => ({ v: N(x.V), p: N(x.P), o: N(x.O) || 0 })),
      etiquetas: eti.ok ? eti.rows.map((x) => ({ c: N(x.C), d: T(x.D) })) : [],
      cozinhas: coz.ok ? coz.rows.map((x) => ({ c: N(x.C), d: T(x.D) })) : [],
      observacoes: obs.ok ? obs.rows.map((x) => ({ c: N(x.C), t: T(x.T), e: N(x.E), cat: T(x.CAT) })) : [],
      usuarios: [...porUsuario.values()],
    };
    const r = await fetch(`${PAGAR_MESA_URL}/api/loja/wizard-espelho`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo), signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => null);
    if (!j?.ok) console.error('[wizard] nuvem recusou:', j?.erro || r.status);
    else console.log(`[espelho] ${j.perguntas} perguntas · ${j.opcoes} opções · ${j.ligacoes} ligações · `
      + `${j.etiquetas} etiquetas · ${j.cozinhas} praças · ${j.observacoes} observações · ${j.usuarios} usuários`);
  } catch (err) { console.error('[wizard] espelho:', err.message); }
  finally { espelhoWizardRodando = false; }
}
/** Puxa da nuvem os produtos que nasceram lá e guarda localmente.
 *  Falha de rede não pode limpar o cardápio: em erro, mantém o que já tem. */
let catalogoNuvemRodando = false;
async function loopCatalogoNuvem() {
  if (catalogoNuvemRodando || !FILIAL_ID || !PAGAR_MESA_SECRET) return;
  catalogoNuvemRodando = true;
  try {
    const e = Math.floor(Date.now() / 1000) + 120;
    const qs = new URLSearchParams({ f: FILIAL_ID, e: String(e), s: nfceAssina('catalogo', e) });
    // sem Firebird, o cardápio INTEIRO vem daqui — inclusive o saldo
    if (nativo()) qs.set('tudo', '1');
    const r = await fetch(`${PAGAR_MESA_URL}/api/loja/catalogo-nuvem?${qs}`, { signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => null);
    if (!j?.ok || !Array.isArray(j.produtos)) return;
    const codigos = j.produtos.map((p) => Number(p.codigo_pdv)).filter(Number.isFinite);
    await sql.begin(async (t) => {
      for (const p of j.produtos) {
        await t`INSERT INTO produto_nuvem (codigo_pdv, produto_codigo, nome, tamanho, preco, area_codigo,
            comanda_mobile, cardapio_digital, categoria, descricao, saldo, atualizado)
          VALUES (${Number(p.codigo_pdv)}, ${Number(p.produto_codigo)}, ${p.nome || ''}, ${p.tamanho || null},
            ${Number(p.preco) || 0}, ${p.area_codigo == null ? null : Number(p.area_codigo)},
            ${p.comanda_mobile !== false}, ${!!p.cardapio_digital}, ${p.categoria || null},
            ${p.descricao || null}, ${p.saldo == null ? null : Number(p.saldo)}, now())
          ON CONFLICT (codigo_pdv) DO UPDATE SET produto_codigo=EXCLUDED.produto_codigo, nome=EXCLUDED.nome,
            tamanho=EXCLUDED.tamanho, preco=EXCLUDED.preco, area_codigo=EXCLUDED.area_codigo,
            comanda_mobile=EXCLUDED.comanda_mobile, cardapio_digital=EXCLUDED.cardapio_digital,
            categoria=EXCLUDED.categoria, descricao=EXCLUDED.descricao, saldo=EXCLUDED.saldo, atualizado=now()`;
      }
      // pausado/descontinuado na nuvem some daqui — a resposta é a lista inteira
      if (codigos.length) await t`DELETE FROM produto_nuvem WHERE NOT (codigo_pdv = ANY(${codigos}))`;
      else await t`DELETE FROM produto_nuvem`;
    });
    // Praças, observações e wizard vêm junto no modo próprio — tudo isso
    // morria com o Firebird e é o que o KDS e a comanda usam.
    if (nativo()) {
      if (Array.isArray(j.areas) && j.areas.length) {
        for (const a of j.areas) {
          await sql`INSERT INTO area (codigo, nome) VALUES (${Number(a.codigo)}, ${a.nome})
            ON CONFLICT (codigo) DO UPDATE SET nome=EXCLUDED.nome`;
        }
      }
      if (Array.isArray(j.observacoes)) {
        const obs = j.observacoes.filter((o) => o && o.categoria && o.texto)
          .map((o) => ({ categoria: o.categoria, texto: o.texto }));
        await sql.begin(async (t) => {
          await t`TRUNCATE observacao_sugerida`;
          if (obs.length) await t`INSERT INTO observacao_sugerida ${t(obs, 'categoria', 'texto')}`;
        });
      }
      const w = j.wizard;
      if (w && Array.isArray(w.perguntas)) {
        await sql.begin(async (t) => {
          await t`TRUNCATE wizard_pergunta`; await t`TRUNCATE wizard_opcao`; await t`TRUNCATE wizard_produto`;
          for (const x of w.perguntas) {
            await t`INSERT INTO wizard_pergunta (codigo, texto, min, max)
              VALUES (${Number(x.codigo)}, ${x.texto || ''}, ${Number(x.min) || 0}, ${Number(x.max) || 0})`;
          }
          for (const x of w.opcoes || []) {
            await t`INSERT INTO wizard_opcao (codigo, pergunta, nome, preco, produto_pdv)
              VALUES (${Number(x.codigo)}, ${Number(x.pergunta)}, ${x.nome || ''},
                ${Number(x.preco) || 0}, ${x.produto_pdv == null ? null : Number(x.produto_pdv)})`;
          }
          for (const x of w.ligacoes || []) {
            await t`INSERT INTO wizard_produto (codigo_pdv, pergunta, ordem)
              VALUES (${Number(x.codigo_pdv)}, ${Number(x.pergunta)}, ${Number(x.ordem) || 0})
              ON CONFLICT DO NOTHING`;
          }
        });
      }
    }
    console.log('[catalogo-nuvem] ' + j.produtos.length + ' produto(s)'
      + (nativo() ? ` · ${(j.areas || []).length} praças · ${(j.observacoes || []).length} observações`
        + ` · ${((j.wizard || {}).perguntas || []).length} perguntas` : ' da nuvem no cardápio'));
    if (nativo()) await catalogoNativo();
  } catch (err) { console.error('[catalogo-nuvem]', err.message); }
  finally { catalogoNuvemRodando = false; }
}
/** No banco próprio o cardápio da loja é REMONTADO do que a nuvem mandou.
 *  Mesmo formato de produto_local que o Firebird produzia, então nenhuma tela
 *  muda: garçom, KDS, caixa e cliente continuam lendo a mesma tabela. */
async function catalogoNativo() {
  const rows = await sql`SELECT codigo_pdv, produto_codigo, nome, tamanho, preco, area_codigo,
      comanda_mobile, cardapio_digital, categoria, descricao, saldo FROM produto_nuvem`;
  if (!rows.length) { console.error('[catalogo] nuvem não mandou nada — mantendo o cardápio atual'); return; }
  const redir = await mapaRedirPracas();
  const porItem = await mapaItemPraca();
  const fora = await itensForaKds();
  const linhas = rows.map((x) => {
    const nome = String(x.nome || '?');
    const tam = x.tamanho || null;
    let area = x.area_codigo == null ? null : Number(x.area_codigo);
    if (area != null && redir.has(area)) area = redir.get(area);
    const nm = semAcento(nome + ' ' + (tam || ''));
    for (const r of porItem) if (nm.includes(r.termo)) { area = r.area; break; }
    if (fora.length && fora.some((t) => nm.includes(t))) area = null;
    const saldo = x.saldo == null ? null : Number(x.saldo);
    return { codigo_pdv: Number(x.codigo_pdv), produto_codigo: Number(x.produto_codigo), nome, tamanho: tam,
      preco: Number(x.preco) || 0, area_codigo: area, comanda_mobile: x.comanda_mobile !== false,
      nome_busca: nm, categoria: x.categoria || 'Outros', categoria_ordem: 999,
      sem_estoque: saldo != null && saldo <= 0, estoque: saldo,
      cardapio_digital: !!x.cardapio_digital, descricao: x.descricao || null, preparo: null };
  });
  await sql.begin(async (t) => {
    await t`TRUNCATE produto_local`;
    await t`INSERT INTO produto_local ${t(linhas, 'codigo_pdv', 'produto_codigo', 'nome', 'tamanho', 'preco',
      'area_codigo', 'comanda_mobile', 'nome_busca', 'categoria', 'categoria_ordem', 'sem_estoque', 'estoque',
      'cardapio_digital', 'descricao', 'preparo')}`;
  });
  console.log('[catalogo] modo próprio: ' + linhas.length + ' itens no cardápio da loja');
}
let produtoFilaRodando = false;
async function loopProdutoFila() {
  if (produtoFilaRodando || !FILIAL_ID || !PAGAR_MESA_SECRET) return;
  produtoFilaRodando = true;
  try {
    const e = Math.floor(Date.now() / 1000) + 120;
    const q2 = new URLSearchParams({ f: FILIAL_ID, e: String(e), s: nfceAssina('produto', e) });
    const r = await fetch(`${PAGAR_MESA_URL}/api/loja/produto-fila?${q2}`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => null);
    if (!j?.ok || !j.alteracoes?.length) return;
    let mudou = 0;
    for (const a of j.alteracoes) {
      let res;
      try { res = await fbAlterarProduto(a); }
      catch (err) { res = { ok: false, erro: err.message }; }
      if (res.ok) mudou++;
      const e2 = Math.floor(Date.now() / 1000) + 120;
      await fetch(`${PAGAR_MESA_URL}/api/loja/produto-fila`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ f: FILIAL_ID, e: e2, s: nfceAssina('produto', e2), id: a.id,
          ok: !!res.ok, erro: res.erro || null }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
      console.log('[produto] ' + a.campo + '=' + a.valor + ' no produto ' + a.produto
        + (a.variante ? '/tam ' + a.variante : '') + ' → ' + (res.ok ? 'aplicado' : 'ERRO: ' + res.erro));
    }
    // Catálogo da loja (garçom, KDS, cardápio do cliente) sai do espelho local:
    // sem isto o preço novo só apareceria no próximo ciclo de 5 min.
    if (mudou) await espelhoCatalogo().catch((err) => console.error('[produto] espelho:', err.message));
    // Mexeu em pergunta/opção? O espelho da nuvem é substituído por envio
    // inteiro — sem isso a tela mostraria o texto velho até o próximo ciclo.
    if (j.alteracoes.some((a) => String(a.campo || '').startsWith('pergunta_') || String(a.campo || '').startsWith('opcao_'))) {
      await loopEspelhoWizard().catch(() => {});
    }
  } catch (err) { console.error('[produto] fila:', err.message); }
  finally { produtoFilaRodando = false; }
}
// ─────────── RECEBIMENTO MANUAL COM COMPROVANTE ───────────
// A maquininha às vezes recebe e NÃO baixa a comanda (queda de rede, timeout,
// operador que fechou a tela). O dinheiro entrou, a conta continua aberta — e
// hoje o caixa não tem como registrar isso sem inventar.
//
// Aqui ele registra na mão: mesa, forma, valor. Em forma eletrônica a FOTO do
// comprovante é obrigatória — é o que separa "recebi no Pix" de conferência de
// verdade. Se o tablet não tem câmera (ou está em HTTP, onde o navegador não
// libera), a tela mostra um QR: o caixa fotografa pelo próprio celular e a
// imagem chega aqui em segundos, sem depender de internet — é tudo na LAN.
//
// PARCIAL É A REGRA, NÃO A EXCEÇÃO: conta de 100 pode entrar 10 no Pix, 50 no
// cartão e 40 em dinheiro. Cada entrada é um recebimento com seu comprovante,
// e a conta só fecha quando o total é alcançado.
const FORMAS_MANUAIS = {
  dinheiro: { codigo: FORMA.DINHEIRO, nome: 'Dinheiro', foto: false },
  credito: { codigo: FORMA.CREDITO, nome: 'Crédito', foto: true },
  debito: { codigo: FORMA.DEBITO, nome: 'Débito', foto: true },
  pix: { codigo: FORMA.PIX_MANUAL, nome: 'Pix', foto: true },
};
function tokenComprovante() {
  return randomBytes(9).toString('base64url');
}
/** Abre um token pra foto vir do celular (QR na tela do caixa). */
// ENDEREÇO PÚBLICO DA LOJA (Tailscale Funnel). O link da LAN é o melhor —
// rápido e funciona sem internet — mas só serve pra celular NO Wi-Fi da casa.
// Celular no 4G nunca alcança 10.0.0.252, e é isso que trava o caixa em
// "aguardando a foto". O Funnel já está ligado na 0001 e tem TLS válido, então
// vale como plano B. Descobre sozinho pelo próprio Tailscale: sem config,
// sem hostname chumbado. Uma vez só por boot.
let urlExternaCache;
async function urlExterna() {
  if (urlExternaCache !== undefined) return urlExternaCache;
  const daConfig = (await cfgGet('url_externa', '')) || process.env.URL_EXTERNA || '';
  if (daConfig) { urlExternaCache = daConfig.replace(/\/+$/, ''); return urlExternaCache; }
  urlExternaCache = await new Promise((ok) => {
    const exe = process.platform === 'win32'
      ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale';
    execFile(exe, ['status', '--json'], { timeout: 4000 }, (err, out) => {
      if (err) return ok(null);
      try {
        const dns = String(JSON.parse(out)?.Self?.DNSName || '').replace(/\.+$/, '');
        ok(dns ? 'https://' + dns : null);
      } catch { ok(null); }
    });
  });
  if (urlExternaCache) console.log('[comprovante] endereço externo: ' + urlExternaCache);
  return urlExternaCache;
}
async function apiComprovanteAbrir(body, quem) {
  const numero = Number(body.numero) || 0;
  if (!numero) return { ok: false, erro: 'mesa inválida' };
  const token = tokenComprovante();
  await sql`INSERT INTO comprovante_token (token, numero, valor, forma, login)
    VALUES (${token}, ${numero}, ${Number(body.valor) || null}, ${String(body.forma || '')}, ${quem?.login || null})`;
  // Padrão: IP da loja em HTTP — o celular não precisa de internet nem de
  // aceitar certificado, e a página usa <input capture>, que funciona sem
  // contexto seguro (a câmera via getUserMedia, não).
  const externo = body.externo === true;
  const base = externo ? await urlExterna() : ipDaLoja();
  if (externo && !base) return { ok: false, erro: 'esta loja não tem endereço externo configurado' };
  const url = base + '/comprovante?t=' + token + (String(body.forma || '') === 'devolucao' ? '&d=1' : '');
  return { ok: true, token, url, qr: qrSvg(url, 190), externo, tem_externo: !!(await urlExterna()) };
}
/** O celular manda a foto. Sem sessão de propósito: quem tem o token, tem o
 *  direito — o token vive 10 minutos e serve uma vez só. */
/** Manda a foto pra nuvem LER (a chave da IA é de lá, não do start.bat).
 *  Nunca lança: internet caída = recebimento segue sem os dados, porque a foto
 *  sozinha já era a prova. O OCR enriquece, não autoriza. */
async function lerComprovanteNaNuvem(arquivo) {
  if (!FILIAL_ID || !PAGAR_MESA_SECRET || !arquivo) return null;
  try {
    const caminho = path.join(DIR_FOTOS, arquivo);
    if (!existsSync(caminho)) return null;
    const b64 = readFileSync(caminho).toString('base64');
    const e = Math.floor(Date.now() / 1000) + 120;
    const r = await fetch(`${PAGAR_MESA_URL}/api/loja/comprovante-ler`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ f: FILIAL_ID, e, s: nfceAssina('ocr', e),
        foto: 'data:image/jpeg;base64,' + b64 }),
      signal: AbortSignal.timeout(25000),
    });
    const j = await r.json().catch(() => null);
    if (!j?.ok || !j.dados) return null;
    console.log('[comprovante] lido: ' + [j.dados.operadora, j.dados.tipo,
      j.dados.nsu ? 'NSU ' + j.dados.nsu : null, j.dados.via ? 'via ' + j.dados.via : null,
      j.dados.valor != null ? 'R$ ' + j.dados.valor : null].filter(Boolean).join(' · '));
    return j.dados;
  } catch (err) { console.error('[comprovante] OCR:', err.message); return null; }
}
async function apiComprovanteEnviar(body) {
  const t = String(body.t || '').slice(0, 40);
  const [row] = await sql`SELECT token, arquivo, forma FROM comprovante_token
    WHERE token=${t} AND criado_em > now() - interval '10 minutes' AND usado_em IS NULL`;
  if (!row) return { ok: false, erro: 'este link expirou — peça outro no caixa' };
  const arq = guardaFoto(body.foto);
  if (!arq) return { ok: false, erro: 'não consegui ler a foto' };
  await sql`UPDATE comprovante_token SET arquivo=${arq}, enviado_em=now() WHERE token=${t}`;
  // lê em segundo plano: o celular não espera a IA pra dizer "enviado".
  // Foto de DEVOLUÇÃO (garrafa devolvida) não é comprovante — não tem o que ler.
  if (row.forma !== 'devolucao') {
    lerComprovanteNaNuvem(arq).then(async (d) => {
      if (d) await sql`UPDATE comprovante_token SET dados=${JSON.stringify(d)} WHERE token=${t}`;
    }).catch(() => {});
  }
  return { ok: true };
}
/** Chegou comprovante? Pergunta pelo TOKEN e, se não veio nele, POR MESA.
 *
 *  Por que por mesa: cada toque em "Pelo meu celular" cria um token novo, e o
 *  celular fica com a página do QR que ele escaneou — que pode ser o anterior.
 *  A foto então chega num token e o caixa fica esperando em outro, para sempre
 *  ("aguardando a foto" com o celular mostrando ✓ Enviado — aconteceu em
 *  20/08). O caixa não tem como saber disso, e nem deveria: o que importa é
 *  que chegou um comprovante PRA ESTA MESA, agora. */
async function apiComprovanteStatus(t, numero = null, forma = null) {
  const tok = String(t || '').slice(0, 40);
  const [row] = tok
    ? await sql`SELECT arquivo, enviado_em, aberto_em, dados FROM comprovante_token WHERE token=${tok}`
    : [null];
  if (row && row.arquivo) {
    return { ok: true, chegou: true, arquivo: row.arquivo, abriu: true, token: tok, dados: row.dados || null };
  }
  const n = Number(numero) || 0;
  if (n) {
    const [outro] = await sql`SELECT token, arquivo, dados FROM comprovante_token
      WHERE numero=${n} AND arquivo IS NOT NULL AND usado_em IS NULL
        AND criado_em > now() - interval '30 minutes'
        AND (${forma}::text IS NULL OR forma=${forma}::text)
      ORDER BY enviado_em DESC LIMIT 1`;
    if (outro) return { ok: true, chegou: true, arquivo: outro.arquivo, abriu: true, token: outro.token, dados: outro.dados || null };
  }
  if (!row) return { ok: false, erro: 'token desconhecido' };
  return { ok: true, chegou: false, arquivo: null, abriu: !!row.aberto_em, token: tok };
}
/** A página do celular carregou: marca aberto_em pro caixa saber que o QR foi lido. */
async function comprovanteAbriu(t) {
  const tok = String(t || '').slice(0, 40);
  if (!tok) return;
  try { await sql`UPDATE comprovante_token SET aberto_em=COALESCE(aberto_em, now()) WHERE token=${tok}`; } catch { /* segue */ }
}
/** Foto tirada NO TABLET: grava e manda ler, igual à que vem do celular.
 *  Unifica os dois caminhos — antes a do tablet só era gravada na confirmação,
 *  tarde demais pra preencher o NSU na tela. */
async function apiComprovanteFoto(body, quem) {
  const arq = guardaFoto(body.foto);
  if (!arq) return { ok: false, erro: 'não consegui ler a foto' };
  const numero = Number(body.numero) || 0;
  const token = tokenComprovante();
  await sql`INSERT INTO comprovante_token (token, numero, valor, forma, arquivo, login, enviado_em, aberto_em)
    VALUES (${token}, ${numero}, ${Number(body.valor) || null}, ${String(body.forma || '')},
      ${arq}, ${quem?.login || null}, now(), now())`;
  const dados = String(body.forma || '') === 'devolucao' ? null : await lerComprovanteNaNuvem(arq);
  if (dados) await sql`UPDATE comprovante_token SET dados=${JSON.stringify(dados)} WHERE token=${token}`;
  return { ok: true, token, arquivo: arq, dados: dados || null };
}
/** Registra o recebimento e devolve quanto ainda falta na conta. */
/** NSU repetido no MESMO DIA = comprovante usado duas vezes (erro ou golpe).
 *  Devolve o pagamento que já usa o número, ou null se está livre. */
async function nsuJaUsadoHoje(nsu) {
  const n = String(nsu ?? '').replace(/\D/g, '');
  if (!n) return null;
  const r = await qi(`SELECT FIRST 1 CODIGO, CODIGOPEDIDO PED, CAST(VALOR AS NUMERIC(12,2)) V
    FROM PAGAMENTOS WHERE NSUTRANSACAO=${n} AND DATADELETE IS NULL
      AND CAST(DATAPAGAMENTO AS DATE) = CURRENT_DATE`);
  return r.ok && r.rows.length
    ? { pagamento: Number(r.rows[0].CODIGO), pedido: Number(r.rows[0].PED) || null, valor: Number(r.rows[0].V) || 0 }
    : null;
}
async function apiCaixaReceberManual(body, quem) {
  const numero = Number(body.numero) || 0;
  const f = FORMAS_MANUAIS[String(body.forma || '')];
  const valor = +Number(body.valor || 0).toFixed(2);
  if (!numero) return { ok: false, erro: 'mesa inválida' };
  if (!f) return { ok: false, erro: 'forma inválida' };
  if (!(valor > 0)) return { ok: false, erro: 'valor inválido' };
  if (body.nsu) {
    const dup = await nsuJaUsadoHoje(body.nsu);
    if (dup) return { ok: false, erro: `Esse NSU já foi usado HOJE no pedido ${dup.pedido ?? '?'} (R$ ${dup.valor.toFixed(2).replace('.', ',')}). Confira o comprovante — cada cupom vale uma vez.` };
  }
  // dinheiro segue a MESMA trava de sempre: só entra no caixa do operador
  let caixaCodigo = null;
  if (f.codigo === FORMA.DINHEIRO) {
    const cx = await fbCaixaDoOperador(quem.login);
    if (!cx) return { ok: false, sem_caixa: true, erro: 'Abra o SEU caixa antes de receber dinheiro.' };
    caixaCodigo = cx.codigo;
  }
  // comprovante: da câmera do tablet (dataUrl) ou do token que o celular usou
  let arquivo = null;
  if (body.token) {
    const st = await apiComprovanteStatus(body.token, numero);
    if (st.ok && st.arquivo) {
      arquivo = st.arquivo;
      // queima o token que REALMENTE trouxe a foto (pode não ser o da tela)
      await sql`UPDATE comprovante_token SET usado_em=now() WHERE token=${String(st.token || body.token)}`;
    }
  } else if (body.foto) {
    arquivo = guardaFoto(body.foto);
  }
  if (f.foto && !arquivo) return { ok: false, precisa_foto: true, erro: 'essa forma exige a foto do comprovante' };

  const r = await apiContaPagar({
    numero, ped: body.ped, forma: String(body.forma), valor, modo: 'manual', caixa_codigo: caixaCodigo,
    permitir_servico: true, nsu: body.nsu || null,
    // a foto é o que autoriza cartão/Pix na mão — sem ela, a trava barra
    comprovante: !!arquivo,
    origem: arquivo ? 'manual-foto' : 'manual',
    observacao: 'Recebimento manual · ' + (quem.nome || quem.login),
  });
  if (!r.ok) return r;
  const d = body.dados && typeof body.dados === 'object' ? body.dados : null;
  try {
    await sql`INSERT INTO recebimento_foto (numero, pedido, pagamento_codigo, forma, valor, arquivo, nsu, login,
        operadora, bandeira, tipo_transacao, via, autorizacao, valor_lido, id_pix, dados)
      VALUES (${numero}, ${null}, ${r.pagamento_fb ?? null}, ${f.nome}, ${valor},
        ${arquivo}, ${body.nsu ? String(body.nsu).slice(0, 30) : null}, ${quem.login},
        ${d?.operadora || null}, ${d?.bandeira || null}, ${d?.tipo || null}, ${d?.via || null},
        ${d?.autorizacao || null}, ${d?.valor ?? null}, ${d?.idPix || null},
        ${d ? JSON.stringify(d) : null})`;
  } catch (e) { console.error('[manual] índice do comprovante:', e.message); }
  // quitou = fecha a conta, igual ao recebimento em dinheiro
  if (r.quitada) { try { const fe = await apiCaixaFechar(numero, body.ped); r.fechada = !!fe.ok; } catch { r.fechada = false; } }
  return { ...r, forma: f.nome, comprovante: arquivo };
}
/** Fecha a conta lançando o que falta no fiado do cliente. */
/** Carimba no pedido de quem é o fiado (e o cliente, se ainda não tinha). */
async function pedFiado(ped, clienteCod) {
  if (nativo()) {
    await sql`UPDATE comanda SET contato_codigo=COALESCE(contato_codigo, ${Number(clienteCod)}),
        fiado_codigo=${Number(clienteCod)} WHERE codigo=${Number(ped)}`;
    return;
  }
  await qi(`UPDATE PEDIDOS SET CODIGOCONTATOFIADO=${Number(clienteCod)},
    CODIGOCONTATOCLIENTE=COALESCE(CODIGOCONTATOCLIENTE, ${Number(clienteCod)}) WHERE CODIGO=${Number(ped)}`);
}
async function apiCaixaFiado(body, quem) {
  if (!(quem && quem.fiado)) return { ok: false, erro: 'sem permissão de fiado (Conta Corrente no Consumer)' };
  const n = Number(body.numero);
  const ped = await pedidoAlvo(n, body.ped);
  if (!ped) return { ok: false, erro: 'comanda não está aberta' };
  const cli = await fbClienteFiado(Number(body.cliente));
  if (!cli) return { ok: false, erro: 'cliente não encontrado' };
  // ⚠️ REALIDADE DA CASA (19/08): há R$ 173 mil de fiado em aberto e NENHUM
  // cliente com limite cadastrado (só o Júlio, R$ 100). Exigir limite é a
  // regra do dono, mas ligá-la de uma vez pararia o fiado inteiro — então
  // vive em cfg 'fiado_exige_limite' (padrão SIM). Pra soltar enquanto os
  // limites não são cadastrados: gravar 'nao' nessa config.
  const exigeLimite = String(await cfgGet('fiado_exige_limite', 'sim')).toLowerCase() !== 'nao';
  if (exigeLimite && !cli.habilitado) return { ok: false, sem_limite: true, erro:
    `${cli.nome} não está habilitado pra fiado — cadastre o limite de crédito no Consumer (Financeiro > Conta Corrente)` };
  const tot = (await pedTotais(ped))?.total || 0;
  const pago = await fbPagoDoPedido(ped);
  const falta = +(tot - pago).toFixed(2);
  if (!(falta > 0.009)) return { ok: false, erro: 'essa conta já está quitada' };
  if (cli.habilitado && cli.bloqueia && falta > cli.disponivel + 0.009) {
    return { ok: false, estourou: true, erro:
      `passa do limite de ${cli.nome}: disponível R$ ${cli.disponivel.toFixed(2)} e a conta é R$ ${falta.toFixed(2)}` };
  }
  const novoSaldo = +(cli.saldo + falta).toFixed(2);
  const obs = `Fiado - pedido nº ${ped} no valor de R$ ${falta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  // O lançamento é o MESMO dos dois lados (crédito = dívida do cliente):
  // fbLancarContaCorrente já sabe escrever no banco certo e mantém o saldo do
  // cadastro alinhado — antes isto era SQL repetido aqui, e o modo próprio
  // ficaria de fora.
  const u = nativo() ? { codigo: quem.login } : await fbUsuarioCodigo(quem.login);
  const lanc = await fbLancarContaCorrente({ cliente: cli.codigo, tipo: 'credito', valor: falta,
    obs, pedido: ped, usuarioCod: u ? u.codigo : null });
  if (!lanc.ok) return { ok: false, erro: lanc.erro || 'não deu pra lançar no fiado' };
  await pedFiado(ped, cli.codigo);
  await fbFecharPedido(ped);
  await sql`UPDATE mesa_comanda SET fechada_em=now() WHERE comanda=${n} AND fechada_em IS NULL`;
  await sql`UPDATE identificacao SET fechada_em=now() WHERE numero=${n} AND fechada_em IS NULL`;
  espelho().catch(() => {});
  return { ok: true, cliente: cli.nome, valor: falta, saldo_novo: novoSaldo,
    disponivel: +(cli.limite - novoSaldo).toFixed(2) };
}
/** TIRAR OS 10% quando o cliente não quer pagar (e devolver, se foi engano).
 *  É a mesma permissão do desconto no Consumer (12 = "Aplicar Descontos /
 *  Modificar Taxas"), porque é exatamente isso: mexer na taxa. Zera o campo
 *  TOTALSERVICO em vez de virar desconto — assim relatório e comissão do
 *  garçom mostram a verdade (serviço não cobrado), não uma venda com desconto. */
async function apiCaixaServico(body, quem) {
  if (!(quem && quem.desconto)) return { ok: false, erro: 'sem permissão (Aplicar Descontos / Modificar Taxas)' };
  const n = Number(body.numero);
  const ped = await pedidoAlvo(n, body.ped);
  if (!ped) return { ok: false, erro: 'comanda não está aberta' };
  const p = (await qi(`SELECT TOTALSERVICO SVC, VALORTOTALITENS ITENS, VALORTOTAL TOT FROM PEDIDOS WHERE CODIGO=${ped}`)).rows?.[0] || {};
  const svcAtual = Number(p.SVC) || 0;
  const tirar = body.tirar !== false;
  if (tirar) {
    if (!(svcAtual > 0.009)) return { ok: false, erro: 'essa conta já está sem os 10%' };
    const pago = await fbPagoDoPedido(ped);
    const novoTot = +((Number(p.TOT) || 0) - svcAtual).toFixed(2);
    if (novoTot + 0.009 < pago) return { ok: false, erro: `já entraram R$ ${pago.toFixed(2)} nessa conta — o total não pode ficar abaixo do pago` };
    await fbRemoverServico(ped);
    await sql`INSERT INTO servico_ajuste (login, numero, pedido_fb, acao, valor, motivo)
      VALUES (${quem.login}, ${n}, ${ped}, ${'tirou'}, ${svcAtual}, ${String(body.motivo || '').slice(0, 200) || null})`;
    espelho().catch(() => {});
    return { ok: true, acao: 'tirou', valor: svcAtual, novo_total: novoTot };
  }
  if (svcAtual > 0.009) return { ok: false, erro: 'essa conta já está com os 10%' };
  const svc = await fbAplicarServico(ped);
  await sql`INSERT INTO servico_ajuste (login, numero, pedido_fb, acao, valor, motivo)
    VALUES (${quem.login}, ${n}, ${ped}, ${'devolveu'}, ${svc || 0}, ${null})`;
  espelho().catch(() => {});
  return { ok: true, acao: 'devolveu', valor: svc || 0 };
}
// Sangria/despesa/suprimento — mexe na GAVETA do operador logado. Tipos do
// Consumer (conferidos em 16,5 mil operações reais do banco da 0003):
//   S = sangria (retirada pro cofre, as grandes) · D = despesa paga da gaveta
//   (vale-transporte etc.) · A = entrada/suprimento. Motivo é obrigatório.
async function apiCaixaMovimento(body, quem) {
  if (!(quem && quem.movimentar)) return { ok: false, erro: 'sem permissão (Caixa > Realizar entradas e saídas)' };
  const cx = await fbCaixaDoOperador(quem.login);
  if (!cx) return { ok: false, erro: 'abra o SEU caixa antes de mexer na gaveta' };
  const MAPA = { sangria: { tipo: 'S', campo: 'VALORSAIDA' }, despesa: { tipo: 'D', campo: 'VALORSAIDA' }, suprimento: { tipo: 'A', campo: 'VALORENTRADA' } };
  const m = MAPA[String(body.tipo || '')];
  if (!m) return { ok: false, erro: 'tipo inválido' };
  const valor = +Number(body.valor || 0).toFixed(2);
  if (!(valor > 0)) return { ok: false, erro: 'valor inválido' };
  const motivo = String(body.motivo || '').trim();
  if (!motivo) return { ok: false, erro: 'diga o motivo — sangria sem motivo não existe' };
  // sangria registra QUEM LEVA o dinheiro (regra do dono): o caixa entrega pra
  // alguém, e é esse alguém que responde pelo valor até chegar no cofre
  const leva = String(body.quem_leva || '').trim();
  if (body.tipo === 'sangria' && !leva) return { ok: false, erro: 'diga QUEM está levando o dinheiro' };
  if (m.campo === 'VALORSAIDA') {
    const r = await fbResumoCaixa(cx.codigo);
    const gaveta = +(cx.fundo + r.dinheiro + r.entradas - r.saidas).toFixed(2);
    if (valor > gaveta + 0.009) return { ok: false, erro: `a gaveta não tem esse valor (esperado: R$ ${gaveta.toFixed(2)})` };
  }
  // DESPESA cria a conta a pagar linkada ao FORNECEDOR, idêntico ao Consumer
  // (conferido no banco: categoria 32, competência 'cx', parcela 1/1, paga na
  // hora, descrição "Saída do caixa N . motivo" — até vale-transporte é assim,
  // com o funcionário cadastrado como fornecedor)
  let contasPagar = null;
  if (body.tipo === 'despesa' && !nativo()) {
    const forn = Number(body.fornecedor_codigo) || 0;
    if (!forn) return { ok: false, erro: 'busque e escolha quem está recebendo (fornecedor/pessoa)' };
    const desc = `Saída do caixa ${cx.codigo} . ${motivo}`;
    const insCp = await qi(`INSERT INTO CONTASPAGAR (CODIGOCATEGORIACONTAS, CODIGOFORNECEDOR, PARCELA, TOTALPARCELAS, DATAVENCIMENTO, VALOR, DATAPAGAMENTO, VALORPAGO, DATACADASTRO, COMPETENCIA, DESCRICAO, OBSERVACAO)
      VALUES (32, ${forn}, 1, 1, CURRENT_DATE, ${fbNum(valor)}, CURRENT_DATE, ${fbNum(valor)}, CURRENT_TIMESTAMP, 'cx', '${fbEsc(desc)}', 'Conta criada automaticamente ao executar saída do caixa.')`);
    if (!insCp.ok) return { ok: false, erro: 'FB conta a pagar: ' + insCp.err };
    const g = await qi(`SELECT FIRST 1 CODIGO FROM CONTASPAGAR WHERE CODIGOFORNECEDOR=${forn} AND COMPETENCIA='cx' ORDER BY CODIGO DESC`);
    contasPagar = g.ok && g.rows.length ? Number(g.rows[0].CODIGO) : null;
  }
  const obs = (body.tipo === 'sangria' ? 'levou: ' + leva + ' · ' : '') + motivo + ' · ' + (quem.nome || quem.login);
  if (nativo()) {
    // A despesa vira lançamento do caixa e sobe pro Financeiro pela nuvem —
    // aqui não existe CONTASPAGAR (esse módulo é do Concilia, não da loja).
    await sql`INSERT INTO caixa_operacao_local (caixa_codigo, tipo, valor, forma_codigo, obs, login, quando)
      VALUES (${Number(cx.codigo)}, ${String(body.tipo)}, ${Number(valor)}, ${FORMA.DINHEIRO},
        ${obs}, ${quem.login || null}, now())`;
    const cp = await comprovanteGaveta(cx, quem, body, valor, motivo, leva);
    return { ok: true, tipo: body.tipo, valor, contas_pagar: null, ...cp };
  }
  const campos = ['CODIGOCAIXA', 'CODIGOFORMAPAGAMENTO', 'DATAOPERACAO', m.campo, 'OBSERVACAO', 'TIPO'];
  const vals = [String(cx.codigo), String(FORMA.DINHEIRO), 'CURRENT_TIMESTAMP', fbNum(valor), `'${fbEsc(obs)}'`, `'${m.tipo}'`];
  if (contasPagar != null) { campos.push('CODIGOCONTASPAGAR'); vals.push(String(contasPagar)); }
  const ins = await qi(`INSERT INTO CAIXAOPERACAO (${campos.join(', ')}) VALUES (${vals.join(', ')})`);
  if (!ins.ok) return { ok: false, erro: 'FB movimento: ' + ins.err };
  const cp = await comprovanteGaveta(cx, quem, body, valor, motivo, leva);
  return { ok: true, tipo: body.tipo, valor, contas_pagar: contasPagar, ...cp };
}
/** Monta e imprime o comprovante do movimento; devolve o que a tela mostra.
 *  Nunca derruba o movimento: o dinheiro JÁ saiu quando isto roda — falha de
 *  impressora não pode desfazer nem esconder o lançamento. */
async function comprovanteGaveta(cx, quem, body, valor, motivo, leva) {
  try {
    const r = await fbResumoCaixa(cx.codigo).catch(() => null);
    const gaveta = r ? +(cx.fundo + r.dinheiro + r.entradas - r.saidas).toFixed(2) : null;
    const d = { tipo: String(body.tipo), valor, motivo,
      para: body.tipo === 'sangria' ? leva : (String(body.fornecedor_nome || '').trim() || null),
      caixa: cx.codigo, operador: quem.nome || quem.login,
      quando: new Date().toISOString(), gaveta_depois: gaveta ?? 0 };
    const impresso = await imprimirGaveta(d);
    if (!impresso) console.log('[gaveta] ' + d.tipo + ' R$ ' + valor.toFixed(2) + ' · ' + motivo +
      ' · caixa ' + cx.codigo + ' · ' + d.operador + (d.para ? ' · para ' + d.para : '') + ' — SEM IMPRESSORA');
    return { comprovante: d, impresso };
  } catch (e) { console.error('[gaveta] comprovante: ' + e.message); return { comprovante: null, impresso: false }; }
}
/** Busca de fornecedor pra despesa da gaveta (funcionário também é fornecedor). */
async function apiCaixaFornecedores(qRaw) {
  const t = String(qRaw || '').trim().toUpperCase();
  if (t.length < 2) return { ok: true, fornecedores: [] };
  const r = await qi(`SELECT FIRST 12 CODIGO, TRIM(NOME) NOME, TRIM(COALESCE(CNPJOUCPF,'')) DOC FROM FORNECEDORES
    WHERE DATADELETE IS NULL AND UPPER(NOME) LIKE '%${fbEsc(t)}%' ORDER BY NOME`);
  if (!r.ok) return { ok: false, erro: r.err };
  return { ok: true, fornecedores: r.rows.map((x) => ({ codigo: Number(x.CODIGO), nome: T(x.NOME), doc: T(x.DOC) })) };
}
// Relatório/MOVIMENTO do caixa de um DIA (default hoje): totais por forma,
// os caixas (por operador) COM a quebra por forma de cada um, e a gaveta.
// `data` = 'YYYY-MM-DD' pra ver outros dias.
async function apiCaixaRelatorio(data) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(data || '')) ? String(data) : null;
  const ini = d ? `TIMESTAMP '${d} 00:00:00'` : 'CURRENT_DATE';
  const fim = `DATEADD(1 DAY TO ${ini})`;
  const formas = await qi(`SELECT p.CODIGOFORMAPAGAMENTO F, TRIM(COALESCE(f.DESCRICAO,'')) NOME, SUM(p.VALOR) V, COUNT(*) N
    FROM PAGAMENTOS p LEFT JOIN FORMASPAGAMENTO f ON f.CODIGO=p.CODIGOFORMAPAGAMENTO
    WHERE p.DATADELETE IS NULL AND p.DATAPAGAMENTO >= ${ini} AND p.DATAPAGAMENTO < ${fim}
    GROUP BY p.CODIGOFORMAPAGAMENTO, f.DESCRICAO ORDER BY 3 DESC`);
  if (!formas.ok) return { ok: false, erro: 'FB relatório: ' + formas.err };
  // POR CAIXA e forma = o "por usuário": cada operador com seu dinheiro/cartão/Pix.
  const porCx = await qi(`SELECT p.CODIGOCAIXA CX, p.CODIGOFORMAPAGAMENTO F, TRIM(COALESCE(f.DESCRICAO,'')) NOME, SUM(p.VALOR) V, COUNT(*) N
    FROM PAGAMENTOS p LEFT JOIN FORMASPAGAMENTO f ON f.CODIGO=p.CODIGOFORMAPAGAMENTO
    WHERE p.DATADELETE IS NULL AND p.DATAPAGAMENTO >= ${ini} AND p.DATAPAGAMENTO < ${fim}
    GROUP BY p.CODIGOCAIXA, p.CODIGOFORMAPAGAMENTO, f.DESCRICAO`);
  const caixas = await qi(`SELECT c.CODIGO, TRIM(COALESCE(u.NOME, u.LOGIN)) QUEM, c.DATAABERTURA, c.DATAFECHAMENTO, c.SALDOINICIAL, c.SALDOFINAL, c.SALDOFINALINFORMADO,
      CAST(c.OBSERVACAO AS VARCHAR(120)) OBS
    FROM CAIXA c LEFT JOIN VWUSUARIOS u ON u.CODIGO=c.CODIGOUSUARIO
    WHERE (c.DATAABERTURA >= ${ini} AND c.DATAABERTURA < ${fim}) OR (c.DATAFECHAMENTO IS NULL AND c.DATAABERTURA < ${fim}) ORDER BY c.CODIGO DESC`);
  const movs = await qi(`SELECT o.CODIGOCAIXA CX, o.DATAOPERACAO DT, COALESCE(o.VALORENTRADA,0) E, COALESCE(o.VALORSAIDA,0) S, TRIM(COALESCE(o.OBSERVACAO,'')) OBS
    FROM CAIXAOPERACAO o WHERE o.DATADELETE IS NULL AND o.DATAOPERACAO >= ${ini} AND o.DATAOPERACAO < ${fim} ORDER BY o.CODIGO DESC`);
  const fmap = {};
  for (const x of (porCx.ok ? porCx.rows : [])) {
    const cx = Number(x.CX); (fmap[cx] = fmap[cx] || []).push({ codigo: Number(x.F), nome: T(x.NOME) || ('forma ' + x.F), valor: +(Number(x.V) || 0).toFixed(2), n: Number(x.N) });
  }
  return { ok: true, data: d,
    formas: (formas.rows || []).map((x) => ({ codigo: Number(x.F), nome: T(x.NOME) || ('forma ' + x.F), valor: +(Number(x.V) || 0).toFixed(2), n: Number(x.N) })),
    caixas: (caixas.ok ? caixas.rows : []).map((x) => ({ codigo: Number(x.CODIGO), quem: T(x.QUEM), aberto_em: x.DATAABERTURA, fechado_em: x.DATAFECHAMENTO,
      fundo: Number(x.SALDOINICIAL) || 0, esperado: x.SALDOFINAL == null ? null : Number(x.SALDOFINAL), contado: x.SALDOFINALINFORMADO == null ? null : Number(x.SALDOFINALINFORMADO),
      // maquininha = nasceu sozinho ao receber no terminal (só cartão/Pix, sem
      // gaveta) — a OBSERVACAO carimba o nascimento. sistema = aberto por gente.
      tipo: T(x.OBS).startsWith('Aberto automaticamente') ? 'maquininha' : 'sistema',
      formas: fmap[Number(x.CODIGO)] || [], recebido: +(fmap[Number(x.CODIGO)] || []).reduce((s, y) => s + y.valor, 0).toFixed(2) })),
    movs: (movs.ok ? movs.rows : []).map((x) => ({ caixa: Number(x.CX), quando: x.DT, entrada: Number(x.E) || 0, saida: Number(x.S) || 0, obs: T(x.OBS) })) };
}

// ---- HISTÓRICO do que já saiu (últimas baixas) ----
// Serve pra desfazer engano: "quem deu baixa nesse item, que horas, que mesa?".
// Lê de `marca`, que é durável — `comanda` é truncada a cada espelho.
async function apiHistorico(areaCod, modo) {
  const entrega = modo === 'entrega';
  const campo = entrega ? sql`m.entregue_em` : sql`m.pronto_em`;
  // O histórico da entrega também é por praça — senão o runner do bar vê
  // saindo da cozinha e vice-versa, e o "quem baixou o quê" perde o sentido.
  // areaCod null = tudo (só a compatibilidade antiga usa).
  const filtroArea =
    areaCod == null ? sql`TRUE` : areaCod === 0 ? sql`m.area_codigo IS NULL` : sql`m.area_codigo=${areaCod}`;
  const rows = await sql`
    SELECT m.item_codigo, m.nome, COALESCE(m.numero, c.numero) AS numero,
           m.pronto_em, m.entregue_em, m.criado_em, a.nome AS area_nome
      FROM marca m
      LEFT JOIN comanda c ON c.codigo = m.comanda_codigo
      LEFT JOIN area a ON a.codigo = m.area_codigo
     WHERE ${campo} IS NOT NULL AND ${filtroArea}
     ORDER BY ${campo} DESC LIMIT 40`;
  return { itens: rows.map((x) => ({ ...x, quando: entrega ? x.entregue_em : x.pronto_em })) };
}

// ---- TEMPO DE PREPARO por praça e por prato ----
async function apiTempos() {
  const areas = await sql`SELECT a.codigo, a.nome, c.minutos FROM area a
    LEFT JOIN praca_config c ON c.area_codigo=a.codigo ORDER BY a.nome`;
  const pratos = await sql`SELECT t.codigo_pdv, t.minutos_extra, p.nome FROM produto_tempo t
    LEFT JOIN produto_local p ON p.codigo_pdv=t.codigo_pdv ORDER BY t.minutos_extra DESC, p.nome`;
  return { padrao: LIMITE_ATRASO_MIN, areas, pratos };
}
async function apiTemposSalvar(body) {
  const min = Number(body.minutos);
  if (body.area_codigo != null) {
    if (!(min >= 0 && min <= 600)) return { ok: false, erro: 'minutos de 0 a 600' };
    await sql`INSERT INTO praca_config (area_codigo, minutos) VALUES (${Number(body.area_codigo)}, ${min})
      ON CONFLICT (area_codigo) DO UPDATE SET minutos=EXCLUDED.minutos`;
    return { ok: true };
  }
  if (body.codigo_pdv != null) {
    const cod = Number(body.codigo_pdv);
    if (min <= 0) { await sql`DELETE FROM produto_tempo WHERE codigo_pdv=${cod}`; return { ok: true, removido: true }; }
    if (min > 600) return { ok: false, erro: 'minutos de 0 a 600' };
    await sql`INSERT INTO produto_tempo (codigo_pdv, minutos_extra) VALUES (${cod}, ${min})
      ON CONFLICT (codigo_pdv) DO UPDATE SET minutos_extra=EXCLUDED.minutos_extra`;
    return { ok: true };
  }
  return { ok: false, erro: 'informe area_codigo ou codigo_pdv' };
}

/** REPARO AUTOMATICO: identificacao que veio de cadastro de COLABORADOR.
 *
 *  Ate 01/08/2026 contatoPorCpf() fazia SELECT FIRST 1 sem filtrar TIPO. Como
 *  CONTATOS guarda cliente ('CF') e colaborador ('AA') na MESMA tabela, digitar
 *  na comanda o CPF de preenchimento dos garcons (024.589.335-05, presente em
 *  13 cadastros 'AA') trazia "ROSANA" — uma operadora — como se fosse a
 *  cliente. O garcom confirmava e o nome errado era gravado em `identificacao`
 *  e `mesa_comanda`.
 *
 *  Filtrar a origem NAO resolve o passado: a etapa 'ja-atendido' da busca le o
 *  que NOS gravamos, entao o nome errado continua voltando. Isto limpa. Roda no
 *  boot, e' idempotente e, sem colaborador vinculado, nao toca em nada. */
async function repararNomesDeColaborador() {
  const alvos = await sql`SELECT DISTINCT contato_fb FROM (
      SELECT contato_fb FROM identificacao WHERE contato_fb IS NOT NULL
      UNION ALL SELECT contato_fb FROM mesa_comanda WHERE contato_fb IS NOT NULL) t`;
  if (!alvos.length) return;
  const cods = alvos.map((x) => Number(x.contato_fb)).filter(Boolean);
  if (!cods.length) return;
  const r = await qi(`SELECT CODIGO, TRIM(COALESCE(TIPO,'')) TIPO, TRIM(NOME) NOME
    FROM CONTATOS WHERE CODIGO IN (${cods.join(',')})`);
  if (!r.ok) return;                       // Firebird fora do ar: tenta no proximo boot
  const naoCliente = r.rows.filter((x) => String(x.TIPO || '').trim().toUpperCase() !== 'CF');
  if (!naoCliente.length) return;
  const ruins = naoCliente.map((x) => Number(x.CODIGO));
  const a = await sql`DELETE FROM identificacao WHERE contato_fb = ANY(${ruins}) RETURNING numero`;
  const b = await sql`UPDATE mesa_comanda SET nome=NULL, nome_curto=NULL, cpf=NULL, contato_fb=NULL
    WHERE contato_fb = ANY(${ruins}) RETURNING comanda`;
  if (a.length || b.length) {
    console.log('[reparo] identificacao vinda de COLABORADOR removida: ' +
      a.length + ' mesa(s)/comanda(s) em identificacao, ' + b.length + ' em mesa_comanda — ' +
      naoCliente.map((x) => T(x.NOME) + ' (tipo ' + x.TIPO + ')').join(', '));
  }
}

/** O mesmo estrago, mas nas linhas que ficaram SEM o vinculo do contato: sobra
 *  so o CPF. Criterio seguro: apagar apenas quando aquele CPF existe no
 *  Consumer e NENHUM dos cadastros dele e' cliente. CPF que nao existe la
 *  (cliente novo digitado a mao pelo garcom) nao entra — nao ha o que casar. */
/** Tira da base os cadastros que EU criei testando. Sao nomes que nao existem
 *  no mundo real; ficaram amarrados a CPFs de gente de verdade e apareciam como
 *  se fossem o nome da pessoa. Roda no boot, uma vez, e some. */
async function limparTestes() {
  const marcas = ['AUDITORIA TESTE', 'Joana Ribeiro da Silva', 'Carlos Teste da Silva', 'Maria Teste'];
  const r = await sql`DELETE FROM identificacao WHERE nome = ANY(${marcas}) RETURNING numero, nome`;
  const c = await sql`DELETE FROM mesa_comanda WHERE nome = ANY(${marcas}) RETURNING comanda`;
  if (r.length || c.length) {
    console.log('[reparo] cadastros de teste removidos: ' +
      r.map((x) => x.nome + ' (mesa ' + x.numero + ')').join(', ') +
      (c.length ? ' · ' + c.length + ' em mesa_comanda' : ''));
  }
}

async function repararPorCpfDeColaborador() {
  const cpfs = await sql`SELECT DISTINCT cpf FROM identificacao
    WHERE cpf IS NOT NULL AND contato_fb IS NULL AND nome IS NOT NULL`;
  if (!cpfs.length) return;
  const lista = cpfs.map((x) => soDig(x.cpf)).filter((c) => c.length === 11);
  if (!lista.length) return;
  const r = await qi(`SELECT REPLACE(REPLACE(REPLACE(CNPJOUCPF,'.',''),'-',''),'/','') DOC,
      TRIM(COALESCE(TIPO,'')) TIPO FROM CONTATOS
    WHERE DATADELETE IS NULL AND REPLACE(REPLACE(REPLACE(CNPJOUCPF,'.',''),'-',''),'/','')
      IN (${lista.map((c) => `'${c}'`).join(',')})`);
  if (!r.ok) return;
  const porDoc = new Map();
  for (const x of r.rows) {
    const d = String(x.DOC || '').trim();
    if (!porDoc.has(d)) porDoc.set(d, []);
    porDoc.get(d).push(String(x.TIPO || '').trim().toUpperCase());
  }
  const ruins = [...porDoc.entries()]
    .filter(([, tipos]) => tipos.length && !tipos.includes('CF'))
    .map(([doc]) => doc);
  if (!ruins.length) return;
  const del = await sql`DELETE FROM identificacao WHERE cpf = ANY(${ruins}) AND contato_fb IS NULL RETURNING numero`;
  if (del.length) console.log('[reparo] ' + del.length + ' identificacao(oes) com CPF que so existe como colaborador — removida(s)');
}

// ---- CHAMADOS da mesa (garçom / reclamação) ----
const TIPOS_CHAMADO = new Set(['garcom', 'reclamacao']);
// O que pode dar errado, na linguagem da casa. O rotulo vai pro KDS e pro
// celular do garcom, entao e' curto e diz PRA ONDE correr.
const ASSUNTOS = {
  demora: 'DEMORA',
  errado: 'VEIO ERRADO',
  frio: 'VEIO FRIO',
  faltou: 'FALTOU ALGO',
  salao: 'MESA / LOUCA / LIMPEZA',
  outro: 'OUTRO',
};
async function apiChamadoCriar(body) {
  const tipo = String(body.tipo || 'garcom');
  if (!TIPOS_CHAMADO.has(tipo)) return { ok: false, erro: 'tipo inválido' };
  const mesa = body.mesa == null ? null : Number(body.mesa);
  if (mesa != null && !(mesa >= 1 && mesa <= NUMERO_MAX)) return { ok: false, erro: 'mesa inválida' };
  // Um chamado aberto por mesa+tipo: apertar o botão 5x não vira 5 alertas.
  // ⚠️ Mas o aviso automático de "a mesa pediu pelo celular" NÃO pode engolir
  // uma chamada de verdade — são coisas diferentes e o garçom reage diferente.
  // Por isso a trava separa os dois: 'pedido' (automático) de 'chamada' (a
  // pessoa apertou o botão).
  const origem = String(body.origem || '').slice(0, 120) || null;
  const auto = origem === 'pedido-cliente';
  const assunto = ASSUNTOS[String(body.assunto || '')] ? String(body.assunto) : null;
  // ⚠️ A trava de repetido inclui o ASSUNTO. Sem isso, quem reclamou da demora
  // e depois avisou que o prato veio frio tinha o segundo aviso engolido como
  // "repetido" — sao dois problemas diferentes, e o segundo e' pior.
  const [ja] = await sql`SELECT id FROM chamado
    WHERE mesa IS NOT DISTINCT FROM ${mesa} AND tipo=${tipo} AND atendido_em IS NULL
      AND assunto IS NOT DISTINCT FROM ${assunto}
      AND (origem IS NOT DISTINCT FROM ${'pedido-cliente'}) = ${auto} LIMIT 1`;
  if (ja) return { ok: true, id: Number(ja.id), repetido: true };
  // praça(s) do que o cliente marcou: o aviso só acende na cozinha dona do item
  let areas = null;
  const cods = Array.isArray(body.itens) ? body.itens.map(Number).filter(Boolean) : [];
  if (cods.length) {
    const as = await sql`SELECT DISTINCT area_codigo FROM comanda_item
      WHERE item_codigo = ANY(${cods}) AND area_codigo IS NOT NULL`;
    const lista = as.map((x) => Number(x.area_codigo)).filter(Boolean);
    if (lista.length) areas = lista;
  }
  const [r] = await sql`INSERT INTO chamado (mesa, tipo, origem, nota, texto, assunto, areas)
    VALUES (${mesa}, ${tipo}, ${origem},
            ${body.nota == null ? null : Number(body.nota)}, ${String(body.texto || '').slice(0, 500) || null},
            ${assunto}, ${areas})
    RETURNING id`;
  return { ok: true, id: Number(r.id) };
}
async function apiChamados(areaCod = null) {
  // KDS de uma praça vê: reclamação DELA + as sem praça (salão, conta, texto
  // livre). O resto é ruído — e ruído todo mundo aprende a ignorar.
  const filtro = areaCod == null || !(areaCod > 0)
    ? sql`TRUE`
    : sql`(areas IS NULL OR array_length(areas, 1) IS NULL OR ${areaCod} = ANY(areas))`;
  const rows = await sql`SELECT id, mesa, tipo, origem, nota, texto, assunto, areas, criado_em FROM chamado
    WHERE atendido_em IS NULL AND ${filtro} ORDER BY criado_em`;
  const agora = Date.now();
  const comIdade = rows.map((x) => ({ ...x, ha_min: Math.max(0, Math.floor((agora - new Date(x.criado_em).getTime()) / 60000)) }));
  return {
    reclamacoes: comIdade.filter((x) => x.tipo === 'reclamacao'),
    garcom: comIdade.filter((x) => x.tipo === 'garcom'),
  };
}
async function apiChamadoAtender(body) {
  const id = Number(body.id);
  if (!id) return { ok: false, erro: 'id' };
  await sql`UPDATE chamado SET atendido_em=now(), atendido_por=${String(body.por || '').slice(0, 60) || null}
    WHERE id=${id} AND atendido_em IS NULL`;
  return { ok: true };
}
/** Mesas com reclamação aberta — a cozinha usa pra passar na frente. */
async function mesasComReclamacao(areaCod = null) {
  const filtro = areaCod == null || !(areaCod > 0)
    ? sql`TRUE`
    : sql`(areas IS NULL OR array_length(areas, 1) IS NULL OR ${areaCod} = ANY(areas))`;
  const r = await sql`SELECT DISTINCT mesa FROM chamado
    WHERE tipo='reclamacao' AND atendido_em IS NULL AND mesa IS NOT NULL AND ${filtro}`;
  return new Set(r.map((x) => Number(x.mesa)));
}
/** Mesas com CHAMADO de garçom aberto (o BOTÃO da mesa, não o aviso automático
 *  "pediu pelo celular"). A maquininha NÃO tem tela de chamado — em vez de
 *  subir versão nova pra Cielo, o servidor marca a mesa na grade (nome 🔔 +
 *  cor) e o app JÁ INSTALADO mostra. Some quando alguém atende (Vou lá no
 *  celular/KDS) ou quando o garçom abre a mesa na maquininha. */
async function mesasChamandoGarcom() {
  const r = await sql`SELECT DISTINCT mesa FROM chamado
    WHERE tipo='garcom' AND atendido_em IS NULL AND mesa IS NOT NULL
      AND origem IS DISTINCT FROM 'pedido-cliente'`;
  return new Set(r.map((x) => Number(x.mesa)));
}
/** Atende os chamados de garçom de uma mesa (o garçom foi até lá). */
async function atenderChamadoGarcom(mesa, por) {
  const n = Number(mesa);
  if (!(n >= 1)) return;
  await sql`UPDATE chamado SET atendido_em=now(), atendido_por=${String(por || 'maquininha').slice(0, 60)}
    WHERE tipo='garcom' AND atendido_em IS NULL AND mesa=${n}`;
}

// ---- PRAÇAS QUE A CASA NÃO USA MAIS ----
// Terraço e luau saíram de operação: as praças continuam no cadastro do
// Consumer (e 399 produtos ainda apontam pra elas na 0001), mas NÃO devem
// mais aparecer no KDS — cozinha com estação fantasma é cozinha confusa.
// Some da lista por NOME (o código muda de loja pra loja); a lista mora em
// cfg 'pracas_ocultas' — esvaziar traz tudo de volta, sem mexer em código.
// ⚠️ Item lançado numa praça oculta NÃO some: cai no balde laranja "Sem praça
// definida", que já existe justamente pra nada ficar invisível.
const PRACAS_OCULTAS_PADRAO = 'luau,terraco,coz terraco,pastel,destilados';
// ---- PRAÇAS QUE VIRARAM OUTRA ----
// A casa juntou estações: pastel passou a sair na COZ PETISCO e destilados no
// DRINKS. Em vez de reapontar centenas de produtos no cadastro do Consumer
// (que também imprime por lá e é a verdade fiscal), o espelho TRADUZ a praça
// na entrada: o item nasce já na cozinha que vai produzir.
// Config em cfg 'pracas_redirecionadas', formato "de>para" separado por vírgula.
const PRACAS_REDIR_PADRAO = 'pastel>coz petisco,destilados>drinks';
// ---- ITENS QUE NINGUÉM PRODUZ ----
// Couvert não é prato: ninguém prepara, ninguém entrega. Ficava no balde
// "Sem praça" (o cadastro dele não tem cozinha), pedindo baixa e contando
// atraso na mesa. Entra JÁ BAIXADO — some do KDS sem sumir da conta.
const ITENS_FORA_KDS_PADRAO = 'couvert';
// ---- ITEM COM PRAÇA PRÓPRIA ----
// Conserta cadastro torto sem mexer no Consumer: "BATATA FRITA" (a duplicada
// em maiúsculas) está sem cozinha e caía no balde órfão. Formato "nome>praça".
const ITENS_PRACA_PADRAO = 'batata frita>coz petisco';
async function itensForaKds() {
  const txt = await cfgGet('itens_fora_kds', ITENS_FORA_KDS_PADRAO);
  return String(txt).split(',').map((x) => semAcento(x.trim())).filter(Boolean);
}
async function mapaItemPraca() {
  const txt = await cfgGet('itens_praca', ITENS_PRACA_PADRAO);
  const pares = String(txt).split(',')
    .map((x) => x.split('>').map((y) => semAcento(y.trim())))
    .filter((par) => par.length === 2 && par[0] && par[1]);
  if (!pares.length) return [];
  const porNome = new Map((await sql`SELECT codigo, nome FROM area`).map((a) => [semAcento(a.nome), Number(a.codigo)]));
  return pares.map(([termo, praca]) => ({ termo, area: porNome.get(praca) ?? null }))
    .filter((x) => x.area != null);
}
async function mapaRedirPracas() {
  const txt = await cfgGet('pracas_redirecionadas', PRACAS_REDIR_PADRAO);
  const pares = String(txt).split(',')
    .map((x) => x.split('>').map((y) => semAcento(y.trim())))
    .filter((par) => par.length === 2 && par[0] && par[1]);
  if (!pares.length) return new Map();
  const porNome = new Map((await sql`SELECT codigo, nome FROM area`).map((a) => [semAcento(a.nome), Number(a.codigo)]));
  const m = new Map();
  for (const [de, para] of pares) {
    const cDe = porNome.get(de), cPara = porNome.get(para);
    if (cDe != null && cPara != null && cDe !== cPara) m.set(cDe, cPara);
  }
  return m;
}
async function pracasOcultas() {
  const txt = await cfgGet('pracas_ocultas', PRACAS_OCULTAS_PADRAO);
  const nomes = new Set(String(txt).split(',').map((x) => semAcento(x.trim())).filter(Boolean));
  if (!nomes.size) return [];
  const rows = await sql`SELECT codigo, nome FROM area`;
  return rows.filter((a) => nomes.has(semAcento(a.nome))).map((a) => Number(a.codigo));
}

async function apiAreas() {
  const ocultas = await pracasOcultas();
  const rows = await sql`
    SELECT a.codigo, a.nome,
      COUNT(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2 AND COALESCE(ci.produzido, m.pronto_em) IS NULL) AS a_produzir,
      COUNT(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2) AS total,
      -- pronto e ainda não entregue NESTA praça: é o que o runner dela tem na mão
      COUNT(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2
        AND COALESCE(ci.produzido, m.pronto_em) IS NOT NULL
        AND COALESCE(ci.entregue, m.entregue_em) IS NULL) AS a_entregar
    FROM area a
    LEFT JOIN comanda_item ci ON ci.area_codigo = a.codigo
    LEFT JOIN marca m ON m.item_codigo = ci.item_codigo
    WHERE a.codigo <> ALL(${ocultas})
    GROUP BY a.codigo, a.nome
    ORDER BY a_produzir DESC, a.nome`;
  // ⚠️ ITENS SEM PRAÇA. O produto sem cozinha atribuída no Consumer entra com
  // area_codigo nulo, e o KDS só lista as praças cadastradas — o item ficava
  // invisível PRA SEMPRE: ninguém produzia, e ele seguia contando atraso e
  // pintando a mesa de amarelo. Foi assim que um abacaxi travou a mesa 45 sem
  // aparecer em cozinha nenhuma.
  // apiKds(0)/apiEntrega(0) já sabem ler essa faixa; faltava a tela oferecer.
  const semArea = (await sql`
    SELECT COUNT(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2 AND COALESCE(ci.produzido, m.pronto_em) IS NULL) AS a_produzir,
           COUNT(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2) AS total,
           COUNT(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2
             AND COALESCE(ci.produzido, m.pronto_em) IS NOT NULL
             AND COALESCE(ci.entregue, m.entregue_em) IS NULL) AS a_entregar
      FROM comanda_item ci LEFT JOIN marca m ON m.item_codigo = ci.item_codigo
     WHERE ci.area_codigo IS NULL OR ci.area_codigo = ANY(${ocultas})`)[0];
  if (Number(semArea?.total ?? 0) > 0) {
    rows.unshift({ codigo: 0, nome: 'Sem praça definida', orfa: true,
      a_produzir: Number(semArea.a_produzir), total: Number(semArea.total),
      a_entregar: Number(semArea.a_entregar) });
  }
  const ent = (await sql`
    SELECT COUNT(*) AS n FROM comanda_item ci LEFT JOIN marca m ON m.item_codigo = ci.item_codigo
    WHERE ci.tipo IS DISTINCT FROM 2 AND COALESCE(ci.produzido, m.pronto_em) IS NOT NULL AND COALESCE(ci.entregue, m.entregue_em) IS NULL`)[0];
  const est = (await sql`SELECT * FROM sync_estado WHERE id=1`)[0] || null;
  return { areas: rows, entrega_n: Number(ent?.n ?? 0), online: ultimoStatus.ok, sync: est,
    tem_entrega: await kdsTem('entrega') };
}

// ---- API: KDS de PRODUÇÃO de uma área (itens a produzir, ordem de CHEGADA = FIFO) ----
// ---- KDS: PRODUÇÃO e/ou ENTREGA, por loja ----
// Nem toda casa separa as duas coisas. Na Tabuará quem produz entrega, então a
// tela de Entregas só cria um passo a mais sem ninguém pra executar — e um
// item "pronto" ficaria eternamente esperando alguém dizer que saiu.
// cfg 'kds_modo': 'ambos' (padrão, como as outras lojas), 'producao' ou 'entrega'.
async function kdsModo() {
  const v = String(await cfgGet('kds_modo', 'ambos')).toLowerCase().trim();
  return v === 'producao' || v === 'entrega' ? v : 'ambos';
}
async function kdsTem(qual) {
  const m = await kdsModo();
  return m === 'ambos' || m === qual;
}
async function apiKds(areaCod) {
  const ocultas = areaCod === 0 ? await pracasOcultas() : [];
  const cond = areaCod === 0
    ? sql`(ci.area_codigo IS NULL OR ci.area_codigo = ANY(${ocultas}))`
    : sql`ci.area_codigo=${areaCod}`;
  const itens = await sql`
    SELECT ci.*, COALESCE(ci.produzido, m.pronto_em) AS pronto_em,
           c.numero, c.origem, c.nome AS comanda_nome, c.qtd_pessoas
    FROM comanda_item ci
    JOIN comanda c ON c.codigo = ci.comanda_codigo
    LEFT JOIN marca m ON m.item_codigo = ci.item_codigo
    WHERE ${cond} AND COALESCE(ci.produzido, m.pronto_em) IS NULL
    ORDER BY ci.criado NULLS LAST, ci.id`;
  const r = agrupar(itens, 'chegada');
  await rotularComandas(r.comandas);
  // Prazo desta praça + o extra do prato mais demorado da comanda.
  // Ex.: Bar 5min; se a comanda tem um drink com +10, o prazo dela vira 15.
  const cfg = (await sql`SELECT minutos FROM praca_config WHERE area_codigo=${areaCod}`)[0];
  const prazoPraca = cfg ? Number(cfg.minutos) : LIMITE_ATRASO_MIN;
  const extras = new Map((await sql`SELECT codigo_pdv, minutos_extra FROM produto_tempo`).map((x) => [Number(x.codigo_pdv), Number(x.minutos_extra)]));
  const agora = Date.now();
  for (const c of r.comandas) {
    c.espera_min = c.chegada ? Math.max(0, Math.floor((agora - new Date(c.chegada).getTime()) / 60000)) : null;
    const extra = Math.max(0, ...(c.itens || []).map((i) => extras.get(Number(i.codigo_pdv)) || 0), 0);
    c.prazo_min = prazoPraca + extra;
    c.atrasado = c.espera_min != null && c.espera_min >= c.prazo_min;
    // 2x o prazo = estourou de vez: o KDS sobe o alarme (som mais forte e repetido)
    c.critico = c.espera_min != null && c.espera_min >= c.prazo_min * 2;
  }
  const areaNome = areaCod === 0 ? 'Sem área' : ((await sql`SELECT nome FROM area WHERE codigo=${areaCod}`)[0]?.nome || ('Área ' + areaCod));

  // "SAI JUNTO" ITEM A ITEM: o par e' explicito (item_junto), nao a comanda
  // inteira. Aqui listamos os ITENS desta praca cujo PAR de outra praca ja
  // ficou pronto — quem segura o pedido agora e' este item.
  const esperando = await sql`
    SELECT ci.item_codigo, ci.nome AS item, c.numero, a2.nome AS praca, m2.pronto_em,
           ci2.nome AS item_pronto
      FROM item_junto ij
      JOIN comanda_item ci ON ci.item_codigo = ij.item_codigo
      JOIN comanda c ON c.codigo = ci.comanda_codigo
      LEFT JOIN marca m ON m.item_codigo = ci.item_codigo
      JOIN item_junto ij2 ON ij2.grupo = ij.grupo AND ij2.item_codigo <> ij.item_codigo
      JOIN comanda_item ci2 ON ci2.item_codigo = ij2.item_codigo
      LEFT JOIN marca m2 ON m2.item_codigo = ci2.item_codigo
      LEFT JOIN area a2 ON a2.codigo = ci2.area_codigo
     WHERE ${cond} AND ci.tipo IS DISTINCT FROM 2
       AND COALESCE(ci.produzido, m.pronto_em) IS NULL
       AND COALESCE(ci2.produzido, m2.pronto_em) IS NOT NULL
     ORDER BY m2.pronto_em`;
  // itens desta praca que fazem parte de ALGUM par (pra marcar na tela)
  const pareados = await sql`
    SELECT ci.item_codigo, ij.grupo FROM item_junto ij
      JOIN comanda_item ci ON ci.item_codigo = ij.item_codigo
     WHERE ${cond} AND ci.tipo IS DISTINCT FROM 2`;

  // Mesa que reclamou passa na frente: sobe pro topo da fila e vem marcada.
  const reclamou = await mesasComReclamacao(areaCod);
  for (const c of r.comandas) c.reclamou = reclamou.has(Number(c.numero));
  r.comandas.sort((a, b) => (b.reclamou ? 1 : 0) - (a.reclamou ? 1 : 0));

  const ch = await apiChamados(areaCod);
  const espItens = new Set(esperando.map((x) => Number(x.item_codigo)));
  const parItens = new Map(pareados.map((x) => [Number(x.item_codigo), x.grupo]));
  for (const c of r.comandas) for (const i of c.itens || []) {
    if (i.item_codigo == null) continue;
    if (parItens.has(Number(i.item_codigo))) i.pareado = true;
    if (espItens.has(Number(i.item_codigo))) {
      const e = esperando.find((x) => Number(x.item_codigo) === Number(i.item_codigo));
      i.esperando_par = { praca: e?.praca || 'outra praça', item: e?.item_pronto || null };
    }
  }
  // CANCELADO ANTES DE FICAR PRONTO: o item sumia do KDS sem aviso e a
  // cozinha seguia fazendo. Banner grandão por 10 min — mas só na PRAÇA do
  // item (cerveja cancelada não é aviso da cozinha) e só até alguém dar "Ok,
  // vi". Pedido inteiro (area nula) continua indo pra todas as praças.
  const cancelados = await sql`SELECT id, numero, nome, status_item, motivo,
      round(extract(epoch from (now()-quando))/60)::int AS min_atras
    FROM cancelamento
    WHERE quando > now() - interval '10 minutes' AND status_item IN ('a_produzir','pedido')
      AND visto_em IS NULL
      AND (area_codigo IS NULL OR ${areaCod == null || !(areaCod > 0) ? sql`TRUE` : sql`area_codigo=${areaCod}`})
    ORDER BY quando DESC LIMIT 6`;
  return { area: { codigo: areaCod, nome: areaNome }, limite_atraso_min: LIMITE_ATRASO_MIN, ...r,
    esperando, reclamacoes: ch.reclamacoes, cancelados, online: ultimoStatus.ok };
}

// ---- API: ENTREGA (global) — itens prontos, FIFO por hora do "pronto" ----
// A entrega é SEPARADA POR PRAÇA, igual à produção: quem corre o prato da
// cozinha não é quem corre a bebida do bar. Uma tela só, com tudo misturado,
// faz os dois runners disputarem a mesma fila e ninguém saber o que é seu.
//   areaCod null .. tudo (compatibilidade; a tela nova sempre manda uma praça)
//   areaCod 0 ..... itens sem praça definida
//   areaCod N ..... só aquela praça
async function apiEntrega(areaCod = null) {
  // loja sem etapa de entrega: devolve vazio em vez de uma fila que ninguém olha
  if (!(await kdsTem('entrega'))) return { comandas: [], desligado: true };
  const filtroArea =
    areaCod == null ? sql`TRUE`
      : areaCod === 0 ? sql`(ci.area_codigo IS NULL OR ci.area_codigo = ANY(${await pracasOcultas()}))`
      : sql`ci.area_codigo=${areaCod}`;
  const itens = await sql`
    SELECT ci.*, COALESCE(ci.produzido, m.pronto_em) AS pronto_em,
           c.numero, c.origem, c.nome AS comanda_nome, c.qtd_pessoas, a.nome AS area_nome
    FROM comanda_item ci
    JOIN comanda c ON c.codigo = ci.comanda_codigo
    LEFT JOIN marca m ON m.item_codigo = ci.item_codigo
    LEFT JOIN area a ON a.codigo = ci.area_codigo
    WHERE COALESCE(ci.produzido, m.pronto_em) IS NOT NULL
      AND COALESCE(ci.entregue, m.entregue_em) IS NULL
      AND ${filtroArea}
    ORDER BY COALESCE(ci.produzido, m.pronto_em), ci.id`;
  const r = agrupar(itens, 'pronto');
  await rotularComandas(r.comandas);
  // Prazo do passe (3 min) e prazo de PRODUÇÃO da praça — a entrega herda o
  // atraso: prato que já saiu tarde da cozinha nasce vermelho no passe, porque
  // pro cliente o relógio é um só (ele não sabe onde o tempo foi perdido).
  const entregaMin = Math.max(1, Number(await cfgGet('entrega_min', String(LIMITE_ENTREGA_MIN))) || LIMITE_ENTREGA_MIN);
  const cfgP = areaCod != null && areaCod > 0
    ? (await sql`SELECT minutos FROM praca_config WHERE area_codigo=${areaCod}`)[0] : null;
  const prazoPraca = cfgP ? Number(cfgP.minutos) : LIMITE_ATRASO_MIN;
  const extras = new Map((await sql`SELECT codigo_pdv, minutos_extra FROM produto_tempo`).map((x) => [Number(x.codigo_pdv), Number(x.minutos_extra)]));
  const agora = Date.now();
  for (const c of r.comandas) {
    c.aguarda_min = c.pronta_desde ? Math.max(0, Math.floor((agora - new Date(c.pronta_desde).getTime()) / 60000)) : null;
    // idade TOTAL do pedido (desde o lançamento): só o aguarda_min "zerava" o
    // relógio quando o prato chegava no passe — o runner precisa dos dois tempos.
    c.pedido_min = c.chegada ? Math.max(0, Math.floor((agora - new Date(c.chegada).getTime()) / 60000)) : null;
    const extra = Math.max(0, ...(c.itens || []).map((i) => extras.get(Number(i.codigo_pdv)) || 0), 0);
    c.prazo_entrega_min = entregaMin;
    c.prazo_min = prazoPraca + extra;                     // prazo da produção
    const passeEstourou = c.aguarda_min != null && c.aguarda_min >= entregaMin;
    const pedidoEstourou = c.pedido_min != null && c.pedido_min >= c.prazo_min;
    c.atrasado = passeEstourou || pedidoEstourou;
    c.critico = (c.aguarda_min != null && c.aguarda_min >= entregaMin * 2)
      || (c.pedido_min != null && c.pedido_min >= c.prazo_min * 2);
    // por que está vermelho: parado no passe ou já veio tarde da cozinha
    c.motivo_atraso = passeEstourou ? 'passe' : (pedidoEstourou ? 'producao' : null);
    for (const i of c.itens) {
      i.prod_min = (i.criado && i.pronto_em) ? Math.max(0, Math.round((new Date(i.pronto_em).getTime() - new Date(i.criado).getTime()) / 60000)) : null;
    }
  }
  // CANCELADO DEPOIS DE PRONTO (e antes de entregar): o prato estava no passe
  // esperando runner — o aviso evita levar comida cancelada pra mesa.
  const cancelados = await sql`SELECT id, numero, nome, status_item, motivo,
      round(extract(epoch from (now()-quando))/60)::int AS min_atras
    FROM cancelamento
    WHERE quando > now() - interval '10 minutes' AND status_item IN ('pronto','pedido')
      AND visto_em IS NULL
      AND (area_codigo IS NULL OR ${areaCod == null || !(areaCod > 0) ? sql`TRUE` : sql`area_codigo=${areaCod}`})
    ORDER BY quando DESC LIMIT 6`;
  return { ...r, cancelados, online: ultimoStatus.ok };
}

/** Quebra os itens de uma comanda em RODADAS de lançamento.
 *  Duas águas às 20h e uma coca às 20h10 são duas vias, não uma comanda que
 *  cresceu — o que já saiu pra cozinha não muda mais. */
function chaveRodada(itens) {
  const porComanda = new Map();
  for (const i of itens) {
    if (!porComanda.has(i.comanda_codigo)) porComanda.set(i.comanda_codigo, []);
    porComanda.get(i.comanda_codigo).push(i);
  }
  const chave = new Map(); // id do item -> nº da rodada
  for (const [, lista] of porComanda) {
    const ord = [...lista].sort((a, b) => {
      const ta = a.criado ? new Date(a.criado).getTime() : 0;
      const tb = b.criado ? new Date(b.criado).getTime() : 0;
      return ta - tb || Number(a.item_codigo || 0) - Number(b.item_codigo || 0);
    });
    let rodada = 0, anterior = null;
    for (const i of ord) {
      const t = i.criado ? new Date(i.criado).getTime() : null;
      if (anterior != null && t != null && (t - anterior) > RODADA_GAP_SEG * 1000) rodada++;
      if (t != null) anterior = t;
      chave.set(i.id ?? i.item_codigo, rodada);
    }
  }
  return chave;
}
function agrupar(itens, ordem) {
  const rodadaDe = chaveRodada(itens);
  const porC = new Map();
  for (const i of itens) {
    const rod = rodadaDe.get(i.id ?? i.item_codigo) || 0;
    const chave = i.comanda_codigo + ':' + rod;
    if (!porC.has(chave)) porC.set(chave, { codigo: i.comanda_codigo, rodada: rod, numero: i.numero, origem: i.origem, nome: i.comanda_nome, qtd_pessoas: i.qtd_pessoas, chegada: null, pronta_desde: null, itens: [] });
    const c = porC.get(chave);
    // ⚠️ RESPOSTA DE PERGUNTA É OBSERVAÇÃO, NÃO ITEM. "Ao ponto", "com gelo",
    // "1 copo" chegam como filho (tipo 2) e o KDS listava cada um como linha
    // própria — sendo que o mesmo texto JÁ sai como observação do prato logo
    // acima. Pior: "NENHUM" (o texto de 'sem observação') virava item.
    // Some do KDS quando é vazio/NENHUM ou quando já está na observação do
    // prato; complemento de verdade (o que a cozinha precisa fazer) continua.
    if (Number(i.tipo) === 2) {
      const nm = semAcento(i.nome || '').trim();
      if (!nm || nm === 'nenhum' || nm === 'n/a') continue;
      const pai = [...c.itens].reverse().find((x) => Number(x.tipo) !== 2);
      if (pai && temMod(pai.detalhes) && semAcento(pai.detalhes).includes(nm)) continue;
    }
    c.itens.push({ item_codigo: i.item_codigo, codigo_pdv: i.codigo_pdv, nome: i.nome, quantidade: i.quantidade, tipo: i.tipo, detalhes: i.detalhes, area_nome: i.area_nome, criado: i.criado, pronto_em: i.pronto_em, modificado: temMod(i.detalhes), pareado: false, esperando_par: null });
    if (i.criado && (!c.chegada || new Date(i.criado) < new Date(c.chegada))) c.chegada = i.criado;
    if (i.pronto_em && (!c.pronta_desde || new Date(i.pronto_em) < new Date(c.pronta_desde))) c.pronta_desde = i.pronto_em;
  }
  // comanda que ficou SÓ com linha escondida (ex.: um "NENHUM" solto) não vira
  // cartão vazio na tela
  const comandas = [...porC.values()].filter((c) => c.itens.length)
    .map((c) => ({ ...c, ...classificar(c.origem, c.numero) }));
  // FIFO: quem chegou (ou ficou pronto) primeiro aparece primeiro — ordem de produção, não de mesa.
  const chave = ordem === 'pronto' ? 'pronta_desde' : 'chegada';
  comandas.sort((a, b) => {
    const ta = a[chave] ? new Date(a[chave]).getTime() : Infinity;
    const tb = b[chave] ? new Date(b[chave]).getTime() : Infinity;
    return ta - tb;
  });
  const nItens = itens.filter((i) => i.tipo !== 2).length;
  return { comandas, nComandas: comandas.length, nItens };
}

// ---- gravar toque (pronto / entregue) no Postgres local ----
async function marcar(body) {
  const campo = body.campo === 'entregue' ? 'entregue' : 'pronto';
  const col = campo === 'entregue' ? 'entregue_em' : 'pronto_em';
  const on = body.on !== false;
  const val = on ? new Date() : null;
  // ⚠️ SEM FOTO NÃO BAIXA.
  // Dar baixa é ato com consequência: o item sai da fila e o cliente é
  // cobrado. Tem que ter autor. Sem câmera liberada, o tablet não opera —
  // a checagem é AQUI, não na tela, pra não bastar burlar o navegador.
  // Desfazer (on=false) não exige: é caminho de correção e travá-lo prenderia
  // o erro no lugar.
  let arqFoto = null;
  if (on) {
    arqFoto = body.foto ? guardaFoto(body.foto) : null;
    if (!arqFoto) {
      return { ok: false, sem_camera: true,
        erro: 'Sem foto não dá baixa. Libere a câmera neste tablet.' +
              (body.sem_foto ? ' — ' + String(body.sem_foto).slice(0, 140) : '') };
    }
  }
  let codigos = [];
  // lista explícita = "tudo pronto" de UMA rodada (não da comanda inteira,
  // senão baixaria item que ainda nem foi produzido de um lançamento posterior)
  if (Array.isArray(body.item_codigos) && body.item_codigos.length) {
    codigos = body.item_codigos.map(Number).filter(Boolean);
    const filhos = await sql`SELECT item_codigo AS ic FROM comanda_item
      WHERE codigo_pai = ANY(${codigos}) AND item_codigo IS NOT NULL`;
    for (const f of filhos) codigos.push(Number(f.ic));
  } else if (body.item_codigo != null) {
    codigos = [Number(body.item_codigo)];
    // marca junto os complementos-filhos (molho, acompanhamento) do prato
    const filhos = await sql`SELECT item_codigo AS ic FROM comanda_item WHERE codigo_pai=${Number(body.item_codigo)} AND item_codigo IS NOT NULL`;
    for (const f of filhos) codigos.push(Number(f.ic));
  } else if (body.comanda_codigo != null) {
    const cc = Number(body.comanda_codigo);
    if (campo === 'entregue') {
      const r = await sql`SELECT ci.item_codigo AS ic FROM comanda_item ci LEFT JOIN marca m ON m.item_codigo=ci.item_codigo
        WHERE ci.comanda_codigo=${cc} AND ci.item_codigo IS NOT NULL AND COALESCE(ci.produzido, m.pronto_em) IS NOT NULL`;
      codigos = r.map((x) => Number(x.ic));
    } else if (body.area_codigo != null) {
      const r = await sql`SELECT item_codigo AS ic FROM comanda_item WHERE comanda_codigo=${cc} AND item_codigo IS NOT NULL AND area_codigo=${Number(body.area_codigo)}`;
      codigos = r.map((x) => Number(x.ic));
    } else {
      const r = await sql`SELECT item_codigo AS ic FROM comanda_item WHERE comanda_codigo=${cc} AND item_codigo IS NOT NULL`;
      codigos = r.map((x) => Number(x.ic));
    }
  }
  for (const ic of codigos) {
    // snapshot do item (hora do lançamento, área, nome) -> registro durável do tempo de produção
    const s = (await sql`SELECT ci.criado, ci.comanda_codigo, ci.area_codigo, ci.nome, c.numero FROM comanda_item ci LEFT JOIN comanda c ON c.codigo=ci.comanda_codigo WHERE ci.item_codigo=${ic} LIMIT 1`)[0] || {};
    await sql`INSERT INTO marca (item_codigo, criado_em, comanda_codigo, area_codigo, nome, numero, ${sql(col)})
              VALUES (${ic}, ${s.criado || null}, ${s.comanda_codigo || null}, ${s.area_codigo || null}, ${s.nome || null}, ${s.numero ?? null}, ${val})
              ON CONFLICT (item_codigo) DO UPDATE SET ${sql(col)}=${val},
                numero=COALESCE(marca.numero, EXCLUDED.numero),
                criado_em=COALESCE(marca.criado_em, EXCLUDED.criado_em),
                comanda_codigo=COALESCE(marca.comanda_codigo, EXCLUDED.comanda_codigo),
                area_codigo=COALESCE(marca.area_codigo, EXCLUDED.area_codigo),
                nome=COALESCE(marca.nome, EXCLUDED.nome)`;
  }
  await registrarBaixa(campo, codigos, arqFoto, on);
  return { ok: true, n: codigos.length };
}

// ---- QUEM BAIXOU: a foto de quem tocou a tela ----
//
// Não há login no KDS: o tablet fica na praça e qualquer um encosta. A foto é
// a única referência de QUEM apertou — é o que permite apurar baixa indevida
// e resolver "entregaram na mesa errada" sem depender da memória de ninguém.
//
// ⚠️ SEM CÂMERA O TABLET NÃO OPERA. A baixa é recusada — decisão do dono: um
// item sai da fila e o cliente é cobrado, então tem que ter autor.
//
// Consequência prática, e é séria: a câmera do navegador SÓ funciona em
// contexto seguro (HTTPS ou localhost). A loja roda HTTP num IP da rede, então
// CADA TABLET precisa da origem liberada antes de entrar em serviço:
//   chrome://flags/#unsafely-treat-insecure-origin-as-secure
//   -> http://IP:8790  -> Relaunch  -> aceitar a permissão da câmera
// Tablet sem isso não dá baixa nenhuma. É de propósito, mas tem que estar
// feito ANTES do serviço começar.
// ---- HTTPS: é o que libera a câmera, sem mexer em flag nenhuma ----
//
// getUserMedia exige contexto seguro. Mandar cada tablet configurar
// chrome://flags é frágil e ninguém lembra. Em vez disso o próprio servidor
// sobe TAMBÉM em HTTPS, na porta seguinte: o aparelho aceita o aviso de
// certificado UMA vez ("Avançado > Continuar") e a câmera passa a funcionar
// como em qualquer site.
//
// O certificado é gerado aqui mesmo, na primeira vez, com o openssl que já
// vem junto do PostgreSQL que o nosso instalador instala. Sem openssl, o
// HTTPS simplesmente não sobe e o sistema segue em HTTP (sem câmera).
const PORT_HTTPS = Number(process.env.PORT_HTTPS || (Number(process.env.PORT || 8790) + 1));
function achaOpenssl() {
  const tentar = [process.env.OPENSSL_BIN, 'openssl', 'openssl.exe'];
  // PostgreSQL e Firebird trazem openssl; o Git for Windows também. Varro as
  // versões instaladas em vez de chutar um número.
  for (const base of [
    'C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL',
    'C:\\Program Files\\Firebird', 'C:\\Program Files (x86)\\Firebird',
  ]) {
    try {
      for (const v of readdirSync(base)) {
        tentar.push(path.join(base, v, 'bin', 'openssl.exe'));
        tentar.push(path.join(base, v, 'openssl.exe'));
      }
    } catch { /* pasta não existe nesta máquina */ }
  }
  for (const p of [
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
    'C:\\Windows\\System32\\OpenSSH\\openssl.exe',
    'C:\\ProgramData\\chocolatey\\bin\\openssl.exe',
  ]) tentar.push(p);
  for (const bin of tentar) {
    if (!bin) continue;
    try { execFileSync(bin, ['version'], { stdio: 'ignore', timeout: 8000 }); return bin; } catch { /* próximo */ }
  }
  return null;
}
/** IPs desta máquina — vão no certificado, senão o navegador recusa o endereço. */
function ipsLocais() {
  const out = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}
// ---- certificado sem depender do openssl ----
// A 0003 não tinha openssl e o HTTPS não subiu — com "sem câmera não baixa",
// o certificado não pode depender de um programa que talvez não exista na
// máquina. Então o X.509 é montado aqui, em DER, e assinado com o crypto do
// próprio Node. É um autoassinado de rede interna: o navegador avisa uma vez
// e a pessoa aceita.
const B = (...x) => Buffer.concat(x.map((v) => (Buffer.isBuffer(v) ? v : Buffer.from(v))));
function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const b = []; let v = n;
  while (v > 0) { b.unshift(v & 0xff); v >>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
}
const tlv = (tag, conteudo) => B(Buffer.from([tag]), derLen(conteudo.length), conteudo);
const derSeq = (...p) => tlv(0x30, B(...p));
const derSet = (...p) => tlv(0x31, B(...p));
function derInt(buf) {                       // inteiro positivo
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from([buf]);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = B(Buffer.from([0]), b);
  return tlv(0x02, b);
}
function derOid(txt) {
  const p = txt.split('.').map(Number);
  const out = [p[0] * 40 + p[1]];
  for (const n of p.slice(2)) {
    const pilha = [n & 0x7f];
    let v = n >> 7;
    while (v > 0) { pilha.unshift((v & 0x7f) | 0x80); v >>= 7; }
    out.push(...pilha);
  }
  return tlv(0x06, Buffer.from(out));
}
const derUtf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const derBits = (b) => tlv(0x03, B(Buffer.from([0]), b));   // 0 bits não usados
const derOctet = (b) => tlv(0x04, b);
function derUtcTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return tlv(0x17, Buffer.from(
    p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z', 'ascii'));
}
const OID = { sha256RSA: '1.2.840.113549.1.1.11', cn: '2.5.4.3',
  san: '2.5.29.17', basic: '2.5.29.19', keyUso: '2.5.29.15', extUso: '2.5.29.37', srv: '1.3.6.1.5.5.7.3.1' };
function nomeX509(cn) { return derSeq(derSet(derSeq(derOid(OID.cn), derUtf8(cn)))); }
function extensao(oid, critica, valor) {
  return derSeq(derOid(oid), ...(critica ? [tlv(0x01, Buffer.from([0xff]))] : []), derOctet(valor));
}
function geraCertificado(cn, dns, ips) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const algo = derSeq(derOid(OID.sha256RSA), tlv(0x05, Buffer.alloc(0)));   // NULL
  const agora = new Date(), fim = new Date(agora.getTime() + 3650 * 86400000);
  // SAN: dNSName é [2] IA5String, iPAddress é [7] OCTET STRING (4 bytes)
  const nomes = [
    ...dns.map((d) => tlv(0x82, Buffer.from(d, 'ascii'))),
    ...ips.map((ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number)))),
  ];
  const exts = tlv(0xa3, derSeq(
    extensao(OID.basic, true, derSeq()),                                  // CA:FALSE
    extensao(OID.keyUso, true, derBits(Buffer.from([0xa0]))),             // digitalSignature+keyEncipherment
    extensao(OID.extUso, false, derSeq(derOid(OID.srv))),                 // serverAuth
    extensao(OID.san, false, derSeq(...nomes)),
  ));
  const tbs = derSeq(
    tlv(0xa0, derInt(Buffer.from([2]))),                                  // v3
    derInt(randomBytes(8)),                                               // serial
    algo, nomeX509(cn), derSeq(derUtcTime(agora), derUtcTime(fim)), nomeX509(cn),
    spki, exts,
  );
  const assinatura = sign('sha256', tbs, privateKey);
  const der = derSeq(tbs, algo, derBits(assinatura));
  const pem = (tipo, b) =>
    `-----BEGIN ${tipo}-----\n${b.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END ${tipo}-----\n`;
  return { cert: pem('CERTIFICATE', der), key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
function certificado() {
  const dirC = path.join(process.cwd(), 'cert');
  const arqC = path.join(dirC, 'cert.pem'), arqK = path.join(dirC, 'key.pem');
  if (existsSync(arqC) && existsSync(arqK)) {
    try { return { cert: readFileSync(arqC), key: readFileSync(arqK) }; } catch { /* refaz */ }
  }
  const ips = ipsLocais(), dns = ['localhost'];
  const cn = (process.env.LOJA_NOME || 'prainha').replace(/[^\w-]/g, '') + '-vendas';
  try {
    mkdirSync(dirC, { recursive: true });
    const { cert, key } = geraCertificado(cn, dns, ['127.0.0.1', ...ips]);
    writeFileSync(arqC, cert); writeFileSync(arqK, key);
    console.log('[https] certificado próprio gerado para ' + ['localhost', '127.0.0.1', ...ips].join(', '));
    return { cert: Buffer.from(cert), key: Buffer.from(key) };
  } catch (e) {
    console.log('[https] falhei em gerar o certificado (' + e.message + ') — tentando openssl…');
  }
  const ssl = achaOpenssl();
  if (!ssl) { console.log('[https] sem openssl também — sobe só em HTTP, e aí a câmera não funciona'); return null; }
  try {
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((x) => 'IP:' + x)].join(',');
    execFileSync(ssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', arqK, '-out', arqC, '-days', '3650', '-subj', '/CN=' + cn,
      '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
    console.log('[https] certificado gerado via openssl para ' + san);
    return { cert: readFileSync(arqC), key: readFileSync(arqK) };
  } catch (e) {
    console.log('[https] openssl também falhou: ' + e.message);
    return null;
  }
}

const DIR_FOTOS = path.join(process.cwd(), 'fotos');
function guardaFoto(dataUrl) {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 900_000) return null; // 900 KB: foto de baixa é pequena
  const dia = new Date().toISOString().slice(0, 10);
  const pasta = path.join(DIR_FOTOS, dia);
  mkdirSync(pasta, { recursive: true });
  const nome = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36) + '.jpg';
  writeFileSync(path.join(pasta, nome), buf);
  return dia + '/' + nome;
}
async function registrarBaixa(acao, codigos, arquivo, on) {
  if (!on || !codigos.length) return;            // desmarcar não gera registro
  try {
    const its = await sql`SELECT ci.nome, ci.area_codigo, c.numero, a.nome AS area_nome
      FROM comanda_item ci LEFT JOIN comanda c ON c.codigo=ci.comanda_codigo
      LEFT JOIN area a ON a.codigo=ci.area_codigo
      WHERE ci.item_codigo = ANY(${codigos})`;
    const nomes = [...new Set(its.map((x) => x.nome).filter(Boolean))].join(', ').slice(0, 300);
    await sql`INSERT INTO baixa_foto (acao, area_codigo, area_nome, numero, item_codigos, itens_nome, n_itens, arquivo, sem_foto_motivo)
      VALUES (${acao}, ${its[0]?.area_codigo ?? null}, ${its[0]?.area_nome ?? null}, ${its[0]?.numero ?? null},
              ${codigos}, ${nomes || null}, ${codigos.length}, ${arquivo}, ${null})`;
  } catch (e) {
    // a foto já está em disco e a baixa já foi aplicada; só o índice falhou
    console.error('[baixa] não consegui indexar quem baixou:', e.message);
  }
}
// GUARDA POR UM MÊS. Foto de funcionário é dado pessoal: serve pra apurar o
// que aconteceu naquele turno, não pra virar acervo. Passado o prazo, a imagem
// é apagada do disco — mas o REGISTRO fica (o quê, quando, qual praça, qual
// mesa), que é histórico de operação e não identifica ninguém.
const FOTO_DIAS = Number(process.env.FOTO_DIAS ?? 30);
async function limparFotosAntigas() {
  if (!(FOTO_DIAS > 0)) return;
  try {
    // as pastas são nomeadas AAAA-MM-DD, então comparação de texto já ordena
    const corte = new Date(Date.now() - FOTO_DIAS * 86400000).toISOString().slice(0, 10);
    let dias = 0, fotos = 0;
    if (existsSync(DIR_FOTOS)) {
      for (const dia of readdirSync(DIR_FOTOS)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || dia >= corte) continue;
        const alvo = path.join(DIR_FOTOS, dia);
        try { fotos += readdirSync(alvo).length; } catch { /* pasta some no meio: tudo bem */ }
        rmSync(alvo, { recursive: true, force: true });
        dias++;
      }
    }
    const r = await sql`UPDATE baixa_foto
      SET arquivo = NULL, sem_foto_motivo = ${'foto apagada — guardamos ' + FOTO_DIAS + ' dias'}
      WHERE arquivo IS NOT NULL AND criado_em < now() - (${String(FOTO_DIAS)} || ' days')::interval`;
    if (dias || r.count) console.log(`[fotos] limpeza: ${fotos} foto(s) em ${dias} dia(s), ${r.count} registro(s) marcados`);
  } catch (e) {
    console.error('[fotos] limpeza falhou:', e.message);
  }
}

/** Comprovantes do recebimento manual: a foto que autorizou cada cartão/Pix.
 *  Antes só o caixa via (na hora) — o dono perguntou "onde está o comprovante?"
 *  e não havia onde achar. Lista por dia, com NSU e quem recebeu. */
async function apiComprovantes(data) {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(data || '')) ? String(data) : null;
  try {
    const rows = dia
      ? await sql`SELECT id, numero, pedido, pagamento_codigo, forma, valor, arquivo, nsu, login, quando
          FROM recebimento_foto WHERE quando::date = ${dia} ORDER BY quando DESC LIMIT 300`
      : await sql`SELECT id, numero, pedido, pagamento_codigo, forma, valor, arquivo, nsu, login, quando
          FROM recebimento_foto ORDER BY quando DESC LIMIT 300`;
    return { ok: true, comprovantes: rows.map((r) => ({
      id: Number(r.id), mesa: r.numero, pedido: r.pedido == null ? null : Number(r.pedido),
      pagamento: r.pagamento_codigo == null ? null : Number(r.pagamento_codigo),
      forma: r.forma, valor: Number(r.valor) || 0, arquivo: r.arquivo, nsu: r.nsu,
      quem: r.login, quando: r.quando,
    })) };
  } catch (e) { return { ok: false, erro: e.message }; }
}
const COMPROVANTES_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comprovantes — ${LOJA_NOME}</title><style>
*{box-sizing:border-box}body{margin:0;background:#ececed;color:#16161a;font-family:-apple-system,system-ui,sans-serif}
.barra{background:#fff;border-bottom:1px solid #dcdce3;padding:12px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.barra b{font-size:15px;margin-right:auto}
input[type=date]{font:inherit;padding:8px 10px;border:1px solid #dcdce3;border-radius:9px}
.lista{padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.cd{background:#fff;border:1px solid #dcdce3;border-radius:12px;padding:12px}
.cd img{width:100%;border-radius:8px;margin-top:8px;cursor:zoom-in}
.l1{display:flex;justify-content:space-between;font-weight:700}
.mut{color:#6e6e78;font-size:12.5px;margin-top:2px}
.nsu{display:inline-block;background:#eef6ff;color:#1d4ed8;border-radius:6px;padding:1px 7px;font-size:12px;font-weight:700;margin-top:4px}
.semnsu{background:#fef2f2;color:#b91c1c}
.vazio{padding:40px;text-align:center;color:#6e6e78}
</style></head><body>
<div class="barra"><b>🧾 Comprovantes do recebimento manual</b>
  <input id="d" type="date"><a href="/caixa" style="text-decoration:none"><button style="font:inherit;padding:8px 14px;border:0;border-radius:9px;background:#5b5b66;color:#fff">Caixa</button></a></div>
<div id="app" class="lista"></div>
<script>
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
function brl(v){return 'R$ '+(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}
async function carregar(){
  var d=document.getElementById('d').value;
  var j=await (await fetch('/api/comprovantes'+(d?'?data='+d:''),{cache:'no-store'})).json();
  var app=document.getElementById('app');
  if(!j.ok){app.innerHTML='<div class="vazio">'+esc(j.erro||'erro')+'</div>';return}
  if(!j.comprovantes.length){app.innerHTML='<div class="vazio">Nenhum comprovante'+(d?' nesse dia':'')+'.</div>';return}
  app.innerHTML=j.comprovantes.map(function(c){
    return '<div class="cd"><div class="l1"><span>'+(c.mesa?'mesa '+c.mesa:'')+(c.pedido?' · ped '+c.pedido:'')+'</span><span>'+brl(c.valor)+'</span></div>'+
      '<div class="mut">'+esc(c.forma)+' · '+esc(c.quem||'')+' · '+esc(String(c.quando).slice(0,16).replace('T',' '))+'</div>'+
      (c.nsu?'<span class="nsu">NSU '+esc(c.nsu)+'</span>':'<span class="nsu semnsu">SEM NSU</span>')+
      (c.arquivo?'<a href="/foto/'+esc(c.arquivo)+'" target="_blank"><img loading="lazy" src="/foto/'+esc(c.arquivo)+'"></a>':'<div class="mut">sem foto</div>')+
      '</div>';
  }).join('');
}
document.getElementById('d').value=new Date(Date.now()-3*3600*1000).toISOString().slice(0,10);
document.getElementById('d').addEventListener('change',carregar);
carregar();
</script></body></html>`;

/** Casa NSU faltante: pagamento manual de cartão/Pix sem NSU × transação da
 *  maquininha registrada no sistema (venda_pagamento ok, órfã). Só grava
 *  quando o par é ÚNICO (mesma forma, mesmo valor, mesmo dia) — ambíguo ou
 *  sem par fica no relatório pra resolver na mão (foto em /comprovantes). */
async function apiNsuCasar(data) {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))
    ? String(data)
    : new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const pend = await qi(`SELECT p.CODIGO, p.CODIGOPEDIDO PED, p.CODIGOFORMAPAGAMENTO F,
      CAST(p.VALOR AS NUMERIC(12,2)) V, CAST(p.DATAPAGAMENTO AS VARCHAR(30)) QUANDO
    FROM PAGAMENTOS p
    WHERE p.DATADELETE IS NULL AND p.NSUTRANSACAO IS NULL
      AND p.CODIGOFORMAPAGAMENTO IN (${FORMA.CREDITO},${FORMA.DEBITO},${FORMA.PIX_MANUAL},${FORMA.PIX_ONLINE})
      AND CAST(p.DATAPAGAMENTO AS DATE) = DATE '${dia}'`);
  if (!pend.ok) return { ok: false, erro: 'FB: ' + pend.err };
  const orfaos = await sql`SELECT id, forma_codigo, valor, nsu FROM venda_pagamento
    WHERE status='ok' AND nsu IS NOT NULL AND pagamento_fb IS NULL
      AND criado_em >= ${dia} AND criado_em < (${dia}::date + 1)`;
  const usados = new Set();
  const casados = [];
  const pulados = [];
  for (const p of pend.rows) {
    const valor = Number(p.V) || 0;
    const cand = orfaos.filter((o) => !usados.has(Number(o.id))
      && Number(o.forma_codigo) === Number(p.F)
      && Math.abs(Number(o.valor) - valor) < 0.005);
    if (cand.length !== 1) {
      pulados.push({ pagamento: Number(p.CODIGO), pedido: Number(p.PED) || null, valor,
        motivo: cand.length === 0 ? 'sem transação órfã igual no sistema (maquininha avulsa?)' : `ambíguo: ${cand.length} transações do mesmo valor` });
      continue;
    }
    const o = cand[0];
    const nsuNum = String(o.nsu).replace(/\D/g, '');
    if (!nsuNum) { pulados.push({ pagamento: Number(p.CODIGO), pedido: Number(p.PED) || null, valor, motivo: 'NSU do par não é numérico' }); continue; }
    const dup = await nsuJaUsadoHoje(nsuNum);
    if (dup && dup.pagamento !== Number(p.CODIGO)) { pulados.push({ pagamento: Number(p.CODIGO), pedido: Number(p.PED) || null, valor, motivo: `NSU ${nsuNum} já usado no pagamento ${dup.pagamento}` }); continue; }
    const up = await qi(`UPDATE PAGAMENTOS SET NSUTRANSACAO=${nsuNum} WHERE CODIGO=${Number(p.CODIGO)} AND NSUTRANSACAO IS NULL`);
    if (!up.ok) { pulados.push({ pagamento: Number(p.CODIGO), pedido: Number(p.PED) || null, valor, motivo: 'FB: ' + up.err }); continue; }
    await sql`UPDATE venda_pagamento SET pagamento_fb=${Number(p.CODIGO)} WHERE id=${Number(o.id)}`;
    try { await sql`UPDATE recebimento_foto SET nsu=${nsuNum} WHERE pagamento_codigo=${Number(p.CODIGO)} AND nsu IS NULL`; } catch { /* segue */ }
    usados.add(Number(o.id));
    casados.push({ pagamento: Number(p.CODIGO), pedido: Number(p.PED) || null, valor, nsu: nsuNum });
  }
  return { ok: true, dia, casados, pulados };
}

/** Reprocessa com a IA as fotos de comprovante SEM NSU (as de antes do OCR, ou
 *  quando a leitura falhou): lê o papel de novo e grava o NSU no pagamento.
 *  Complementa o /api/nsu/casar — este casa com o registro interno; aqui o
 *  número vem do próprio cupom da maquininha avulsa. */
async function apiNsuLerFotos(data) {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))
    ? String(data)
    : new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const fotos = await sql`SELECT id, pagamento_codigo, pedido, numero, valor, arquivo
    FROM recebimento_foto
    WHERE quando >= ${dia} AND quando < (${dia}::date + 1)
      AND nsu IS NULL AND arquivo IS NOT NULL AND pagamento_codigo IS NOT NULL
    ORDER BY quando`;
  const lidos = [];
  const falhas = [];
  for (const f of fotos) {
    const d = await lerComprovanteNaNuvem(f.arquivo);
    const nsu = String(d?.nsu ?? '').replace(/\D/g, '');
    if (!nsu) { falhas.push({ pagamento: Number(f.pagamento_codigo), mesa: f.numero, valor: Number(f.valor) || 0, motivo: d ? 'IA não achou NSU no papel' : 'OCR indisponível/foto ilegível' }); continue; }
    const dup = await nsuJaUsadoHoje(nsu);
    if (dup && dup.pagamento !== Number(f.pagamento_codigo)) { falhas.push({ pagamento: Number(f.pagamento_codigo), mesa: f.numero, valor: Number(f.valor) || 0, motivo: `NSU ${nsu} já usado no pagamento ${dup.pagamento} — mesmo cupom fotografado 2×?` }); continue; }
    const up = await qi(`UPDATE PAGAMENTOS SET NSUTRANSACAO=${nsu} WHERE CODIGO=${Number(f.pagamento_codigo)} AND NSUTRANSACAO IS NULL`);
    if (!up.ok) { falhas.push({ pagamento: Number(f.pagamento_codigo), mesa: f.numero, valor: Number(f.valor) || 0, motivo: 'FB: ' + up.err }); continue; }
    await sql`UPDATE recebimento_foto SET nsu=${nsu} WHERE id=${Number(f.id)}`;
    lidos.push({ pagamento: Number(f.pagamento_codigo), mesa: f.numero, valor: Number(f.valor) || 0, nsu,
      operadora: d.operadora ?? null, valorNoPapel: d.valor ?? null,
      valorConfere: d.valor == null ? null : Math.abs(Number(d.valor) - Number(f.valor)) < 0.005 });
  }
  return { ok: true, dia, lidos, falhas };
}

/** Grava NSU na mão (papel que a IA não leu): o gestor olha a foto em
 *  /comprovantes e informa o número. Mesma trava de duplicado do dia. */
async function apiNsuDefinir(body) {
  const pagamento = Number(body.pagamento) || 0;
  const nsu = String(body.nsu ?? '').replace(/\D/g, '');
  if (!pagamento || !nsu) return { ok: false, erro: 'pagamento e nsu obrigatórios' };
  const dup = await nsuJaUsadoHoje(nsu);
  if (dup && dup.pagamento !== pagamento) {
    return { ok: false, erro: `NSU ${nsu} já usado hoje no pagamento ${dup.pagamento} (pedido ${dup.pedido ?? '?'})` };
  }
  const atual = await qi(`SELECT CODIGO, NSUTRANSACAO FROM PAGAMENTOS WHERE CODIGO=${pagamento} AND DATADELETE IS NULL`);
  if (!atual.ok || !atual.rows.length) return { ok: false, erro: 'pagamento não encontrado' };
  // sobrescrever=true corrige leitura errada da IA (ex.: pegou o nº do
  // estabelecimento em vez do DOC) — sem a flag, NSU existente é intocável.
  if (atual.rows[0].NSUTRANSACAO != null && body.sobrescrever !== true) {
    return { ok: false, erro: `já tem NSU (${atual.rows[0].NSUTRANSACAO}) — não sobrescrevo (mande sobrescrever:true se for correção)` };
  }
  const up = await qi(`UPDATE PAGAMENTOS SET NSUTRANSACAO=${nsu} WHERE CODIGO=${pagamento}`);
  if (!up.ok) return { ok: false, erro: 'FB: ' + up.err };
  try { await sql`UPDATE recebimento_foto SET nsu=${nsu} WHERE pagamento_codigo=${pagamento}`; } catch { /* segue */ }
  // forma errada no lançamento (caso real: DÉBITO registrado como Pix) —
  // corrige só entre as formas manuais, nunca mexe em dinheiro.
  let formaCorrigida = null;
  if (body.forma) {
    const nova = FORMAS_MANUAIS[String(body.forma)];
    if (!nova || nova.codigo === FORMA.DINHEIRO) return { ok: true, pagamento, nsu, aviso: 'forma inválida — NSU gravado, forma mantida' };
    const uf = await qi(`UPDATE PAGAMENTOS SET CODIGOFORMAPAGAMENTO=${nova.codigo} WHERE CODIGO=${pagamento} AND CODIGOFORMAPAGAMENTO IN (${FORMA.CREDITO},${FORMA.DEBITO},${FORMA.PIX_MANUAL},${FORMA.PIX_ONLINE})`);
    if (uf.ok) {
      formaCorrigida = nova.nome;
      try { await sql`UPDATE recebimento_foto SET forma=${nova.nome} WHERE pagamento_codigo=${pagamento}`; } catch { /* segue */ }
    }
  }
  return { ok: true, pagamento, nsu, formaCorrigida };
}

/** Últimas baixas, com quem apertou. */
async function apiBaixas(limite, area) {
  const n = Math.min(200, Math.max(1, Number(limite) || 60));
  const filtro = area == null || area === '' ? sql`TRUE` : sql`area_codigo=${Number(area)}`;
  const r = await sql`SELECT id, criado_em, acao, area_nome, numero, itens_nome, n_itens, arquivo, sem_foto_motivo
    FROM baixa_foto WHERE ${filtro} ORDER BY criado_em DESC LIMIT ${n}`;
  const semFoto = (await sql`SELECT COUNT(*) AS n FROM baixa_foto
    WHERE arquivo IS NULL AND criado_em > now() - interval '1 day'`)[0];
  return { baixas: r, sem_foto_24h: Number(semFoto?.n ?? 0), guarda_dias: FOTO_DIAS };
}

// ---- HTML (uma SPA; rota / = produção, /entrega = entrega) ----
const HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="manifest" href="/app.webmanifest?t=kds"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><link rel="apple-touch-icon" href="/app-icon.png">
<title>${LOJA_NOME} — KDS</title><style>
:root{--bg:#f2f2f5;--card:#ffffff;--line:#e3e3e9;--ink:#1b1b20;--mut:#6e6e78;--gold2:#e0651a;--green:#15a34a;--green2:#0f8a3e;--red:#dc2626;--deliv:#2563eb;--mesa:#c0850f;--roxo:#6d5bd0;--roxo2:#5a49bd}
*{box-sizing:border-box}body{margin:0;font-family:'Outfit',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:12px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;box-shadow:0 1px 3px rgba(0,0,0,.05)}
h1{font-size:18px;margin:0}h1 b{color:var(--gold2)}
.back,.linkbtn{background:#f0f0f4;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:7px 13px;font:inherit;font-size:14px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:7px}
.back:hover,.linkbtn:hover{background:#e9e9ef}
.linkbtn.go{background:#eafaf0;border-color:#bfe9cf;color:var(--green2);font-weight:600}
.linkbtn .n{background:var(--green);color:#fff;border-radius:20px;padding:1px 8px;font-size:12px;font-weight:700}
.seg{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:10px;padding:9px 12px;font-size:14px;font-weight:600}
.seg.on{border-color:var(--green2);background:#eafaf0;color:var(--green2)}
.pill{font-size:12.5px;color:var(--mut);background:#f4f4f7;border:1px solid var(--line);border-radius:20px;padding:3px 11px}.pill b{color:var(--ink)}
.grow{flex:1}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}.on{background:var(--green)}.off{background:var(--red)}
/* seleção de áreas */
.sel{padding:24px 20px;max-width:1050px;margin:0 auto}
.sel h2{font-size:15px;color:var(--mut);font-weight:500;margin:0 0 16px;letter-spacing:.02em}
.areas{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}
.abtn.orfa{border-top-color:#e0651a}
.abtn{background:var(--card);border:1px solid var(--line);border-top:4px solid var(--roxo);border-radius:16px;padding:20px 18px;cursor:pointer;text-align:left;transition:.12s;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.06)}
.abtn:hover{background:#fafafb;transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.1)}
.abtn .an{font-size:20px;font-weight:700}.abtn .ap{margin-top:10px;font-size:13px;color:var(--mut)}
.abtn .ap b{color:var(--roxo2);font-size:26px;display:block;line-height:1}
/* grid de comandas */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px;padding:18px 20px}
.c{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:0;display:flex;flex-direction:column;border-top:3px solid var(--line);box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden}
.c.delivery{border-top-color:var(--deliv)}.c.mesa{border-top-color:var(--mesa)}.c.balcao{border-top-color:#bfbfc8}
.chd{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 14px 9px}
.rot{font-size:16px;font-weight:700}.c.delivery .rot{color:var(--deliv)}.c.mesa .rot{color:var(--mesa)}
.badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:2px 7px;border-radius:6px;margin-left:6px;background:rgba(37,99,235,.12);color:var(--deliv)}
.its{display:flex;flex-direction:column;gap:2px;padding:2px 14px 8px}
.it{font-size:14px;padding:6px 0;border-top:1px solid #f0f0f3;display:flex;align-items:flex-start;gap:8px}
.it:first-child{border-top:0}
.it .q{color:var(--gold2);font-weight:700;min-width:26px}.it .n{flex:1}
.it.sub .n{color:var(--mut);padding-left:8px;font-size:12.5px}
.it .tag{font-size:10px;color:var(--mut);background:#f2f2f6;border:1px solid var(--line);border-radius:5px;padding:1px 6px;margin-left:6px;white-space:nowrap}
.mod{margin:3px 0 0 34px;font-size:12px;color:#a8500b;background:rgba(224,101,26,.1);border-left:2px solid var(--gold2);padding:2px 8px;border-radius:0 6px 6px 0}.mod::before{content:"✎ "}
.b{border:0;border-radius:8px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;padding:5px 10px;white-space:nowrap;color:#fff}
.b.p{background:var(--roxo)}.b.p:hover{background:var(--roxo2)}
.b.e{background:var(--green)}.b.e:hover{background:var(--green2)}
.b:active{transform:scale(.96)}
.cfoot{padding:9px 12px;border-top:1px solid #eee;display:flex;gap:8px}
.cfoot .b{flex:1;font-size:13px;padding:9px}
.vazio{padding:70px 20px;text-align:center;color:var(--mut);font-size:15px}
/* faixa de RECLAMAÇÃO — vermelha, piscando, no topo. A mesa que reclamou
   passa na frente da fila; a cozinha adianta o prato pra apagar o incêndio. */
.alerta{background:var(--red);color:#fff;padding:15px 20px;font-size:21px;font-weight:800;letter-spacing:.02em;
  display:flex;align-items:center;gap:14px;flex-wrap:wrap;animation:pisca 1.1s ease-in-out infinite}
@keyframes pisca{0%,100%{background:#dc2626}50%{background:#8f1414}}
@media (prefers-reduced-motion:reduce){.alerta{animation:none}}
.alerta .ms{background:rgba(255,255,255,.22);border-radius:9px;padding:3px 12px}
.alerta .sub{font-size:13.5px;font-weight:500;opacity:.92;width:100%}
.c.reclamou{border:2px solid var(--red);border-top:4px solid var(--red);box-shadow:0 0 0 3px rgba(220,38,38,.13)}
.flag{background:var(--red);color:#fff;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;padding:2px 8px;border-radius:6px;margin-left:6px}
/* "sai junto": a outra praça já terminou e este item ainda está pendente */
.junto{background:#fff4e0;border-bottom:1px solid #f0d08a;color:#8a4b06;padding:11px 20px;font-size:14.5px;font-weight:600}
.junto b{color:#6b3a04}
.c.junto-alvo{border-top-color:#e0651a}
/* HISTÓRICO lateral: o que já saiu, na ordem. Resolve "quem deu baixa nisso?" */
.pal{display:flex;align-items:flex-start;gap:0}
.pal .main{flex:1;min-width:0}
.hist{width:270px;flex:0 0 270px;border-left:1px solid var(--line);background:#fff;
  max-height:calc(100vh - 58px);overflow:auto;position:sticky;top:58px}
.hist h3{font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);
  margin:0;padding:13px 15px 9px;border-bottom:1px solid var(--line);background:#fafafb;position:sticky;top:0}
.hi{padding:9px 15px;border-bottom:1px solid #f3f3f6;font-size:13px}
.hi .n{font-weight:600;line-height:1.28}
.hi .m{color:var(--mut);font-size:11.5px;margin-top:2px;display:flex;gap:8px;flex-wrap:wrap}
.hi .m b{color:var(--gold2);font-weight:700}
.hist .vaziinho{padding:22px 15px;color:var(--mut);font-size:13px}
@media (max-width:900px){.pal{flex-direction:column}.hist{width:auto;flex:none;border-left:0;
  border-top:1px solid var(--line);position:static;max-height:none}}
.flagj{background:#e0651a;color:#fff;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;padding:2px 8px;border-radius:6px;margin-left:6px}
.parmarca{margin:3px 0 0 34px;font-size:11.5px;color:#8a4b06;background:#fff4e0;border-left:2px solid #e0651a;padding:2px 8px;border-radius:0 6px 6px 0}
.parpronto{margin:4px 0 0 34px;font-size:12.5px;font-weight:800;color:#fff;background:#e0651a;padding:5px 9px;border-radius:7px;line-height:1.3}
.it.segurando{background:rgba(224,101,26,.07);border-radius:8px}
.badge.via{background:rgba(109,91,208,.14);color:var(--roxo2)}
/* fila / tempo / atraso */
.pos{background:#1b1b20;color:#fff;border-radius:8px;padding:2px 9px;font-weight:800;font-size:13px;margin-right:8px}
.c.atrasado .pos{background:var(--red)}
.tchip{font-size:12.5px;color:var(--mut);white-space:nowrap;font-weight:600}
.c.atrasado{border-top-color:var(--red);box-shadow:0 0 0 2px rgba(220,38,38,.28),0 4px 14px rgba(220,38,38,.18)}
.badge.late{background:rgba(220,38,38,.14);color:var(--red);animation:pisca 1.1s infinite}
.c.atrasado .tchip{color:var(--red);font-weight:800}
@keyframes pisca{50%{opacity:.35}}
.ptime{font-size:11px;color:var(--mut);margin-left:6px;white-space:nowrap}
</style><script>if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(function(){});</script></head><body>
<header id="hd"></header><div id="app"></div>
<script>
var ENTREGA = location.pathname.replace(/\\/+$/,'')==='/entrega';
var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')};
var AREA=null,timer=null,VIEW=null;
function setView(fn){VIEW=fn;clearInterval(timer);fn();timer=setInterval(fn,8000)}
function fmtMin(m){if(m==null)return'';return m<60?m+' min':Math.floor(m/60)+'h'+String(m%60).padStart(2,'0')}
/* ---- som de pedido novo (marcante: din-don duplo) ---- */
var SOM=localStorage.getItem('kds_som')!=='off';
var _ctx=null,_vistos=null;
function _tone(t,f,off,dur){var o=_ctx.createOscillator(),g=_ctx.createGain();o.type='square';o.frequency.value=f;
  g.gain.setValueAtTime(0.0001,t+off);g.gain.exponentialRampToValueAtTime(0.5,t+off+0.02);g.gain.exponentialRampToValueAtTime(0.0001,t+off+dur);
  o.connect(g);g.connect(_ctx.destination);o.start(t+off);o.stop(t+off+dur+0.05)}
function apitar(){if(!SOM)return;try{_ctx=_ctx||new (window.AudioContext||window.webkitAudioContext)();
  if(_ctx.state==='suspended')_ctx.resume();var t=_ctx.currentTime;
  _tone(t,880,0,0.45);_tone(t,1318.5,0.22,0.5);_tone(t,880,0.8,0.45);_tone(t,1318.5,1.02,0.6);}catch(e){}}
// ALARME DE ATRASO: nada a ver com o "din-don" de pedido novo. É grave,
// mais alto e repetido, pra virar cabeça na cozinha barulhenta.
function alarmar(){if(!SOM)return;try{_ctx=_ctx||new (window.AudioContext||window.webkitAudioContext)();
  if(_ctx.state==='suspended')_ctx.resume();var t=_ctx.currentTime;
  for(var k=0;k<5;k++){var o=_ctx.createOscillator(),g=_ctx.createGain(),b=t+k*0.42;
    o.type='sawtooth';o.frequency.setValueAtTime(300,b);o.frequency.linearRampToValueAtTime(620,b+0.3);
    g.gain.setValueAtTime(0.0001,b);g.gain.exponentialRampToValueAtTime(0.95,b+0.03);
    g.gain.exponentialRampToValueAtTime(0.0001,b+0.34);
    o.connect(g);g.connect(_ctx.destination);o.start(b);o.stop(b+0.4)}}catch(e){}}
// Repete a cada 45s enquanto houver comanda estourada — não deixa "acostumar".
var _crit=new Set(),_alarmeTmr=null;
function checaAtraso(d){
  var criticas=new Set();
  (d.comandas||[]).forEach(function(c){if(c.critico)criticas.add(c.codigo)});
  var nova=false;criticas.forEach(function(k){if(!_crit.has(k))nova=true});
  _crit=criticas;
  if(nova)alarmar();
  clearInterval(_alarmeTmr);
  if(criticas.size)_alarmeTmr=setInterval(alarmar,45000);
}
function toggleSom(){SOM=!SOM;localStorage.setItem('kds_som',SOM?'on':'off');if(SOM)apitar();if(VIEW)VIEW()}
function somBtn(){return '<button class="back" onclick="toggleSom()" title="som de pedido novo">'+(SOM?'🔊':'🔇')+'</button>'}
document.addEventListener('pointerdown',function(){try{_ctx=_ctx||new (window.AudioContext||window.webkitAudioContext)();if(_ctx.state==='suspended')_ctx.resume();}catch(e){}},{once:true});
function checaNovos(d){var atuais=new Set();(d.comandas||[]).forEach(function(c){(c.itens||[]).forEach(function(i){if(i.item_codigo!=null)atuais.add(i.item_codigo)})});
  var novo=false;if(_vistos!==null){atuais.forEach(function(k){if(!_vistos.has(k))novo=true})}
  _vistos=atuais;if(novo)apitar()}
function irSelecao(){AREA=null;_vistos=null;history.replaceState(0,'','/');setView(selecao)}
function irArea(cod){AREA={cod:cod};_vistos=null;history.replaceState(0,'','/?area='+cod);setView(kds)}
/* ---- CÂMERA: quem tocou a tela ----
   Sem login no KDS o tablet fica na praça e qualquer um encosta. A foto é a
   única referência de quem apertou.
   A câmera fica LIGADA de uma vez só: assim o toque não espera warm-up e o
   Chrome não pede permissão a cada baixa.
   ⚠️ getUserMedia exige contexto seguro. Em http://IP:8790 não existe, a menos
   que a origem esteja liberada em chrome://flags. Sem câmera, a baixa
   acontece do mesmo jeito — parar a cozinha seria pior — e fica registrada
   com o motivo, que aparece em vermelho no topo até alguém resolver. */
var CAM={stream:null,video:null,erro:null,pronta:false};
async function ligaCamera(){
  if(CAM.pronta)return;
  if(!window.isSecureContext){
    CAM.erro='a câmera exige HTTPS — libere esta origem em chrome://flags/#unsafely-treat-insecure-origin-as-secure';return}
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    CAM.erro='este navegador não dá acesso à câmera';return}
  try{
    var s=await navigator.mediaDevices.getUserMedia({audio:false,
      video:{facingMode:'user',width:{ideal:480},height:{ideal:360}}});
    var v=document.createElement('video');
    v.playsInline=true;v.muted=true;v.autoplay=true;v.srcObject=s;
    v.style.cssText='position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(v);
    try{await v.play()}catch(e){}
    CAM.stream=s;CAM.video=v;CAM.pronta=true;CAM.erro=null;
  }catch(e){
    CAM.erro=(e&&e.name==='NotAllowedError')
      ? 'permissão da câmera negada neste tablet'
      : 'não consegui abrir a câmera ('+((e&&e.name)||'erro')+')';
  }
}
function fotoAgora(){
  if(!CAM.pronta||!CAM.video)return null;
  try{
    var v=CAM.video;
    if(!v.videoWidth)return null;                 // ainda não recebeu quadro
    var w=320,h=Math.round(w*v.videoHeight/v.videoWidth);
    var c=document.createElement('canvas');c.width=w;c.height=h;
    c.getContext('2d').drawImage(v,0,0,w,h);
    return c.toDataURL('image/jpeg',0.55);        // ~20 KB por baixa
  }catch(e){return null}
}
function avisoCam(){
  if(CAM.pronta)return '';
  return '<span class="pill" style="background:#dc2626;color:#fff;border-color:#dc2626">⚠ CÂMERA BLOQUEADA — não dá baixa</span>';
}
/* Sem câmera, a tela inteira para: não adianta deixar apertar e levar erro a
   cada toque no meio do serviço. Mostra o que fazer e um botão pra tentar de
   novo depois de liberar. */
/* O caminho prático: um toque leva pro endereço seguro (https na porta
   seguinte). O tablet aceita o aviso do certificado UMA vez e a câmera passa a
   funcionar — sem mexer em chrome://flags, que nenhum botão consegue abrir. */
function urlSegura(){
  var porta=Number(location.port||80)+1;
  return 'https://'+location.hostname+':'+porta+location.pathname+location.search;
}
function telaSemCamera(){
  var jaHttps=(location.protocol==='https:');
  document.getElementById('app').innerHTML=
    '<div class="sel" style="max-width:760px"><h2 style="color:#dc2626;font-size:19px;font-weight:700">Câmera bloqueada — este tablet não pode dar baixa</h2>'+
    (jaHttps?'':
      '<div style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-top:14px;line-height:1.55">'+
      '<b>É rápido:</b> toque no botão abaixo. O Chrome vai avisar que o site não é conhecido — '+
      'toque em <b>Avançado</b> e depois em <b>Continuar</b>. Só na primeira vez neste aparelho.'+
      '<div class="mut" style="margin-top:8px;font-size:13px">É a nossa própria máquina da loja, na rede interna.</div>'+
      '</div>'+
      '<button class="abtn" style="margin-top:14px;border-top-color:var(--green);width:100%" '+
      'onclick="location.href=\\''+urlSegura()+'\\'">'+
      '<div class="an">🔒 Abrir no modo que libera a câmera</div>'+
      '<div class="ap">'+esc(urlSegura())+'</div></button>')+
    '<div style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-top:14px;line-height:1.5">'+
    '<div style="color:#a33">'+esc(CAM.erro||'a câmera não abriu')+'</div>'+
    (jaHttps?'<div class="mut" style="margin-top:8px;font-size:13px">Já está no endereço seguro. '+
      'Toque no cadeado da barra de endereço e permita a <b>Câmera</b> para este site.</div>':'')+
    '</div>'+
    '<button class="abtn" style="margin-top:14px;border-top-color:#dc2626" onclick="tentarCamera()">'+
    '<div class="an">Já liberei — tentar de novo</div></button>'+
    // sem esta saída a pessoa ficava presa no aviso, sem conseguir voltar
    // pra fila — e a cozinha PRECISA continuar vendo o que tem pra fazer
    '<button class="abtn" style="margin-top:10px" onclick="if(VIEW)VIEW()">'+
    '<div class="an">◂ Voltar aos pedidos</div>'+
    '<div class="ap">dá pra ver a fila; só a baixa é que exige a foto</div></button></div>';
}
async function tentarCamera(){ CAM.erro=null;CAM.pronta=false;await ligaCamera();if(VIEW)VIEW(); }
async function marca(campo,body){
  // a foto sai ANTES do fetch: é o instante do toque que interessa
  var f=fotoAgora();
  if(!f){ await tentarCamera(); if(!CAM.pronta){telaSemCamera();return} f=fotoAgora(); }
  if(!f){telaSemCamera();return}
  body.campo=campo;body.on=true;body.foto=f;
  var r=null;
  try{r=await (await fetch('/api/marca',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json()}catch(e){}
  if(r&&r.sem_camera){telaSemCamera();return}
  if(VIEW)VIEW();
}
function comandaHTML(c,modo,idx){
  var its=(c.itens||[]).map(function(i){
    if(i.tipo===2){ // complemento (molho, acompanhamento): sai junto com o prato-pai, sem botão próprio
      return '<div class="it sub"><span class="q">+</span><span class="n">'+esc(i.nome)+(i.modificado?'<div class="mod">'+esc(i.detalhes)+'</div>':'')+'</span></div>';
    }
    var tag=(modo==='entrega'&&i.area_nome)?'<span class="tag">'+esc(i.area_nome)+'</span>':'';
    var pt=(modo==='entrega'&&i.prod_min!=null)?'<span class="ptime">⚙ '+fmtMin(i.prod_min)+'</span>':'';
    var btn='';
    if(i.item_codigo!=null){
      if(modo==='entrega') btn='<button class="b e" onclick="marca(\\'entregue\\',{item_codigo:'+i.item_codigo+'})">Entregue</button>';
      else btn='<button class="b p" onclick="marca(\\'pronto\\',{item_codigo:'+i.item_codigo+'})">Pronto</button>';
    }
    var par='';
    if(i.esperando_par) par='<div class="parpronto">⏱ O PAR JÁ ESTÁ PRONTO no '+esc(i.esperando_par.praca)+
      (i.esperando_par.item?' ('+esc(i.esperando_par.item)+')':'')+' — este item está segurando</div>';
    else if(i.pareado) par='<div class="parmarca">⇄ sai junto com outra praça</div>';
    return '<div class="it'+(i.esperando_par?' segurando':'')+'"><span class="q">'+(Number(i.quantidade)||1)+'x</span>'+
      '<span class="n">'+esc(i.nome)+tag+pt+(i.modificado?'<div class="mod">'+esc(i.detalhes)+'</div>':'')+par+'</span>'+btn+'</div>';
  }).join('');
  var badge=c.tipo==='delivery'?'<span class="badge">delivery</span>':'';
  if(modo==='entrega'){
    // no passe o vermelho tem dois motivos: parou aqui, ou já veio tarde da
    // cozinha — o runner precisa saber qual, senão cobra a praça errada
    var mot=c.motivo_atraso==='producao'?'veio tarde da cozinha':'parado no passe';
    if(c.critico) badge+='<span class="flag">⏰ '+mot+'</span>';
    else if(c.atrasado) badge+='<span class="badge late">atrasado · '+mot+'</span>';
  }
  else if(c.critico) badge+='<span class="flag">⏰ estourou '+(c.prazo_min?'· prazo '+c.prazo_min+'min':'')+'</span>';
  else if(c.atrasado) badge+='<span class="badge late">atrasado'+(c.prazo_min?' · '+c.prazo_min+'min':'')+'</span>';
  if(c.reclamou) badge+='<span class="flag">⚠ reclamou · adiantar</span>';
  if(esperandoNesta(c.numero)) badge+='<span class="flagj">sai junto</span>';
  // entrega mostra OS DOIS tempos: idade do pedido (lançamento) e espera no passe
  var tchip='';
  if(modo==='entrega'){
    var tt=[];
    if(c.pedido_min!=null)tt.push('⏱ pedido '+fmtMin(c.pedido_min));
    if(c.aguarda_min!=null)tt.push('🛎 espera '+fmtMin(c.aguarda_min));
    if(tt.length)tchip='<span class="tchip" style="text-align:right">'+tt.join('<br>')+'</span>';
  }else if(c.espera_min!=null)tchip='<span class="tchip">⏱ '+fmtMin(c.espera_min)+'</span>';
  // 2ª via da mesma mesa: mostra a hora do lançamento pra não confundir
  if(c.rodada>0&&c.chegada) badge+='<span class="badge via">'+(c.rodada+1)+'ª via · '+
    new Date(c.chegada).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'</span>';
  var nome=c.nome?'<div style="font-size:12px;color:var(--mut);padding:0 14px 6px">'+esc(c.nome)+'</div>':'';
  var foot;
  // manda os códigos DESTA via: "tudo pronto" não pode baixar item de um
  // lançamento posterior que a cozinha nem começou
  var cods=JSON.stringify((c.itens||[]).filter(function(i){return i.item_codigo!=null&&i.tipo!==2})
    .map(function(i){return Number(i.item_codigo)}));
  if(modo==='entrega') foot='<div class="cfoot"><button class="b e" onclick="marca(\\'entregue\\',{item_codigos:'+cods+'})">✓ Entregar tudo</button></div>';
  else foot='<div class="cfoot"><button class="b p" onclick="marca(\\'pronto\\',{item_codigos:'+cods+'})">✓ Tudo pronto</button></div>';
  return '<div class="c '+c.tipo+(c.atrasado?' atrasado':'')+
    (c.reclamou?' reclamou':'')+(esperandoNesta(c.numero)?' junto-alvo':'')+'">'+
    '<div class="chd"><div class="rot"><span class="pos">'+(idx+1)+'º</span>'+esc(c.rotulo)+badge+'</div>'+tchip+'</div>'+
    nome+'<div class="its">'+its+'</div>'+foot+'</div>';
}
async function selecao(){
  var d=await (await fetch('/api/areas',{cache:'no-store'})).json();
  // menu da casa: a tela inicial é a porta de tudo — caixa entra aqui (quem
  // toca cai no PIN, então cozinha não entra por engano)
  document.getElementById('hd').innerHTML='<h1>${LOJA_HTML} · Produção</h1><span class="grow"></span>'+
    '<a class="linkbtn" href="/caixa">🧰 Caixa</a>'+
    '<a class="linkbtn" href="/tablet" title="instalar em tela cheia / atualizar">⚙</a>'+
    (d.tem_entrega===false?'':'<a class="linkbtn go" href="/entrega">Entregas <span class="n">'+d.entrega_n+'</span> ▸</a>')+
    '<span class="pill"><span class="dot '+(d.online?'on':'off')+'"></span>'+(d.online?'ao vivo':'offline')+'</span>';
  var app=document.getElementById('app');
  if(!d.areas.length){app.innerHTML='<div class="vazio">nenhum item aberto</div>';return}
  app.innerHTML='<div class="sel"><h2>Escolha a sua área de produção</h2><div class="areas">'+d.areas.map(function(a){
    // "Sem praça definida" entra em laranja: é anomalia de cadastro, não uma
    // praça de verdade. Sem ela o item ficava invisível e travava a mesa.
    return '<button class="abtn'+(a.orfa?' orfa':'')+'" onclick="irArea('+a.codigo+')"><div class="an">'+
      (a.orfa?'⚠ ':'')+esc(a.nome)+'</div>'+
      '<div class="ap"><b>'+a.a_produzir+'</b> a produzir · '+a.total+' no total'+
      (a.orfa?'<br>produto sem cozinha no Consumer':'')+'</div></button>';
  }).join('')+'</div></div>';
}
async function kds(){
  ligaCamera();   // quem baixar aqui fica registrado; a tela NÃO espera por ela
  var d=await (await fetch('/api/kds?area='+AREA.cod,{cache:'no-store'})).json();
  ESPERANDO=d.esperando||[];
  checaNovos(d); // pedido novo na área -> apita
  checaAtraso(d); // comanda estourou o prazo -> alarme grave e repetido
  var nCrit=(d.comandas||[]).filter(function(c){return c.critico}).length;
  document.getElementById('hd').innerHTML='<button class="back" onclick="irSelecao()">◂ Áreas</button>'+
    '<h1>'+esc(d.area.nome)+' · <b>Produção</b></h1>'+
    '<span class="pill"><b>'+d.nItens+'</b> a produzir</span>'+
    (nCrit?'<span class="pill" style="background:#dc2626;color:#fff;border-color:#dc2626"><b>'+nCrit+'</b> estourou o prazo</span>':'')+
    '<span class="grow"></span>'+avisoCam()+somBtn()+
    '<a class="linkbtn" href="/tempos" title="tempo de preparo">⏱</a>'+
    (d.tem_entrega===false?'':'<a class="linkbtn go" href="/entrega">Entregas ▸</a>')+
    '<span class="pill"><span class="dot '+(d.online?'on':'off')+'"></span>'+(d.online?'ao vivo':'offline')+'</span>';
  var app=document.getElementById('app');
  var topo=faixaCancelado(d,'NÃO produzir — tirar da fila')+faixaReclamacao(d)+faixaJunto(d);
  var corpo=d.comandas.length
    ? '<div class="grid">'+d.comandas.map(function(c,ix){return comandaHTML(c,'producao',ix)}).join('')+'</div>'
    : '<div class="vazio">tudo produzido nesta área ✅</div>';
  app.innerHTML='<div class="pal"><div class="main">'+topo+corpo+'</div>'+
    '<aside class="hist" id="hist"><h3>Últimos que saíram</h3><div class="vaziinho">carregando…</div></aside></div>';
  histLateral('/api/historico?modo=producao&area='+AREA.cod);
}
// Sempre o mesmo formato: item · mesa · hora. É por isso que a marca guarda
// o número — a comanda fecha e some do espelho, o histórico não pode perder.
async function histLateral(url){
  var el=document.getElementById('hist');if(!el)return;
  var d;try{d=await (await fetch(url,{cache:'no-store'})).json()}catch(e){return}
  var its=d.itens||[];
  el.innerHTML='<h3>Últimos que saíram</h3>'+(its.length?its.map(function(i){
    var t=i.quando?new Date(i.quando).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—';
    return '<div class="hi"><div class="n">'+esc(i.nome||'item')+'</div><div class="m">'+
      '<b>'+(i.numero?(Number(i.numero)>=${COMANDA_DE}?'Comanda ':'Mesa ')+i.numero:'sem mesa')+'</b>'+
      '<span>'+t+'</span>'+(i.area_nome?'<span>'+esc(i.area_nome)+'</span>':'')+'</div></div>';
  }).join(''):'<div class="vaziinho">nada saiu ainda</div>');
}
var ESPERANDO=[];
function esperandoNesta(numero){return ESPERANDO.some(function(e){return Number(e.numero)===Number(numero)})}
// (a marca fina agora e' por ITEM — ver i.esperando_par em comandaHTML)
// Reclamações em SEQUÊNCIA, da mais antiga pra mais nova — "mesa 1, mesa 8, mesa 10".
function faixaReclamacao(d){
  var rs=d.reclamacoes||[];if(!rs.length)return '';
  // ⚠️ ANTES ERA SÓ LEITURA: o KDS mostrava a reclamação e não tinha como
  // liberar — só o garçom conseguia, na tela dele. Agora cada uma tem o seu
  // "✓ resolvido" aqui também.
  return rs.map(function(r){
    return '<div class="alerta">⚠️ '+(r.mesa?'MESA '+r.mesa:'SEM MESA')+(r.ha_min>0?' · há '+r.ha_min+'min':'')+
      '<span class="sub">'+(r.texto?esc(r.texto):'Cliente reclamou')+' — adiante o que for dessa mesa.</span>'+
      '<button class="b" style="margin-top:8px;background:#fff;color:#7f1d1d;font-weight:800" '+
      'onclick="recResolvido('+r.id+')">✓ resolvido</button></div>';
  }).join('');
}
async function recResolvido(id){
  try{await fetch('/api/chamado/atender',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({id:id,por:(typeof AREA!=='undefined'&&AREA&&AREA.cod)?('praca '+AREA.cod):'kds'})})}catch(e){}
  if(typeof VIEW==='function'&&VIEW)VIEW();
}
// CANCELADO com item ainda na fila: banner GRANDE no topo. Sem isso o item
// sumia do KDS no ciclo seguinte e a cozinha seguia fazendo (ou o runner
// levava prato cancelado pra mesa).
/* fecha o aviso de cancelado: quem já tirou o prato da fila não precisa
   continuar olhando alarme vermelho até os 10 minutos passarem. */
async function cancVisto(id){
  try{await fetch('/api/cancelado/visto',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({id:id,por:(typeof AREA!=='undefined'&&AREA&&AREA.cod)?('praca '+AREA.cod):'kds'})})}catch(e){}
  if(typeof VIEW==='function'&&VIEW)VIEW();
}
function faixaCancelado(d,acao){
  var cs=d.cancelados||[];if(!cs.length)return '';
  return cs.map(function(c){
    var onde=(Number(c.numero)>=${COMANDA_DE}?'COMANDA ':'MESA ')+c.numero;
    var oq=(c.status_item==='pedido')?'PEDIDO INTEIRO CANCELADO':('CANCELADO: '+esc(c.nome||'item'));
    return '<div class="alerta" style="background:#7f1d1d;border-color:#dc2626;color:#fff;font-size:26px;line-height:1.25">🚫 '+onde+' — '+oq+
      '<span class="sub" style="color:#fecaca">'+(c.min_atras>0?('há '+c.min_atras+' min'):'agora')+(c.motivo?' · '+esc(c.motivo):'')+' — '+acao+'</span>'+
      (c.id?'<button class="b" style="margin-top:8px;background:#fff;color:#7f1d1d;font-weight:800" onclick="cancVisto('+c.id+')">✓ Ok, vi</button>':'')+
      '</div>';
  }).join('');
}
// A outra praça já entregou a parte dela: o que sair daqui está segurando o pedido.
function faixaJunto(d){
  var es=d.esperando||[];if(!es.length)return '';
  var txt=es.map(function(e){
    return '<b>'+esc(e.item)+'</b> ('+(Number(e.numero)>=${COMANDA_DE}?'comanda ':'mesa ')+e.numero+') — o par já saiu no '+esc(e.praca||'outra praça');
  }).join(' · ');
  return '<div class="junto">⏱️ SAI JUNTO — '+txt+'</div>';
}
// ENTREGA POR PRAÇA. Quem corre o prato da cozinha não é quem corre a bebida
// do bar — uma tela só, com tudo junto, faz os dois runners disputarem a mesma
// fila e nenhum saber o que é seu. Mesmo desenho da produção: escolhe a praça,
// e o tablet daquela estação fica fixo nela (o ?area= sobrevive ao refresh).
function irSelecaoEntrega(){AREA=null;_vistos=null;history.replaceState(0,'','/entrega');setView(selecaoEntrega)}
function irAreaEntrega(cod){AREA={cod:cod};_vistos=null;history.replaceState(0,'','/entrega?area='+cod);setView(entrega)}
async function selecaoEntrega(){
  var d=await (await fetch('/api/areas',{cache:'no-store'})).json();
  document.getElementById('hd').innerHTML='<a class="back" href="/">◂ Produção</a>'+
    '<h1>🛎️ <b>Entregas</b></h1><span class="grow"></span>'+
    '<span class="pill"><span class="dot '+(d.online?'on':'off')+'"></span>'+(d.online?'ao vivo':'offline')+'</span>';
  var app=document.getElementById('app');
  if(!d.areas.length){app.innerHTML='<div class="vazio">nenhum item aberto</div>';return}
  app.innerHTML='<div class="sel"><h2>Escolha a sua estação de entrega</h2><div class="areas">'+d.areas.map(function(a){
    return '<button class="abtn'+(a.orfa?' orfa':'')+'" onclick="irAreaEntrega('+a.codigo+')"><div class="an">'+
      (a.orfa?'⚠ ':'')+esc(a.nome)+'</div>'+
      '<div class="ap"><b>'+(a.a_entregar||0)+'</b> pronto(s) pra levar</div></button>';
  }).join('')+'</div></div>';
}
async function entrega(){
  ligaCamera();   // idem: quem entregou fica registrado
  var d=await (await fetch('/api/entrega?area='+AREA.cod,{cache:'no-store'})).json();
  checaNovos(d); // prato novo pronto -> apita no tablet da entrega também
  var nome=(d.comandas[0]&&d.comandas[0].itens[0]&&d.comandas[0].itens[0].area_nome)||AREANOME[AREA.cod]||'';
  document.getElementById('hd').innerHTML='<button class="back" onclick="irSelecaoEntrega()">◂ Estações</button>'+
    '<h1>🛎️ '+(nome?esc(nome)+' · ':'')+'<b>Entregas</b></h1>'+
    '<span class="pill"><b>'+d.nComandas+'</b> comandas</span><span class="pill"><b>'+d.nItens+'</b> prontos</span><span class="grow"></span>'+avisoCam()+somBtn()+
    '<span class="pill"><span class="dot '+(d.online?'on':'off')+'"></span>'+(d.online?'ao vivo':'offline')+'</span>';
  var app=document.getElementById('app');
  var corpo=d.comandas.length
    ? '<div class="grid">'+d.comandas.map(function(c,ix){return comandaHTML(c,'entrega',ix)}).join('')+'</div>'
    : '<div class="vazio">nada aguardando entrega aqui ✅</div>';
  corpo=faixaCancelado(d,'NÃO levar — retirar do passe')+corpo;
  app.innerHTML='<div class="pal"><div class="main">'+corpo+'</div>'+
    '<aside class="hist" id="hist"><h3>Últimos que saíram</h3><div class="vaziinho">carregando…</div></aside></div>';
  histLateral('/api/historico?modo=entrega&area='+AREA.cod);
}
// nome da praça pra quando a fila está vazia e não dá pra tirar de um item
var AREANOME={};
fetch('/api/areas',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
  (d.areas||[]).forEach(function(a){AREANOME[a.codigo]=a.nome});
}).catch(function(){});
if(ENTREGA){
  var _pe=new URLSearchParams(location.search);var ae=_pe.get('area');
  if(ae!==null&&ae!==''){AREA={cod:Number(ae)};setView(entrega)}else{setView(selecaoEntrega)}
}
else{var _p=new URLSearchParams(location.search);var a=_p.get('area');
  if(a!==null&&a!==''){AREA={cod:Number(a)};setView(kds)}else{irSelecao()}}

// ---- VERSAO NOVA NO SERVIDOR ----
// ⚠️ SEM ISTO A TELA FICA CONGELADA NO CODIGO VELHO. Estas paginas sao uma so:
// navegar nao recarrega nada, entao o aparelho segue rodando o JavaScript de
// quando abriu — mesmo com o servidor ja atualizado. Em 02/08 isso fez varias
// correcoes parecerem que "nao funcionaram": o servidor estava novo e o celular
// do garcom, velho.
// Recarrega sozinho quando a versao muda, mas so com a tela parada e sem
// pedido montado — ninguem perde o que estava digitando.
var VERSAO_MINHA='${VERSAO}';
setInterval(async function(){
  var v;try{v=await (await fetch('/api/versao',{cache:'no-store'})).json()}catch(e){return}
  if(!v||!v.versao||v.versao===VERSAO_MINHA)return;
  if(typeof CART!=='undefined'&&CART&&CART.length)return;
  if(document.visibilityState!=='visible')return;
  location.reload();
},60000);
</script></body></html>`;

// ---- /venda — tela do garçom (mobile) ----
const VENDA_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><link rel="manifest" href="/app.webmanifest?t=venda"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><link rel="apple-touch-icon" href="/app-icon.png">
<title>${LOJA_NOME} — Venda</title><style>
:root{--bg:#f2f2f5;--card:#fff;--line:#e3e3e9;--ink:#1b1b20;--mut:#6e6e78;--gold2:#e0651a;--green:#15a34a;--green2:#0f8a3e;--red:#dc2626;--roxo:#6d5bd0}
*{box-sizing:border-box}body{margin:0;font-family:'Outfit',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;padding-bottom:120px}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:10px}
h1{font-size:17px;margin:0}h1 b{color:var(--gold2)}
.back{background:#f0f0f4;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:7px 12px;font:inherit;font-size:14px;cursor:pointer}
.wrap{max-width:560px;margin:0 auto;padding:16px}
.tit{font-size:14px;color:var(--mut);margin:4px 0 10px}
input[type=number],input[type=text],input[type=search]{width:100%;font:inherit;font-size:17px;padding:13px 14px;border:1px solid var(--line);border-radius:12px;background:#fff;outline:none}
input:focus{border-color:var(--gold2)}
.big{background:var(--gold2);color:#fff;border:0;border-radius:12px;font:inherit;font-size:17px;font-weight:700;padding:14px;width:100%;cursor:pointer;margin-top:10px}
.big:active{transform:scale(.98)}.big.verde{background:var(--green)}.big[disabled]{opacity:.45}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.chip{background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:9px 13px;font:inherit;font-size:14.5px;cursor:pointer;color:var(--ink)}
.chip small{display:block;color:var(--mut);font-size:11px}
.chip .dono{display:block;font-size:12.5px;font-weight:700;margin-top:1px}
.chip.on{border-color:var(--gold2);background:rgba(224,101,26,.08);color:var(--gold2);font-weight:700}
.chip.add{border-style:dashed;color:var(--mut)}
.res{background:#fff;border:1px solid var(--line);border-radius:12px;margin-top:8px;overflow:hidden}
.ri{display:flex;justify-content:space-between;gap:10px;padding:12px 14px;border-top:1px solid #f0f0f3;cursor:pointer;align-items:center}
.ri:first-child{border-top:0}.ri:active{background:#faf5ef}
.ri.fora{opacity:.5;cursor:default;background:#fafafa}
.ri.fora:active{background:#fafafa}.ri.fora .p{color:var(--mut)}
.ri.fora .n small{color:var(--red)}
.chip small{white-space:nowrap}
/* grupos: grade uniforme — 3 por fila no celular, 4 em tela maior.
   Antes eram chips de largura livre e a lista ficava um paredão irregular. */
/* 4 linhas visíveis e o resto rola dentro da caixa — a lista não empurra
   a busca e o carrinho pra fora da tela do celular. */
.cats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0;
  max-height:288px;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-right:2px}
@media (min-width:430px){.cats{grid-template-columns:repeat(4,1fr)}}
.cat{background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:9px 6px;font:inherit;
  font-size:12.5px;line-height:1.22;cursor:pointer;color:var(--ink);text-align:center;min-height:64px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;overflow:hidden;word-break:break-word}
.cat .nm{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.cat .qt{font-size:11px;color:var(--mut);font-weight:400}
.cat.on{border-color:var(--gold2);background:rgba(224,101,26,.09);color:var(--gold2);font-weight:700}
.cat.on .qt{color:var(--gold2)}
.cat:active{transform:scale(.97)}
/* cor da mesa pelo status: verde em andamento, amarelo com atraso, vermelho fechando */
.chip.st-andamento{border-color:#8ed4a8;background:#f1fbf5}
.chip.st-andamento small{color:#0f8a3e}
.chip.st-atrasada{border-color:#e8c25a;background:#fffaeb}
.chip.st-atrasada small{color:#9a6b06}
.chip.st-fechando{border-color:#eda3a3;background:#fdf2f2}
.chip.st-fechando small{color:#b32626}
.legenda{width:100%;display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;color:var(--mut);font-size:12px}
.legenda span{display:flex;align-items:center;gap:5px}
.pt{width:9px;height:9px;border-radius:50%;display:inline-block}
.pt.v{background:#15a34a}.pt.a{background:#e0a413}.pt.r{background:#dc2626}
/* rodapé da mesa: imprimir / fechar / receber */
/* consumo da mesa: mesma semantica de cor da tela do cliente —
   VERMELHO a cozinha ainda faz · AMBAR pronto pra retirar · VERDE entregue */
/* acao apagada: da pra ver que existe e por que nao da pra usar ainda */
.ac.off{opacity:.45;background:#f2f2f5;color:#8a8a95;border-style:dashed}
.ccab{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);
  margin:14px 0 4px;padding-bottom:4px;border-bottom:1px solid var(--line)}
.ci{display:flex;align-items:flex-start;gap:10px;background:#fff;border:1px solid var(--line);
  border-left:4px solid #d2d2da;border-radius:11px;padding:11px 12px;margin-top:7px;font-size:15px}
.ci .q{font-weight:700;color:var(--gold2);min-width:26px}
.ci .n{flex:1}
.ci .ob,.ci .hr{display:block;color:var(--mut);font-size:11.5px;margin-top:3px}
.ci .st{font-size:11.5px;white-space:nowrap;align-self:center;font-weight:700}
.ci.preparando{border-left-color:#d33a2c;background:#fffafa}
.ci.preparando .st{color:#c0392b}
.ci.pronto{border-left-color:#e0a413}
.ci.pronto .st{color:#a97608}
.ci.entregue{border-left-color:#17803d;background:#f8fcf9}
.ci.entregue .st{color:#17803d}
.avisoc{background:#fdecea;border:1.5px solid #f1b0a8;color:#a3271b;border-radius:11px;
  padding:11px 13px;margin-top:12px;font-weight:700;font-size:14px}
.acoes{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:8px 0 4px}
.ac{background:#fff;border:1.5px solid var(--line);border-radius:13px;padding:14px 6px;font:inherit;
  font-size:19px;cursor:pointer;color:var(--ink);display:flex;flex-direction:column;align-items:center;gap:5px}
.ac span{font-size:12.5px;font-weight:600;line-height:1.2;text-align:center}
.ac:active{transform:scale(.97)}
.ac.rec{border-color:var(--green);color:var(--green2);background:#f1fbf5}
.grupohd{display:flex;align-items:center;gap:10px;padding:10px 13px;background:#f6f6fa;border-bottom:1px solid var(--line);font-size:14.5px}
.grupohd .mut{margin-left:auto;font-size:12.5px}
.voltag{background:#fff;border:1px solid var(--line);border-radius:8px;padding:5px 10px;font:inherit;font-size:13px;cursor:pointer;color:var(--ink)}
/* faixa "quem está na mesa" — sempre visível, um toque pra identificar */
.cliente{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);
  border-radius:13px;padding:11px 13px;margin-top:12px;cursor:pointer;font-size:15px}
.cliente .av{width:32px;height:32px;flex:none;border-radius:50%;background:var(--gold2);color:#fff;
  display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}
.cliente .av.vazio{background:#e9e9ef;color:var(--mut);font-size:20px}
.cliente .mut{font-size:12.5px}.cliente .seta{margin-left:auto;color:var(--mut);font-size:20px}
.segs{display:flex;gap:8px;margin:10px 0}
.seg{flex:1;background:#fff;border:1.5px solid var(--line);border-radius:11px;padding:11px;font:inherit;
  font-size:14.5px;cursor:pointer;color:var(--mut)}
.seg.on{border-color:var(--gold2);background:rgba(224,101,26,.09);color:var(--gold2);font-weight:700}
.chk{display:flex;align-items:center;gap:9px;margin-top:11px;font-size:14px;color:var(--mut);cursor:pointer}
.chk input{width:20px;height:20px}
/* teclado numérico da casa: o do Android tapava a tela inteira no CPF/WhatsApp */
.kp{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.kp button{padding:14px 0;font:inherit;font-size:22px;font-weight:800;border:1.5px solid var(--line);border-radius:12px;background:#fff;cursor:pointer}
.kp button:active{background:#f0f0f4}
input.kalvo{border-color:var(--gold2)}
.mini{background:none;border:0;color:var(--mut);font:inherit;font-size:13.5px;text-decoration:underline;
  cursor:pointer;padding:10px 0;width:100%;text-align:center}
.praca{background:#fff;border:1px solid var(--line);border-radius:12px;margin-top:10px;overflow:hidden}
.ph{background:#f6f6fa;padding:10px 13px;font-weight:700;font-size:14px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between}
.ph .qtd{color:var(--mut);font-weight:400}
.pi{display:flex;justify-content:space-between;gap:10px;padding:11px 13px;border-top:1px solid #f4f4f7;font-size:15px;align-items:flex-start}
.pi .obsv{display:block;color:var(--gold2);font-size:12.5px;margin-top:2px}
.aviso{background:#fff7e3;border:1px solid #f0d68f;border-radius:12px;padding:12px 14px;font-size:14px;margin-top:12px;line-height:1.45}
.totrev{display:flex;justify-content:space-between;font-size:18px;font-weight:800;padding:16px 4px 4px}
.jt{background:#fff;border:1.5px solid var(--line);border-radius:9px;width:34px;height:34px;font-size:16px;
  cursor:pointer;color:var(--mut);padding:0;vertical-align:middle}
.jt.on{border-color:var(--gold2);background:rgba(224,101,26,.12);color:var(--gold2);font-weight:800}
/* barra de chamados no celular do garçom — fica acima de tudo, sempre visível */
#chamados{position:sticky;top:0;z-index:9}
.ch{display:flex;align-items:center;gap:10px;padding:12px 16px;font-size:15px;font-weight:700;color:#fff}
.ch .ir{margin-left:auto;background:rgba(255,255,255,.25);border:0;color:#fff;font:inherit;font-size:13px;
  font-weight:700;border-radius:8px;padding:6px 12px;cursor:pointer;white-space:nowrap}
.ch.rec{background:var(--red);animation:pisca 1.1s ease-in-out infinite}
@keyframes pisca{0%,100%{background:#dc2626}50%{background:#8f1414}}
@media (prefers-reduced-motion:reduce){.ch.rec{animation:none}}
.ch.gar{background:#2563eb}
/* aviso automático de pedido pelo celular: informa, mas não grita como uma
   chamada de verdade — senão o garçom aprende a ignorar a faixa azul */
.ch.gar.ped{background:#4b5563}
.ri .n{font-size:15px}.ri .n small{color:var(--mut)}.ri .p{color:var(--gold2);font-weight:700;white-space:nowrap}
.cart{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);box-shadow:0 -4px 18px rgba(0,0,0,.08);max-height:62vh;overflow:auto}
.cart .in{max-width:560px;margin:0 auto;padding:10px 16px 14px}
.ci{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f0f0f3;font-size:14.5px}
.ci .nm{flex:1}.ci .nm small{display:block;color:var(--gold2);font-size:12px}
.qbtn{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:#f7f7fa;font-size:18px;font-weight:700;cursor:pointer}
.ci .q{min-width:22px;text-align:center;font-weight:700}
.ci .rm{color:var(--red);background:none;border:0;font-size:17px;cursor:pointer;padding:4px}
.obs{color:var(--mut);background:none;border:0;font-size:16px;cursor:pointer;padding:4px}
.tot{display:flex;justify-content:space-between;font-size:15px;font-weight:700;padding:10px 0 2px}
.ok{background:#eafaf0;border:1px solid #bfe9cf;border-radius:14px;padding:18px;text-align:center;margin-top:14px}
.ok .t{font-size:18px;font-weight:800;color:var(--green2)}
.err{background:#fdeeee;border:1px solid #f3c1c1;border-radius:12px;padding:12px 14px;color:#a11;font-size:14px;margin-top:10px}
.mut{color:var(--mut);font-size:13px}
</style><script>if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(function(){});</script></head><body>
<header><h1>${LOJA_HTML} · Venda</h1><span style="flex:1"></span><span id="gwho" class="mut" style="font-size:12.5px"></span><a class="back" href="/">KDS</a></header>
<div id="chamados"></div>
<div class="wrap" id="app"></div>
<div class="cart" id="cart" style="display:none"><div class="in" id="cartin"></div></div>
<script>
var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')};
var brl=function(n){return 'R$ '+Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2})};
var MESA=null, INFO=null, ALVO=null, CART=[], BUSCA='', debounce=null, CATS=null, CATSEL=null, AREAS=null, JUNTO=false;
// veio do CAIXA (?volta=caixa): "outra mesa"/"trocar mesa" devolvem pra tela
// do caixa (mesas + número), não pro seletor do vendedor
var VOLTA=new URLSearchParams(location.search).get('volta');
function outraMesa(){if(VOLTA==='caixa'){location.href='/caixa';return}telaMesa()}
// token do garçom logado — vai no header de toda chamada; o servidor exige nas
// ações que mexem na conta (enviar/transferir/conta/vincular).
var GTOK=null; try{GTOK=localStorage.getItem('garcom_tok')||null}catch(e){}
function hdrs(x){var h=x||{}; if(GTOK)h['x-garcom']=GTOK; return h}
function app(h){document.getElementById('app').innerHTML=h}
async function jget(u){var r=await fetch(u,{cache:'no-store',headers:hdrs()}); if(r.status===401){sessaoCaiu();return {ok:false,erro:'sessão expirada',sem_sessao:true}} return r.json()}
async function jpost(u,b){var r=await fetch(u,{method:'POST',headers:hdrs({'content-type':'application/json'}),body:JSON.stringify(b)}); if(r.status===401){sessaoCaiu();return {ok:false,erro:'Sua sessão expirou — entre de novo.',sem_sessao:true}} return r.json()}
function sessaoCaiu(){ try{localStorage.removeItem('garcom_tok')}catch(e){} GTOK=null; }

async function telaMesa(){
  MESA=null;ALVO=null;CART=[];CATSEL=null;BUSCA='';renderCart();
  app('<div class="tit">Mesas abertas — toque pra lançar</div>'+
    '<div class="chips" id="abertas"><span class="mut">carregando…</span></div>'+
    '<div class="tit" style="margin-top:18px">Ou digite o número</div>'+
    '<input type="text" id="nmesa" inputmode="numeric" placeholder="ex.: 5" readonly onclick="kpAlvo(this)">'+kpHtml('nmesa')+
    '<button class="big" onclick="abrirMesa()">Abrir mesa</button>'+
    '<div class="mut" style="margin-top:14px">${COMANDA_ATIVA ? 'A <b>mesa</b> é o lugar; a <b>comanda (' + COMANDA_MIN + '–' + COMANDA_MAX + ')</b> é a pessoa. Dentro da mesa dá pra abrir comandas.' : 'Cada <b>mesa</b> tem a sua própria conta.'}</div>');
  var el=document.getElementById('nmesa');
  el.addEventListener('keydown',function(e){if(e.key==='Enter')abrirMesa()});
  var d=await jget('/api/venda/abertas');
  var h='';
  (d.mesas||[]).forEach(function(m){
    h+='<button class="chip st-'+(m.status||'andamento')+'" onclick="irPara('+m.numero+','+m.numero+')">Mesa '+m.numero+
       (m.nome?'<b class="dono">'+esc(m.nome)+'</b>':'')+
       '<small>'+m.itens+' itens · '+brl(m.valor_total)+'</small></button>';
  });
  (d.comandas||[]).forEach(function(c){
    h+='<button class="chip st-'+(c.status||'andamento')+'" onclick="irPara('+(c.mesa||c.numero)+','+c.numero+')">Comanda '+c.numero+
       (c.nome?'<b class="dono">'+esc(c.nome)+'</b>':'')+
       '<small>'+(c.mesa?'mesa '+c.mesa+' · ':'')+c.itens+' itens · '+brl(c.valor_total)+'</small></button>';
  });
  var a=document.getElementById('abertas');
  if(a)a.innerHTML=(h||'<span class="mut">nenhuma mesa aberta agora</span>')+
    (h?'<div class="legenda"><span><i class="pt v"></i>em andamento</span>'+
        '<span><i class="pt a"></i>algo atrasado</span><span><i class="pt r"></i>conta pedida</span></div>':'');
}
function irPara(mesa,alvo){MESA=Number(mesa);ALVO=Number(alvo);carregarMesa()}
// As três ações da conta. Nenhuma delas ENCERRA o pedido: quem fecha e emite
// a nota continua sendo o Consumer. "Fechar" aqui = marcar que pediu a conta.
async function acaoConta(acao){
  var alvo=ALVO||MESA;
  var oQue=acao==='imprimir'?('Imprimir a conta '+rotuloAlvo()+'?'):('Marcar '+rotuloAlvo()+' como conta pedida?');
  if(!confirm(oQue))return;
  var r=await jpost('/api/venda/conta',{numero:alvo,acao:acao});
  var m=document.getElementById('msg');
  if(m)m.innerHTML=r.ok?'<div class="ok"><div class="t">✓ '+esc(r.msg)+'</div></div>'
                      :'<div class="err">'+esc(r.erro||'erro')+'</div>';
  if(r.ok)setTimeout(carregarMesa,1500);
}
// Mesa mudou de lugar, ou a comanda foi pra outra mesa.
function telaTransferir(){
  var ehComanda=ALVO>=${COMANDA_DE};
  app('<button class="back" onclick="carregarMesa()">◂ voltar</button>'+
    '<div class="tit" style="margin-top:12px">'+(ehComanda?'Mover a comanda '+ALVO:'Mover a mesa '+MESA)+'</div>'+
    '<div class="mut" style="margin-bottom:12px">'+(ehComanda
      ? 'A comanda passa a pertencer a outra mesa. Os itens continuam nela.'
      : 'Todos os itens da mesa '+MESA+' vão pra mesa nova, e as comandas dela vão junto.')+'</div>'+
    '<input type="text" id="dest" inputmode="numeric" placeholder="número da mesa de destino" readonly onclick="kpAlvo(this)">'+kpHtml('dest')+
    '<button class="big" onclick="confirmarTransf()">Transferir</button>'+
    '<div id="msg"></div>');
  var el=document.getElementById('dest');if(el)el.focus();
}
async function confirmarTransf(){
  var d=Number((document.getElementById('dest')||{}).value);
  if(!(d>=1&&d<=${MESA_MAX})){alert('Informe a mesa de destino (1 a ${MESA_MAX})');return}
  var origem=ALVO>=${COMANDA_DE}?ALVO:MESA;
  if(!confirm('Transferir '+(ALVO>=${COMANDA_DE}?'a comanda '+origem:'tudo da mesa '+origem)+' para a mesa '+d+'?'))return;
  var r=await jpost('/api/venda/transferir',{de:origem,para:d});
  var m=document.getElementById('msg');
  if(!r.ok){if(m)m.innerHTML='<div class="err">'+esc(r.erro||'erro')+'</div>';return}
  MESA=d;ALVO=ALVO>=${COMANDA_DE}?ALVO:d;
  app('<div class="ok"><div class="t">✓ Transferido</div><div class="mut" style="margin-top:6px">'+esc(r.msg)+'</div></div>'+
    '<button class="big" onclick="carregarMesa()">Abrir a mesa '+d+'</button>');
}
function rotuloAlvo(){return (ALVO>=${COMANDA_DE}?'da comanda '+ALVO:'da mesa '+MESA)}
// conta na tela: imprime em qualquer impressora, ou só mostra pro cliente
function verConta(){location.href='/conta/ver?n='+(ALVO||MESA)}
async function abrirMesa(){
  var n=Number(document.getElementById('nmesa').value);
  if(!(n>=1&&n<=${MESA_MAX})){alert('Mesa de 1 a ${MESA_MAX}');return}
  MESA=n;ALVO=n;await carregarMesa();
}
async function carregarMesa(){
  renderCart(); // a revisão esconde o carrinho fixo; voltando, ele reaparece
  INFO=await jget('/api/venda/mesa?n='+MESA);
  var chips='<button class="chip'+(ALVO===MESA?' on':'')+'" onclick="setAlvo('+MESA+')">Mesa '+MESA+
    infoDe(MESA)+'</button>';
  INFO.comandas.forEach(function(c){
    var quem=(INFO.nomes||{})[c];
    chips+='<button class="chip'+(ALVO===c?' on':'')+'" onclick="setAlvo('+c+')">'+
      (quem?esc(quem):'Comanda '+c)+(quem?' <span class="mut" style="font-weight:400">·'+c+'</span>':'')+
      infoDe(c)+'</button>';
  });
  if(${COMANDA_ATIVA})chips+='<button class="chip add" onclick="addComanda()">+ comanda</button>';
  var quemMesa=INFO.cliente;
  // ABRIR A MESA MOSTRA O QUE A MESA JA CONSUMIU — nao o campo de busca.
  // Quem chega na mesa e' perguntado "e o meu peixe?" antes de "quero pedir".
  // Antes o garcom caia direto no buscador e tinha que sair da tela pra ver o
  // consumo; agora e' o contrario, e "Pedir" abre a busca.
  app('<button class="back" onclick="outraMesa()">'+(VOLTA==='caixa'?'◂ caixa':'◂ trocar mesa')+'</button>'+
    '<div class="cliente" onclick="telaCliente('+MESA+')">'+
      (quemMesa?'<span class="av">'+esc(quemMesa.charAt(0))+'</span><b>'+esc(quemMesa)+'</b><span class="mut">na mesa '+MESA+'</span>'
               :'<span class="av vazio">+</span><b>Identificar o cliente</b><span class="mut">CPF ou WhatsApp</span>')+
      '<span class="seta">›</span></div>'+
    '<div class="tit" style="margin-top:12px">Lançar em</div><div class="chips">'+chips+'</div>'+
    (INFO.conta_pedida
      ? '<div class="avisoc">🔒 Conta pedida — não entra mais lançamento nesta mesa.</div>'+
        '<button class="big" style="background:#17803d;margin-top:8px" '+
        'onclick="acaoConta(\\'reabrir\\')">🔓 Liberar novos pedidos</button>'
      : '<button class="big" style="margin-top:14px" onclick="telaPedirGarcom()">➕ Pedir</button>')+
    '<div class="tit" style="margin-top:20px">Consumo <span id="cres" class="mut" style="font-weight:400"></span></div>'+
    '<div id="consumo"><span class="mut">carregando…</span></div>'+
    '<div id="msg"></div>'+
    '<div class="tit" style="margin-top:22px">Conta</div>'+
    // "Ver/imprimir" saiu: o consumo ja esta na tela acima, o garcom nao precisa
    // abrir outra pagina pra ver o que ele acabou de ler. (A pagina /conta/ver
    // continua existindo — e' o que o CLIENTE abre no celular dele.)
    // Transferir fica NA LINHA da conta, do lado de "Pedir conta" (a .acoes tem
    // 3 colunas). Embaixo sobra so o RECEBER (Pix) — a acao de toda noite.
    '<div class="acoes">'+
      '<button class="ac" onclick="acaoConta(\\'imprimir\\')">🧾<span>Imprimir no caixa</span></button>'+
      '<button class="ac" onclick="acaoConta(\\'fechar\\')">🔒<span>Pedir conta</span></button>'+
      '<button class="ac" onclick="telaTransferir()">⇄<span>Transferir '+(ALVO>=${COMANDA_DE}?'comanda':'mesa')+'</span></button>'+
    '</div>'+
    '<button class="big" style="background:#17803d;margin-top:9px" onclick="telaReceber(null)">💳 Receber a conta <span style="font-weight:400">· Pix</span></button>'+
    '<div class="mut" style="margin-top:8px">Cartão é na maquininha. O cliente também paga sozinho por Pix na tela da mesa dele.</div>');
  pintaConsumo();
}
// O QUE A MESA JA CONSUMIU, com o estado de cada item.
// Mesma leitura que o cliente ve no celular (/api/ja-pedido), pra garcom e
// cliente nunca contarem historias diferentes na frente da mesa.
var EST_G={preparando:'em produção',pronto:'pronto, retirar',entregue:'entregue'};
async function pintaConsumo(){
  var el=document.getElementById('consumo');if(!el)return;
  var d;try{d=await jget('/api/ja-pedido?n='+MESA)}catch(e){el.innerHTML='<span class="mut">não consegui ler o consumo</span>';return}
  var grupos=d.grupos||[], total=0, faltando=0;
  var h=grupos.map(function(g){
    var cab=(g.tipo==='comanda')
      ? '<div class="ccab">Comanda '+g.numero+(g.nome?' · '+esc(g.nome):'')+'</div>'
      : (grupos.length>1?'<div class="ccab">Mesa '+g.numero+'</div>':'');
    return cab+(g.itens||[]).map(function(i){
      total++; if(i.estado!=='entregue')faltando++;
      var quando=(i.estado==='preparando'&&i.espera_min!=null)?('há '+i.espera_min+' min')
        :(i.estado==='pronto'?'aguardando retirada':'');
      return '<div class="ci '+i.estado+'"><span class="q">'+i.quantidade+'x</span>'+
        '<span class="n">'+esc(i.nome)+
        (i.observacao?'<small class="ob">✎ '+esc(i.observacao)+'</small>':'')+
        (i.complementos&&i.complementos.length?'<small class="ob">+ '+i.complementos.map(esc).join(' · ')+'</small>':'')+
        (quando?'<small class="hr">'+quando+'</small>':'')+'</span>'+
        '<span class="st">'+EST_G[i.estado]+'</span></div>';
    }).join('');
  }).join('');
  el.innerHTML=h||'<div class="mut" style="padding:10px 0">Nada lançado ainda nesta mesa.</div>';
  var r=document.getElementById('cres');
  if(r)r.textContent=total?('· '+total+' item(ns)'+(faltando?' · '+faltando+' ainda não entregue(s)':' · tudo entregue')):'';
}
// ---- RECEBER A CONTA (so Pix) ----
// O garcom gera o QR no celular DELE e o cliente aponta a camera do app do
// banco. Mesmo funil do Pix da tela do cliente: /api/pix/cobrar cobra com o
// piso de servico imposto no servidor, /api/pix/conferir confirma e registra
// no Consumer (forma Pix online) UMA vez so. Cartao segue na maquininha —
// esta rede e' HTTP, numero de cartao nao passa por aqui.
var RCB={conta:null,alvo:null,gorj:null,partes:1,valor:null,tmr:null,cobrado:0};
function rcbPara(){if(RCB.tmr){clearInterval(RCB.tmr);RCB.tmr=null}}
function rcbSair(){rcbPara();carregarMesa()}
async function telaReceber(alvo){
  rcbPara();
  var st;try{st=await jget('/api/pix/status')}catch(e){st={}}
  if(!st.disponivel){alert('Pix pela tela não está ligado nesta casa. Por enquanto, maquininha.');return}
  RCB.alvo=(alvo==null)?null:Number(alvo);RCB.partes=1;RCB.valor=null;
  var n=(RCB.alvo==null)?MESA:RCB.alvo;
  app('<div class="mut" style="margin-top:14px">abrindo a conta…</div>');
  var c=await jget('/api/conta/texto?n='+n);
  if(!c.ok){alert(c.erro||'não consegui abrir essa conta');carregarMesa();return}
  RCB.conta=c;RCB.gorj=Number(c.taxa_servico||10);
  pintaReceber();
}
function moedaR(v){return 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}
function rcbCalc(){
  var c=RCB.conta,itens=Number(c.total||0);
  var gorj=+(itens*RCB.gorj/100).toFixed(2);
  var resta=Math.max(0,+((itens+gorj)-Number(c.pago||0)).toFixed(2));
  var cobrar=(RCB.valor!=null)?Math.min(RCB.valor,resta):+(resta/RCB.partes).toFixed(2);
  return {itens:itens,gorj:gorj,resta:resta,cobrar:cobrar};
}
// Le "100", "100,50", "1.234,56", "R$ 80" — SEM regex de proposito: neste
// arquivo (template literal) barra invertida em regex ja quebrou tela duas
// vezes. split/join faz o mesmo servico sem escape nenhum.
function rcbNumero(txt){
  var t=String(txt||'').split(' ').join('').split('R$').join('').split('r$').join('');
  if(t.indexOf(',')>=0){t=t.split('.').join('').split(',').join('.')}
  var n=Number(t);return (isFinite(n)&&n>0)?n:null;
}
function rcbGorj(p){RCB.gorj=p;RCB.valor=null;pintaReceber()}
function rcbPartes(k){RCB.partes=k;RCB.valor=null;pintaReceber()}
// So atualiza o numero grande — redesenhar a tela toda roubava o foco do campo.
function rcbDigitou(txt){
  RCB.valor=rcbNumero(txt);
  var el=document.getElementById('rcbv');
  if(el)el.textContent=moedaR(rcbCalc().cobrar);
}
function pintaReceber(){
  var v=rcbCalc();
  var cmds=(INFO&&INFO.comandas)||[];
  var chips='<button class="chip'+(RCB.alvo==null?' on':'')+'" onclick="telaReceber(null)">Mesa '+MESA+'</button>'+
    cmds.map(function(cn){var quem=(INFO.nomes||{})[cn];
      return '<button class="chip'+(RCB.alvo===cn?' on':'')+'" onclick="telaReceber('+cn+')">'+
        (quem?esc(quem):'Comanda '+cn)+'</button>'}).join('');
  var pagos=(RCB.conta.pagamentos||[]);
  app('<button class="back" onclick="rcbSair()">◂ mesa '+MESA+'</button>'+
    '<div class="tit" style="margin-top:12px">Receber de</div><div class="chips">'+chips+'</div>'+
    '<div id="rcbv" style="font-size:34px;font-weight:800;margin:12px 0 2px">'+moedaR(v.cobrar)+'</div>'+
    '<div class="mut">'+(RCB.valor!=null?'valor digitado — o resto continua na conta'
      :(RCB.partes>1?'1/'+RCB.partes+' do que falta ('+moedaR(v.resta)+')'
      :'consumo '+moedaR(v.itens)+' + serviço '+moedaR(v.gorj)+(Number(RCB.conta.pago||0)>0?' − já pago '+moedaR(RCB.conta.pago):'')))+'</div>'+
    '<div class="tit" style="margin-top:16px">Serviço</div><div class="chips">'+
      [10,15].map(function(p){return '<button class="chip'+(RCB.gorj===p?' on':'')+'" onclick="rcbGorj('+p+')">'+p+'%</button>'}).join('')+'</div>'+
    '<div class="tit" style="margin-top:10px">Dividir por</div><div class="chips">'+
      [1,2,3,4,5,6].map(function(k){return '<button class="chip'+(RCB.partes===k&&RCB.valor==null?' on':'')+'" onclick="rcbPartes('+k+')">'+k+'</button>'}).join('')+'</div>'+
    '<div class="tit" style="margin-top:10px">Ou digite o valor</div>'+
    '<input type="text" inputmode="decimal" placeholder="'+v.cobrar.toFixed(2).split('.').join(',')+'" oninput="rcbDigitou(this.value)">'+
    (pagos.length?'<div class="mut" style="margin-top:8px">já entrou: '+pagos.map(function(g){return esc(g.forma||'pagto')+' '+moedaR(g.valor)}).join(' · ')+'</div>':'')+
    '<button class="big" style="background:#17803d;margin-top:14px" onclick="rcbGerar()">Gerar o Pix</button>');
}
async function rcbGerar(){
  var n=(RCB.alvo==null)?MESA:RCB.alvo,v=rcbCalc();
  app('<div class="mut" style="margin-top:16px">gerando o código Pix…</div>');
  var r=await jpost('/api/pix/cobrar',{mesa:n,gorjeta_pct:RCB.gorj,dividir_por:RCB.partes,
    valor:(RCB.valor!=null?v.cobrar:undefined)});
  if(!r.ok){alert(r.erro||'não consegui gerar o Pix');pintaReceber();return}
  RCB.cobrado=Number(r.valor||0);
  app('<button class="back" onclick="rcbVoltarDoQr()">◂ voltar</button>'+
    '<div class="tit" style="margin-top:10px">Pix de '+((RCB.alvo==null)?('mesa '+MESA):('comanda '+RCB.alvo))+'</div>'+
    '<div style="font-size:34px;font-weight:800;margin:6px 0 10px">'+moedaR(r.valor)+'</div>'+
    (r.imagem?'<div style="background:#fff;border-radius:14px;padding:14px;display:inline-block"><img src="'+r.imagem+'" alt="QR Pix" style="display:block;width:min(70vw,300px)"></div>':'')+
    '<div class="mut" style="margin:10px 0 4px">O cliente aponta a câmera do app do banco. A confirmação aparece aqui sozinha.</div>'+
    '<div style="font-size:11px;word-break:break-all;background:rgba(255,255,255,.07);border-radius:10px;padding:10px;margin-top:6px" onclick="rcbSelec(this)">'+esc(r.copia_cola||'')+'</div>'+
    '<div id="rcbst" style="margin-top:14px;font-weight:700">aguardando o pagamento…</div>');
  rcbVigiar(r.txid);
}
function rcbVoltarDoQr(){rcbPara();telaReceber(RCB.alvo)}
function rcbSelec(el){try{var rg=document.createRange();rg.selectNodeContents(el);var s=getSelection();s.removeAllRanges();s.addRange(rg)}catch(e){}}
function rcbVigiar(txid){
  rcbPara();
  var tent=0,ocup=false;
  RCB.tmr=setInterval(async function(){
    if(++tent>120){rcbPara();var st=document.getElementById('rcbst');
      if(st)st.textContent='não confirmou em 10 min — volte e gere outro código';return}
    if(ocup)return;ocup=true;
    var s;try{s=await jget('/api/pix/conferir?txid='+encodeURIComponent(txid))}
    catch(e){ocup=false;return}
    ocup=false;
    if(s.ok&&s.pago){
      rcbPara();
      app('<div style="text-align:center;margin-top:40px">'+
        '<div style="font-size:52px;color:#17c964">✓</div>'+
        '<div style="font-size:26px;font-weight:800;margin-top:6px">Recebido '+moedaR(RCB.cobrado)+'</div>'+
        '<div class="mut" style="margin-top:8px">Registrado na conta como Pix online.</div></div>'+
        '<button class="big" style="margin-top:24px" onclick="carregarMesa()">Voltar pra mesa</button>');
    }
  },5000);
}
// A BUSCA agora e' uma tela a parte, aberta pelo botao "Pedir".
async function telaPedirGarcom(){
  renderCart();
  var chips='<button class="chip'+(ALVO===MESA?' on':'')+'" onclick="setAlvo('+MESA+')">Mesa '+MESA+
    infoDe(MESA)+'</button>';
  (INFO.comandas||[]).forEach(function(c){
    var quem=(INFO.nomes||{})[c];
    chips+='<button class="chip'+(ALVO===c?' on':'')+'" onclick="setAlvo('+c+')">'+
      (quem?esc(quem):'Comanda '+c)+infoDe(c)+'</button>';
  });
  app('<button class="back" onclick="carregarMesa()">◂ voltar pra mesa '+MESA+'</button>'+
    '<div class="tit" style="margin-top:12px">Lançar em</div><div class="chips">'+chips+'</div>'+
    '<div class="tit">Produto</div>'+
    '<input type="search" id="busca" placeholder="buscar produto… (ex.: file, caipirinha)" value="'+esc(BUSCA)+'" oninput="buscar(this.value)">'+
    '<div id="grupos"><div class="tit" style="margin-top:12px">ou escolha o grupo</div>'+
    '<div class="cats" id="cats"><span class="mut">carregando…</span></div></div>'+
    '<div class="res" id="res" style="display:none"></div>'+
    '<div id="msg"></div>');
  var el=document.getElementById('busca');
  if(el)el.addEventListener('keydown',function(e){if(e.key==='Escape'){this.value='';buscar('')}});
  await carregarCategorias();
  if(BUSCA)buscar(BUSCA); else if(CATSEL)verCat(CATSEL);
}
async function carregarCategorias(){
  if(!CATS)CATS=(await jget('/api/venda/categorias')).categorias||[];
  var el=document.getElementById('cats');if(!el)return;
  el.innerHTML=CATS.map(function(c){
    return '<button class="cat'+(CATSEL===c.categoria?' on':'')+'" onclick=\\'verCat('+JSON.stringify(c.categoria).replace(/'/g,'&#39;')+')\\'>'+
      '<span class="nm">'+esc(c.categoria)+'</span><span class="qt">'+c.disp+'</span></button>';
  }).join('');
}
// Escolheu o grupo: a grade INTEIRA sai da tela e fica só a lista do grupo,
// com um botão de voltar. Ficar com 36 grupos por cima da lista empurrava os
// produtos pra fora do alcance do polegar.
async function verCat(nome){
  CATSEL=nome;BUSCA='';
  var b=document.getElementById('busca');if(b)b.value='';
  var g=document.getElementById('grupos');if(g)g.style.display='none';
  var d=await jget('/api/venda/categoria?c='+encodeURIComponent(nome));
  var el=document.getElementById('res');if(!el)return;
  el.style.display='block';
  el.innerHTML='<div class="grupohd"><button class="voltag" onclick="fechaCat()">◂ grupos</button>'+
    '<b>'+esc(nome)+'</b><span class="mut">'+(d.produtos||[]).length+' itens</span></div>'+
    ((d.produtos&&d.produtos.length)?d.produtos.map(linhaProduto).join(''):'<div class="ri"><span class="n mut">nada encontrado</span></div>');
}
function fechaCat(){
  CATSEL=null;
  var r=document.getElementById('res');if(r)r.style.display='none';
  var g=document.getElementById('grupos');if(g)g.style.display='';
  carregarCategorias();
}
function linhaProduto(p){
  // GRUPO = produto com mais de uma variante (Dose/Garrafa, ou as frutas do
  // gin). Mostra uma linha só e pergunta qual ao tocar — o preço muda por
  // variante, então listar 17 linhas quase iguais só atrapalha.
  if(p.grupo){
    var faixa=(p.preco===p.preco_max)?brl(p.preco):(brl(p.preco)+' a '+brl(p.preco_max));
    if(p.sem_estoque)return '<div class="ri fora"><span class="n">'+esc(p.nome)+
      ' <small>· fora de estoque</small></span><span class="p">'+faixa+'</span></div>';
    return '<div class="ri" onclick="escolherVariante('+p.produto_codigo+')">'+
      '<span class="n">'+esc(p.nome)+' <small>· '+p.disponiveis+' opções</small></span>'+
      '<span class="p">'+faixa+'</span></div>';
  }
  var nm=esc(p.nome)+(p.tamanho?' <small>['+esc(p.tamanho)+']</small>':'');
  if(p.sem_estoque)return '<div class="ri fora"><span class="n">'+nm+' <small>· fora de estoque</small></span>'+
    '<span class="p">'+brl(p.preco)+'</span></div>';
  return '<div class="ri" onclick=\\'addItem('+JSON.stringify(p).replace(/'/g,'&#39;')+')\\'>'+
    '<span class="n">'+nm+'</span><span class="p">'+brl(p.preco)+'</span></div>';
}
async function escolherVariante(prod){
  var d=await jget('/api/venda/variantes?p='+prod);
  if(!d.ok||!d.produtos.length){alert('sem opções disponíveis');return}
  var el=document.getElementById('res');if(!el)return;
  el.style.display='block';
  el.innerHTML='<div class="rh">'+esc(d.nome)+' — escolha</div>'+
    d.produtos.map(function(v){
      var rot=esc(v.tamanho||'padrão');
      if(v.sem_estoque)return '<div class="ri fora"><span class="n">'+rot+' <small>· fora</small></span>'+
        '<span class="p">'+brl(v.preco)+'</span></div>';
      return '<div class="ri" onclick=\\'addItem('+JSON.stringify(v).replace(/'/g,'&#39;')+')\\'>'+
        '<span class="n">'+rot+'</span><span class="p">'+brl(v.preco)+'</span></div>';
    }).join('');
}
function mostrarProdutos(ps){
  var el=document.getElementById('res');if(!el)return;
  el.style.display='block';
  el.innerHTML=(ps&&ps.length)?ps.map(linhaProduto).join(''):'<div class="ri"><span class="n mut">nada encontrado</span></div>';
}
function infoDe(n){
  var a=(INFO.abertos||[]).find(function(x){return Number(x.numero)===n});
  return a?'<small>'+a.itens+' itens · '+brl(a.valor_total)+'</small>':'<small>vazia</small>';
}
function setAlvo(n){ALVO=n;carregarMesa()}
// Abrir comanda em 2 passos: número, depois QUEM é. O CPF é opcional — se a
// pessoa não quiser dar, segue só com o número, como sempre foi.
// A COMANDA SO NASCE COM DONO. Aqui a gente apenas GUARDA o numero e vai pedir
// quem e' — o vinculo so e' criado la no salvar. Assim "voltar" no meio do
// caminho nao deixa comanda solta na mesa, que foi o que aconteceu em 01/08.
var NOVACOMANDA=null;
function addComanda(){
  var c=prompt('Número da comanda (${COMANDA_MIN}–${COMANDA_MAX}):');if(!c)return;
  criarComanda(Number(c));
}
async function criarComanda(c){
  if(!(c>=${COMANDA_MIN}&&c<=${COMANDA_MAX})){alert('Comanda de ${COMANDA_MIN} a ${COMANDA_MAX}');return}
  NOVACOMANDA=c;
  telaCliente(c);         // nada e' criado ainda — quem cria e' salvarCliente()
}
var CPFINFO=null,cpfDeb=null,ALVOID=null;
// Esta tela e' SO de CPF. Existiu um seletor CPF/WhatsApp aqui — saiu em
// 02/08: o CPF e' a chave, o WhatsApp vem depois, no passo 2. Ter dois modos
// so criava a duvida de qual usar.
// Identificar quem está no lugar — serve pra MESA e pra COMANDA.
// CPF ou WhatsApp: o cliente dá o que quiser.
function telaCliente(numero){
  ALVOID=Number(numero);CPFINFO=null;
  var nova=(NOVACOMANDA===ALVOID);
  app('<button class="back" onclick="cancelarIdent()">◂ voltar</button>'+
    '<div class="tit" style="margin-top:12px">Quem está '+(ALVOID>=${COMANDA_DE}?'na comanda '+ALVOID:'na mesa '+ALVOID)+'</div>'+
    (nova?'<div class="mut" style="margin:6px 0 10px">A comanda '+ALVOID+' só abre depois disto — '+
      'sem dono ela não é criada.</div>':'')+

    '<input type="text" id="ncpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" readonly onclick="kpAlvo(this)">'+kpHtml('ncpf')+
    '<div id="quem" class="mut" style="margin-top:10px">Digite o CPF — se ele já for conhecido, o nome vem sozinho.</div>'+
    '<div id="passo2"></div>');
  var el=document.getElementById('ncpf');if(el)el.focus();
}
// Sair sem salvar NAO pode deixar comanda pela metade.
function cancelarIdent(){ NOVACOMANDA=null; carregarMesa(); }
// Passo 2: o nome (quando nao veio do cadastro) e o WhatsApp.
// O WhatsApp e' o que a casa usa pra avisar de reserva e mesa pronta — sem
// pedir aqui, ele nunca entra: esta e' a unica hora em que a pessoa esta na
// frente do garcom com o celular na mao.
// ⚠️ AQUI NAO SE DIGITA NOME. Sao dois campos e ponto: CPF e WhatsApp.
// O nome vem da consulta — cadastro da casa, quem ja atendemos, outras filiais
// ou SPC. Pedir pro garcom digitar era transferir pra ele um problema nosso, e
// ainda abria a porta pra grafia errada entrar na base (foi assim que a base
// ganhou 34 CPFs duplicados com nomes diferentes).
// Se a consulta nao trouxer nome, a tela DIZ isso e nao deixa salvar — comanda
// sem dono e' o que a gente esta justamente evitando.
function passo2(telFim){
  var p2=document.getElementById('passo2');if(!p2)return;
  // JÁ TEM WHATSAPP CADASTRADO -> não pede de novo (pedido do dono): mostra o
  // final que a casa tem e segue. Trocar o número é um toque, pra quem mudou.
  if(telFim){
    p2.innerHTML='<div class="tit" style="margin-top:16px">WhatsApp</div>'+
      '<div class="mut">Já temos o número desta pessoa (final '+esc(String(telFim).slice(-4))+') — não precisa digitar.</div>'+
      '<button class="big" style="margin-top:12px" onclick="salvarCliente()">Salvar</button>'+
      '<div style="margin-top:10px;text-align:right"><a style="color:var(--mut);text-decoration:underline;cursor:pointer" onclick="trocarZap()">trocar o número</a></div>';
    return;
  }
  p2.innerHTML='<div class="tit" style="margin-top:16px">WhatsApp</div>'+
    '<input type="text" id="nzap" inputmode="numeric" placeholder="(79) 90000-0000" readonly onclick="kpAlvo(this)">'+kpHtml('nzap')+
    '<label class="chk"><input type="checkbox" id="ncad" checked> cadastrar pra próxima visita</label>'+
    '<button class="big" style="margin-top:12px" onclick="salvarCliente()">Salvar</button>'+
    '<div class="mut" style="margin-top:8px">Serve pra avisar de reserva e mesa pronta.</div>';
}
function trocarZap(){
  var p2=document.getElementById('passo2');if(!p2)return;
  p2.innerHTML='<div class="tit" style="margin-top:16px">Novo WhatsApp</div>'+
    '<input type="text" id="nzap" inputmode="numeric" placeholder="(79) 90000-0000" readonly onclick="kpAlvo(this)">'+kpHtml('nzap')+
    '<button class="big" style="margin-top:12px" onclick="salvarCliente()">Salvar</button>';
}
// Consulta nao trouxe nome: explica e oferece tentar de novo. Sem campo de nome.
function semNome(msg){
  var p2=document.getElementById('passo2');if(!p2)return;
  p2.innerHTML='<div class="mut" style="margin-top:12px">'+esc(msg)+'</div>'+
    '<button class="big g" style="margin-top:10px" onclick="repetirBusca()">Consultar de novo</button>';
}
function repetirBusca(){
  var i=document.getElementById('ncpf');if(!i)return;
  var v=i.value;i.value='';olhaCpf('',i);i.value=v;olhaCpf(v,i);
}
// ---- CPF: confere na hora, no proprio aparelho ----
// Digito verificador e' aritmetica pura: sem servidor, sem consulta paga, sem
// internet. O servidor confere de novo — isto e' conforto, nao seguranca.
// ⚠️ Esta funcao ja existiu numa SEGUNDA copia deste mesmo bloco, que era
// codigo morto (declaracao de funcao e' icada e a ULTIMA vence). A copia foi
// removida em 01/08. Se voltar a aparecer bloco repetido aqui, e' bug.
function cpfOk(v){
  var c=String(v||'').replace(/\\D/g,'');
  if(c.length!==11)return false;
  if(/^(\\d)\\1{10}$/.test(c))return false;
  for(var k=0;k<2;k++){
    var len=9+k, pos=10+k, soma=0;
    for(var i=0;i<len;i++) soma+=Number(c[i])*(pos-i);
    var d=(soma*10)%11; if(d===10)d=0;
    if(d!==Number(c[len]))return false;
  }
  return true;
}
/* teclado numérico próprio: campo readonly, o do Android nem abre. */
var KP_ALVO=null;
function kpAlvo(el){KP_ALVO=el.id;document.querySelectorAll('input.kalvo').forEach(function(x){x.classList.remove('kalvo')});el.classList.add('kalvo')}
function kpHtml(alvo){KP_ALVO=alvo;
  return '<div class="kp">'+['7','8','9','4','5','6','1','2','3','0','⌫'].map(function(k){
    return '<button type="button" onclick="kpT(\\''+(k==='⌫'?'back':k)+'\\')">'+k+'</button>'}).join('')+'</div>';}
function kpT(k){
  var e=KP_ALVO&&document.getElementById(KP_ALVO);if(!e)return;
  if(k==='back')e.value=(e.value||'').replace(/.$/,'');
  else e.value=(e.value||'')+k;
  if(e.id==='ncpf')olhaCpf(e.value,e); else e.dispatchEvent(new Event('input'));
}
function mascaraCpf(inp){
  var c=String(inp.value||'').replace(/\\D/g,'').slice(0,11);
  var t=c;
  if(c.length>9) t=c.slice(0,3)+'.'+c.slice(3,6)+'.'+c.slice(6,9)+'-'+c.slice(9);
  else if(c.length>6) t=c.slice(0,3)+'.'+c.slice(3,6)+'.'+c.slice(6);
  else if(c.length>3) t=c.slice(0,3)+'.'+c.slice(3);
  if(inp.value!==t)inp.value=t;
  inp.style.color = (c.length===11 && !cpfOk(c)) ? '#c0392b' : '';
  return c;
}
function olhaCpf(v,inp){
  CPFINFO=null;clearTimeout(cpfDeb);
  var d=inp?mascaraCpf(inp):String(v||'').replace(/\\D/g,'');
  var q=document.getElementById('quem');if(!q)return;
  var min=11;
  if(d.length===11&&!cpfOk(d)){
    q.style.color='#c0392b';q.textContent='CPF não confere — confira os números.';return}
  if(d.length<min){q.style.color='';q.innerHTML='Digite o CPF — o nome vem da consulta.';return}
  q.style.color='';q.textContent='consultando…';
  cpfDeb=setTimeout(async function(){
    var r=await jget('/api/venda/identificar?cpf='+d);
    if(!r.ok){q.style.color='#dc2626';q.textContent=r.erro||'inválido';return}
    q.style.color='';
    // O FLUXO E' UM SO: CPF -> o nome VEM. Da base da casa, de quem ja
    // atendemos, das outras filiais ou do SPC — o garcom nao digita nome.
    // Campo de nome so aparece quando NENHUMA fonte respondeu, e ai a tela
    // diz por que, em vez de simplesmente pedir pra digitar.
    if(r.nome){CPFINFO=r;
      q.innerHTML='<b style="color:#0f8a3e">'+esc(r.nome)+'</b>'+
        ' <span class="mut">· '+fonteTexto(r.fonte)+'</span>';
      passo2(r.telefone_fim);}
    else if(r.fonte==='erro'){
      q.innerHTML='<span style="color:#b45309">A consulta não respondeu agora.</span>';
      semNome('Sem o nome não dá pra abrir. Tente de novo em alguns segundos.'+
        (r.aviso?' ('+r.aviso+')':''));}
    else {
      q.innerHTML='<span style="color:#b45309">Não achei nome para este CPF.</span>';
      semNome('Confira se o número está certo. Se estiver, a consulta não encontrou esta pessoa.');}
  },500);
}
function fonteTexto(f){
  return f==='consumer'?'já é cliente da casa'
    :f==='grupo'?'já veio em outra unidade'
    :f==='ja-atendido'?'já atendido aqui'
    :(f==='spc'||f==='spc-cache')?'consulta externa'
    :f==='ambiguo'?'CPF repetido na base':'cadastro';
}
async function salvarCliente(){
  var doc=((document.getElementById('ncpf')||{}).value||'').replace(/\\D/g,'');
  var zap=((document.getElementById('nzap')||{}).value||'').replace(/\\D/g,'');
  var nome=CPFINFO?CPFINFO.nome:'';
  if(!nome){alert('Digite o CPF primeiro — o nome vem da consulta.');return}
  var body={numero:ALVOID,nome:nome};
  if(doc.length===11)body.cpf=doc;
  if(zap.length>=10)body.telefone=zap;
  if(CPFINFO&&CPFINFO.contato_fb)body.contato_fb=CPFINFO.contato_fb;
  else if((document.getElementById('ncad')||{}).checked)body.cadastrar=true;
  // COMANDA NOVA: e' AQUI que ela nasce, com o dono junto. Se isto falhar,
  // nada foi criado — nao sobra comanda solta.
  if(NOVACOMANDA===ALVOID){
    var v=await jpost('/api/venda/vincular',{mesa:MESA,comanda:ALVOID,
      nome:nome,cpf:body.cpf||null,telefone:body.telefone||null,contato_fb:body.contato_fb||null});
    if(!v.ok){alert(v.erro);return}
    NOVACOMANDA=null;
  }
  var r=await jpost('/api/venda/identificar',body);
  if(!r.ok){alert(r.erro);return}
  CPFINFO=null;
  if(ALVOID>=${COMANDA_DE})ALVO=ALVOID;
  await carregarMesa();
}
// AQUI HAVIA UMA TERCEIRA criarComanda() QUEBRADA — removida.
// Ela nao recebia parametro: lia o numero de um campo 'ncmd' que NENHUMA tela
// desenha (a string 'ncmd' aparecia uma unica vez no arquivo inteiro,
// justamente na linha que a lia). Como declaracao de funcao e' icada e a
// ULTIMA vence, era essa que rodava — sombreando as duas versoes boas, que
// recebem o numero por argumento. Resultado em producao na Prainha Bar: o
// garcom clicava "+ comanda", digitava 305, e levava "Comanda de 300 a 400".
// Sempre. O numero ia por argumento e era descartado; o campo inexistente
// virava NaN. Sobra de uma tela antiga de abrir comanda com formulario.
//
// CUIDADO ao editar comentarios aqui dentro: este bloco vive DENTRO de um
// template literal. Crase fecha a string e quebra o arquivo inteiro.
function buscar(v){
  BUSCA=v;clearTimeout(debounce);
  // digitou = os grupos somem na hora e a lista fica só do que casa com o texto
  var g=document.getElementById('grupos');
  if(g)g.style.display=v?'none':'';
  if(v){CATSEL=null;carregarCategorias()}
  if(!v||v.length<2){var r=document.getElementById('res');if(r)r.style.display='none';return}
  debounce=setTimeout(async function(){
    var d=await jget('/api/venda/busca?q='+encodeURIComponent(v));
    mostrarProdutos(d.produtos);
  },250);
}
// ---- PERGUNTAS DO PRATO (wizard do Consumer) ----
// "Ponto da carne?", "Com gelo?" — as MESMAS perguntas do cardápio do cliente
// e da maquininha. O garçom/caixa lançava sem responder e a cozinha ficava
// adivinhando; agora o item só entra no carrinho depois do mínimo respondido.
var PERG=null,PERGIX=0,PERGRESP=null,PERGPROD=null;
async function addItem(p){
  if(p.sem_estoque)return;
  var w=null;
  try{w=await (await fetch('/api/venda/perguntas?pdv='+p.codigo_pdv,{cache:'no-store'})).json()}catch(e){}
  if(w&&w.ok&&w.perguntas&&w.perguntas.length){
    PERGPROD=p;PERG=w.perguntas;PERGIX=0;
    PERGRESP=w.perguntas.map(function(){return []});
    return pintaPerg();
  }
  addDireto(p,null,null,0);
}
function addDireto(p,obs,respostas,extra){
  if(!obs&&!respostas){
    var j=CART.find(function(x){return x.codigo_pdv===p.codigo_pdv&&!x.obs&&!x.respostas});
    if(j){j.qtd++;renderCart();return}
  }
  CART.push({codigo_pdv:p.codigo_pdv,nome:p.nome,tamanho:p.tamanho,preco:Number(p.preco)+(extra||0),qtd:1,obs:obs||'',area_codigo:p.area_codigo,respostas:respostas||null});
  renderCart();
}
function pergExtra(){
  var t=0;
  (PERGRESP||[]).forEach(function(sel,i){sel.forEach(function(c){
    var o=PERG[i].opcoes.find(function(x){return x.codigo===c});
    if(o)t+=Number(o.preco||0);
  })});
  return t;
}
function pergFecha(){var o=document.getElementById('pgov');if(o)o.remove();PERG=null;PERGPROD=null}
function pintaPerg(){
  var q=PERG[PERGIX],sel=PERGRESP[PERGIX];
  var ilim=!q.max;
  var lim=(q.min===q.max&&q.min>0)?('escolha '+q.min):(ilim?(q.min?('pelo menos '+q.min):'opcional'):('de '+q.min+' a '+q.max));
  var ex=pergExtra();
  var h='<div style="max-width:520px;width:100%;max-height:88vh;overflow:auto;background:#fff;border-radius:14px;padding:16px" onclick="event.stopPropagation()">'+
    '<div style="font-size:19px;font-weight:800;color:#111">'+esc(q.texto)+'</div>'+
    '<div class="mut" style="margin:4px 0 10px">'+esc(PERGPROD.nome)+' · '+lim+' · '+(PERGIX+1)+' de '+PERG.length+
      (ex>0?' · <b>+ '+brl(ex)+'</b>':'')+'</div>'+
    q.opcoes.map(function(o){
      var on=sel.indexOf(o.codigo)>=0;
      return '<div onclick="pergMarca('+o.codigo+')" style="display:flex;justify-content:space-between;gap:8px;padding:12px;border:2px solid '+(on?'#0a7d38':'#ddd')+';border-radius:10px;margin-bottom:8px;font-weight:'+(on?'800':'500')+';color:#111;cursor:pointer">'+
        '<span>'+(on?'✓ ':'')+esc(o.nome)+'</span>'+
        '<span>'+(Number(o.preco)>0?'+ '+brl(Number(o.preco)):'')+'</span></div>';
    }).join('')+
    '<button class="big" onclick="pergProx()">'+(PERGIX+1<PERG.length?'Continuar':'Adicionar ao pedido')+'</button>'+
    '<button class="big" style="background:#888" onclick="'+(PERGIX>0?'pergVolta()':'pergFecha()')+'">'+(PERGIX>0?'◂ Voltar':'Cancelar')+'</button>'+
    '</div>';
  var ov=document.getElementById('pgov');
  if(!ov){
    ov=document.createElement('div');ov.id='pgov';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:80;display:flex;align-items:center;justify-content:center;padding:14px';
    document.body.appendChild(ov);
  }
  ov.innerHTML=h;
}
function pergMarca(cod){
  var q=PERG[PERGIX],sel=PERGRESP[PERGIX],i=sel.indexOf(cod);
  if(i>=0){sel.splice(i,1);return pintaPerg()}
  var teto=q.max||99;
  if(teto===1)sel.length=0;
  else if(sel.length>=teto){alert('Escolha no máximo '+teto+'.');return}
  sel.push(cod);pintaPerg();
}
function pergVolta(){PERGIX--;pintaPerg()}
function pergProx(){
  var q=PERG[PERGIX],sel=PERGRESP[PERGIX];
  if(sel.length<(q.min||0)){alert('Escolha pelo menos '+q.min+'.');return}
  if(PERGIX+1<PERG.length){PERGIX++;return pintaPerg()}
  var nomes=[],codigos=[];
  PERGRESP.forEach(function(s,i){s.forEach(function(c){
    var o=PERG[i].opcoes.find(function(x){return x.codigo===c});
    if(o){nomes.push(o.nome);codigos.push(o.codigo)}
  })});
  var p=PERGPROD,ex=pergExtra();
  pergFecha();
  // mesmo contrato do cardápio do cliente: obs = nomes escolhidos, respostas = códigos
  addDireto(p,nomes.join(', '),codigos,ex);
}
// REVISAO: nada vai pra cozinha sem passar por aqui. O garcom anota a mesa
// inteira, confere item por item com a mesa e so entao confirma.
function nomeArea(c){
  if(c==null||c==='0')return 'Sem praça definida';
  var a=(AREAS||[]).find(function(x){return Number(x.codigo)===Number(c)});
  return a?a.nome:'Área '+c;
}
async function revisar(){
  if(!CART.length)return;
  if(!AREAS)AREAS=(await jget('/api/areas')).areas||[];
  document.getElementById('cart').style.display='none';
  var grupos={},ordem=[];
  CART.forEach(function(i){
    var k=(i.area_codigo==null?'0':String(i.area_codigo));
    if(!grupos[k]){grupos[k]=[];ordem.push(k)}
    grupos[k].push(i);
  });
  var alvoTxt=(ALVO>=${COMANDA_DE}?'Comanda '+ALVO+(MESA&&MESA!==ALVO?' · Mesa '+MESA:''):'Mesa '+MESA);
  var h='<button class="back" onclick="carregarMesa()">◂ voltar e ajustar</button>'+
    '<div class="tit" style="margin-top:12px">Confira antes de enviar — <b>'+esc(alvoTxt)+'</b></div>';
  if(ordem.length>1){
    h+='<div class="aviso"><b>Este pedido vai para '+ordem.length+' praças.</b><br>'+
       '<span class="mut">Marque <b>⇄</b> nos itens que devem sair ao mesmo tempo — só neles. '+
       'O resto segue normal, sem esperar.</span></div>';
  }
  ordem.forEach(function(k){
    var its=grupos[k],n=its.reduce(function(s,i){return s+i.qtd},0);
    h+='<div class="praca"><div class="ph"><span>'+esc(nomeArea(k))+'</span><span class="qtd">'+n+' item'+(n>1?'s':'')+'</span></div>';
    its.forEach(function(i){
      var ix=CART.indexOf(i);
      h+='<div class="pi"><span><b>'+i.qtd+'×</b> '+esc(i.nome)+
        (i.tamanho?' <span class="mut">['+esc(i.tamanho)+']</span>':'')+
        (i.obs?'<span class="obsv">✎ '+esc(i.obs)+'</span>':'')+'</span>'+
        '<span style="white-space:nowrap">'+
        (ordem.length>1?'<button class="jt'+(i.junto?' on':'')+'" onclick="togJunto('+ix+')" title="sai junto">⇄</button> ':'')+
        '<span class="p">'+brl(i.preco*i.qtd)+'</span>'+
        ' <button class="rm" onclick="rmRev('+ix+')">✕</button></span></div>';
    });
    h+='</div>';
  });
  var tot=CART.reduce(function(s,i){return s+i.preco*i.qtd},0);
  h+='<div class="totrev"><span>Total</span><span>'+brl(tot)+'</span></div>'+
     '<button class="big verde" id="btnenviar" onclick="enviar()">CONFIRMAR E ENVIAR PRA COZINHA</button>'+
     '<button class="big" style="background:#888" onclick="carregarMesa()">Voltar e ajustar</button>'+
     '<div id="msg"></div>';
  app(h);
}
function rmRev(ix){CART.splice(ix,1);if(CART.length)revisar();else carregarMesa()}
// marca ESTE item pra sair junto. So vale se houver marcado em praca diferente
// — dois itens da mesma cozinha ja saem juntos naturalmente.
function togJunto(ix){CART[ix].junto=!CART[ix].junto;revisar()}
function renderCart(){
  var c=document.getElementById('cart');
  if(!CART.length){c.style.display='none';return}
  c.style.display='block';
  var rows=CART.map(function(i,ix){
    return '<div class="ci"><div class="nm">'+esc(i.nome)+(i.tamanho?' <span class="mut">['+esc(i.tamanho)+']</span>':'')+(i.obs?'<small>✎ '+esc(i.obs)+'</small>':'')+'</div>'+
      '<button class="qbtn" onclick="qtd('+ix+',-1)">−</button><span class="q">'+i.qtd+'</span><button class="qbtn" onclick="qtd('+ix+',1)">+</button>'+
      '<button class="obs" onclick="editObs('+ix+')" title="observação">✎</button>'+
      '<button class="rm" onclick="rm('+ix+')">✕</button></div>';
  }).join('');
  var tot=CART.reduce(function(s,i){return s+i.preco*i.qtd},0);
  var alvoTxt=ALVO>=${COMANDA_DE}?('Comanda '+ALVO+' · Mesa '+MESA):('Mesa '+MESA);
  document.getElementById('cartin').innerHTML=rows+
    '<div class="tot"><span>'+alvoTxt+'</span><span>'+brl(tot)+'</span></div>'+
    '<button class="big" onclick="revisar()">REVISAR PEDIDO ('+CART.reduce(function(s,i){return s+i.qtd},0)+')</button>'+
    '<div class="mut" style="text-align:center;margin-top:6px">continue anotando a mesa toda — só envia depois de conferir</div>';
}
function qtd(ix,d){CART[ix].qtd+=d;if(CART[ix].qtd<1)CART.splice(ix,1);renderCart()}
function rm(ix){CART.splice(ix,1);renderCart()}
function editObs(ix){var o=prompt('Observação do prato (ex.: ao ponto, sem cebola):',CART[ix].obs||'');if(o!==null){CART[ix].obs=o.trim();renderCart()}}
async function enviar(){
  if(!CART.length)return;
  var btn=document.getElementById('btnenviar')||document.querySelector('.big.verde');
  if(btn){btn.disabled=true;btn.textContent='Enviando…'}
  var r=await jpost('/api/venda/enviar',{numero:ALVO,itens:CART.map(function(i){return {codigo_pdv:i.codigo_pdv,qtd:i.qtd,obs:i.obs,junto:!!i.junto,respostas:i.respostas||null}})});
  if(r.ok){
    CART=[];JUNTO=false;renderCart();
    app('<div class="ok"><div class="t">✓ Enviado pra cozinha</div>'+
      '<div class="mut" style="margin-top:6px">'+(r.numero>=${COMANDA_DE}?'Comanda '+r.numero+(r.mesa?' · Mesa '+r.mesa:''):'Mesa '+r.numero)+
      ' · '+r.n_itens+' item(ns) · '+brl(r.total)+' · pedido #'+r.pedido_fb+'</div></div>'+
      (r.avisos_impressora&&r.avisos_impressora.length?'<div class="avisoc" style="margin-top:10px;font-size:16px"><b>'+r.avisos_impressora.map(esc).join('</b><br><b>')+'</b></div>':'')+
      '<button class="big" onclick="carregarMesa()">Continuar nesta mesa</button>'+
      '<button class="big" style="background:#888" onclick="outraMesa()">'+(VOLTA==='caixa'?'◂ Voltar pro caixa':'Outra mesa')+'</button>');
  } else {
    var m=document.getElementById('msg');
    if(m)m.innerHTML='<div class="err">'+esc(r.erro||'erro')+'</div>';
    if(btn){btn.disabled=false;btn.textContent='CONFIRMAR E ENVIAR PRA COZINHA'}
  }
}
// ---- chamados da mesa: reclamação (vermelho piscando) e chamar garçom ----
// Fica no topo de QUALQUER tela do garçom. Reclamação primeiro: é a que a
// cozinha vai adiantar, e quanto antes alguém for à mesa, menor o estrago.
async function puxarChamados(){
  var el=document.getElementById('chamados');if(!el)return;
  var d;try{d=await jget('/api/chamados'+(typeof AREA!=='undefined'&&AREA&&AREA.cod?('?area='+AREA.cod):''))}catch(e){return}
  var h='';
  // Reclamação é sensível: some da comanda mobile de quem NÃO é gerente. Ela
  // aparece no KDS (a cozinha adianta) e aqui só pro gerente.
  if(EH_GERENTE)(d.reclamacoes||[]).forEach(function(r){
    h+='<div class="ch rec">⚠️ '+(r.mesa?'MESA '+r.mesa:'Sem mesa')+' reclamou'+
      (r.ha_min>0?' · há '+r.ha_min+'min':' · agora')+
      (r.texto?' — '+esc(r.texto):'')+
      '<button class="ir" onclick="atender('+r.id+','+(r.mesa||0)+')">Vou lá</button></div>';
  });
  (d.garcom||[]).forEach(function(r){
    // "pediu pelo celular" é aviso automático; "chamou" é gente com a mão
    // levantada. Mostrar os dois como "chamou" fazia o garçom correr à toa —
    // e ignorar o vermelho depois de algumas vezes.
    var auto=(r.origem==='pedido-cliente');
    h+='<div class="ch gar'+(auto?' ped':'')+'">'+(auto?'🍽 ':'🔔 ')+
      (r.mesa?'Mesa '+r.mesa:'Alguém')+(auto?' pediu pelo celular':' chamou')+
      (r.ha_min>0?' · há '+r.ha_min+'min':' · agora')+
      (auto&&r.texto?' — '+esc(String(r.texto).replace('pediu pelo celular: ','')):'')+
      '<button class="ir" onclick="atender('+r.id+','+(r.mesa||0)+')">'+(auto?'Ok':'Vou lá')+'</button></div>';
  });
  el.innerHTML=h;
}
async function atender(id,mesa){
  await jpost('/api/chamado/atender',{id:id});
  await puxarChamados();
  if(mesa){MESA=Number(mesa);ALVO=Number(mesa);carregarMesa()}
}
// ---- LOGIN DO GARÇOM ----
// A comanda mobile não abre direto: só quem tem AcessarComandaMobile no
// Consumer entra, com um PIN próprio (a senha do Consumer é cifrada e não deu
// pra usar). O token fica no localStorage e sobrevive ao recarregar.
var GNOME=null, chamTimer=null, LOGIN_TMP=null, EH_GERENTE=false;
async function iniciarVenda(){
  var s=null; if(GTOK){ try{s=await jget('/api/garcom/sessao')}catch(e){} }
  if(s&&s.ok){ EH_GERENTE=!!s.gerente; entrarNoApp(s.nome||s.login); } else { GTOK=null; telaLogin(); }
}
function entrarNoApp(nome){
  GNOME=nome;
  var w=document.getElementById('gwho');
  if(w)w.innerHTML=esc(nome||'')+(EH_GERENTE?' · <a href="#" onclick="telaGerentes();return false" style="color:var(--gold2)">gerentes</a>':'')+' · <a href="#" onclick="sairGarcom();return false" style="color:var(--gold2)">sair</a>';
  if(!chamTimer){ puxarChamados(); chamTimer=setInterval(puxarChamados,15000); }
  // vindo do CAIXA (?mesa=N&volta=caixa): já cai na mesa, com o caminho de volta
  var q=new URLSearchParams(location.search);
  if(q.get('volta')==='caixa'&&w)w.innerHTML='<a href="/caixa" style="color:var(--gold2);font-weight:700">◂ caixa</a> · '+w.innerHTML;
  var pm=Number(q.get('mesa')||0);
  if(pm>0)irPara(pm,pm); else telaMesa();
}
function sairGarcom(){
  try{localStorage.removeItem('garcom_tok')}catch(e){} GTOK=null;GNOME=null;
  if(chamTimer){clearInterval(chamTimer);chamTimer=null}
  var c=document.getElementById('chamados');if(c)c.innerHTML='';
  var w=document.getElementById('gwho');if(w)w.innerHTML='';
  telaLogin();
}
var GERLIST=[];
async function telaGerentes(){
  app('<button class="back" onclick="telaMesa()">◂ voltar</button>'+
    '<div class="tit" style="margin-top:12px">Gerentes</div>'+
    '<div class="mut" style="margin-bottom:12px">O gerente vê as <b>reclamações</b> das mesas aqui na comanda (a reclamação também vai pro KDS). Quem é Administrador ou tem Excluir-Pedido no Consumer já é gerente (travado).</div>'+
    '<div id="glist"><span class="mut">carregando…</span></div>');
  var d=await jget('/api/gerentes');
  var el=document.getElementById('glist');if(!el)return;
  if(!d.ok){el.innerHTML='<div class="err">'+esc(d.erro||'sem acesso')+'</div>';return}
  GERLIST=d.gerentes||[];
  if(!GERLIST.length){el.innerHTML='<span class="mut">ninguém com PIN ainda — cada um entra 1x pra aparecer aqui</span>';return}
  el.innerHTML=GERLIST.map(function(g,ix){
    return '<div class="ch gar" style="justify-content:space-between;align-items:center">'+
      '<span>'+(g.gerente?'✅ ':'▫️ ')+esc(g.nome)+' <small style="opacity:.6">'+esc(g.login)+(g.por_consumer?' · Consumer':'')+'</small></span>'+
      (g.por_consumer?'':'<button class="ir" onclick="setGerenteIx('+ix+','+(g.gerente?'false':'true')+')">'+(g.gerente?'tirar':'tornar')+'</button>')+
      '</div>';
  }).join('');
}
async function setGerenteIx(ix,val){
  var g=GERLIST[ix];if(!g)return;
  var r=await jpost('/api/gerente',{login:g.login,gerente:val});
  if(!r.ok){alert(r.erro||'erro');return}
  telaGerentes();
}
function telaLogin(){
  var c=document.getElementById('chamados');if(c)c.innerHTML='';
  app('<div class="tit" style="margin-top:8px">Entrar na comanda</div>'+
    '<input type="text" id="glogin" autocapitalize="none" autocorrect="off" autocomplete="username" placeholder="seu login do Consumer" value="'+(LOGIN_TMP?esc(LOGIN_TMP):'')+'">'+
    '<div class="tit" style="margin-top:14px">PIN</div>'+
    '<input type="password" id="gpin" inputmode="numeric" autocomplete="off" placeholder="4 a 8 números">'+
    '<div id="gpin2wrap"></div>'+
    '<div id="gmsg" class="mut" style="margin-top:9px;min-height:18px"></div>'+
    '<button class="big" onclick="fazerLogin()">Entrar</button>'+
    '<div class="mut" style="margin-top:12px">Só quem tem acesso à <b>Comanda Mobile</b> no Consumer. Na primeira vez, você cria seu PIN.</div>');
  var gl=document.getElementById('glogin');
  var gp=document.getElementById('gpin');
  if(gl&&!LOGIN_TMP)gl.focus(); else if(gp)gp.focus();
  if(gp)gp.addEventListener('keydown',function(e){if(e.key==='Enter')fazerLogin()});
  if(gl)gl.addEventListener('keydown',function(e){if(e.key==='Enter'){var x=document.getElementById('gpin');if(x)x.focus()}});
}
async function fazerLogin(){
  var login=((document.getElementById('glogin')||{}).value||'').trim().toLowerCase();
  var pin=((document.getElementById('gpin')||{}).value||'').replace(/\\D/g,'');
  var p2el=document.getElementById('gpin2');
  var pin2=p2el?((p2el.value||'').replace(/\\D/g,'')):null;
  var msg=document.getElementById('gmsg');
  function erro(t){if(msg){msg.style.color='#dc2626';msg.textContent=t}}
  if(!login){erro('Digite seu login.');return}
  if(pin.length<4){erro('O PIN tem de 4 a 8 números.');return}
  if(msg){msg.style.color='';msg.textContent='entrando…'}
  var body={login:login,pin:pin}; if(pin2!=null)body.pin2=pin2;
  var r=await jpost('/api/garcom/entrar',body);
  if(r.ok&&r.token){
    try{localStorage.setItem('garcom_tok',r.token)}catch(e){}
    GTOK=r.token;LOGIN_TMP=null;EH_GERENTE=!!r.gerente; entrarNoApp(r.nome||login); return;
  }
  if(r.ok&&r.primeira_vez){
    LOGIN_TMP=login;
    var w=document.getElementById('gpin2wrap');
    if(w&&!document.getElementById('gpin2'))
      w.innerHTML='<div class="tit" style="margin-top:14px">Repita o PIN</div>'+
        '<input type="password" id="gpin2" inputmode="numeric" autocomplete="off" placeholder="o mesmo PIN, pra confirmar">';
    if(msg){msg.style.color='#9a6b06';msg.textContent='Primeira vez, '+esc(r.nome||login)+' — escolha um PIN e repita pra confirmar.'}
    var p2=document.getElementById('gpin2');
    if(p2){p2.focus();p2.addEventListener('keydown',function(e){if(e.key==='Enter')fazerLogin()})}
    return;
  }
  erro(r.erro||'não consegui entrar');
}
iniciarVenda();

// ---- VERSAO NOVA NO SERVIDOR ----
// ⚠️ SEM ISTO A TELA FICA CONGELADA NO CODIGO VELHO. Estas paginas sao uma so:
// navegar nao recarrega nada, entao o aparelho segue rodando o JavaScript de
// quando abriu — mesmo com o servidor ja atualizado. Em 02/08 isso fez varias
// correcoes parecerem que "nao funcionaram": o servidor estava novo e o celular
// do garcom, velho.
// Recarrega sozinho quando a versao muda, mas so com a tela parada e sem
// pedido montado — ninguem perde o que estava digitando.
var VERSAO_MINHA='${VERSAO}';
setInterval(async function(){
  var v;try{v=await (await fetch('/api/versao',{cache:'no-store'})).json()}catch(e){return}
  if(!v||!v.versao||v.versao===VERSAO_MINHA)return;
  if(typeof CART!=='undefined'&&CART&&CART.length)return;
  if(document.visibilityState!=='visible')return;
  location.reload();
},60000);
</script></body></html>`;

// ---- HISTÓRICO DE CONSUMO do cliente ----
// O que essa pessoa já pediu aqui. Serve pro cliente ("pedir de novo") e pro
// garçom sugerir. Fonte: PEDIDOS.CODIGOCONTATOCLIENTE (887 pedidos vinculados).
async function apiClienteHistorico({ numero, contato }) {
  let contatoFb = contato ? Number(contato) : null;
  let nome = null;
  if (!contatoFb && numero) {
    const id = (await sql`SELECT contato_fb, nome_curto FROM identificacao WHERE numero=${Number(numero)} AND fechada_em IS NULL`)[0];
    contatoFb = id?.contato_fb ?? null;
    nome = id?.nome_curto ?? null;
  }
  // Sem contato no Consumer não há HISTÓRICO — mas a pessoa continua
  // identificada. Devolver identificado:false aqui apagava o "Olá, Fulano" de
  // quem se cadastrou com o Firebird fora do ar (fbCriarContato falha e o
  // contato_fb fica nulo, mas o nome foi gravado do mesmo jeito).
  if (!contatoFb) return { ok: true, identificado: !!nome, nome, itens: [], visitas: 0 };
  const r = await qi(`SELECT FIRST 12 TRIM(i.NOMEPRODUTO) NOME, i.CODIGOPRODUTODETALHE PDV,
      COUNT(*) VEZES, MAX(p.DATAABERTURA) ULT
    FROM ITENSPEDIDO i JOIN PEDIDOS p ON p.CODIGO = i.CODIGOPEDIDO
    WHERE p.CODIGOCONTATOCLIENTE = ${contatoFb} AND i.DATADELETE IS NULL
      AND p.DATADELETE IS NULL AND i.CODIGOITEMPEDIDOTIPO <> 2
    GROUP BY 1, 2 ORDER BY 3 DESC`);
  if (!r.ok) return { ok: false, erro: 'histórico indisponível: ' + r.err };
  const v = await qi(`SELECT COUNT(*) VISITAS, COALESCE(SUM(VALORTOTAL),0) GASTO, MAX(DATAABERTURA) ULT
    FROM PEDIDOS WHERE CODIGOCONTATOCLIENTE = ${contatoFb} AND DATADELETE IS NULL`);
  // só oferece o que dá pra vender AGORA (preço, não pausado, com estoque)
  const pdvs = r.rows.map((x) => N(x.PDV)).filter(Boolean);
  const vend = pdvs.length
    ? await sql`SELECT codigo_pdv, nome, tamanho, preco, area_codigo, sem_estoque FROM produto_local WHERE codigo_pdv = ANY(${pdvs})`
    : [];
  const porPdv = new Map(vend.map((x) => [Number(x.codigo_pdv), x]));
  const itens = r.rows.map((x) => {
    const p = porPdv.get(N(x.PDV));
    return { nome: T(x.NOME), codigo_pdv: N(x.PDV), vezes: Number(x.VEZES), ultima: x.ULT,
      disponivel: !!p && !p.sem_estoque, preco: p ? Number(p.preco) : null, tamanho: p?.tamanho ?? null };
  });
  const st = v.ok && v.rows.length ? v.rows[0] : {};
  return { ok: true, identificado: true, nome, contato_fb: contatoFb, itens,
    visitas: Number(st.VISITAS || 0), gasto: Number(st.GASTO || 0), ultima_visita: st.ULT || null };
}
/** Pedido feito pelo PRÓPRIO cliente, do celular dele, pelo QR da mesa. */
async function apiMesaPedir(body) {
  const numero = Number(body.mesa);
  if (!(numero >= 1 && numero <= NUMERO_MAX)) return { ok: false, erro: 'mesa inválida' };
  // trava no SERVIDOR: a tela pode estar velha, ter sido restaurada pelo
  // navegador ou ser de alguem que ja foi embora. Se a sessao nao bate, nao
  // lanca — senao daria pra pedir na conta de outra pessoa.
  if (body.sessao != null) {
    const ses = await apiMesaSessao(numero, body.sessao, body.desde);
    if (!ses.ok) return { ok: false, erro: ses.aviso || 'sessão expirada', reescanear: true };
  }
  const itens = Array.isArray(body.itens) ? body.itens.slice(0, 30) : [];
  if (!itens.length) return { ok: false, erro: 'sem itens' };
  // ⚠️ O CLIENTE SÓ PEDE O QUE É DO CARDÁPIO DIGITAL. Esconder na tela não
  // basta: sem esta checagem bastava forjar a chamada com o código do couvert.
  // O garçom não passa por aqui — ele lança qualquer coisa, de propósito.
  const pdvs = itens.map((i) => Number(i.codigo_pdv)).filter(Boolean);
  if (pdvs.length) {
    const ok = await sql`SELECT codigo_pdv FROM produto_local
      WHERE codigo_pdv = ANY(${pdvs}) AND cardapio_digital
        AND categoria NOT IN (SELECT categoria FROM grupo_oculto)`;
    const liberados = new Set(ok.map((x) => Number(x.codigo_pdv)));
    const barrado = pdvs.find((c) => !liberados.has(c));
    if (barrado != null) {
      const n = (await sql`SELECT nome FROM produto_local WHERE codigo_pdv=${barrado}`)[0];
      return { ok: false, erro: `"${n?.nome || barrado}" não está disponível para pedido pelo celular. Chame o garçom.` };
    }
  }
  // _cliente: foi a MESA que pediu, não um garçom (vira o autor do item)
  const r = await apiVendaEnviar({ numero, itens, junto: false, _cliente: true }); // obs vai dentro de cada item
  if (r.ok) {
    // o garçom fica sabendo que a mesa pediu sozinha
    await apiChamadoCriar({ mesa: numero, tipo: 'garcom', origem: 'pedido-cliente',
      texto: 'pediu pelo celular: ' + itens.length + ' item(ns)' }).catch(() => {});
  }
  return r;
}

// ---- QR CODES das mesas (pra imprimir e colar) ----
// O QR aponta pro IP DESTA máquina na rede da loja: o cliente no Wi-Fi abre
// /mesa?n=12 e tem conta, chamar garçom e Pix. Não depende de internet.
// ⚠️ O IP TEM QUE SER O DA REDE DA LOJA. Desde que o Tailscale foi instalado
// (19/08), a primeira interface da máquina passou a ser a dele — 100.71.x.x,
// da faixa CGNAT 100.64/10. QR gerado com esse endereço não abre no celular
// do cliente nem no do caixa: ninguém alcança o Tailscale de fora dele.
// Ordem: 192.168 → 10.x → 172.16-31 → qualquer outra que não seja CGNAT.
function ipLan() {
  const cand = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const n of lista || []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      const ip = n.address;
      const [a, b] = ip.split('.').map(Number);
      if (a === 169 && b === 254) continue;                    // link-local
      if (a === 100 && b >= 64 && b <= 127) continue;          // CGNAT (Tailscale)
      const peso = a === 192 && b === 168 ? 0 : a === 10 ? 1
        : a === 172 && b >= 16 && b <= 31 ? 2 : 3;
      cand.push({ ip, peso });
    }
  }
  cand.sort((x, y) => x.peso - y.peso);
  return cand.length ? cand[0].ip : null;
}
function ipDaLoja() {
  if (process.env.URL_PUBLICA) return process.env.URL_PUBLICA.replace(/\/+$/, '');
  const ip = ipLan();
  return ip ? `http://${ip}:${PORT}` : `http://localhost:${PORT}`;
}
function qrSvg(texto, px = 150) {
  return new QRCode({ content: texto, padding: 0, width: px, height: px, ecl: 'M', join: true }).svg();
}

// ---- QR como PNG DE VERDADE ----
// Por que existir, se ja temos SVG: o celular nao compartilha SVG. Segurar o
// dedo numa <img> de PNG abre "Compartilhar imagem" no Android e "Adicionar as
// Fotos" no iPhone — e' assim que o passe de saida vai pro WhatsApp de quem
// esta indo embora. (navigator.share nao serve: a tela do cliente e' HTTP e
// ele so existe em contexto seguro. E o wa.me nao anexa imagem: so leva texto.)
// Escrito a mao com zlib, sem dependencia nova. Cinza de 1 bit: o QR de mesa
// sai com ~400 bytes, contra 19 KB do SVG.
const CRC_TAB = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TAB[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(tipo, dados) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([len, corpo, crc]);
}
/** PNG do QR. `px` e' o tamanho ALVO — o real vira multiplo inteiro do modulo,
 *  senao o QR fica com quadradinhos de tamanhos diferentes e leitor ruim erra. */
function qrPng(texto, px = 560) {
  const q = new QRCode({ content: texto, padding: 0, width: px, height: px, ecl: 'M', join: true });
  const m = q.qrcode.modules;            // ⚠️ indexado [x][y] — x e' COLUNA, y e' LINHA
  const n = m.length;
  const quiet = 4;                        // zona clara exigida pela norma
  const total = n + quiet * 2;
  const escala = Math.max(1, Math.floor(px / total));
  const lado = total * escala;
  const bpl = Math.ceil(lado / 8);        // bytes por linha (1 bit por pixel)
  const raw = Buffer.alloc((bpl + 1) * lado);
  for (let y = 0; y < lado; y++) {
    const off = y * (bpl + 1);
    raw[off] = 0;                         // filtro "none"
    raw.fill(0xFF, off + 1, off + 1 + bpl); // fundo branco (bit 1 = claro)
    const my = Math.floor(y / escala) - quiet;
    if (my < 0 || my >= n) continue;
    for (let x = 0; x < lado; x++) {
      const mx = Math.floor(x / escala) - quiet;
      if (mx < 0 || mx >= n) continue;
      if (m[mx][my]) raw[off + 1 + (x >> 3)] &= ~(0x80 >> (x & 7)); // modulo preto
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0); ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 1;   // bit depth 1
  ihdr[9] = 0;   // grayscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
async function apiQrcodes(de, ate) {
  const base = ipDaLoja();
  const ini = Math.max(1, Number(de) || 1);
  const fim = Math.min(MESA_MAX, Number(ate) || 30);
  const mesas = [];
  for (let n = ini; n <= fim; n++) mesas.push({ numero: n, url: `${base}/mesa?n=${n}`, svg: qrSvg(`${base}/mesa?n=${n}`) });
  return { base, de: ini, ate: fim, mesas };
}
const COMPROVANTE_HTML = `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Comprovante · Prainha</title><style>
*{box-sizing:border-box}body{margin:0;font:16px/1.4 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;
background:#0f172a;color:#e2e8f0;padding:16px;min-height:100vh}
h1{font-size:19px;margin:6px 0 2px}.mut{color:#94a3b8;font-size:13px}
.card{background:#1e293b;border-radius:14px;padding:16px;margin-top:14px}
button{width:100%;border:0;border-radius:12px;padding:16px;font-size:17px;font-weight:600;margin-top:12px}
.go{background:#16a34a;color:#fff}.re{background:#334155;color:#e2e8f0}
img{width:100%;border-radius:12px;margin-top:12px}
.ok{color:#4ade80;font-weight:600}.err{color:#f87171;margin-top:10px}
input[type=file]{display:none}
</style></head><body>
<h1 id="h1">Foto do comprovante</h1>
<div class="mut" id="ctx">carregando…</div>
<div class="card">
  <label for="f"><span class="go" style="display:block;text-align:center;border-radius:12px;padding:16px;font-weight:600">📷 Tirar foto</span></label>
  <input id="f" type="file" accept="image/*" capture="environment">
  <img id="pv" style="display:none">
  <button class="go" id="ok" style="display:none" onclick="mandar()">Enviar pro caixa</button>
  <button class="re" id="re" style="display:none" onclick="refazer()">Tirar outra</button>
  <div class="err" id="e"></div>
</div>
<script>
var T=new URLSearchParams(location.search).get('t')||'';
var D=new URLSearchParams(location.search).get('d')==='1'; // devolução: foto do produto, não do comprovante
var FOTO=null;
if(D){document.title='Devolução · Prainha';document.getElementById('h1').textContent='Foto do produto devolvido'}
document.getElementById('ctx').textContent = T ? (D?'Mostre a garrafa/lata devolvida e toque em tirar foto.':'Aponte pro comprovante e toque em tirar foto.') : 'Link inválido.';
/* ⚠️ TIRAR OUTRA TEM QUE LIMPAR O INPUT ANTES.
   A câmera do Android devolve sempre o mesmo nome de arquivo ("image.jpg").
   Um <input type=file> NAO dispara o evento change quando o arquivo escolhido e
   igual ao que ja estava la - entao a foto nova era ignorada e a tela seguia
   mostrando a velha, como se o sistema tivesse repetido. Zerar o .value faz
   toda captura contar como nova. Some também com a prévia antiga, pra ninguém
   ficar olhando pra foto que já foi descartada. */
function refazer(){
  FOTO=null;
  var pv=document.getElementById('pv'); pv.removeAttribute('src'); pv.style.display='none';
  document.getElementById('ok').style.display='none';
  document.getElementById('re').style.display='none';
  document.getElementById('e').textContent='';
  var f=document.getElementById('f'); f.value=''; f.click();
}
document.getElementById('f').addEventListener('change', function(ev){
  var f=ev.target.files&&ev.target.files[0];
  // sem arquivo = o usuário cancelou a câmera: zera pra próxima tentativa valer
  if(!f){ev.target.value='';return}
  var r=new FileReader();
  r.onload=function(){
    // reduz antes de subir: foto de celular tem 4 MB e a rede da loja é a que é
    var img=new Image();
    img.onload=function(){
      var max=1280, k=Math.min(1, max/Math.max(img.width,img.height));
      var c=document.createElement('canvas'); c.width=img.width*k; c.height=img.height*k;
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      FOTO=c.toDataURL('image/jpeg',0.8);
      var pv=document.getElementById('pv'); pv.src=FOTO; pv.style.display='block';
      document.getElementById('ok').style.display='block';
      document.getElementById('ok').textContent='Enviar pro caixa';
      document.getElementById('re').style.display='block';
    };
    img.src=r.result;
  };
  r.readAsDataURL(f);
  // libera o input pra próxima foto (o Android reusa o nome do arquivo)
  ev.target.value='';
});
async function mandar(){
  if(!FOTO)return;
  var e=document.getElementById('e'), ok=document.getElementById('ok');
  e.textContent='';
  // Tenta 4x com pausa: o celular costuma DERRUBAR o Wi-Fi sem internet e pular
  // pro 4G bem na hora do envio — na retentativa ele já voltou pro Wi-Fi.
  for(var i=1;i<=4;i++){
    ok.textContent='enviando… ('+i+'/4)';
    try{
      var r=await fetch('/api/comprovante/enviar',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({t:T,foto:FOTO})});
      var j=await r.json();
      if(!j.ok){e.textContent=j.erro||'não deu';ok.textContent='Enviar pro caixa';return}
      document.body.innerHTML='<h1 class="ok">✓ Enviado</h1><div class="mut">'+(D?'Pode voltar pro caixa e confirmar o cancelamento.':'Pode voltar pro caixa e confirmar o recebimento.')+'</div>';
      return;
    }catch(err){ await new Promise(function(rs){setTimeout(rs,1500)}); }
  }
  ok.textContent='Enviar de novo';
  e.innerHTML='<div style="background:#7f1d1d;color:#fecaca;border-radius:10px;padding:12px;font-size:15px;margin-top:10px">'+
    '⚠ <b>A foto NÃO chegou na loja.</b><br>O celular precisa estar no <b>Wi-Fi da casa</b> — '+
    'desligue os dados móveis (4G/5G), confira o Wi-Fi e toque em <b>Enviar de novo</b>.</div>';
}
</script></body></html>`;

const QRCODES_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QR das mesas — ${LOJA_NOME}</title><style>
:root{--ink:#16161a;--mut:#6e6e78;--line:#dcdce3;--gold2:#e0651a}
*{box-sizing:border-box}body{margin:0;background:#ececed;color:var(--ink);font-family:'Outfit',-apple-system,system-ui,sans-serif}
.barra{background:#fff;border-bottom:1px solid var(--line);padding:12px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.barra b{font-size:15px;margin-right:auto}
input{width:74px;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:9px;text-align:center}
button{background:var(--gold2);color:#fff;border:0;border-radius:9px;padding:9px 15px;font:inherit;font-size:14px;font-weight:700;cursor:pointer}
button.g{background:#5b5b66}
.grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;padding:18px}
.cd{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 10px;text-align:center;page-break-inside:avoid;break-inside:avoid}
.cd .casa{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut)}
.cd .n{font-size:30px;font-weight:800;line-height:1.05;margin:2px 0 8px}
.cd svg{width:100%;height:auto;max-width:160px}
.cd .cha{font-size:11.5px;color:var(--mut);margin-top:8px;line-height:1.35}
.aviso{padding:0 18px;color:var(--mut);font-size:13px}
@media print{body{background:#fff}.barra,.aviso{display:none}.grade{grid-template-columns:repeat(3,1fr);padding:0;gap:8px}.cd{border-color:#bbb}}
</style></head><body>
<div class="barra"><b>QR das mesas</b>
  <span class="aviso" style="padding:0">mesa</span>
  <input id="de" type="number" value="1" min="1"> <span>até</span> <input id="ate" type="number" value="30" min="1">
  <button onclick="carregar()">Gerar</button>
  <button class="g" onclick="window.print()">🖨 Imprimir</button>
  <a href="/" style="text-decoration:none"><button class="g">KDS</button></a></div>
<div class="aviso" id="info"></div>
<div class="grade" id="app">gerando…</div>
<script>
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
async function carregar(){
  var de=document.getElementById('de').value,ate=document.getElementById('ate').value;
  var d=await (await fetch('/api/qrcodes?de='+de+'&ate='+ate,{cache:'no-store'})).json();
  document.getElementById('info').innerHTML='Aponta para <b>'+esc(d.base)+'</b> — o celular precisa estar no Wi-Fi da casa. '+
    'Se o IP da máquina mudar, os QR param de funcionar: fixe o IP ou use a variável URL_PUBLICA.';
  document.getElementById('app').innerHTML=d.mesas.map(function(m){
    return '<div class="cd"><div class="casa">${LOJA_NOME}</div><div class="n">'+m.numero+'</div>'+
      m.svg+'<div class="cha">Aponte a câmera<br>conta · chamar garçom · Pix</div></div>';
  }).join('');
}
carregar();
</script></body></html>`;

// ---- PIX do cliente (tela da mesa) ----
// Adapter igual ao do pagamento: sem credencial, a tela diz honestamente que
// não está ligado e oferece chamar o garçom — nunca finge que gerou cobrança.
// 'inter' = API de cobrança imediata do Banco Inter (mTLS), o mesmo banco que
// já usamos pro extrato. Cielo Pix segue bloqueado na conta da casa.
const PIX_PROVEDOR = process.env.PIX_PROVEDOR || 'off';
const INTER_HOST = process.env.INTER_HOST || 'cdpj.partners.bancointer.com.br';
function interCred() {
  const c = { id: process.env.INTER_CLIENT_ID, secret: process.env.INTER_CLIENT_SECRET,
    cert: process.env.INTER_CERT_B64, key: process.env.INTER_KEY_B64, chave: process.env.INTER_PIX_CHAVE };
  return (c.id && c.secret && c.cert && c.key && c.chave) ? c : null;
}
// Cielo API 3.0 — validado em 30/07: a conta JÁ aceita Pix (HTTP 201 com QR).
// Vale mais que o Inter aqui, porque não depende de liberar escopo nenhum.
const CIELO_BASE = process.env.CIELO_SANDBOX === 'true'
  ? 'https://apisandbox.cieloecommerce.cielo.com.br' : 'https://api.cieloecommerce.cielo.com.br';
const CIELO_QUERY = process.env.CIELO_SANDBOX === 'true'
  ? 'https://apiquerysandbox.cieloecommerce.cielo.com.br' : 'https://apiquery.cieloecommerce.cielo.com.br';
function cieloCred() {
  const id = process.env.CIELO_MERCHANT_ID, key = process.env.CIELO_MERCHANT_KEY;
  return (id && key) ? { id, key } : null;
}
function pixStatus() {
  // Diagnostico junto: "disponivel" so diz que a env EXISTE. Se ela vier com
  // aspas sobrando do .bat ou truncada, a Cielo responde "MerchantId is
  // required" e sem isto aqui nao da pra saber o porque a distancia.
  const c = cieloCred();
  const fmt = (v) => (v ? { tamanho: v.length, comeca: v.slice(0, 4), aspas: /["']/.test(v) } : null);
  const diag = PIX_PROVEDOR === 'cielo'
    ? { merchant_id: fmt(c?.id), merchant_key: fmt(c?.key) }
    : { chave: interCred()?.chave ? 'ok' : 'ausente' };
  if (PIX_PROVEDOR === 'cielo') return { disponivel: !!c, provedor: 'cielo', diag };
  return { disponivel: PIX_PROVEDOR === 'inter' && !!interCred(), provedor: PIX_PROVEDOR, diag };
}
async function cieloPixCriar(mesa, valor) {
  const c = cieloCred();
  const r = await fetch(CIELO_BASE + '/1/sales/', { method: 'POST',
    headers: { 'content-type': 'application/json', MerchantId: c.id, MerchantKey: c.key },
    body: JSON.stringify({
      MerchantOrderId: 'MESA' + mesa + '-' + Date.now(),
      Customer: { Name: 'Mesa ' + mesa },
      // Amount em CENTAVOS
      Payment: { Type: 'Pix', Amount: Math.round(valor * 100) },
    }) });
  const j = await r.json().catch(() => null);
  if (r.status !== 201 && r.status !== 200) {
    return { ok: false, erro: 'Cielo recusou: ' + (j?.[0]?.Message || j?.Message || 'HTTP ' + r.status) };
  }
  const p = j?.Payment || {};
  if (!p.QrCodeString) return { ok: false, erro: 'Cielo não devolveu o código Pix' };
  return { ok: true, txid: p.PaymentId, copia: p.QrCodeString };
}
async function cieloPixStatus(paymentId) {
  const c = cieloCred();
  const r = await fetch(CIELO_QUERY + '/1/sales/' + encodeURIComponent(paymentId),
    { headers: { MerchantId: c.id, MerchantKey: c.key } });
  const j = await r.json().catch(() => null);
  if (r.status !== 200) return { ok: false, erro: 'consulta falhou: HTTP ' + r.status };
  const st = Number(j?.Payment?.Status);
  // 12 = pendente · 2 = pago (Payment Confirmed)
  return { ok: true, pago: st === 2, status: st, e2e: j?.Payment?.ProofOfSale || null };
}
/** mTLS: o fetch do Node não expõe client cert, então vai de https.request. */
function interAgent(c) {
  return new https.Agent({ cert: Buffer.from(c.cert, 'base64'), key: Buffer.from(c.key, 'base64'), keepAlive: false });
}
function interReq(c, { method, path, body, token }) {
  const dados = body ? JSON.stringify(body) : null;
  return new Promise((ok) => {
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    if (dados) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(dados); }
    const r = https.request({ hostname: INTER_HOST, path, method, agent: interAgent(c), headers, timeout: 12000 }, (res) => {
      let d = ''; res.on('data', (x) => (d += x));
      res.on('end', () => { try { ok({ status: res.statusCode, data: d ? JSON.parse(d) : null }); }
        catch { ok({ status: res.statusCode, data: null, raw: d.slice(0, 300) }); } });
    });
    r.on('timeout', () => { r.destroy(); ok({ status: 0, data: null, raw: 'timeout' }); });
    r.on('error', (e) => ok({ status: 0, data: null, raw: e.message }));
    if (dados) r.write(dados);
    r.end();
  });
}
let tokenPix = { valor: null, expira: 0 };
async function interToken(c) {
  if (tokenPix.valor && tokenPix.expira > Date.now()) return tokenPix.valor;
  const body = new URLSearchParams({ client_id: c.id, client_secret: c.secret,
    grant_type: 'client_credentials', scope: 'cob.write cob.read' }).toString();
  const r = await new Promise((ok) => {
    const req = https.request({ hostname: INTER_HOST, path: '/oauth/v2/token', method: 'POST', agent: interAgent(c),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) }, timeout: 12000 },
      (res) => { let d = ''; res.on('data', (x) => (d += x)); res.on('end', () => { try { ok({ status: res.statusCode, data: JSON.parse(d) }); } catch { ok({ status: res.statusCode, data: null, raw: d.slice(0, 200) }); } }); });
    req.on('timeout', () => { req.destroy(); ok({ status: 0, raw: 'timeout' }); });
    req.on('error', (e) => ok({ status: 0, raw: e.message }));
    req.write(body); req.end();
  });
  if (r.status !== 200 || !r.data?.access_token) {
    // 401 "No registered scope" = a aplicação do Inter não tem cobrança Pix liberada
    throw new Error('Inter recusou o token de cobrança: ' + (r.data?.error_description || r.raw || 'HTTP ' + r.status));
  }
  tokenPix = { valor: r.data.access_token, expira: Date.now() + (Number(r.data.expires_in || 300) - 30) * 1000 };
  return tokenPix.valor;
}
/** Cobrança imediata (cob) — o cliente paga e a gente confere por polling. */
/** Quanto cobrar: o cliente pode pagar SÓ A PARTE DELE e escolher a gorjeta.
 *  O teto é sempre o que falta pagar — ninguém paga a mais por engano, e
 *  valor vindo do browser nunca vira cobrança sem passar por aqui. */
function valorDaCobranca(conta, body) {
  const itens = Number(conta.total || 0);
  // Gorjeta: null = o padrão da casa. O cliente pode dar MAIS, nunca menos —
  // retirar o serviço é conversa com o garçom, não botão na tela. Sem este
  // piso aqui, bastava forjar a chamada e pagar sem serviço.
  const padrao = Number(conta.taxa_servico || 0);
  const pct = body.gorjeta_pct == null
    ? padrao
    : Math.max(padrao, Math.min(30, Number(body.gorjeta_pct) || 0));
  const comGorjeta = +(itens * (1 + pct / 100)).toFixed(2);
  const restaTotal = Math.max(0, +(comGorjeta - Number(conta.pago || 0)).toFixed(2));
  if (restaTotal <= 0) return { erro: 'essa conta já está paga' };
  // divisão: paga 1/N do que falta
  const partes = Math.max(1, Math.min(20, Number(body.dividir_por) || 1));
  let valor = +(restaTotal / partes).toFixed(2);
  // valor explícito (o cliente digitou quanto quer pagar)
  if (body.valor != null) {
    const v = Number(body.valor);
    if (!(v > 0)) return { erro: 'valor inválido' };
    valor = Math.min(+v.toFixed(2), restaTotal); // nunca acima do que falta
  }
  if (!(valor > 0)) return { erro: 'não há saldo a pagar nessa mesa' };
  return { valor, pct, comGorjeta, restaTotal, partes };
}
async function apiPixCobrar(body) {
  if (!pixStatus().disponivel) return { ok: false, erro: 'Pix na tela ainda não está habilitado nesta casa.' };
  const conta = await apiContaTexto(body.mesa);
  if (!conta.ok) return conta;
  const cob = valorDaCobranca(conta, body);
  if (cob.erro) return { ok: false, erro: cob.erro };
  const valor = cob.valor;
  if (PIX_PROVEDOR === 'cielo') {
    const r = await cieloPixCriar(Number(body.mesa), valor);
    if (!r.ok) return r;
    await sql`INSERT INTO pix_cobranca (txid, mesa, valor, copia_cola, provedor) VALUES (${r.txid}, ${Number(body.mesa)}, ${valor}, ${r.copia}, 'cielo')
      ON CONFLICT (txid) DO NOTHING`;
    return { ok: true, txid: r.txid, valor, copia_cola: r.copia,
      imagem: 'data:image/svg+xml;base64,' + Buffer.from(qrSvg(r.copia, 260)).toString('base64') };
  }
  const c = interCred();
  let token;
  try { token = await interToken(c); } catch (e) { return { ok: false, erro: e.message }; }
  const txid = ('PRAINHA' + Number(body.mesa) + Date.now().toString(36) + Math.floor(Math.random() * 1e6)).replace(/[^A-Za-z0-9]/g, '').slice(0, 35);
  const r = await interReq(c, { method: 'PUT', path: '/pix/v2/cob/' + txid, token, body: {
    calendario: { expiracao: 1800 },
    valor: { original: valor.toFixed(2) },
    chave: c.chave,
    solicitacaoPagador: 'Mesa ' + Number(body.mesa) + ' - ' + LOJA_NOME,
  } });
  if (r.status !== 201 && r.status !== 200) {
    return { ok: false, erro: 'Inter recusou a cobrança: ' + (r.data?.detail || r.data?.title || r.raw || 'HTTP ' + r.status) };
  }
  const copia = r.data?.pixCopiaECola || r.data?.location || null;
  if (!copia) return { ok: false, erro: 'Inter não devolveu o código Pix' };
  await sql`INSERT INTO pix_cobranca (txid, mesa, valor, copia_cola) VALUES (${txid}, ${Number(body.mesa)}, ${valor}, ${copia})
    ON CONFLICT (txid) DO NOTHING`;
  return { ok: true, txid, valor, copia_cola: copia,
    imagem: 'data:image/svg+xml;base64,' + Buffer.from(qrSvg(copia, 260)).toString('base64') };
}
// ---- QR DE SAÍDA (catraca) ----
// Depois de pagar, o cliente diz quantas pessoas saem com ele e recebe um QR.
// A catraca lê o mesmo QR a cada passagem e libera UMA por vez, até zerar.
// Crianças de até 10 anos não entram na conta — passam com o responsável.
const SAIDA_VALIDADE_MIN = Number(process.env.SAIDA_VALIDADE_MIN || 90);
/** Placa em formato unico: so letra e numero, maiuscula. A cancela le
 *  "ABC-1234", "abc1d23" e o cliente digita de qualquer jeito. */
function normPlaca(x) { return String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7); }
function placaValida(x) { return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(normPlaca(x)); }

/** A conta da mesa esta ZERADA?
 *  Mede pelo CONSUMO, sem a taxa de servico: a taxa e opcional por lei, e
 *  prender alguem na catraca por causa de gorjeta e' pior pra casa do que
 *  liberar. Quem paga pelo app sempre paga 10% ou 15%, entao na pratica so
 *  cai aqui quem quitou o consumo no caixa. */
async function contaZerada(mesa) {
  const c = await apiContaTexto(mesa);
  if (!c.ok) return { zerada: false, erro: c.erro, falta: null };
  const consumo = +(Number(c.total || 0)
    + (c.comandas || []).reduce((s, x) => s + Number(x.subtotal || 0), 0)).toFixed(2);
  const pago = Number(c.pago_geral || 0);
  const falta = Math.max(0, +(consumo - pago).toFixed(2));
  return { zerada: falta <= 0.009, falta, consumo, pago, falta_com_servico: Number(c.falta_geral || 0) };
}

async function apiSaidaGerar(body) {
  const mesa = Number(body.mesa);
  const adultos = Math.max(0, Math.min(50, Number(body.adultos) || 0));
  const criancas = Math.max(0, Math.min(50, Number(body.criancas) || 0));
  const pessoas = adultos + criancas;
  if (!(pessoas >= 1)) return { ok: false, erro: 'informe pelo menos 1 pessoa' };
  if (!(mesa >= 1 && mesa <= NUMERO_MAX)) return { ok: false, erro: 'mesa inválida' };

  // ⚠️ O PORTAO. So sai quem nao deve nada. Antes de 01/08 bastava confirmar
  // UM pagamento — quem pagasse R$ 37 de uma conta de R$ 186 ganhava passe e
  // saia pela catraca. A tela tambem trava, mas a trava que vale e' esta:
  // a tela e' do cliente, o servidor e' da casa.
  const z = await contaZerada(mesa);
  if (!z.zerada) {
    return { ok: false, falta: z.falta,
      erro: z.erro || ('ainda faltam R$ ' + Number(z.falta || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
        + ' nesta conta. O passe de saída sai quando a conta zerar.') };
  }

  const placas = [...new Set((Array.isArray(body.placas) ? body.placas : [])
    .map(normPlaca).filter(placaValida))];
  const token = 'S' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1e8).toString(36).toUpperCase();
  await sql`INSERT INTO saida_qr (token, mesa, pessoas, adultos, criancas, carros, origem, expira_em)
    VALUES (${token}, ${mesa}, ${pessoas}, ${adultos}, ${criancas}, ${placas.length},
            ${String(body.origem || '').slice(0, 20) || null},
            now() + (${SAIDA_VALIDADE_MIN} || ' minutes')::interval)`;
  for (const pl of placas) {
    await sql`INSERT INTO saida_veiculo (token, placa, mesa) VALUES (${token}, ${pl}, ${mesa})
      ON CONFLICT (token, placa) DO NOTHING`;
  }
  return { ok: true, token, pessoas, adultos, criancas, placas, validade_min: SAIDA_VALIDADE_MIN,
    imagem: 'data:image/svg+xml;base64,' + Buffer.from(qrSvg(token, 250)).toString('base64') };
}

/** A CANCELA do patio chama isto quando o LPR le uma placa.
 *  Mesma trava do UPDATE condicional da catraca: duas leituras do mesmo carro
 *  nao liberam duas vezes. */
async function apiSaidaCancela(placa) {
  const pl = normPlaca(placa);
  if (!pl) return { ok: false, libera: false, motivo: 'sem placa' };
  const r = await sql`UPDATE saida_veiculo v SET liberada_em = now()
    FROM saida_qr q
    WHERE v.token = q.token AND v.placa = ${pl} AND v.liberada_em IS NULL AND q.expira_em > now()
    RETURNING v.placa, v.mesa, v.token`;
  if (r.length) return { ok: true, libera: true, placa: pl, mesa: r[0].mesa };
  // Por que nao liberou? A guarita precisa saber se e' "conta aberta" ou
  // "ja saiu" — sao conversas diferentes com o cliente.
  const j = (await sql`SELECT v.liberada_em, v.mesa, q.expira_em FROM saida_veiculo v
    JOIN saida_qr q ON q.token = v.token WHERE v.placa = ${pl}
    ORDER BY v.criado_em DESC LIMIT 1`)[0];
  if (!j) return { ok: true, libera: false, placa: pl, motivo: 'sem passe de saída — a conta pode estar aberta' };
  if (j.liberada_em) return { ok: true, libera: false, placa: pl, mesa: j.mesa, motivo: 'este carro já saiu' };
  return { ok: true, libera: false, placa: pl, mesa: j.mesa, motivo: 'passe vencido' };
}
/** A CATRACA chama isto a cada leitura. Cada chamada consome UMA passagem. */
async function apiSaidaPassar(token) {
  const t = String(token || '').trim().toUpperCase();
  if (!t) return { ok: false, libera: false, motivo: 'sem código' };
  // UPDATE condicional: duas leituras ao mesmo tempo não podem liberar a mais
  const r = await sql`UPDATE saida_qr SET usados = usados + 1, ultima_em = now()
     WHERE token = ${t} AND usados < pessoas AND expira_em > now()
     RETURNING pessoas, usados, mesa`;
  if (r.length) {
    const { pessoas, usados, mesa } = r[0];
    return { ok: true, libera: true, mesa, pessoa: Number(usados), de: Number(pessoas),
      restantes: Number(pessoas) - Number(usados), ultima: Number(usados) === Number(pessoas) };
  }
  const q = (await sql`SELECT pessoas, usados, expira_em FROM saida_qr WHERE token=${t}`)[0];
  if (!q) return { ok: true, libera: false, motivo: 'código não encontrado' };
  if (new Date(q.expira_em) <= new Date()) return { ok: true, libera: false, motivo: 'código expirado' };
  return { ok: true, libera: false, motivo: 'todas as passagens já foram usadas', de: Number(q.pessoas) };
}
/** Códigos que ainda têm gente pra passar — o operador da catraca vê a fila. */
async function apiSaidaAtivos() {
  const r = await sql`SELECT token, mesa, pessoas, usados, origem, criado_em, expira_em FROM saida_qr
    WHERE usados < pessoas AND expira_em > now() ORDER BY criado_em DESC LIMIT 30`;
  return { ativos: r.map((x) => ({ ...x, restantes: Number(x.pessoas) - Number(x.usados) })) };
}
async function apiSaidaConsultar(token) {
  const q = (await sql`SELECT * FROM saida_qr WHERE token=${String(token || '').toUpperCase()}`)[0];
  if (!q) return { ok: false, erro: 'não encontrado' };
  // ⚠️ VENCIMENTO. Sem esta linha um passe vencido respondia ok:true e a tela
  // do convidado mostrava o QR como se valesse — a pessoa so descobria na
  // catraca, com a fila atras. apiSaidaPassar ja recusava; quem mentia era a
  // consulta.
  if (q.expira_em && new Date(q.expira_em).getTime() < Date.now()) {
    return { ok: false, erro: 'passe vencido', vencido: true, mesa: q.mesa };
  }
  const veic = await sql`SELECT placa, liberada_em FROM saida_veiculo WHERE token=${q.token} ORDER BY id`;
  return { ok: true, mesa: q.mesa, pessoas: Number(q.pessoas), usados: Number(q.usados),
    restantes: Number(q.pessoas) - Number(q.usados), expira_em: q.expira_em,
    veiculos: veic.map((v) => ({ placa: v.placa, saiu: !!v.liberada_em })) };
}

// ---- /passe?t=CODIGO — o passe de saida compartilhado ----
// Quem pagou a conta manda este link no zap pra quem vai embora antes. A pessoa
// abre, mostra o QR na catraca e passa. E' o MESMO codigo da mesa: cada leitura
// consome uma passagem, entao mandar pra tres pessoas nao cria tres passes.
const PASSE_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Passe de saida — ${LOJA_NOME}</title><style>
*{box-sizing:border-box}body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:#f6f6f8;color:#1b1b1f;padding:22px 16px;text-align:center}
.casa{color:#8a8a94;font-size:13px;letter-spacing:.12em;text-transform:uppercase}
h1{font-size:25px;margin:8px 0 4px}
.qr{width:min(74vw,300px);height:auto;background:#fff;border-radius:16px;padding:14px;margin:16px auto;display:block;
  box-shadow:0 2px 14px rgba(0,0,0,.09)}
.codigo{font-family:ui-monospace,Menlo,monospace;font-size:19px;letter-spacing:.06em;color:#5a5a66}
.cx{background:#fff;border-radius:14px;padding:15px;margin:16px auto;max-width:420px;box-shadow:0 1px 8px rgba(0,0,0,.06)}
.n{font-size:31px;font-weight:800;color:#c86a20}
.mut{color:#6b6b76;font-size:14px}
.mau{background:#fdecea;color:#a3271b;border-radius:14px;padding:18px;max-width:420px;margin:16px auto;font-weight:600}
</style></head><body>
<div class="casa">${LOJA_NOME}</div>
<h1>Passe de saida</h1>
<div id="app" class="mut">carregando…</div>
<script>
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
var T=new URLSearchParams(location.search).get('t')||'';
async function pinta(){
  var d;try{d=await (await fetch('/api/saida/consultar?t='+encodeURIComponent(T),{cache:'no-store'})).json()}
  catch(e){return}
  var el=document.getElementById('app');
  if(!d.ok){el.innerHTML='<div class="mau">Este passe nao vale mais.<br><span style="font-weight:400">'+
    'Peca um novo a quem pagou a conta.</span></div>';clearInterval(TMR);return}
  if(d.restantes<=0){el.innerHTML='<div class="mau">Todas as passagens deste codigo ja foram usadas.</div>';
    clearInterval(TMR);return}
  el.innerHTML='<img class="qr" src="/api/saida/qr?t='+encodeURIComponent(T)+'" alt="QR de saida">'+
    '<div class="codigo">'+esc(T)+'</div>'+
    '<div class="cx"><div class="n">'+d.restantes+'</div>'+
    '<div class="mut">'+(d.restantes===1?'passagem restante':'passagens restantes')+
    ' &middot; mesa '+esc(d.mesa)+'</div></div>'+
    ((d.veiculos&&d.veiculos.length)
      ? '<div class="cx"><div class="mut">Carros</div>'+d.veiculos.map(function(v){
          return '<div style="font-weight:700;font-size:18px;letter-spacing:.06em;margin-top:3px'+
            (v.saiu?';color:#9a9aa4;text-decoration:line-through':'')+'">'+esc(v.placa)+
            (v.saiu?' <span style="font-size:12px;letter-spacing:0">ja saiu</span>':'')+'</div>';
        }).join('')+'</div>'
      : '')+
    '<div class="mut">Encoste o celular no leitor da catraca. Uma pessoa por vez.</div>';
}
var TMR=setInterval(pinta,4000);pinta();
</script></body></html>`;

// ---- CARTÃO: o cliente paga no concilia (HTTPS), não aqui ----
// Este servidor roda em HTTP na rede da loja. Número de cartão digitado aqui
// seria lido por qualquer um no Wi-Fi. Então a gente só monta um link ASSINADO
// e manda o cliente pro app (Vercel), que já tem cartão com 3DS. Nenhum dado
// de cartão passa por esta máquina.
// CARTAO DESLIGADO POR PADRAO — e' decisao, nao esquecimento.
// A ponte pro app esta pronta e configurada, mas a Cielo recusa: o 3DS devolve
// 401 (produto nao ativado no EC) e a autorizacao direta devolve 002
// "Transacao nao permitida". Chamado aberto com eles. Enquanto isso a tela
// mostra o cartao apagado, em vez de deixar o cliente tentar e levar erro na
// cara com a conta na mao.
// Quando a Cielo liberar: CARTAO_ATIVO=true no start.bat e reiniciar.
const CARTAO_ATIVO = process.env.CARTAO_ATIVO === 'true';
/** Tem como cobrar no cartao AGORA (config + liberado). */
function cartaoDisponivel() { return CARTAO_ATIVO && cartaoConfigurado(); }
/** A ponte esta configurada — usado pra dizer "em breve" em vez de sumir. */
function cartaoConfigurado() { return !!(PAGAR_MESA_SECRET && FILIAL_ID); }
function assinarMesa({ filialId, mesa, valorCentavos, ref, expira }) {
  return createHmac('sha256', PAGAR_MESA_SECRET)
    .update([filialId, mesa, valorCentavos, ref, expira].join('|')).digest('hex');
}
function linkCartao({ mesa, valorCentavos, ref, expira }) {
  const p = { filialId: FILIAL_ID, mesa, valorCentavos, ref, expira };
  const q = new URLSearchParams({ f: FILIAL_ID, m: String(mesa), v: String(valorCentavos),
    r: ref, e: String(expira), s: assinarMesa(p) });
  return `${PAGAR_MESA_URL}/pagar-mesa?${q}`;
}
async function apiCartaoCobrar(body) {
  if (!cartaoDisponivel()) return { ok: false, erro: 'Pagamento com cartão na tela ainda não está configurado (falta PAGAR_MESA_SECRET/FILIAL_ID).' };
  const conta = await apiContaTexto(body.mesa);
  if (!conta.ok) return conta;
  const c = valorDaCobranca(conta, body);
  if (c.erro) return { ok: false, erro: c.erro };
  const valor = c.valor;
  const centavos = Math.round(valor * 100);
  const ref = 'M' + Number(body.mesa) + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  const expira = Math.floor(Date.now() / 1000) + 20 * 60; // 20min
  const url = linkCartao({ mesa: Number(body.mesa), valorCentavos: centavos, ref, expira });
  await sql`INSERT INTO cartao_cobranca (ref, mesa, valor, expira_em) VALUES (${ref}, ${Number(body.mesa)}, ${valor}, to_timestamp(${expira}))
    ON CONFLICT (ref) DO NOTHING`;
  return { ok: true, ref, valor, url,
    imagem: 'data:image/svg+xml;base64,' + Buffer.from(qrSvg(url, 240)).toString('base64') };
}
async function apiCartaoConferir(ref) {
  if (!cartaoDisponivel()) return { ok: false, erro: 'cartão não configurado' };
  const c = (await sql`SELECT * FROM cartao_cobranca WHERE ref=${String(ref)}`)[0];
  if (!c) return { ok: false, erro: 'cobrança não encontrada' };
  if (c.pago_em) return { ok: true, pago: true, ja_registrado: true };
  const expira = Math.floor(new Date(c.expira_em).getTime() / 1000);
  const centavos = Math.round(Number(c.valor) * 100);
  const q = new URLSearchParams({ f: FILIAL_ID, m: String(c.mesa), v: String(centavos), r: c.ref, e: String(expira),
    s: assinarMesa({ filialId: FILIAL_ID, mesa: Number(c.mesa), valorCentavos: centavos, ref: c.ref, expira }) });
  let r;
  try {
    const resp = await fetch(`${PAGAR_MESA_URL}/api/pagar-mesa/status?${q}`, { signal: AbortSignal.timeout(8000) });
    r = await resp.json();
  } catch (e) { return { ok: false, erro: 'sem internet pra conferir: ' + e.message }; }
  if (!r?.ok) return { ok: false, erro: r?.error || 'consulta falhou' };
  if (!r.pago) return { ok: true, pago: false, status: r.status, erro_cielo: r.erro || null };
  await sql`UPDATE cartao_cobranca SET pago_em=now(), autorizacao=${r.autorizacao || null} WHERE ref=${String(ref)}`;
  try {
    const ped = await fbAcharPedido(Number(c.mesa));
    if (ped) await fbInserirPagamento(ped, {
      forma_codigo: r.tipo === 'DebitCard' ? FORMA.DEBITO : FORMA.CREDITO,
      valor: Number(c.valor), autorizacao: r.autorizacao, bandeira: r.bandeira,
      observacao: 'Cartão do cliente (Cielo) ' + ref });
  } catch (err) { console.error('[cartao] registrar no Consumer falhou:', err.message); }
  return { ok: true, pago: true };
}

/** Confere se caiu. Quando cair, registra em PAGAMENTOS (forma 21 = Pix online),
 *  do mesmo jeito que a Fase 2 já faz — o Consumer segue emitindo a NFC-e. */
async function apiPixConferir(txid) {
  const cob = (await sql`SELECT * FROM pix_cobranca WHERE txid=${String(txid)}`)[0];
  if (!cob) return { ok: false, erro: 'cobrança não encontrada' };
  if (cob.pago_em) return { ok: true, pago: true, ja_registrado: true };
  let pago, e2e;
  if (cob.provedor === 'cielo') {
    const s = await cieloPixStatus(String(txid));
    if (!s.ok) return s;
    if (!s.pago) return { ok: true, pago: false, status: s.status };
    pago = true; e2e = s.e2e;
  } else {
    const c = interCred();
    if (!c) return { ok: false, erro: 'Pix não habilitado' };
    let token;
    try { token = await interToken(c); } catch (e) { return { ok: false, erro: e.message }; }
    const r = await interReq(c, { method: 'GET', path: '/pix/v2/cob/' + String(txid), token });
    if (r.status !== 200) return { ok: false, erro: 'consulta falhou: HTTP ' + r.status };
    if (r.data?.status !== 'CONCLUIDA') return { ok: true, pago: false, status: r.data?.status || '?' };
    pago = true; e2e = r.data?.pix?.[0]?.endToEndId || null;
  }
  // ⚠️ DINHEIRO. Quem dá a baixa é ESTE update, não o SELECT lá em cima.
  // O `pago_em IS NULL` faz do próprio UPDATE a trava: se duas conferidas
  // chegarem juntas — e chegam, o polling é de 5s e a consulta na Cielo passa
  // disso — só uma volta com linha e só ela registra o pagamento. Em 01/08 um
  // Pix de R$ 37,28 entrou DUAS VEZES na conta do cliente por causa disso.
  // Nunca separe a checagem da gravação aqui.
  const claim = await sql`UPDATE pix_cobranca SET pago_em=now(), e2e=${e2e}
    WHERE txid=${String(txid)} AND pago_em IS NULL RETURNING txid`;
  if (!claim.length) return { ok: true, pago: true, ja_registrado: true };
  try {
    const ped = await fbAcharPedido(Number(cob.mesa));
    const marca = 'Pix do cliente ' + txid;
    if (!ped) {
      // ⚠️ DINHEIRO SEM DONO. O Pix caiu depois que a mesa fechou (o cliente
      // pagou, a página dele morreu, e alguém no caixa encerrou a conta por
      // outro caminho). Até aqui isso passava CALADO: marcava a cobrança como
      // paga e não gravava em lugar nenhum. Agora fica marcado e gritado —
      // esse valor precisa de conciliação humana, não de palpite do sistema.
      await sql`UPDATE pix_cobranca SET sem_conta=true WHERE txid=${String(txid)}`;
      console.error('[pix] ⚠️ ÓRFÃO: R$ ' + Number(cob.valor).toFixed(2) + ' caiu na mesa ' + cob.mesa +
        ' mas a conta já estava fechada — txid ' + txid + (e2e ? ' · E2E ' + e2e : '') + ' · CONCILIAR NA MÃO');
    }
    if (ped) {
      // Segunda trava, do lado do Consumer: se por qualquer caminho já existe
      // um pagamento com este txid, não grava outro.
      const dup = await qi(`SELECT FIRST 1 CODIGO FROM PAGAMENTOS
        WHERE CODIGOPEDIDO=${ped} AND DATADELETE IS NULL AND OBSERVACAO CONTAINING '${fbEsc(String(txid))}'`);
      if (dup.ok && dup.rows.length) console.error('[pix] ' + txid + ' já estava no Consumer — não dupliquei');
      else {
        const pagFb = await fbInserirPagamento(ped, { forma_codigo: FORMA.PIX_ONLINE, valor: Number(cob.valor),
          autorizacao: e2e, observacao: marca });
        // o log LOCAL também precisa do Pix: é dele que sai a lista
        // "Pagamentos" da mesa e da conta impressa — sem isto o cliente pagava
        // e o garçom não via o lançamento na tela.
        await sql`INSERT INTO venda_pagamento (numero, pedido_fb, forma_codigo, forma, valor, origem, status, autorizacao, pagamento_fb)
          VALUES (${Number(cob.mesa)}, ${ped}, ${FORMA.PIX_ONLINE}, ${'Pix Online'}, ${Number(cob.valor)}, ${'pix-cliente'}, ${'ok'}, ${e2e || null}, ${pagFb})`;
      }
      // quitou pelo Pix = mesmo ato final do dinheiro e da maquininha: fecha o
      // pedido e libera a mesa (o apiCaixaFechar barra sozinho se faltar).
      let fechou = false;
      try { fechou = (await apiCaixaFechar(Number(cob.mesa)))?.fechada === true; } catch { /* parcial: segue aberta */ }
      // COMPROVANTE (pedido do dono, 22/08): sai na térmica do caixa assim que
      // o Pix é reconhecido. Sai também no pagamento parcial — quem pagou a
      // parte dele tem direito ao papel, mesmo com a mesa seguindo aberta.
      imprimirComprovantePix(String(txid)).catch(() => {});
      console.log('[pix] ' + txid + ' pago R$ ' + Number(cob.valor).toFixed(2) + ' na mesa ' + cob.mesa + (fechou ? ' — mesa FECHADA' : ' — mesa segue aberta (falta pagar)'));
    }
  } catch (err) { console.error('[pix] registrar no Consumer falhou:', err.message); }
  return { ok: true, pago: true, e2e };
}

// ---- /conta/ver?n=12 — a conta na TELA, imprimível em papel comum ----
// A impressão do Consumer (TIPOIMPRESSAO 2) depende da impressora do caixa
// estar configurada, e a maquininha Cielo ainda está inacessível. Esta página
// resolve hoje: abre no navegador, imprime em qualquer impressora, ou só mostra.
/** Taxa de serviço da casa (CONFIG.TAXASERVICO do Consumer, hoje 10%). */
const TAXA_SERVICO = Number(process.env.TAXA_SERVICO ?? 10);
// Desconto/acréscimo do PEDIDO (TOTALDESCONTO/TOTALACRESCIMO do Consumer), ao
// vivo — o espelho `comanda` só tem o VALORTOTAL. Falhou o Firebird = 0 (a
// conta abre, só sem o ajuste).
async function fbAjustesPedido(codigo) {
  try {
    const r = await qi(`SELECT COALESCE(TOTALDESCONTO,0) D, COALESCE(TOTALACRESCIMO,0) A FROM PEDIDOS WHERE CODIGO=${Number(codigo)}`);
    const x = r.ok && r.rows[0];
    return { desconto: +(Number(x?.D) || 0).toFixed(2), acrescimo: +(Number(x?.A) || 0).toFixed(2) };
  } catch { return { desconto: 0, acrescimo: 0 }; }
}
async function apiContaTexto(numero, modoApp = false, comFiado = false) {
  const n = Number(numero);
  const c = (await sql`SELECT codigo, numero, nome, valor_total, subtotal_pago, data_abertura, qtd_pessoas
    FROM comanda WHERE numero=${n} LIMIT 1`)[0];
  if (!c) return { ok: false, erro: 'não há conta aberta no número ' + n };
  const itens = await sql`SELECT nome, quantidade, valor_total, tipo, detalhes FROM comanda_item
    WHERE comanda_codigo=${c.codigo} ORDER BY criado NULLS LAST, id`;
  // nome: a identificacao nova ganha da tabela antiga de vinculo
  const ident = (await sql`SELECT nome_curto FROM identificacao WHERE numero=${n} AND fechada_em IS NULL`)[0];
  const quem = ident || (await sql`SELECT nome_curto FROM mesa_comanda WHERE comanda=${n} AND fechada_em IS NULL`)[0];
  // ⚠️ Somar TODOS os itens (menos a linha de Serviço, tipo 8) — inclui
  // COMPLEMENTO COM PREÇO (ex.: Vinagrete R$1). Antes excluía todo tipo 2 e
  // derrubava complemento pago → o app cobrava a menos e a mesa não fechava
  // (mesa 16 da Mayara: itens 112, mas cobrou 111×1,10). = VALORTOTALITENS do FB.
  const total = itens.filter((i) => Number(i.tipo) !== 8).reduce((s, i) => s + Number(i.valor_total || 0), 0);
  const pago = Number(c.subtotal_pago || 0);
  // DESCONTO/ACRÉSCIMO do pedido: o app e o cupom IGNORAVAM (conta com desconto
  // era cobrada cheia). Canônico = total + serviço − desconto + acréscimo.
  // modoApp = app ANTIGO da maquininha (calcula itens×1,10−pago só a partir do
  // `total`): dobra o desconto pra DENTRO do `total` de um jeito que
  // total×F − pago = saldo canônico (exato na taxa padrão). O app novo manda
  // x-concilia-app e recebe os campos honestos (desconto/acrescimo à parte).
  const aj = await fbAjustesPedido(c.codigo);
  const F = 1 + TAXA_SERVICO / 100;
  const fold = (bruto, a) => modoApp ? +(bruto - (a.desconto - a.acrescimo) / F).toFixed(2) : bruto;
  const totalBase = fold(total, aj);

  // Comandas da mesa: cada pessoa vê o SEU subtotal, com os 10% já calculados.
  // Sem isso, na hora de dividir a conta a mesa faz a conta de cabeça e erra.
  const comandas = [];
  if (n < COMANDA_DE) {
    const vinc = await sql`SELECT comanda, nome_curto FROM mesa_comanda
      WHERE mesa=${n} AND fechada_em IS NULL ORDER BY comanda`;
    for (const v of vinc) {
      // Comanda recém-aberta ainda não tem PEDIDOS no Consumer (ele nasce no
      // primeiro item). Antes disso ela sumia da conta — o garçom abria e não
      // via. Agora aparece zerada, que é a verdade: existe e não consumiu nada.
      const cc = (await sql`SELECT codigo, nome, subtotal_pago FROM comanda WHERE numero=${Number(v.comanda)} LIMIT 1`)[0]
        || { codigo: null, nome: null, subtotal_pago: 0 };
      // Os ITENS da comanda vão junto: sem eles o cupom mostrava só um total
      // solto ("302 — R$ 17,60") e a pessoa não tinha como conferir o que
      // consumiu. Conferência de consumo sem o consumo descrito não confere nada.
      const its = cc.codigo == null ? [] : await sql`SELECT nome, quantidade, valor_total, tipo, detalhes FROM comanda_item
        WHERE comanda_codigo=${cc.codigo} ORDER BY criado NULLS LAST, id`;
      const sub = its.filter((i) => Number(i.tipo) !== 8).reduce((s, i) => s + Number(i.valor_total || 0), 0); // inclui complemento com preço (ver total da mesa acima)
      const idc = (await sql`SELECT nome_curto FROM identificacao WHERE numero=${Number(v.comanda)} AND fechada_em IS NULL`)[0];
      // rastro da transferência: de onde essa comanda veio, quando e por quem
      const tr = (await sql`SELECT de_numero, para_numero, criado_em, por, itens_movidos
        FROM transferencia WHERE para_numero=${Number(v.comanda)} OR de_numero=${Number(v.comanda)}
        ORDER BY criado_em DESC LIMIT 1`)[0] || null;
      // O QUE JÁ FOI PAGO NA COMANDA. Sem isto, quem pagava a comanda no Pix
      // via a conta da mesa continuar cheia — o dinheiro tinha entrado e a
      // mesa não sabia. Cada comanda é um PEDIDOS próprio no Consumer, com
      // seu SUBTOTALPAGO; é ele que diz o que já foi quitado ali.
      const ajC = cc.codigo == null ? { desconto: 0, acrescimo: 0 } : await fbAjustesPedido(cc.codigo);
      const subBase = fold(sub, ajC);
      const svcC = +(subBase * TAXA_SERVICO / 100).toFixed(2);
      const comSvc = modoApp ? +(subBase + svcC).toFixed(2) : +(sub + svcC - ajC.desconto + ajC.acrescimo).toFixed(2);
      const pagoC = Number(cc.subtotal_pago || 0);
      const restaC = Math.max(0, +(comSvc - pagoC).toFixed(2));
      comandas.push({ numero: Number(v.comanda), nome: idc?.nome_curto || v.nome_curto || cc.nome || null,
        itens: its, transferencia: tr,
        subtotal: subBase, servico: svcC, desconto: modoApp ? 0 : ajC.desconto, acrescimo: modoApp ? 0 : ajC.acrescimo,
        com_servico: comSvc,
        pago: pagoC, resta: restaC, quitada: pagoC > 0 && restaC <= 0.009 });
    }
  }
  const servico = +(totalBase * TAXA_SERVICO / 100).toFixed(2);
  const comServico = modoApp ? +(totalBase + servico).toFixed(2) : +(total + servico - aj.desconto + aj.acrescimo).toFixed(2);
  // ⚠️ O total da MESA é só do que foi lançado NELA. Cada comanda é uma conta
  // separada no Consumer (PEDIDOS próprio), então o consumo dela NÃO entra
  // aqui. O cupom mostrava "TOTAL 327,80" com uma comanda de 17,60 pendurada
  // do lado, e quem lia somava errado. Por isso vai também o total geral —
  // mesa + comandas — pra ninguém fechar a noite achando que cobrou tudo.
  // OS PAGAMENTOS JÁ FEITOS, um a um. Numa conta rachada entre 6 pessoas,
  // quem chega depois precisa ver o que já entrou pra saber o que falta —
  // e o caixa precisa conferir sem abrir o Consumer.
  let pagamentos = [];
  try {
    const ped = await fbAcharPedido(n);
    if (ped) {
      const r = await qi(`SELECT g.VALOR V, g.DATAPAGAMENTO Q, TRIM(g.OBSERVACAO) OBS,
          TRIM(f.DESCRICAO) FORMA
        FROM PAGAMENTOS g LEFT JOIN FORMASPAGAMENTO f ON f.CODIGO = g.CODIGOFORMAPAGAMENTO
        WHERE g.CODIGOPEDIDO = ${ped} AND g.DATADELETE IS NULL ORDER BY g.CODIGO`);
      if (r.ok) pagamentos = r.rows.map((x) => ({ valor: Number(x.V) || 0,
        quando: x.Q || null, forma: (x.FORMA || '').trim() || null,
        obs: (x.OBS || '').trim() || null }));
    }
  } catch { /* sem Firebird a conta ainda abre, só sem o detalhe */ }
  const totalComandas = comandas.reduce((s, c) => s + Number(c.com_servico || 0), 0);
  const pagoComandas = comandas.reduce((s, c) => s + Number(c.pago || 0), 0);
  const geral = +(comServico + totalComandas).toFixed(2);
  // Quanto AINDA FALTA na mesa toda: o que já foi pago em qualquer comanda
  // (ou na própria mesa) sai daqui. Comanda quitada não pode continuar
  // pesando no que a mesa deve.
  const pagoGeral = +(pago + pagoComandas).toFixed(2);
  // ⚠️ FIADO NÃO SAI AQUI. /api/conta/texto é ABERTO na rede da loja — quem
  // digitar um número de mesa vê a conta. Pôr o saldo devedor nisso é expor a
  // dívida de uma pessoa pra qualquer um no Wi-Fi. O saldo vai só no cupom
  // térmico, que sai da mão do caixa (comFiado abaixo).
  const fiado = comFiado ? await fiadoDaConta(n, c.codigo, Math.max(0, comServico - pago)) : null;
  return { ok: true, numero: n, nome: quem?.nome_curto || c.nome || null, abertura: c.data_abertura, fiado,
    pessoas: c.qtd_pessoas, itens, comandas, pagamentos,
    total: totalBase, desconto: modoApp ? 0 : aj.desconto, acrescimo: modoApp ? 0 : aj.acrescimo,
    taxa_servico: TAXA_SERVICO, servico, com_servico: comServico,
    total_comandas: +totalComandas.toFixed(2), geral,
    pago_comandas: +pagoComandas.toFixed(2), pago_geral: pagoGeral,
    falta_geral: Math.max(0, +(geral - pagoGeral).toFixed(2)),
    pago, resta: Math.max(0, comServico - pago) };
}
/* ---- /comprovante?txid=… — o papel do Pix na tela ----
   Mesma folha do cupom térmico, em HTML: o cliente abre no celular dele assim
   que paga, e a casa abre pra reimprimir. O E2E aparece por extenso de
   propósito — é o número que o banco reconhece numa contestação. */
const PIXCOMPROV_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comprovante — ${LOJA_NOME}</title><style>
:root{--ink:#141418;--mut:#6e6e78;--line:#dcdce3;--ok:#0d7a43}
*{box-sizing:border-box}body{margin:0;background:#ececed;color:var(--ink);font-family:'Outfit',-apple-system,system-ui,sans-serif}
.barra{background:#fff;border-bottom:1px solid var(--line);padding:11px 16px;display:flex;gap:9px;align-items:center}
.barra b{flex:1;font-size:15px}
button{background:#e0651a;color:#fff;border:0;border-radius:9px;padding:9px 15px;font:inherit;font-size:14px;font-weight:700;cursor:pointer}
button.g{background:#5b5b66}
.cupom{width:80mm;max-width:100%;margin:16px auto;background:#fff;padding:16px 13px;
  font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12.5px;line-height:1.5;box-shadow:0 2px 10px rgba(0,0,0,.12)}
.cab{text-align:center;margin-bottom:10px}
.cab .n{font-size:16px;font-weight:800;letter-spacing:.5px}
.cab .t{font-size:12px;font-weight:700;margin-top:2px}
.cab .s{color:var(--mut);font-size:10.5px}
hr{border:0;border-top:1px dashed #9a9aa5;margin:9px 0}
.lin{display:flex;justify-content:space-between;gap:8px}
.mesa{font-size:15px;font-weight:800}
.pago{display:flex;justify-content:space-between;font-size:19px;font-weight:800;margin:6px 0}
.selo{text-align:center;font-size:15px;font-weight:800;color:var(--ok);border:2px solid var(--ok);border-radius:8px;padding:6px;margin:10px 0}
.falta{text-align:center;font-size:14px;font-weight:800;color:#b3261e;border:2px solid #b3261e;border-radius:8px;padding:6px;margin:10px 0}
.e2e{word-break:break-all;font-size:11px;color:var(--mut)}
.pe{text-align:center;color:var(--mut);font-size:10.5px;margin-top:12px;line-height:1.5}
.erro{max-width:420px;margin:40px auto;background:#fff;padding:22px;border-radius:12px;text-align:center}
@media print{body{background:#fff}.barra{display:none}.cupom{box-shadow:none;margin:0;width:auto}}
</style></head><body>
<div class="barra"><b>Comprovante</b>
<button class="g" onclick="print()">Imprimir</button></div>
<div id="app"><div class="erro">carregando…</div></div>
<script>
var brl=function(v){return 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})};
var esc=function(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
(async function(){
  var txid=new URLSearchParams(location.search).get('txid')||'';
  var d;try{d=await (await fetch('/api/pix/comprovante?txid='+encodeURIComponent(txid),{cache:'no-store'})).json()}catch(e){d=null}
  var app=document.getElementById('app');
  if(!d||!d.ok){app.innerHTML='<div class="erro">Comprovante não encontrado.</div>';return}
  var q=new Date(d.quando).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  app.innerHTML='<div class="cupom">'+
    '<div class="cab"><div class="n">'+esc(d.casa.toUpperCase())+'</div>'+
      '<div class="t">COMPROVANTE DE PAGAMENTO</div>'+
      '<div class="s">não é documento fiscal</div></div><hr>'+
    '<div class="mesa">'+esc(d.rotulo)+(d.nome?' · '+esc(d.nome):'')+'</div>'+
    '<div class="s" style="color:#6e6e78">'+q+'</div><hr>'+
    '<div class="lin"><span>Forma</span><b>Pix</b></div>'+
    '<div class="pago"><span>PAGO</span><span>'+brl(d.valor)+'</span></div><hr>'+
    '<div class="lin"><span>Consumo da mesa</span><span>'+brl(d.consumo)+'</span></div>'+
    '<div class="lin"><span>Total pago</span><span>'+brl(d.pago_geral)+'</span></div>'+
    (d.quitada?'<div class="selo">✓ CONTA QUITADA</div>'
              :'<div class="falta">Ainda falta '+brl(d.falta)+'</div>')+
    '<hr>'+(d.e2e?'<div>Pix E2E:</div><div class="e2e">'+esc(d.e2e)+'</div>':'')+
    '<div class="e2e">ID: '+esc(d.txid)+'</div>'+
    '<div class="pe">Obrigado pela preferência!</div></div>';
  document.title='Comprovante '+d.rotulo+' — '+brl(d.valor);
})();
</script></body></html>`;

const CONTAVER_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conta — ${LOJA_NOME}</title><style>
:root{--ink:#141418;--mut:#6e6e78;--line:#dcdce3}
*{box-sizing:border-box}body{margin:0;background:#ececed;color:var(--ink);font-family:'Outfit',-apple-system,system-ui,sans-serif}
.barra{background:#fff;border-bottom:1px solid var(--line);padding:11px 16px;display:flex;gap:9px;align-items:center}
.barra b{flex:1;font-size:15px}
button,a.b{background:#e0651a;color:#fff;border:0;border-radius:9px;padding:9px 15px;font:inherit;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none}
button.g{background:#5b5b66}
/* 80mm = a largura do cupom térmico; em papel A4 fica centralizado */
.cupom{width:80mm;max-width:100%;margin:16px auto;background:#fff;padding:14px 12px;
  font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12.5px;line-height:1.45;box-shadow:0 2px 10px rgba(0,0,0,.12)}
.cab{text-align:center;margin-bottom:10px}
.cab .n{font-size:16px;font-weight:800;letter-spacing:.5px}
.cab .s{color:var(--mut);font-size:11px}
hr{border:0;border-top:1px dashed #9a9aa5;margin:9px 0}
.it{display:flex;gap:6px}
.it .q{width:26px;flex:none}.it .d{flex:1;word-break:break-word}.it .v{text-align:right;white-space:nowrap}
.sub{color:var(--mut);font-size:11px;padding-left:32px}
.tot{display:flex;justify-content:space-between;font-size:15px;font-weight:800;margin-top:4px}
.lin{display:flex;justify-content:space-between}
.pe{text-align:center;color:var(--mut);font-size:10.5px;margin-top:12px;line-height:1.5}
.erro{max-width:420px;margin:40px auto;background:#fff;padding:22px;border-radius:12px;text-align:center}
@media print{body{background:#fff}.barra{display:none}.cupom{box-shadow:none;margin:0;width:auto}}
</style></head><body>
<div class="barra"><b>Conta</b>
  <button onclick="window.print()">🖨 Imprimir</button>
  <button class="g" onclick="history.back()">Voltar</button></div>
<div id="app"></div>
<script>
var N=new URLSearchParams(location.search).get('n');
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
function brl(v){return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
(async function(){
  var d=await (await fetch('/api/conta/texto?n='+N,{cache:'no-store'})).json();
  var app=document.getElementById('app');
  if(!d.ok){app.innerHTML='<div class="erro">'+esc(d.erro||'erro')+'</div>';return}
  var h='<div class="cupom"><div class="cab"><div class="n">PRAINHA BAR</div>'+
    '<div class="s">CONFERÊNCIA DE CONSUMO<br>não é documento fiscal</div></div><hr>'+
    '<div class="lin"><span>'+(Number(d.numero)>=${COMANDA_DE}?'Comanda':'Mesa')+' <b>'+d.numero+'</b></span>'+
    '<span>'+new Date().toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</span></div>'+
    (d.nome?'<div class="lin"><span>Cliente</span><span>'+esc(d.nome)+'</span></div>':'')+
    (d.pessoas?'<div class="lin"><span>Pessoas</span><span>'+d.pessoas+'</span></div>':'')+'<hr>';
  (d.itens||[]).forEach(function(i){
    if(i.tipo===2){h+='<div class="sub">+ '+esc(i.nome)+'</div>';return}
    h+='<div class="it"><span class="q">'+(Number(i.quantidade)||1)+'x</span>'+
       '<span class="d">'+esc(i.nome)+'</span><span class="v">'+brl(i.valor_total)+'</span></div>';
  });
  h+='<hr><div class="lin"><span>Subtotal</span><span>'+brl(d.total)+'</span></div>'+
     '<div class="lin"><span>Serviço '+d.taxa_servico+'%</span><span>'+brl(d.servico)+'</span></div>'+
     '<div class="tot"><span>TOTAL</span><span>'+brl(d.com_servico)+'</span></div>';
  if(d.pago>0){h+='<div class="lin"><span>já pago</span><span>-'+brl(d.pago)+'</span></div>'+
    '<div class="tot"><span>A PAGAR</span><span>'+brl(d.resta)+'</span></div>'}
  // Divisão por comanda: cada um vê o seu, já com o serviço somado
  if((d.comandas||[]).length){
    d.comandas.forEach(function(c){
      h+='<hr><div style="text-align:center;font-weight:700;margin-bottom:4px">COMANDA '+c.numero+
         (c.nome?' · '+esc(c.nome):'')+(c.quitada?' — PAGO':'')+'</div>';
      // De onde veio: comanda transferida sem aviso vira discussão no caixa.
      if(c.transferencia){
        var t=c.transferencia;
        var q=new Date(t.criado_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
        h+='<div style="font-size:11px;text-align:center;margin-bottom:4px">'+
           'transferida da '+(t.de_numero>=${COMANDA_DE}?'comanda ':'mesa ')+t.de_numero+
           ' às '+q+(t.por?' por '+esc(t.por):'')+'</div>';
      }
      // OS ITENS da comanda. Antes saía só o total: "302 — R$ 17,60", sem
      // nada pra conferir. Conferência de consumo precisa descrever o consumo.
      var its=(c.itens||[]).filter(function(i){return i.tipo!==2});
      if(!its.length) h+='<div class="it"><span class="d" style="font-size:11px">sem consumo lançado</span></div>';
      its.forEach(function(i){
        h+='<div class="it"><span class="q">'+Number(i.quantidade)+'x</span>'+
           '<span class="d">'+esc(i.nome)+'</span>'+
           '<span class="v">'+brl(i.valor_total)+'</span></div>';
      });
      h+='<div class="it"><span class="q"></span><span class="d" style="font-size:11px">'+
         brl(c.subtotal)+' + '+brl(c.servico)+' serv.</span>'+
         '<span class="v"><b>'+brl(c.com_servico)+'</b></span></div>';
      // Comanda paga tem que DIZER que foi paga — senão o valor dela continua
      // na soma aos olhos de quem lê e a mesa parece dever o que já quitou.
      if(c.pago>0){
        h+='<div class="it"><span class="q"></span><span class="d" style="font-size:11px">já pago</span>'+
           '<span class="v">− '+brl(c.pago)+'</span></div>';
        if(c.resta>0.009) h+='<div class="it"><span class="q"></span>'+
           '<span class="d" style="font-size:11px">falta nesta comanda</span>'+
           '<span class="v"><b>'+brl(c.resta)+'</b></span></div>';
      }
    });
    // Mesa e comandas são contas SEPARADAS no Consumer. Sem esta linha, quem
    // lê o cupom soma errado — o TOTAL de cima é só o da mesa.
    h+='<hr><div class="tot"><span>TOTAL GERAL</span><b>'+brl(d.geral)+'</b></div>'+
       '<div style="font-size:11px;text-align:center">mesa '+brl(d.com_servico)+
       ' + comandas '+brl(d.total_comandas)+'</div>';
    if(d.pago_geral>0){
      h+='<div class="lin"><span>já pago</span><b>− '+brl(d.pago_geral)+'</b></div>'+
         '<div class="tot"><span>AINDA FALTA</span><b>'+brl(d.falta_geral)+'</b></div>';
    }
  }
  h+='<div class="pe">Serviço de '+d.taxa_servico+'% incluso no total.<br>Obrigado pela preferência!</div></div>';
  app.innerHTML=h;
})();
</script></body></html>`;

// ---- /catraca — tela de operação da saída ----
// Serve pra testar e pra operar na mão enquanto a catraca não estiver ligada
// na API. A catraca de verdade só precisa chamar /api/saida/passar?t=CODIGO.
const CATRACA_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saída — ${LOJA_NOME}</title><style>
:root{--bg:#12121a;--ink:#f4f4f7;--mut:#9a9aa8;--ok:#15a34a;--no:#dc2626}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:'Outfit',-apple-system,system-ui,sans-serif;min-height:100vh}
.wrap{max-width:520px;margin:0 auto;padding:26px 20px}
h1{font-size:20px;margin:0 0 4px}.mut{color:var(--mut);font-size:14px}
input{width:100%;font:inherit;font-size:26px;letter-spacing:.08em;text-align:center;padding:16px;
  border:2px solid #2c2c3a;border-radius:14px;background:#1c1c26;color:var(--ink);outline:none;margin-top:16px;text-transform:uppercase}
input:focus{border-color:#4b4b64}
button{width:100%;background:#3b82f6;color:#fff;border:0;border-radius:14px;font:inherit;font-size:17px;
  font-weight:700;padding:15px;margin-top:12px;cursor:pointer}
.res{border-radius:16px;padding:24px;text-align:center;margin-top:20px}
.res.ok{background:rgba(21,163,74,.16);border:1px solid rgba(21,163,74,.5)}
.res.no{background:rgba(220,38,38,.14);border:1px solid rgba(220,38,38,.45)}
.res .ic{font-size:52px;line-height:1}
.res .t{font-size:22px;font-weight:800;margin-top:6px}
.res.ok .t{color:#4ade80}.res.no .t{color:#f87171}
.res .d{color:var(--mut);font-size:14.5px;margin-top:6px}
.big{font-size:56px;font-weight:800;margin-top:6px;line-height:1}
.big .de{font-size:24px;font-weight:600;color:var(--mut)}
.bolas{display:flex;gap:7px;justify-content:center;flex-wrap:wrap;margin-top:14px}
.bo{width:14px;height:14px;border-radius:50%;background:#2c2c3a;border:1px solid #3d3d50}
.bo.on{background:var(--ok);border-color:var(--ok)}
.sec{margin-top:30px;font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:var(--mut)}
.at{display:flex;align-items:center;gap:12px;background:#1c1c26;border:1px solid #2c2c3a;border-radius:12px;
  padding:13px 15px;margin-top:9px;cursor:pointer;font-size:15px}
.at:active{background:#23232f}
.at .cod{font-family:Menlo,monospace;font-size:12px;color:var(--mut);flex:1}
.at .rest{background:#2c2c3a;border-radius:20px;padding:3px 11px;font-size:13px;font-weight:700}
button.tst{background:#2c2c3a;color:var(--mut);font-size:14px;margin-top:16px}
</style></head><body><div class="wrap">
<h1>Saída · catraca</h1>
<div class="mut">Leia o QR do cliente ou digite o código. Cada leitura libera uma pessoa.</div>
<input id="t" placeholder="CÓDIGO" autocomplete="off" autofocus>
<button onclick="passar()">Liberar passagem</button>
<div id="r"></div>
<div class="sec">Mesas com gente pra sair</div>
<div id="ativos" class="mut">carregando…</div>
<button class="tst" onclick="criarTeste()">Criar um código de teste (4 pessoas)</button>
</div>
<script>
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
var el=document.getElementById('t');
el.addEventListener('keydown',function(e){if(e.key==='Enter')passar()});
async function passar(){
  var t=(el.value||'').trim();if(!t)return;
  var d=await (await fetch('/api/saida/passar?t='+encodeURIComponent(t),{cache:'no-store'})).json();
  var r=document.getElementById('r');
  if(d.libera){
    r.innerHTML='<div class="res ok"><div class="ic">✓</div><div class="t">PODE PASSAR</div>'+
      '<div class="big">'+d.pessoa+'<span class="de"> de '+d.de+'</span></div>'+
      '<div class="d">'+(d.ultima?'era a última pessoa · mesa '+d.mesa
        :'faltam '+d.restantes+' · mesa '+d.mesa)+'</div>'+
      '<div class="bolas">'+Array.from({length:d.de},function(_,i){
        return '<span class="bo'+(i<d.pessoa?' on':'')+'"></span>'}).join('')+'</div></div>';
    if(d.ultima)el.value='';
  } else {
    r.innerHTML='<div class="res no"><div class="ic">✕</div><div class="t">NÃO LIBERADO</div>'+
      '<div class="d">'+esc(d.motivo||'')+'</div></div>';
  }
  el.focus();el.select();
  carregarAtivos();
}
// Quem ainda tem gente pra passar. Serve na operacao (ver a fila) e pra
// achar o codigo quando o cliente perdeu a tela do celular.
async function carregarAtivos(){
  var d;try{d=await (await fetch('/api/saida/ativos',{cache:'no-store'})).json()}catch(e){return}
  var el=document.getElementById('ativos');if(!el)return;
  if(!d.ativos.length){el.className='mut';el.innerHTML='ninguém aguardando saída agora';return}
  el.className='';
  el.innerHTML=d.ativos.map(function(a){
    return '<div class="at" onclick="usar(\\''+a.token+'\\')"><b>Mesa '+a.mesa+'</b>'+
      '<span class="cod">'+a.token+'</span>'+
      '<span class="rest">'+a.restantes+' de '+a.pessoas+'</span></div>';
  }).join('');
}
function usar(t){document.getElementById('t').value=t;passar()}
async function criarTeste(){
  var r=await (await fetch('/api/saida/gerar',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({mesa:99,adultos:4,criancas:0,origem:'teste'})})).json();
  if(!r.ok){alert(r.erro||'erro');return}
  document.getElementById('t').value=r.token;
  carregarAtivos();
  document.getElementById('r').innerHTML='<div class="res ok" style="padding:16px">'+
    '<div class="d">código de teste criado: <b>'+r.token+'</b><br>toque em "Liberar passagem" 4 vezes</div></div>';
}
carregarAtivos();setInterval(carregarAtivos,10000);
</script></body></html>`;

// ---- /tempos — configuração do tempo de preparo ----
// ---- /camera — teste de 10 segundos, pra preparar cada tablet sem achismo ----
// "Não seguro" na barra do Chrome é o rótulo normal de certificado próprio e
// NÃO bloqueia a câmera. Esta página tira a dúvida: diz em português se o
// aparelho está pronto, e mostra a foto que acabou de tirar.
const CAMERA_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${LOJA_NOME} — Testar câmera</title><style>
:root{--ink:#1b1b20;--mut:#6e6e78;--line:#e3e3e9;--green2:#0f8a3e;--red:#dc2626;--gold2:#e0651a}
*{box-sizing:border-box}body{margin:0;font-family:'Outfit',-apple-system,system-ui,sans-serif;background:#f2f2f5;color:var(--ink);padding:20px}
.wrap{max-width:520px;margin:0 auto}
h1{font-size:20px;margin:0 0 14px}
.l{background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px 15px;margin-bottom:9px;display:flex;gap:11px;align-items:flex-start}
.l b{display:block;font-size:15px}.l span{font-size:13px;color:var(--mut);line-height:1.4}
.ic{font-size:20px;line-height:1}
.ok{border-left:4px solid var(--green2)}.ruim{border-left:4px solid var(--red)}
.b{display:block;width:100%;border:0;border-radius:14px;font:inherit;font-size:17px;font-weight:700;padding:17px;margin-top:14px;color:#fff;background:var(--gold2);cursor:pointer}
.b.v{background:var(--green2)}
img{width:100%;border-radius:12px;margin-top:14px;display:block}
code{background:#eee;padding:1px 5px;border-radius:5px;font-size:12px;word-break:break-all}
</style></head><body><div class="wrap">
<h1>Este tablet pode dar baixa?</h1>
<div id="app">testando…</div>
</div>
<script>
var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')};
function linha(ok,titulo,txt){return '<div class="l '+(ok?'ok':'ruim')+'"><span class="ic">'+(ok?'✅':'❌')+
  '</span><div><b>'+titulo+'</b><span>'+txt+'</span></div></div>'}
async function testar(){
  var h='';
  var seg=window.isSecureContext;
  h+=linha(seg,seg?'Endereço seguro':'Endereço NÃO é seguro',
    seg?'Está em <code>'+esc(location.origin)+'</code>. O aviso "Não seguro" na barra do Chrome é normal com certificado próprio e não atrapalha.'
       :'A câmera só funciona em <code>https</code>. Toque no botão abaixo pra abrir no endereço certo.');
  var tem=!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia);
  h+=linha(tem,tem?'Navegador com câmera':'Navegador sem acesso à câmera',
    tem?'O Chrome deste aparelho expõe a câmera.':'Atualize o Chrome ou use outro navegador.');
  document.getElementById('app').innerHTML=h+'<div class="l"><span class="ic">⏳</span><div><b>Abrindo a câmera…</b><span>permita quando o Chrome perguntar</span></div></div>';
  if(!seg||!tem){
    var porta=Number(location.port||80)+1;
    document.getElementById('app').innerHTML=h+
      '<button class="b" onclick="location.href=\\'https://'+location.hostname+':'+porta+'/camera\\'">🔒 Abrir no endereço seguro</button>';
    return;
  }
  try{
    var s=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:480}},audio:false});
    var v=document.createElement('video');v.playsInline=true;v.muted=true;v.srcObject=s;
    await v.play();
    await new Promise(function(r){setTimeout(r,600)});
    var c=document.createElement('canvas');c.width=320;c.height=Math.round(320*v.videoHeight/v.videoWidth);
    c.getContext('2d').drawImage(v,0,0,c.width,c.height);
    var img=c.toDataURL('image/jpeg',0.6);
    s.getTracks().forEach(function(t){t.stop()});
    document.getElementById('app').innerHTML=h+
      linha(true,'Câmera funcionando','Esta é a foto que o sistema guardaria numa baixa. Tablet pronto.')+
      '<img src="'+img+'" alt="foto de teste">'+
      '<button class="b v" onclick="location.href=\\'/\\'">Ir para a produção</button>';
  }catch(e){
    document.getElementById('app').innerHTML=h+
      linha(false,'Câmera recusada',(e&&e.name==='NotAllowedError')
        ? 'A permissão foi negada neste aparelho. Toque no cadeado (ou no ⓘ) da barra de endereço, ache <b>Câmera</b> e mude para <b>Permitir</b>. Depois recarregue.'
        : 'Erro: '+esc((e&&e.name)||e))+
      '<button class="b" onclick="location.reload()">Testar de novo</button>';
  }
}
testar();
</script></body></html>`;

// ---- /baixas — QUEM BAIXOU O QUÊ, com a foto de quem tocou a tela ----
// A pergunta que o histórico do KDS não respondia: "quem apertou pronto nesse
// item?". Serve pra apurar baixa indevida e pra resolver "entregaram na mesa
// errada" sem depender da memória de ninguém.
// ---- /produtos — CADASTRO: onde cada item aparece, e a foto ----
// A verdade vai passar a ser o nosso banco. Hoje o Consumer ainda tem as
// mesmas flags, então a tela mostra o padrão herdado dele e deixa a casa
// decidir por cima — sem tocar no Consumer, e com "voltar ao padrão" sempre à
// mão. Quando virar de vez, é só parar de olhar pro padrão.
const PRODUTOS_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${LOJA_NOME} — Produtos</title><style>
:root{--bg:#f2f2f5;--card:#fff;--line:#e3e3e9;--ink:#1b1b20;--mut:#6e6e78;--gold2:#e0651a;--green2:#0f8a3e;--red:#dc2626}
*{box-sizing:border-box}body{margin:0;font-family:'Outfit',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:12px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
h1{font-size:18px;margin:0}h1 b{color:var(--gold2)}
.back{background:#f0f0f4;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:7px 12px;font:inherit;font-size:14px;cursor:pointer;text-decoration:none}
.grow{flex:1}
input[type=search]{flex:1;min-width:180px;font:inherit;font-size:15px;padding:9px 12px;border:1px solid var(--line);border-radius:10px}
.wrap{max-width:1080px;margin:0 auto;padding:16px 18px 60px}
.pi{display:flex;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:11px 13px;margin-bottom:9px}
.pi img,.pi .semf{width:56px;height:56px;border-radius:9px;object-fit:cover;flex:none;background:#eee;cursor:pointer}
.pi .semf{display:flex;align-items:center;justify-content:center;color:#aaa;font-size:11px;text-align:center;line-height:1.2;border:1px dashed var(--line)}
.pi .n{flex:1;min-width:150px;font-size:14.5px;line-height:1.3}
.pi .n small{display:block;color:var(--mut);font-size:12px;margin-top:2px}
.cn{display:flex;gap:6px;flex-wrap:wrap}
.cb{border:1.5px solid var(--line);background:#fff;color:var(--mut);border-radius:9px;padding:6px 10px;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.cb.on{border-color:var(--green2);background:#eafaf0;color:var(--green2);font-weight:700}
.cb.off{border-color:var(--red);background:#fdeaea;color:var(--red);font-weight:700}
.cb.herda{border-style:dashed}
.vazio{padding:50px 20px;text-align:center;color:var(--mut)}
.dica{background:#fff7e3;border:1px solid #f0d68f;color:#8a4b06;border-radius:11px;padding:10px 13px;font-size:13px;line-height:1.45;margin-bottom:14px}
</style></head><body>
<header><a class="back" href="/">◂ Produção</a><h1>Produtos <b>·</b> onde aparece</h1>
<input type="search" id="q" placeholder="buscar produto…" oninput="buscar(this.value)">
<select id="so" onchange="carrega()" style="font:inherit;padding:8px;border-radius:9px;border:1px solid var(--line)">
  <option value="">todos</option><option value="sem-foto">sem foto</option><option value="ajustados">já ajustados</option>
</select>
<span class="grow"></span><span id="cnt" class="back"></span></header>
<div class="wrap">
<div class="dica"><b>Tracejado</b> = herdado do Consumer. Clique pra decidir: <b>verde</b> aparece, <b>vermelho</b> não.
Clicando de novo volta ao herdado. Clique na foto pra trocar.</div>
<div id="app" class="vazio">carregando…</div></div>
<input type="file" id="arq" accept="image/*" style="display:none">
<script>
var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')};
var LISTA=[], deb=null, FOTOALVO=null;
function buscar(v){clearTimeout(deb);deb=setTimeout(carrega,300)}
async function carrega(){
  var q=document.getElementById('q').value, so=document.getElementById('so').value;
  var d;try{d=await (await fetch('/api/produtos?q='+encodeURIComponent(q)+'&so='+so,{cache:'no-store'})).json()}catch(e){return}
  LISTA=d.produtos||[];
  document.getElementById('cnt').textContent=LISTA.length+' itens';
  var app=document.getElementById('app');
  if(!LISTA.length){app.className='vazio';app.innerHTML='nada encontrado';return}
  app.className='';
  app.innerHTML=LISTA.map(function(p,ix){
    return '<div class="pi">'+
      (p.tem_foto?'<img src="/produto-foto/'+p.produto_codigo+'?v='+Date.now()+'" onclick="trocaFoto('+ix+')">'
                 :'<div class="semf" onclick="trocaFoto('+ix+')">sem<br>foto</div>')+
      '<span class="n">'+esc(p.nome)+(p.tamanho?' <b>'+esc(p.tamanho)+'</b>':'')+
        '<small>'+esc(p.categoria||'')+' · R$ '+Number(p.preco).toLocaleString('pt-BR',{minimumFractionDigits:2})+
        (p.sem_estoque?' · sem estoque':'')+'</small></span>'+
      '<span class="cn">'+
        bot(ix,'cliente','Cliente',p.cliente,p.padrao_cliente)+
        bot(ix,'garcom','Garçom',p.garcom,true)+
        bot(ix,'caixa','Caixa',p.caixa,true)+
        bot(ix,'delivery','Delivery',p.delivery,false)+
      '</span></div>';
  }).join('');
}
function bot(ix,campo,rot,valor,padrao){
  var efetivo=(valor===null||valor===undefined)?padrao:valor;
  var cls=(valor===null||valor===undefined)?'cb herda '+(efetivo?'on':'off'):'cb '+(efetivo?'on':'off');
  // &quot; em vez de aspas escapadas: dentro de um template literal a barra
  // some e o onclick sai quebrado. A entidade HTML atravessa intacta.
  return '<button class="'+cls+'" onclick="gira('+ix+',&quot;'+campo+'&quot;)">'+rot+'</button>';
}
// ciclo: herdado -> sim -> não -> herdado. Sempre dá pra voltar ao padrão.
async function gira(ix,campo){
  var p=LISTA[ix], v=p[campo];
  p[campo]=(v===null||v===undefined)?true:(v===true?false:null);
  var r=await (await fetch('/api/produto/salvar',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({codigo_pdv:p.codigo_pdv,cliente:p.cliente,garcom:p.garcom,caixa:p.caixa,delivery:p.delivery})})).json();
  if(!r.ok){alert(r.erro||'não consegui salvar');return}
  carrega();
}
function trocaFoto(ix){FOTOALVO=LISTA[ix];document.getElementById('arq').click()}
document.getElementById('arq').addEventListener('change',async function(ev){
  var f=ev.target.files[0];if(!f||!FOTOALVO)return;
  // reduz antes de mandar: foto de celular tem 4 MB e a tela só precisa de 600px
  var img=new Image(), url=URL.createObjectURL(f);
  img.onload=async function(){
    var w=Math.min(600,img.width), h=Math.round(w*img.height/img.width);
    var c=document.createElement('canvas');c.width=w;c.height=h;
    c.getContext('2d').drawImage(img,0,0,w,h);
    var r=await (await fetch('/api/produto/foto',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({produto_codigo:FOTOALVO.produto_codigo,foto:c.toDataURL('image/jpeg',0.82)})})).json();
    URL.revokeObjectURL(url);
    if(!r.ok){alert(r.erro||'não consegui salvar a foto');return}
    FOTOALVO=null;ev.target.value='';carrega();
  };
  img.src=url;
});
carrega();
</script></body></html>`;

const BAIXAS_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${LOJA_NOME} — Quem baixou</title><style>
:root{--bg:#f2f2f5;--card:#fff;--line:#e3e3e9;--ink:#1b1b20;--mut:#6e6e78;--gold2:#e0651a;--green2:#0f8a3e;--red:#dc2626;--deliv:#2563eb}
*{box-sizing:border-box}body{margin:0;font-family:'Outfit',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:12px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h1{font-size:18px;margin:0}h1 b{color:var(--gold2)}
.back{background:#f0f0f4;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:7px 13px;font:inherit;font-size:14px;cursor:pointer;text-decoration:none}
.grow{flex:1}
.pill{font-size:12.5px;color:var(--mut);background:#f4f4f7;border:1px solid var(--line);border-radius:20px;padding:3px 11px}
.pill.al{background:#dc2626;color:#fff;border-color:#dc2626}
.wrap{max-width:1180px;margin:0 auto;padding:18px 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.cd{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.cd img{display:block;width:100%;height:170px;object-fit:cover;background:#111}
.semf{height:170px;display:flex;align-items:center;justify-content:center;text-align:center;
  background:#faeaea;color:#a33;font-size:12px;padding:14px;line-height:1.35}
.cb{padding:11px 13px}
.tp{display:inline-block;font-size:11px;font-weight:700;border-radius:20px;padding:2px 9px;margin-bottom:6px}
.tp.pronto{background:#eafaf0;color:var(--green2)}.tp.entregue{background:#e8f0fe;color:var(--deliv)}
.it{font-size:14px;line-height:1.3;margin-bottom:5px}
.mt{font-size:12px;color:var(--mut);line-height:1.4}
.vazio{padding:60px 20px;text-align:center;color:var(--mut)}
</style></head><body>
<header><a class="back" href="/">◂ Produção</a><h1>Quem <b>baixou</b></h1>
<span class="grow"></span><span id="al"></span>
<a class="back" href="/baixas" onclick="carrega();return false">atualizar</a></header>
<div class="wrap"><div id="app" class="vazio">carregando…</div></div>
<script>
var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')};
function hora(t){var d=new Date(t);return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
async function carrega(){
  var d;try{d=await (await fetch('/api/baixas?n=120',{cache:'no-store'})).json()}catch(e){return}
  var al=document.getElementById('al');
  al.innerHTML=(d.sem_foto_24h
    ? '<span class="pill al">'+d.sem_foto_24h+' baixa(s) sem foto nas últimas 24h</span>'
    : '<span class="pill">todas com foto nas últimas 24h</span>')+
    ' <span class="pill">fotos guardadas por '+(d.guarda_dias||30)+' dias</span>';
  var app=document.getElementById('app');
  if(!d.baixas.length){app.className='vazio';app.innerHTML='nenhuma baixa registrada ainda';return}
  app.className='grid';
  app.innerHTML=d.baixas.map(function(b){
    var img=b.arquivo
      ? '<img src="/foto/'+esc(b.arquivo)+'" alt="quem baixou" loading="lazy">'
      : '<div class="semf">sem foto<br><span style="font-size:11px">'+esc(b.sem_foto_motivo||'motivo não registrado')+'</span></div>';
    return '<div class="cd">'+img+'<div class="cb">'+
      '<span class="tp '+esc(b.acao)+'">'+(b.acao==='entregue'?'ENTREGOU':'FEZ / DEU PRONTO')+'</span>'+
      '<div class="it">'+esc(b.itens_nome||'(item sem nome)')+'</div>'+
      '<div class="mt">'+(b.numero!=null?'mesa/comanda <b>'+b.numero+'</b> · ':'')+
        (b.n_itens>1?b.n_itens+' itens · ':'')+esc(b.area_nome||'sem praça')+'</div>'+
      '<div class="mt">'+hora(b.criado_em)+'</div>'+
    '</div></div>';
  }).join('');
}
carrega();setInterval(carrega,15000);
</script></body></html>`;

const IFOOD_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${LOJA_NOME} — iFood</title><style>
:root{--bg:#f2f2f5;--card:#fff;--line:#e3e3e9;--ink:#1b1b20;--mut:#6e6e78;--red:#ea1d2c;--green:#15a34a}
*{box-sizing:border-box}body{margin:0;font-family:'Outfit',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{background:#fff;border-bottom:1px solid var(--line);padding:13px 20px;display:flex;align-items:center;gap:12px}
h1{font-size:18px;margin:0}h1 b{color:var(--red)}
.back{background:#f0f0f4;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:7px 13px;font:inherit;font-size:14px;text-decoration:none}
.wrap{max-width:860px;margin:0 auto;padding:22px 20px 60px}
h2{font-size:15px;color:var(--mut);font-weight:500;margin:26px 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.l{display:flex;align-items:center;gap:12px;padding:13px 16px;border-top:1px solid #f1f1f5}
.l:first-child{border-top:0}.l .nm{flex:1;font-size:15.5px}
.l .nm small{display:block;color:var(--mut);font-size:12.5px;line-height:1.5}
input,select{font:inherit;font-size:15px;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:#fff}
input:focus{outline:none;border-color:var(--red)}
.b{background:var(--red);color:#fff;border:0;border-radius:10px;padding:9px 15px;font:inherit;font-size:14.5px;cursor:pointer}
.b.g{background:var(--green)}.b.o{background:#f0f0f4;color:var(--ink);border:1px solid var(--line)}
.b[disabled]{opacity:.45;cursor:default}
.tag{font-size:12px;font-weight:700;padding:3px 9px;border-radius:99px;background:#f0f0f4;color:var(--mut)}
.tag.on{background:#dcfce7;color:#166534}.tag.off{background:#fee2e2;color:#991b1b}
.pd{padding:14px 16px;border-top:1px solid #f1f1f5}
.pd .top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.pd .n{font-weight:700;font-size:16px}
.pd .end{color:var(--mut);font-size:13.5px;margin-top:3px;line-height:1.5}
.acoes{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.mut{color:var(--mut);font-size:13.5px;line-height:1.6}
.aviso{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:12px;padding:13px 15px;font-size:13.5px;line-height:1.6;margin-bottom:18px}
.cod{font-size:30px;font-weight:800;letter-spacing:3px;color:var(--red);margin:8px 0}
</style></head><body>
<header><a class="back" href="/">◂ KDS</a><h1>i<b>Food</b></h1><span id="est" class="tag">—</span></header>
<div class="wrap" id="app">carregando…</div>
<script>
var D=null,LOJA_PINTADA=false;
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
function din(v){return 'R$ '+Number(v||0).toFixed(2).replace('.',',')}
function hora(s){if(!s)return '';var d=new Date(s);return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
async function jget(u){return (await fetch(u,{cache:'no-store'})).json()}
async function jpost(u,b){return (await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})})).json()}
async function carregar(){D=await jget('/api/ifood');pinta()}
function situacao(p){
  if(p.cancelado)return['Cancelado','off'];
  if(p.cancel_pedido)return['Cliente pediu cancelamento','off'];
  if(p.concluido)return['Concluído','on'];
  if(p.despachado)return['Saiu para entrega','on'];
  if(p.confirmado)return['Em produção','on'];
  return ['Aguardando aceite',''];
}
function pinta(){
  var d=D,h='';
  document.getElementById('est').className='tag '+(d.ativo?'on':'off');
  document.getElementById('est').textContent=d.ativo?'ligado':'desligado';
  if(!d.ativo)h+='<div class="aviso"><b>Integração desligada.</b> Enquanto estiver assim, quem recebe os pedidos do iFood é o Consumer — nada muda na operação. Ligue só depois de autorizar esta loja no Portal do Parceiro: o iFood aceita <b>uma integradora por loja</b>, e ao autorizar aqui o Consumer para de receber.</div>';
  // ---- estado ----
  h+='<h2>Situação</h2><div class="card">'+
    '<div class="l"><div class="nm">Receber pedidos do iFood aqui<small>'+(d.pronto?'credencial pronta':'falta credencial — passos abaixo')+'</small></div>'+
      '<button class="b '+(d.ativo?'o':'')+'" onclick="liga('+(d.ativo?'0':'1')+')">'+(d.ativo?'desligar':'ligar')+'</button></div>'+
    '<div class="l"><div class="nm">Aceitar o pedido automaticamente<small>o iFood cobra tempo de aceite; no manual alguém precisa apertar Confirmar em cada pedido</small></div>'+
      '<input type="checkbox" id="auto" '+(d.auto_confirmar?'checked':'')+' onchange="salvar({auto_confirmar:this.checked})" style="width:20px;height:20px"></div>'+
    '<div class="l"><div class="nm">Código de PDV do cardápio<small>o número que já está cadastrado no cardápio do iFood. No Consumer existem dois e eles se sobrepõem — se marcar errado, o pedido vira o prato errado. O item sempre sai conferido pelo nome.</small></div>'+
      '<select onchange="salvar({codigo_pdv:this.value})">'+
        '<option value="variante"'+(d.codigo_pdv!=='produto'?' selected':'')+'>variante (PRODUTODETALHE)</option>'+
        '<option value="produto"'+(d.codigo_pdv==='produto'?' selected':'')+'>produto (PRODUTOS)</option>'+
      '</select></div>'+
    '<div class="l"><div class="nm">Última consulta<small>'+(d.status.ultimo_erro?('<span style="color:#dc2626">'+esc(d.status.ultimo_erro)+'</span>'):('a cada '+d.poll_seg+'s'))+'</small></div>'+
      '<span class="mut">'+(d.status.ultimo_ok?hora(d.status.ultimo_ok):'—')+'</span></div>'+
    '</div>';
  // ---- loja aberta/pausada ----
  h+='<h2>A loja no iFood</h2><div class="card" id="loja"><div class="pd mut">consultando…</div></div>';
  // ---- credencial ----
  h+='<h2>1 · Credencial do app (Portal do Desenvolvedor)</h2><div class="card">'+
    '<div class="l"><div class="nm">Tipo do app<small>centralizado = a loja é do mesmo dono do app (não precisa parear). distribuído = a loja autoriza no Portal do Parceiro, como o Consumer está hoje.</small></div>'+
      '<select onchange="salvar({modo:this.value})">'+
        '<option value="centralizado"'+(d.modo!=='distribuido'?' selected':'')+'>centralizado</option>'+
        '<option value="distribuido"'+(d.modo==='distribuido'?' selected':'')+'>distribuído</option>'+
      '</select></div>'+
    '<div class="l"><div class="nm">client_id<small>'+(d.tem_credencial?'gravado':'cole o do seu app')+'</small></div>'+
      '<input id="cid" value="'+esc(d.client_id)+'" placeholder="uuid do app" style="width:290px"></div>'+
    '<div class="l"><div class="nm">client_secret<small>fica gravado só aqui na loja; nunca é exibido de volta</small></div>'+
      '<input id="csec" type="password" placeholder="••••••••" style="width:290px"></div>'+
    '<div class="l"><div class="nm">Loja (merchant_id)<small>preenche sozinho quando o pareamento acha uma loja só</small></div>'+
      '<input id="mid" value="'+esc(d.merchant_id)+'" placeholder="uuid da loja" style="width:290px"></div>'+
    '<div class="l"><button class="b" onclick="salvarCred()">salvar credencial</button>'+
      '<button class="b o" onclick="testar()">testar e achar a loja</button><span class="mut" id="okc"></span></div>'+
    '<div id="tst"></div></div>';
  // ---- pareamento: só existe no app distribuído ----
  if(d.modo==='distribuido'){
    h+='<h2>2 · Autorizar a loja</h2><div class="card"><div class="l"><div class="nm">'+
      (d.pareado?'Loja já autorizada<small>refaça só se trocar de loja ou se o acesso for revogado no portal</small>':'Gere o código e autorize no Portal do Parceiro<small>o mesmo caminho que o Consumer usou pra ser autorizado</small>')+
      '</div><button class="b o" onclick="parear()">gerar código</button></div><div id="par"></div></div>';
  }
  // ---- pedidos ----
  h+='<h2>Pedidos <span class="mut">('+d.pedidos.length+')</span></h2><div class="card" id="peds">';
  if(!d.pedidos.length)h+='<div class="pd mut">Nenhum pedido ainda. Quando a integração estiver ligada e autorizada, o pedido aparece aqui em até '+d.poll_seg+'s e cai direto na cozinha.</div>';
  d.pedidos.forEach(function(p){
    var s=situacao(p);
    h+='<div class="pd"><div class="top"><span class="n">#'+esc(p.display_id||'')+'</span>'+
      '<span class="tag '+s[1]+'">'+s[0]+'</span>'+
      '<span class="mut">'+hora(p.recebido_em)+' · '+p.itens+' item(ns) · '+din(p.total)+(p.pago_online?' · pago no app':' · A RECEBER')+'</span></div>'+
      '<div class="end">'+esc(p.cliente||'sem nome')+(p.fone?' · '+esc(p.fone):'')+
      (p.endereco?'<br>'+esc(p.endereco):'')+
      (p.agendado_para?'<br>agendado para '+hora(p.agendado_para):'')+
      (p.modo_entrega==='MERCHANT'?'<br><b>entrega nossa</b>':(p.modo_entrega==='IFOOD'?'<br>entregador do iFood':''))+'</div>';
    if(!p.concluido&&!p.cancelado){
      h+='<div class="acoes">';
      if(p.cancel_pedido){
        h+='<button class="b" onclick="cmd(\\''+p.id+'\\',\\'aceitar_cancel\\')">aceitar cancelamento</button>'+
           '<button class="b o" onclick="cmd(\\''+p.id+'\\',\\'negar_cancel\\')">negar</button>';
      }else{
        if(!p.confirmado)h+='<button class="b g" onclick="cmd(\\''+p.id+'\\',\\'confirmar\\')">confirmar</button>';
        if(p.confirmado&&!p.despachado){
          h+=(p.modo_entrega==='MERCHANT')
            ?'<button class="b" onclick="cmd(\\''+p.id+'\\',\\'despachar\\')">saiu para entrega</button>'
            :'<button class="b" onclick="cmd(\\''+p.id+'\\',\\'pronto\\')">pronto para retirada</button>';
        }
        h+='<button class="b o" onclick="cmd(\\''+p.id+'\\',\\'cancelar\\')">cancelar</button>';
        h+='<button class="b o" onclick="imprimir(\\''+p.id+'\\')">imprimir nota</button>';
      }
      h+='</div>';
    }
    h+='</div>';
  });
  h+='</div>';
  document.getElementById('app').innerHTML=h;
  if(!LOJA_PINTADA){LOJA_PINTADA=true;pintaLoja()}
}
async function salvar(b){await jpost('/api/ifood/salvar',b);await carregar()}
async function liga(v){
  var r=await jpost('/api/ifood/salvar',{ativo:v==='1'||v===1});
  if(!r.ok&&r.erro)alert(r.erro);
  await carregar();
}
async function salvarCred(){
  var b={client_id:document.getElementById('cid').value,merchant_id:document.getElementById('mid').value};
  var s=document.getElementById('csec').value;if(s)b.client_secret=s;
  await jpost('/api/ifood/salvar',b);
  document.getElementById('okc').textContent='salvo';
  await carregar();
}
async function testar(){
  var r=await jpost('/api/ifood/testar');
  await carregar(); // re-renderiza: o merchant_id pode ter sido preenchido sozinho
  var el=document.getElementById('tst');if(!el)return;
  if(!r.ok){el.innerHTML='<div class="pd" style="color:#dc2626">'+esc(r.erro)+'</div>';return}
  el.innerHTML='<div class="pd"><div class="mut">Credencial ok. Lojas que ela enxerga:</div>'+
    (r.lojas.length?r.lojas.map(function(l){return '<div style="margin-top:6px"><b>'+esc(l.nome)+'</b><br><span class="mut">'+esc(l.id)+'</span></div>'}).join('')
      :'<div style="margin-top:6px;color:#dc2626">nenhuma — a loja ainda não está vinculada a este app</div>')+'</div>';
}
async function parear(){
  var r=await jpost('/api/ifood/parear');
  var el=document.getElementById('par');
  if(!r.ok){el.innerHTML='<div class="pd" style="color:#dc2626">'+esc(r.erro)+'</div>';return}
  el.innerHTML='<div class="pd"><div class="mut">1. Abra o portal e cole este código '+
    '<b>(vale '+Math.round((r.expira_seg||600)/60)+' minutos)</b>:</div>'+
    '<div class="cod">'+esc(r.codigo)+'</div>'+
    '<a class="b" style="text-decoration:none;display:inline-block" target="_blank" href="'+esc(r.url)+'">abrir o Portal do Parceiro</a>'+
    '<div class="mut" style="margin-top:12px">2. Autorize a loja. O portal devolve um <b>código de autorização</b> — cole abaixo:</div>'+
    '<div class="acoes"><input id="acode" placeholder="código de autorização" style="width:280px">'+
    '<button class="b g" onclick="concluir()">concluir</button></div></div>';
}
async function concluir(){
  var r=await jpost('/api/ifood/concluir',{codigo:document.getElementById('acode').value});
  if(!r.ok){alert(r.erro||'não deu');return}
  alert('Loja autorizada.'+((r.lojas&&r.lojas.length>1)?' Escolha o merchant_id da loja certa: '+r.lojas.map(function(l){return l.nome+' = '+l.id}).join(' | '):''));
  await carregar();
}
async function cmd(id,acao){
  var motivo=null;
  if(acao==='cancelar'){ motivo=await escolherMotivo(id); if(!motivo)return; }
  else{
    var txt={confirmar:'Confirmar este pedido?',despachar:'Marcar que saiu para entrega?',pronto:'Marcar pronto para retirada?',aceitar_cancel:'Aceitar o cancelamento pedido pelo cliente?',negar_cancel:'Negar o cancelamento?'}[acao];
    if(!confirm(txt))return;
  }
  var r=await jpost('/api/ifood/comando',{id:id,acao:acao,motivo:motivo});
  if(!r.ok)alert(r.erro||'não deu');
  await carregar();
}
async function imprimir(id){
  var r=await jpost('/api/ifood/imprimir',{id:id});
  if(!r.ok)alert(r.erro||'nao deu'); 
}
async function pintaLoja(){
  var el=document.getElementById('loja'); if(!el)return;
  var d=await jget('/api/ifood/loja');
  if(!d.ok){el.innerHTML='<div class="pd mut">'+esc(d.erro||'sem status')+'</div>';return}
  var h='<div class="l"><div class="nm">'+(d.aberta?'<b style="color:var(--green)">Loja aberta</b>':'<b style="color:var(--red)">'+esc(d.titulo)+'</b>')+
    '<small>'+(d.motivos.length?esc(d.motivos.join(' · ')):'recebendo pedidos normalmente')+'</small></div></div>';
  if(d.pausas.length){
    d.pausas.forEach(function(x){
      h+='<div class="l"><div class="nm">Pausada'+(x.descricao?': '+esc(x.descricao):'')+'<small>até '+esc(String(x.fim||'').slice(11,16))+'</small></div>'+
        '<button class="b g" onclick="retomar(\''+x.id+'\')">voltar a receber</button></div>';
    });
  }else{
    h+='<div class="l"><div class="nm">Pausar o recebimento<small>o iFood reabre sozinho na hora marcada; o horário de funcionamento não muda</small></div>'+
      '<button class="b o" onclick="pausar(15)">15 min</button>'+
      '<button class="b o" onclick="pausar(30)">30 min</button>'+
      '<button class="b o" onclick="pausar(60)">1 h</button></div>';
  }
  el.innerHTML=h;
}
async function pausar(min){
  var motivo=prompt('Pausar '+min+' min. Motivo (aparece no iFood):','Cozinha cheia');
  if(motivo===null)return;
  var r=await jpost('/api/ifood/pausar',{minutos:min,motivo:motivo});
  if(!r.ok)alert(r.erro||'nao deu');
  await pintaLoja();
}
async function retomar(id){
  if(!confirm('Voltar a receber pedidos agora?'))return;
  var r=await jpost('/api/ifood/retomar',{id:id});
  if(!r.ok)alert(r.erro||'nao deu');
  await pintaLoja();
}
async function escolherMotivo(id){
  var d=await jget('/api/ifood/motivos?id='+encodeURIComponent(id));
  if(!d.ok||!d.motivos.length){alert('O iFood não devolveu motivos de cancelamento para este pedido'+(d.erro?': '+d.erro:'. Pode ser que ele não aceite mais cancelamento.'));return null}
  var txt='CANCELAR este pedido no iFood.\n\nEscolha o motivo (digite o número):\n\n';
  d.motivos.forEach(function(m,i){txt+=(i+1)+') '+m.descricao+'\n'});
  var esc=prompt(txt,'1'); if(!esc)return null;
  var m=d.motivos[Number(esc)-1];
  if(!m){alert('Número inválido');return null}
  if(!confirm('Cancelar por: '+m.descricao+'?'))return null;
  return m;
}
carregar();setInterval(carregar,15000);
// o estado da loja tem ritmo próprio: a lista atualiza de 15 em 15s, mas
// consultar o Merchant a cada 15s seria bater na API à toa.
pintaLoja();setInterval(pintaLoja,60000);
</script></body></html>`;

const TEMPOS_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${LOJA_NOME} — Tempo de preparo</title><style>
:root{--bg:#f2f2f5;--card:#fff;--line:#e3e3e9;--ink:#1b1b20;--mut:#6e6e78;--gold2:#e0651a;--green:#15a34a}
*{box-sizing:border-box}body{margin:0;font-family:'Outfit',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{background:#fff;border-bottom:1px solid var(--line);padding:13px 20px;display:flex;align-items:center;gap:12px}
h1{font-size:18px;margin:0}h1 b{color:var(--gold2)}
.back{background:#f0f0f4;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:7px 13px;font:inherit;font-size:14px;text-decoration:none}
.wrap{max-width:720px;margin:0 auto;padding:22px 20px 60px}
h2{font-size:15px;color:var(--mut);font-weight:500;margin:26px 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.l{display:flex;align-items:center;gap:12px;padding:13px 16px;border-top:1px solid #f1f1f5}
.l:first-child{border-top:0}.l .nm{flex:1;font-size:15.5px}
.l .nm small{display:block;color:var(--mut);font-size:12.5px}
input{width:86px;font:inherit;font-size:16px;padding:9px 11px;border:1px solid var(--line);border-radius:10px;text-align:center}
input:focus{outline:none;border-color:var(--gold2)}
.un{color:var(--mut);font-size:13.5px}
.mut{color:var(--mut);font-size:13.5px;line-height:1.55}
.add{display:flex;gap:9px;margin-top:10px}
.add input[type=search]{flex:1;width:auto;text-align:left}
.sug{background:#fff;border:1px solid var(--line);border-radius:12px;margin-top:6px;overflow:hidden}
.sug div{padding:11px 14px;border-top:1px solid #f1f1f5;cursor:pointer;font-size:14.5px}
.sug div:first-child{border-top:0}.sug div:hover{background:#faf5ef}
.rm{color:#dc2626;background:none;border:0;font-size:17px;cursor:pointer}
.ok{color:var(--green);font-size:13px;font-weight:700;min-width:56px}
</style></head><body>
<header><a class="back" href="/">◂ KDS</a><h1>Tempo de <b>preparo</b></h1></header>
<div class="wrap" id="app">carregando…</div>
<script>
var D=null,tmr={};
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
async function jget(u){return (await fetch(u,{cache:'no-store'})).json()}
async function jpost(u,b){return (await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)})).json()}
async function carregar(){D=await jget('/api/tempos');pinta();pintaGrupos();pintaImp()}
async function pintaImp(){
  var d=await jget('/api/impressora');
  var el=document.getElementById('imp');if(!el)return;
  var m=d.modo||'kds';
  var algumaPraca=(d.pracas||[]).some(function(a){return a.ip});
  var h='<div class="l"><div class="nm">Onde a comanda aparece<small>KDS = as telas/tablets · impressora = cupom na térmica</small></div>'+
    '<select id="imodo" onchange="salvaImp()" style="font:inherit;font-size:15px;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:#fff">'+
      '<option value="kds"'+(m==='kds'?' selected':'')+'>Só no KDS</option>'+
      '<option value="ambos"'+(m==='ambos'?' selected':'')+'>KDS + impressora</option>'+
      '<option value="impressora"'+(m==='impressora'?' selected':'')+'>Só na impressora</option>'+
    '</select><span class="ok" id="ok-im"></span></div>'+
    '<div class="l"><div class="nm">Impressora do caixa (a conta sai nela)<small>e padrão de praça sem impressora própria</small></div>'+
    '<input id="iip" type="text" value="'+esc(d.ip||'')+'" placeholder="192.168.10.9" style="width:150px;text-align:left" onchange="salvaImp()">'+
    '<button class="back" style="cursor:pointer" onclick="testeImp()">testar</button></div>';
  (d.pracas||[]).forEach(function(a){
    h+='<div class="l"><div class="nm">'+esc(a.nome)+'<small>'+(a.ip?('imprime em '+esc(a.ip)):(d.ip?('sem IP próprio — usa a do caixa ('+esc(d.ip)+')'):'sem impressora'))+'</small></div>'+
      '<input type="text" value="'+esc(a.ip||'')+'" placeholder="IP da praça" style="width:150px;text-align:left" onchange="salvaImpPraca('+a.codigo+',this.value)">'+
      '<button class="back" style="cursor:pointer" onclick="testeImp('+a.codigo+')">testar</button>'+
      '<span class="ok" id="ok-ip'+a.codigo+'"></span></div>';
  });
  if(m!=='kds'&&!d.ip&&!algumaPraca)h+='<div class="l" style="color:#dc2626;font-size:13.5px">Modo com impressora, mas NENHUM IP preenchido — comanda não vai sair em papel.</div>';
  if(d.ultimo&&d.ultimo.quando)h+='<div class="l mut" style="font-size:12.5px">última impressão: '+(d.ultimo.ok?'ok':'FALHOU — '+esc(d.ultimo.erro||''))+' ('+esc(d.ultimo.oque||'')+')</div>';
  el.innerHTML=h;
}
async function salvaImp(){
  var r=await jpost('/api/impressora',{modo:(document.getElementById('imodo')||{}).value,ip:((document.getElementById('iip')||{}).value||'').trim()});
  if(!r.ok){alert(r.erro||'não salvou');pintaImp();return}
  await pintaImp();marcaOk('ok-im');
}
async function salvaImpPraca(cod,v){
  var r=await jpost('/api/impressora',{area_codigo:cod,ip:(v||'').trim()});
  if(!r.ok){alert(r.erro||'não salvou');pintaImp();return}
  await pintaImp();marcaOk('ok-ip'+cod);
}
async function testeImp(cod){
  if(cod==null){
    var r0=await jpost('/api/impressora',{modo:(document.getElementById('imodo')||{}).value,ip:((document.getElementById('iip')||{}).value||'').trim()});
    if(!r0.ok){alert(r0.erro||'não salvou');return}
  }
  var r=await jpost('/api/impressora/teste',cod!=null?{area_codigo:cod}:{});
  alert(r.ok?'Enviado! Confere o cupom na impressora.':(r.erro||'não imprimiu'));
  pintaImp();
}
async function pintaGrupos(){
  var d=await jget('/api/grupos-ocultos');
  var el=document.getElementById('grupos');if(!el)return;
  el.innerHTML=(d.grupos||[]).map(function(g){
    return '<div class="l"><label class="nm" style="cursor:pointer;display:flex;gap:10px;align-items:center">'+
      '<input type="checkbox" '+(g.oculto?'':'checked')+
      ' onchange=\\'togGrupo('+JSON.stringify(g.categoria).replace(/'/g,"&#39;")+',this.checked)\\' '+
      'style="width:20px;height:20px">'+esc(g.categoria)+'</label></div>';
  }).join('')||'<div class="l"><div class="nm mut">nenhum grupo</div></div>';
}
async function togGrupo(cat,visivel){await jpost('/api/grupo-ocultar',{categoria:cat,oculto:!visivel})}
function pinta(){
  var h='<h2 style="margin-top:0">Comanda — KDS e impressora</h2>'+
    '<div class="card" id="imp" style="padding:2px 16px">carregando…</div>'+
    '<div class="mut" style="margin-top:26px">Quanto tempo cada praça tem pra entregar. Passou disso, o pedido fica <b>vermelho</b> no KDS. '+
    'Passou do <b>dobro</b>, o alarme fica mais alto e insistente.</div>'+
    '<h2>Por praça</h2><div class="card">';
  D.areas.forEach(function(a){
    h+='<div class="l"><div class="nm">'+esc(a.nome)+
      (a.minutos==null?'<small>usando o padrão de '+D.padrao+' min</small>':'')+'</div>'+
      '<input type="number" inputmode="numeric" min="0" max="600" value="'+(a.minutos==null?D.padrao:a.minutos)+'" '+
      'onchange="salvaArea('+a.codigo+',this.value)"><span class="un">min</span>'+
      '<span class="ok" id="ok-a'+a.codigo+'"></span></div>';
  });
  h+='</div><h2>O que o cliente vê no cardápio</h2>'+
     '<div class="mut">Desmarque o que não deve aparecer pra quem pede pela mesa. '+
     'O garçom continua vendo tudo. (Serviço e a maioria dos complementos já saem sozinhos, '+
     'pela marcação do Consumer.)</div><div class="card" id="grupos" style="margin-top:10px">carregando…</div>'+
     '<h2>Pratos que demoram mais</h2>'+
    '<div class="mut">Minutos <b>somados</b> ao tempo da praça. Uma picanha na Cozinha de 20min com +15 vira 35min só pra ela.</div>'+
    '<div class="card" style="margin-top:10px">';
  if(!D.pratos.length) h+='<div class="l"><div class="nm mut">nenhum prato com tempo extra</div></div>';
  D.pratos.forEach(function(p){
    h+='<div class="l"><div class="nm">'+esc(p.nome||('produto '+p.codigo_pdv))+'</div>'+
      '<input type="number" inputmode="numeric" min="0" max="600" value="'+p.minutos_extra+'" '+
      'onchange="salvaPrato('+p.codigo_pdv+',this.value)"><span class="un">min a mais</span>'+
      '<button class="rm" onclick="salvaPrato('+p.codigo_pdv+',0)" title="remover">✕</button></div>';
  });
  h+='</div><div class="add"><input type="search" id="q" placeholder="buscar prato pra dar tempo extra…" oninput="buscar(this.value)"></div>'+
     '<div class="sug" id="sug" style="display:none"></div>';
  document.getElementById('app').innerHTML=h;
}
var deb=null;
function buscar(v){
  clearTimeout(deb);
  var s=document.getElementById('sug');
  if(!v||v.length<2){s.style.display='none';return}
  deb=setTimeout(async function(){
    var d=await jget('/api/venda/busca?q='+encodeURIComponent(v));
    s.style.display='block';
    s.innerHTML=d.produtos.length?d.produtos.slice(0,8).map(function(p){
      return '<div onclick="novoPrato('+p.codigo_pdv+')">'+esc(p.nome)+(p.tamanho?' <span class="un">['+esc(p.tamanho)+']</span>':'')+'</div>';
    }).join(''):'<div class="mut">nada encontrado</div>';
  },250);
}
async function novoPrato(cod){
  var m=prompt('Quantos minutos A MAIS esse prato leva?','10');
  if(m===null)return;
  await jpost('/api/tempos',{codigo_pdv:cod,minutos:Number(m)});
  document.getElementById('q').value='';document.getElementById('sug').style.display='none';
  carregar();
}
function marcaOk(id){var e=document.getElementById(id);if(!e)return;e.textContent='salvo ✓';
  clearTimeout(tmr[id]);tmr[id]=setTimeout(function(){e.textContent=''},1800)}
async function salvaArea(cod,v){await jpost('/api/tempos',{area_codigo:cod,minutos:Number(v)});marcaOk('ok-a'+cod)}
async function salvaPrato(cod,v){await jpost('/api/tempos',{codigo_pdv:cod,minutos:Number(v)});carregar()}
carregar();
</script></body></html>`;

// ---- /mesa?n=12 — o que o CLIENTE vê no QR da mesa ----
// Fica no servidor da loja: funciona no Wi-Fi da casa sem depender de internet.
const MESA_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${LOJA_NOME}</title><style>
:root{--bg:#f2f2f5;--ink:#1b1b20;--mut:#6e6e78;--gold2:#e0651a;--green:#15a34a;--line:#e3e3e9}
*{box-sizing:border-box}body{margin:0;font-family:'Outfit',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh}
.wrap{max-width:460px;margin:0 auto;padding:28px 20px}
h1{font-size:22px;margin:0 0 2px}h1 b{color:var(--gold2)}
.mesa{color:var(--mut);font-size:15px;margin-bottom:26px}
.b{display:block;width:100%;border:0;border-radius:16px;font:inherit;font-size:18px;font-weight:700;padding:20px;margin-top:14px;cursor:pointer;color:#fff;background:var(--gold2)}
.b.g{background:#5b5b66}
.ok{background:#eafaf0;border:1px solid #bfe9cf;border-radius:16px;padding:22px;text-align:center;margin-top:18px}
.ok .t{font-size:19px;font-weight:800;color:#0f8a3e}
.mut{color:var(--mut);font-size:14px;line-height:1.5}
input{width:100%;font:inherit;font-size:17px;padding:14px;border:1px solid var(--line);border-radius:12px;margin-top:10px}
.b.ver{background:#5b5b66}.b.pix{background:#0f8a3e}.b.cart{background:#2563eb}
.b.zap{background:#25d366}
/* forma de pagamento: legenda embaixo do nome, e o apagado pra forma que
   ainda não está liberada — some do caminho sem sumir da tela, pra pessoa
   entender que existe e não ficar procurando */
.b small{display:block;font-size:13px;font-weight:400;opacity:.85;margin-top:3px}
.b.off{background:#e6e6ec;color:#9a9aa4;cursor:not-allowed}
.b.off small{opacity:1;color:#9a9aa4}
.cont{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);border-radius:14px;
  padding:12px 14px;margin-top:10px;font-size:15.5px}
.cont span{flex:1}.cont b{min-width:30px;text-align:center;font-size:21px}
.cont button{width:42px;height:42px;border-radius:11px;border:1px solid var(--line);background:#f6f6fa;
  font-size:22px;font-weight:700;cursor:pointer;color:var(--ink);padding:0}
.codigo{font-family:Menlo,monospace;font-size:19px;letter-spacing:.1em;text-align:center;
  background:#fff;border:1px solid var(--line);border-radius:11px;padding:12px;margin-top:8px}
.passou{background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px;margin-top:10px;
  text-align:center;font-size:15px;color:var(--mut)}
.passou b{color:var(--ink);font-size:19px}
.bolas{display:flex;gap:7px;justify-content:center;flex-wrap:wrap;margin-top:9px}
.bo{width:14px;height:14px;border-radius:50%;background:#e4e4ea;border:1px solid #d2d2da}
.bo.on{background:#15a34a;border-color:#15a34a}
.valor{font-size:38px;font-weight:800;letter-spacing:-.5px}
.aviso{background:#fff7e3;border:1px solid #f0d68f;border-radius:14px;padding:15px;font-size:14.5px;line-height:1.5;margin:8px 0 4px}
.qr{width:100%;max-width:280px;display:block;margin:16px auto;border-radius:12px;background:#fff;padding:10px}
.copia{background:#fff;border:1px solid var(--line);border-radius:10px;padding:11px;font-family:Menlo,monospace;
  font-size:11px;word-break:break-all;line-height:1.4;max-height:110px;overflow:auto;
  /* precisa dar pra segurar e copiar na mão: em HTTP o copiar automático
     nem sempre funciona, e este é o plano B do cliente */
  -webkit-user-select:text;user-select:text;-webkit-touch-callout:default}
.b.ped{background:var(--gold2)}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:13px 15px;margin-top:12px}
.card .lin{display:flex;justify-content:space-between;padding:4px 0;font-size:14.5px}
.cats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0;max-height:264px;overflow-y:auto}
.cat{background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:12px 8px;font:inherit;font-size:13px;
  cursor:pointer;color:var(--ink);text-align:center;min-height:60px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:3px;line-height:1.2}
.cat span{font-size:11px;color:var(--mut)}
.cabg{display:flex;align-items:center;gap:10px;padding:10px 0;font-size:15px}
.voltag{background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 11px;font:inherit;font-size:13px;cursor:pointer}
.pr{display:flex;justify-content:space-between;gap:10px;align-items:center;background:#fff;border:1px solid var(--line);
  border-radius:11px;padding:12px 13px;margin-top:7px;cursor:pointer;font-size:15px}
.pr:active{background:#faf5ef}
.pr.escolhida{border-color:var(--gold2);background:rgba(224,101,26,.09)}
.pr.escolhida .pn{color:var(--gold2);font-weight:700}
.pr.off{opacity:.45;cursor:default;background:#fafafa}
.pr .pn small{display:block;color:var(--mut);font-size:11.5px}
.pr .pv{color:var(--gold2);font-weight:700;white-space:nowrap}
#cart{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);
  box-shadow:0 -4px 18px rgba(0,0,0,.12);max-height:56vh;overflow:auto;z-index:9}
#cart .cin{max-width:460px;margin:0 auto;padding:12px 20px 16px}
#cart .ci{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f1f1f4;font-size:14.5px}
#cart .ci span{flex:1}
#cart .ci button{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:#f7f7fa;
  font-size:18px;font-weight:700;cursor:pointer;color:var(--ink);padding:0;margin:0}
#cart .ct{display:flex;justify-content:space-between;padding:11px 0 9px;font-size:15px}
#cart .jt{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:#f7f7fa;
  font-size:15px;cursor:pointer;color:var(--mut);padding:0;flex:none}
#cart .jt.on{border-color:var(--gold2);background:rgba(224,101,26,.12);color:var(--gold2);font-weight:800}
.jmark{display:block;color:var(--gold2);font-size:11.5px;margin-top:2px;font-weight:700}
.jdica{background:#fff7e3;border:1px solid #f0d68f;border-radius:10px;padding:9px 11px;font-size:12.5px;
  color:#8a4b06;margin-top:8px;line-height:1.4}
/* REVISÃO EM TELA CHEIA: o último olhar antes de mandar pra cozinha — pedido
   do dono (23/08) pra ficar claro demais o que está sendo pedido, e reduzir
   pedido duplicado por insegurança/ansiedade do cliente na hora de confirmar.
   body.revcheia esconde o resto (cabeçalho/carrinho fixo) e vira um
   flex-column de 3 blocos: topo fixo, lista rolável, rodapé fixo com o botão
   — como um confirm nativo, não como mais uma tela do fluxo. */
body.revcheia{padding-bottom:0}
body.revcheia #app{position:fixed;inset:0;z-index:50;background:var(--bg,#f7f7f9);
  display:flex;flex-direction:column;padding:0}
.revtop{flex:none;padding:22px 18px 14px;background:#fff;border-bottom:1px solid var(--line)}
.revtop h1{font-size:24px;margin:0}
.revlista{flex:1;overflow-y:auto;padding:14px 16px 10px;-webkit-overflow-scrolling:touch}
.revrodape{flex:none;padding:14px 16px calc(16px + env(safe-area-inset-bottom));
  background:#fff;border-top:1px solid var(--line);box-shadow:0 -6px 18px rgba(0,0,0,.06)}
.rev{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid var(--line);
  border-radius:14px;padding:16px 15px;margin-bottom:10px}
.rev .rq{font-weight:800;color:#fff;background:var(--gold2);font-size:16px;min-width:38px;
  height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none}
.rev .rn{flex:1;font-size:18px;font-weight:600;line-height:1.3}
.rev .rn b{font-weight:800}
.rev .rv{font-weight:800;white-space:nowrap;font-size:17px}
.rev .rx{background:#f4f4f7;border:1px solid var(--line);color:var(--mut);border-radius:10px;
  width:38px;height:38px;font:inherit;font-size:16px;cursor:pointer;flex:none}
.rev .rx:active{background:#ffe9e9;color:var(--red)}
.revt{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:17px}
.revt b{font-size:25px;color:var(--gold2)}
.revrodape .b{font-size:17px;padding:16px}
#btnConfirmarPedido:disabled{opacity:.65}
body{padding-bottom:120px}
/* observacao do item: as sugestoes que a casa ja cadastrou pro grupo */
.obsl{display:flex;flex-wrap:wrap;gap:8px}
.ob{background:#fff;border:1.5px solid var(--line);border-radius:11px;padding:10px 13px;font:inherit;
  font-size:14px;cursor:pointer;color:var(--ink)}
.ob.on{border-color:var(--gold2);background:rgba(224,101,26,.1);color:var(--gold2);font-weight:700}
.obsv{display:block;color:var(--gold2);font-size:12px;margin-top:2px}
/* confirmacao GRANDE — tem que dar pra ler de longe, com a mesa cheia */
.enviadao{background:#0f8a3e;color:#fff;border-radius:20px;padding:36px 22px;text-align:center;margin-top:14px}
.enviadao .tick{font-size:64px;line-height:1}
.enviadao .t1{font-size:31px;font-weight:800;letter-spacing:.02em;margin-top:10px;line-height:1.1}
.enviadao .t2{font-size:31px;font-weight:800;letter-spacing:.02em;line-height:1.1}
.enviadao .t3{font-size:15px;opacity:.9;margin-top:12px}
/* o que ja pedi */
/* cabeçalho de bloco no "já pedi": separa o que é da mesa do que é de cada
   comanda, pra dar pra saber de quem foi o quê */
.jcab{font-size:13px;font-weight:700;color:var(--gold2);margin:14px 0 6px;
  padding-bottom:4px;border-bottom:1px solid var(--line)}
.jcab:first-child{margin-top:0}
.ja{display:flex;align-items:flex-start;gap:10px;background:#fff;border:1px solid var(--line);
  border-left:4px solid #d2d2da;border-radius:11px;padding:12px 13px;margin-top:8px;font-size:15px}
/* Cor conta a historia sem ler: VERMELHO = a cozinha ainda esta fazendo,
   AMBAR = pronto, saindo, VERDE = ja esta na sua mesa. O estado antigo
   deixava o entregue cinza e apagado, entao o que ja chegou parecia o que
   menos importava — e' o contrario: e' o que tranquiliza. */
.ja.preparando{border-left-color:#d33a2c;background:#fffafa}
.ja.preparando .st{color:#c0392b;font-weight:700}
.ja.pronto{border-left-color:#e0a413}
.ja.pronto .st{color:#a97608;font-weight:700}
.ja.entregue{border-left-color:#17803d;background:#f6fcf8}
.ja.entregue .st{color:#17803d;font-weight:700}
.ja .q{font-weight:700;color:var(--gold2);min-width:26px}
.ja .n{flex:1}
.ja .st{font-size:11.5px;color:var(--mut);white-space:nowrap;align-self:center}
.ja .hr{display:block;color:var(--mut);font-size:11.5px;margin-top:3px}
.aovivo{font-size:10.5px;background:#eafaf0;color:#0f8a3e;border:1px solid #bfe9cf;border-radius:20px;padding:1px 8px;font-weight:700}
.tit2{font-size:13px;color:var(--mut);margin:16px 0 6px}
.segs{display:flex;gap:7px;flex-wrap:wrap}
.seg{flex:1;min-width:64px;background:#fff;border:1.5px solid var(--line);border-radius:11px;padding:11px 6px;
  font:inherit;font-size:14px;cursor:pointer;color:var(--mut)}
.seg.on{border-color:var(--gold2);background:rgba(224,101,26,.09);color:var(--gold2);font-weight:700}
/* seletor do que pagar (mesa toda x cada comanda): cada opção mostra o valor,
   pra pessoa escolher sem ter que fazer conta de cabeça */
.segs.alvos{gap:8px;margin:10px 0 2px}
.segs.alvos .seg{flex:1 1 46%;min-width:130px;text-align:left;padding:11px 12px;line-height:1.2;color:var(--ink)}
.segs.alvos .seg small{display:block;color:var(--mut);font-size:12px;font-weight:400;margin-top:3px}
.avisoc{background:#fdecea;border:1.5px solid #f1b0a8;color:#a3271b;border-radius:11px;
  padding:11px 13px;margin-top:10px;font-weight:700;font-size:14px}
.segs.alvos .seg.on small{color:var(--gold2)}
/* campo de valor livre: grande, teclado numérico, difícil de não achar */
.vlivre{display:flex;align-items:center;gap:9px;background:#fff;border:1.5px solid var(--line);
  border-radius:12px;padding:4px 12px;margin-top:2px}
.vlivre span{color:var(--mut);font-size:17px;font-weight:700}
.vlivre input{flex:1;border:0;outline:none;font:inherit;font-size:24px;font-weight:700;
  padding:10px 0;color:var(--gold2);background:transparent;min-width:0}
.b.op{background:#fff;color:var(--ink);border:1.5px solid var(--line);text-align:left;font-weight:600}
.b.op:active{background:#f4f4f7}
.itens{display:flex;flex-direction:column;gap:8px}
.it{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;
  background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;
  font:inherit;text-align:left;cursor:pointer;color:var(--ink)}
.it b{font-size:15.5px}
.it span{color:var(--mut);font-size:12.5px}
.it.on{border-color:#c0392b;background:#fdf3f1;box-shadow:0 0 0 3px rgba(192,57,43,.10)}
.it.on b{color:#a3271b}
.vlivre .vx{background:#f0f0f4;border:1px solid var(--line);color:var(--mut);border-radius:8px;
  width:32px;height:32px;font:inherit;cursor:pointer;flex:none}
/* foto do produto: miniatura na lista e a versão grande ao tocar */
.pr .pfoto{width:52px;height:52px;object-fit:cover;border-radius:9px;flex:none;background:#eee;cursor:zoom-in}
.pr .pn small.pdesc{display:block;color:var(--mut);font-size:11.5px;line-height:1.35;margin-top:2px;
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
#lightbox{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.88);display:none;
  align-items:center;justify-content:center;padding:18px}
#lightbox .lbox{max-width:520px;width:100%;text-align:center}
#lightbox img{width:100%;max-height:64vh;object-fit:contain;border-radius:14px;background:#111}
#lightbox .lbt{color:#fff;font-size:19px;font-weight:700;margin-top:14px}
#lightbox .lbd{color:#d9d9de;font-size:14px;line-height:1.5;margin-top:8px}
#lightbox .lbf{color:#8a8a95;font-size:12px;margin-top:16px}
/* botao redondo de fechar: o texto "toque pra fechar" sozinho nao parecia
   clicavel e as pessoas ficavam presas na foto */
#lightbox .lbx{position:fixed;top:14px;right:14px;width:44px;height:44px;border-radius:50%;
  border:1.5px solid rgba(255,255,255,.35);background:rgba(0,0,0,.55);color:#fff;
  font-size:21px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
  -webkit-tap-highlight-color:transparent}
#lightbox .lbx:active{background:rgba(255,255,255,.2)}

</style></head><body><div class="wrap" id="app"></div>
<script>
var MESA=new URLSearchParams(location.search).get('n');
// ---- sessao da mesa ----
// Trocar de app e voltar nao pode perder a mesa (o Android recarrega a
// pagina), mas TAMBEM nao pode deixar pedir numa mesa que ja e' de outra
// pessoa. Guardamos a mesa + qual CONTA estava aberta; o servidor recusa se
// a conta trocou ou se passou do tempo.
var SES=null;
function lerSes(){ try{return JSON.parse(sessionStorage.getItem('prainha_mesa')||'null')}catch(e){return null} }
function gravaSes(v){ try{sessionStorage.setItem('prainha_mesa',JSON.stringify(v))}catch(e){} SES=v; }
function limpaSes(){ try{sessionStorage.removeItem('prainha_mesa')}catch(e){} SES=null; }
// Veio da CAMERA (URL com ?n=) -> sessao NOVA. Escanear o QR e' a prova de
// que a pessoa esta na mesa agora; reusar a sessao velha fazia o relogio
// contar desde o escaneamento ANTERIOR e barrava quem tinha acabado de chegar.
// desde=null: quem carimba o tempo e' o servidor, na primeira validacao.
// Date.now() do aparelho nao serve — o relogio dele (ou o da loja) pode estar
// errado, e ja esteve: 4h de diferenca fazia toda sessao nascer expirada.
if(MESA){ gravaSes({mesa:Number(MESA),comanda:null,desde:null}); }
else { var g=lerSes(); if(g&&g.mesa){ MESA=String(g.mesa); SES=g; } }
// ⚠️ A MESA MORA NA URL. Ela vivia so no sessionStorage, que e' POR ABA e some
// quando o navegador descarta a aba. Fechando e reabrindo a tela o aparelho
// podia restaurar OUTRA aba, de um escaneamento antigo, e o cliente que estava
// na mesa 15 aparecia na mesa 1 — pedindo na conta de outra pessoa. Fixando o
// numero na URL, o que o celular guarda no historico ja carrega a mesa certa,
// e da pra CONFERIR o numero na barra de endereco quando houver duvida.
if(MESA){ try{ if(new URLSearchParams(location.search).get('n')!==String(MESA))
  history.replaceState({app:1},'','/mesa?n='+encodeURIComponent(MESA)); }catch(e){} }

/** Confere com o servidor antes de qualquer acao que valha dinheiro.
 *  Guarda o "ok" por poucos segundos: inicio() e telaPedir() chamam em
 *  sequencia, e em rede lenta (o Wi-Fi da loja, no celular do cliente) cada
 *  ida-e-volta atrasa a tela. A sessao vale 60 min — 6 segundos de folga aqui
 *  nao afrouxa nada. */
var _sesOk=0;
async function sessaoOk(){
  var n=MESA?Number(MESA):null;
  if(!n)return true; // sem mesa ainda: a propria tela pede o numero
  if(Date.now()-_sesOk<6000)return true;
  // ⚠️ NADA DE CRASE NESTE COMENTARIO: a tela inteira e' um template literal,
  // e uma crase aqui fecha a string e derruba o arquivo (foi o que aconteceu
  // ao escrever este proprio comentario, em 01/08).
  // O t (quando a sessao nasceu) vai SEMPRE, mesmo sem comanda. Antes ele so
  // era enviado junto com a comanda — entao o celular que pegou a mesa vazia
  // nao mandava nada e o servidor nao tinha como saber que a mesa foi fechada
  // depois. Era assim que o aparelho do cliente anterior continuava colado.
  var q='/api/mesa/sessao?n='+n+
    (SES&&SES.comanda!=null?'&c='+SES.comanda:'')+
    (SES&&SES.desde!=null?'&t='+SES.desde:'');
  var r;try{r=await (await fetch(q,{cache:'no-store'})).json()}catch(e){return true} // sem rede: nao trava
  if(r.ok){
    // primeira validacao apos escanear: fixa qual conta estava aberta, mantendo
    // o instante do escaneamento (nao reinicia o relogio a cada checagem)
    if(!SES||SES.comanda==null) gravaSes({mesa:n,comanda:r.comanda_codigo,desde:(SES&&SES.desde)||r.agora});
    else if(SES.comanda!==r.comanda_codigo) gravaSes({mesa:n,comanda:r.comanda_codigo,desde:r.agora});
    _sesOk=Date.now();
    return true;
  }
  _sesOk=0;
  limpaSes();
  telaReescanear(r.aviso||'Escaneie o QR da mesa pra continuar.');
  return false;
}
function telaReescanear(msg){
  var tinha=CART.length;
  MESA=null;CART=[];renderCarrinho();
  app('<h1>Escaneie o QR da mesa</h1>'+
    '<div class="aviso" style="margin-top:12px">'+esc(msg)+'</div>'+
    (tinha?'<div class="mut" style="margin-top:10px">Seu carrinho foi limpo por segurança — o pedido precisa ir pra conta certa.</div>':'')+
    '<div class="mut" style="margin-top:14px">É rápido: aponte a câmera pro código que está na sua mesa.</div>');
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
// O cliente chega aqui pela CAMERA do celular. Sem mexer no historico, o botao
// "voltar" do Android fecha a pagina e joga ele de volta na camera — parecia
// que o sistema tinha travado. Cada tela interna empilha uma entrada; o voltar
// traz pro inicio, e so do inicio e' que ele realmente sai.
var NOINICIO=true;
function app(h){
  document.getElementById('app').innerHTML=h;
  window.scrollTo(0,0);
  if(NOINICIO){ NOINICIO=false; try{history.pushState({app:1},'')}catch(e){} }
}
window.addEventListener('popstate',function(){ NOINICIO=true; inicio(); });
var EU=null, CART=[], CATS=null;
async function inicio(){
  NOINICIO=true; // daqui, o proximo "voltar" do Android sai mesmo
  if(MESA&&!(await sessaoOk()))return;
  var n=MESA?Number(MESA):null;
  if(n)EU=await (await fetch('/api/cliente/historico?n='+n,{cache:'no-store'})).json();
  var saud=(EU&&EU.identificado&&EU.nome)?('Olá, <b>'+esc(EU.nome)+'</b>'):'${LOJA_HTML}';
  var h='<h1>'+saud+'</h1><div class="mesa">'+(MESA?'Mesa '+esc(MESA):'Seja bem-vindo')+'</div>'+
    (MESA?'':'<input id="nm" inputmode="numeric" placeholder="número da sua mesa">');
  if(EU&&EU.identificado){
    // O contador de visitas saiu: é inteligência da casa sobre a pessoa, não
    // serviço pra ela — e ninguém pediu pra ser contado. O botão "O que eu
    // sempre peço", logo abaixo, já entrega o histórico de um jeito útil.
    // (o número continua indo pro garçom, que é quem ganha em saber)
  } else {
    h+='<button class="b g" onclick="telaCadastro()">Quer se identificar? <span style="font-weight:400">(opcional)</span></button>';
  }
  h+='<button class="b ped" onclick="telaPedir()">🍽 Fazer pedido</button>'+
     '<button class="b g" onclick="verJaPedido()">📋 O que já pedi</button>'+
     (EU&&EU.identificado&&EU.itens&&EU.itens.length?'<button class="b g" onclick="telaHistorico()">⭐ O que eu sempre peço</button>':'')+
     '<button class="b ver" onclick="minhaConta()">🧾 Ver minha conta</button>'+
     '<button class="b pix" onclick="telaPix()">💳 Pagar a conta</button>'+
     '<button class="b" onclick="chamar()">🔔 Chamar o garçom</button>'+
     '<button class="b g" onclick="telaProblema()">Relatar um problema</button>'+
     '<div class="mut" style="margin-top:22px">O garçom recebe seus pedidos e avisos na hora.</div>';
  app(h);renderCarrinho();
}
// ---- cadastro do cliente (tudo opcional) ----
// telaCadastro({alvo, depois, motivo, exigeDoc})
//   alvo ..... em QUE número gravar (a mesa, ou a comanda quando o cadastro é
//              exigido pra levar a comanda). Sem isto, gravava sempre na mesa.
//   depois ... o que fazer ao salvar (volta pro fluxo que pediu o cadastro)
//   exigeDoc . CPF ou WhatsApp obrigatório (transferência precisa de rastro)
var CADALVO=null, POSCAD=null, CADEXIGE=false;
function telaCadastro(op){
  CADINFO=null;op=op||{};
  CADALVO=(op.alvo!=null)?op.alvo:null;
  POSCAD=op.depois||null;
  CADEXIGE=!!op.exigeDoc;
  app('<h1>Seu cadastro</h1>'+
    '<div class="mut" style="margin:6px 0 16px">'+esc(op.motivo||'Precisamos do seu CPF pra abrir a conta. O nome vem sozinho.')+'</div>'+
    '<div class="tit2" style="margin-top:0">CPF <span class="mut">(obrigatório)</span></div>'+
    '<input id="ccpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" oninput="olhaCpfCli(this.value,this)">'+
    '<div id="cquem" class="mut" style="margin-top:9px">Digite o CPF — o nome vem sozinho.</div>'+
    '<div id="cpasso2"></div>'+
    '<button class="b g" onclick="inicio()">Agora não</button>');
  var el=document.getElementById('ccpf');if(el)el.focus();
}
var CADINFO=null, cadDeb=null;
// (removida a saída "não quero informar o CPF": o CPF virou obrigatório —
// é ele que identifica quem está consumindo e o que a consulta ao SPC usa)
// ---- CPF: confere na hora, no proprio aparelho ----
// O digito verificador e' aritmetica pura: nao precisa de servidor, nem de
// consulta paga, nem de internet. Errar um numero de telefone e' comum, e sem
// isto a pessoa so descobria depois da ida-e-volta — ou nem descobria, e o CPF
// errado ia parar na NFC-e. O servidor confere de novo: isto aqui e' conforto,
// nao seguranca.
function cpfOk(v){
  var c=String(v||'').replace(/\\D/g,'');
  if(c.length!==11)return false;
  if(/^(\\d)\\1{10}$/.test(c))return false;   // 111.111.111-11 passa na conta e nao existe
  for(var k=0;k<2;k++){
    var len=9+k, pos=10+k, soma=0;
    for(var i=0;i<len;i++) soma+=Number(c[i])*(pos-i);
    var d=(soma*10)%11; if(d===10)d=0;
    if(d!==Number(c[len]))return false;
  }
  return true;
}
// mostra 000.000.000-00 enquanto digita, pra pessoa conferir com o documento
function mascaraCpf(inp){
  var c=String(inp.value||'').replace(/\\D/g,'').slice(0,11);
  var t=c;
  if(c.length>9) t=c.slice(0,3)+'.'+c.slice(3,6)+'.'+c.slice(6,9)+'-'+c.slice(9);
  else if(c.length>6) t=c.slice(0,3)+'.'+c.slice(3,6)+'.'+c.slice(6);
  else if(c.length>3) t=c.slice(0,3)+'.'+c.slice(3);
  if(inp.value!==t)inp.value=t;
  inp.style.color = (c.length===11 && !cpfOk(c)) ? '#c0392b' : '';
  return c;
}
function olhaCpfCli(v,inp){
  CADINFO=null;clearTimeout(cadDeb);
  var d=inp?mascaraCpf(inp):String(v||'').replace(/\\D/g,'');
  var q=document.getElementById('cquem'), p2=document.getElementById('cpasso2');
  if(!q)return;
  if(d.length<11){q.style.color='';q.textContent='Digite o CPF que o nome vem sozinho.';if(p2)p2.innerHTML='';return}
  // barra ANTES de perguntar ao servidor: CPF que nao fecha a conta nao existe
  if(!cpfOk(d)){q.style.color='#c0392b';
    q.textContent='Esse CPF não confere. Dê uma olhada nos números.';
    if(p2)p2.innerHTML='';return}
  q.style.color='';q.textContent='consultando…';
  cadDeb=setTimeout(async function(){
    var r=await (await fetch('/api/venda/identificar?cpf='+d,{cache:'no-store'})).json();
    if(!r.ok){q.style.color='#dc2626';q.textContent=r.erro||'CPF inválido';if(p2)p2.innerHTML='';return}
    q.style.color='';
    if(r.nome){
      CADINFO=r;
      q.innerHTML='Olá, <b style="color:#0f8a3e">'+esc(r.nome_curto)+'</b>!';
      passo2Cli(r.telefone_fim);
    } else if(r.fonte==='erro'){
      q.innerHTML='<span style="color:#b45309">A consulta não respondeu agora. Tente de novo em alguns segundos.</span>';
      if(p2)p2.innerHTML='<button class="b g" onclick="olhaCpfCli(document.getElementById(\\'ccpf\\').value,document.getElementById(\\'ccpf\\'))">Consultar de novo</button>';
    } else {
      q.innerHTML='<span style="color:#b45309">Não achei nome para este CPF. Confira o número.</span>';
      if(p2)p2.innerHTML='';
    }
  },500);
}
// WhatsApp: nao validamos se o numero existe, mas o DDD e' obrigatorio —
// numero sem DDD nao serve pra avisar de reserva nem de mesa pronta.
// Igual a tela do garcom: o cliente NAO digita nome. Ele digita o CPF, o nome
// vem da consulta (cadastro da casa ou SPC), e embaixo o WhatsApp. Sao dois
// campos e pronto.
function passo2Cli(telFim){
  var p2=document.getElementById('cpasso2');if(!p2)return;
  p2.innerHTML='<div class="tit2">WhatsApp'+(telFim?' <span class="mut">· temos o final '+esc(String(telFim).slice(-4))+'</span>':'')+'</div>'+
    '<input id="czap" inputmode="numeric" placeholder="(79) 90000-0000" oninput="olhaZap(this.value)">'+
    '<div id="czapmsg" class="mut" style="margin-top:6px">Com DDD. É por aqui que avisamos quando seu pedido sai e quando sua reserva está pronta.</div>'+
    '<button class="b" onclick="salvarCadastro()">Salvar</button>';
  var z=document.getElementById('czap');if(z)z.focus();
}
function olhaZap(v){
  var d=String(v||'').replace(/\\D/g,'');
  var m=document.getElementById('czapmsg');if(!m)return;
  if(!d){m.style.color='';m.textContent='Com DDD. Usamos pra avisar de reserva e mesa pronta.';return}
  if(d.length<10){m.style.color='#b45309';m.textContent='Falta o DDD — comece pelo 79, 11, 21…';return}
  if(d.length>11){m.style.color='#dc2626';m.textContent='Número muito longo';return}
  m.style.color='#0f8a3e';m.textContent='✓ (' + d.slice(0,2) + ') ' + d.slice(2);
}
async function salvarCadastro(){
  // grava no ALVO: normalmente a mesa, mas a comanda quando o cadastro foi
  // exigido pra levá-la — é lá que o servidor procura o rastro de quem moveu
  var n=(CADALVO!=null)?CADALVO:mesaAtual();if(n===null)return;
  var cpf=((document.getElementById('ccpf')||{}).value||'').replace(/\\D/g,'');
  var zap=((document.getElementById('czap')||{}).value||'').replace(/\\D/g,'');
  var nome=CADINFO?CADINFO.nome:'';
  if(cpf.length!==11){alert('O CPF é obrigatório pra abrir a conta.');return}
  if(!nome){alert('Digite o CPF e espere o nome aparecer.');return}
  if(zap&&zap.length<10){alert('O WhatsApp precisa do DDD (ex.: 79 seguido do número)');return}
  var body={numero:n,nome:nome,cadastrar:true};
  if(cpf.length===11)body.cpf=cpf;
  if(zap.length>=10)body.telefone=zap;
  if(CADINFO&&CADINFO.contato_fb)body.contato_fb=CADINFO.contato_fb;
  var r=await post('/api/venda/identificar',body);
  if(!r.ok){alert(r.erro);return}
  var depois=POSCAD;
  CADINFO=null;CADALVO=null;POSCAD=null;CADEXIGE=false;
  if(depois)depois(); else inicio();
}
// ---- histórico: pedir de novo com um toque ----
function telaHistorico(){
  var h='<h1>O que você sempre pede</h1><div class="mut" style="margin:6px 0 14px">'+
    EU.visitas+' visitas · toque pra adicionar</div>';
  EU.itens.forEach(function(i){
    h+='<div class="pr'+(i.disponivel?'':' off')+'"'+(i.disponivel?' onclick=\\'addCart('+JSON.stringify(i).replace(/'/g,"&#39;")+')\\'':'')+'>'+
      '<span class="pn">'+esc(i.nome)+'<small>'+i.vezes+'x'+(i.disponivel?'':' · indisponível')+'</small></span>'+
      (i.preco?'<span class="pv">R$ '+Number(i.preco).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</span>':'')+'</div>';
  });
  h+='<button class="b g" onclick="inicio()">Voltar</button>';
  app(h);renderCarrinho();
}
// ---- cardápio: mesmo catálogo do garçom ----
async function telaPedir(){
  if(mesaAtual()===null)return;
  // conferir ANTES de deixar montar o carrinho: descobrir que a sessao caiu
  // depois de escolher tudo e' a pior hora possivel.
  if(!(await sessaoOk()))return;
  app('<h1>Cardápio</h1><input type="search" id="bq" placeholder="buscar…" oninput="buscarProd(this.value)">'+
    '<div id="grid" class="cats"><span class="mut">carregando…</span></div><div id="lst"></div>'+
    '<button class="b g" onclick="inicio()">Voltar</button>');
  // Sem try/catch, um soluço de rede deixava a tela em "carregando…" PRA
  // SEMPRE, sem dizer nada — foi assim que o iPhone apareceu "sem grupos".
  // Agora a falha aparece e dá pra tentar de novo.
  if(!CATS){
    try{
      var rc=await fetch('/api/venda/categorias?cliente=1',{cache:'no-store'});
      if(!rc.ok)throw new Error('servidor respondeu '+rc.status);
      CATS=(await rc.json()).categorias||[];
    }catch(e){
      CATS=null;
      var ge=document.getElementById('grid');
      if(ge)ge.innerHTML='<div class="aviso" style="grid-column:1/-1">Não consegui carregar o cardápio.<br>'+
        '<small>'+esc((e&&e.message)||e)+'</small></div>'+
        '<button class="b" style="grid-column:1/-1" onclick="telaPedir()">Tentar de novo</button>';
      return;
    }
  }
  var g=document.getElementById('grid');if(!g)return;
  if(!CATS.length){
    g.innerHTML='<div class="aviso" style="grid-column:1/-1">Nenhum grupo disponível agora.</div>';
    renderCarrinho();return;
  }
  g.innerHTML=CATS.map(function(c){
    return '<button class="cat" onclick=\\'abrirCat('+JSON.stringify(c.categoria).replace(/'/g,"&#39;")+')\\'>'+
      esc(c.categoria)+'<span>'+c.disp+'</span></button>';
  }).join('');
  renderCarrinho();
}
async function abrirCat(nome){
  var d=await (await fetch('/api/venda/categoria?cliente=1&c='+encodeURIComponent(nome),{cache:'no-store'})).json();
  document.getElementById('grid').style.display='none';
  listar(d.produtos,nome);
}
var bdeb=null;
function buscarProd(v){
  clearTimeout(bdeb);
  var g=document.getElementById('grid');
  if(!v){if(g)g.style.display='';document.getElementById('lst').innerHTML='';return}
  if(g)g.style.display='none';
  if(v.length<2)return;
  bdeb=setTimeout(async function(){
    var d=await (await fetch('/api/venda/busca?q='+encodeURIComponent(v)+'&cliente=1',{cache:'no-store'})).json();
    listar(d.produtos,null);
  },300);
}
function listar(ps,titulo){
  var h=titulo?'<div class="cabg"><button class="voltag" onclick="telaPedir()">◂ grupos</button><b>'+esc(titulo)+'</b></div>':'';
  h+=(ps&&ps.length)?ps.map(function(p){
    var brl=function(v){return 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2})};
    // miniatura: a foto é do PRODUTO, então grupo e item usam a mesma
    var mini=p.tem_foto
      ? '<img class="pfoto" src="/produto-foto/'+p.produto_codigo+'" loading="lazy" alt="" '+
        'onclick="event.stopPropagation();fotoGrande('+p.produto_codigo+',\\''+esc(String(p.nome).replace(/'/g,''))+'\\')">'
      : '';
    // GRUPO: produto com várias variantes (Dose/Garrafa, ou a fruta do gin).
    // Uma linha só; ao tocar, a tela pergunta qual — cada uma tem seu preço.
    if(p.grupo){
      var faixa=(p.preco===p.preco_max)?brl(p.preco):(brl(p.preco)+' a '+brl(p.preco_max));
      if(p.sem_estoque)return '<div class="pr off"><span class="pn">'+esc(p.nome)+
        '<small>indisponível</small></span><span class="pv">'+faixa+'</span></div>';
      return '<div class="pr" onclick="verVariantes('+p.produto_codigo+')">'+mini+
        '<span class="pn">'+esc(p.nome)+'<small>'+p.disponiveis+' opções · toque pra escolher</small></span>'+
        '<span class="pv">'+faixa+'</span></div>';
    }
    return '<div class="pr'+(p.sem_estoque?' off':'')+'"'+(p.sem_estoque?'':' onclick=\\'addCart('+JSON.stringify(p).replace(/'/g,"&#39;")+')\\'')+'>'+mini+
      '<span class="pn">'+esc(p.nome)+(p.tamanho?' <small>['+esc(p.tamanho)+']</small>':'')+
      (p.descricao?'<small class="pdesc">'+esc(p.descricao)+'</small>':'')+
      (p.sem_estoque?'<small>indisponível</small>':'')+'</span>'+
      '<span class="pv">'+brl(p.preco)+'</span></div>';
  }).join(''):'<div class="mut" style="padding:14px 2px">nada encontrado</div>';
  document.getElementById('lst').innerHTML=h;
}
// Foto grande + a descrição do prato. Quem quer ver melhor toca na miniatura;
// quem não quer não perde espaço na lista.
async function fotoGrande(prod,nome){
  var d=document.getElementById('lightbox');
  if(!d){d=document.createElement('div');d.id='lightbox';document.body.appendChild(d);
    d.onclick=function(){d.style.display='none'}}
  var desc='';
  try{
    var r=await (await fetch('/api/venda/variantes?p='+prod+'&cliente=1',{cache:'no-store'})).json();
    if(r.ok&&r.produtos.length&&r.produtos[0].descricao)desc=r.produtos[0].descricao;
  }catch(e){}
  d.style.display='flex';
  d.innerHTML='<div class="lbox"><img src="/produto-foto/'+prod+'" alt="">'+
    '<div class="lbt">'+esc(nome||'')+'</div>'+
    (desc?'<div class="lbd">'+esc(desc)+'</div>':'')+
    '<div class="lbf">toque em qualquer lugar pra fechar</div></div>'+
    '<button class="lbx" onclick="fechaFoto(event)" aria-label="fechar">✕</button>';
}
function fechaFoto(e){
  if(e)e.stopPropagation();
  var d=document.getElementById('lightbox');
  if(d)d.style.display='none';
}
async function verVariantes(prod){
  var d;try{d=await (await fetch('/api/venda/variantes?p='+prod+'&cliente=1',{cache:'no-store'})).json()}catch(e){return}
  if(!d.ok||!d.produtos.length){alert('sem opções disponíveis agora');return}
  listar(d.produtos, d.nome);
}
// ---- PERGUNTAS DO PRATO ----
// "Qual o ponto da carne", "Qual o acompanhamento?" — vêm cadastradas no
// Consumer, com mínimo e máximo de respostas, e algumas opções cobram a mais.
// Sem responder, o cliente não pede sozinho metade dos pratos.
var PERG=null, PERGIX=0, PERGRESP=null, PERGPROD=null;
async function addCart(p){
  if(p.sem_estoque||p.disponivel===false)return;
  var w=null;
  try{w=await (await fetch('/api/venda/perguntas?pdv='+p.codigo_pdv,{cache:'no-store'})).json()}catch(e){}
  if(w&&w.ok&&w.perguntas&&w.perguntas.length){
    PERGPROD=p;PERG=w.perguntas;PERGIX=0;
    PERGRESP=w.perguntas.map(function(){return []});
    return pintaPergunta();
  }
  return addCartObs(p);
}
/** Quanto as respostas escolhidas somam ao preço do prato. */
function precoExtra(){
  var t=0;
  (PERGRESP||[]).forEach(function(sel,i){
    sel.forEach(function(c){
      var o=PERG[i].opcoes.find(function(x){return x.codigo===c});
      if(o)t+=Number(o.preco||0);
    });
  });
  return t;
}
function pintaPergunta(){
  // A barra do carrinho é fixa e cresce com os itens — com 2 itens ela passa
  // de 280px e cobre os botões desta tela ("Adicionar ao pedido" sumia atrás).
  // Enquanto responde a pergunta, o carrinho sai da frente; volta sozinho
  // quando a tela muda, porque telaPedir/poeNoCarrinho chamam renderCarrinho.
  var cc=document.getElementById('cart');
  if(cc){cc.style.display='none';folgaCarrinho(cc)}
  var q=PERG[PERGIX], sel=PERGRESP[PERGIX];
  var ilim=!q.max;                       // max 0 no Consumer = quantos quiser
  var lim=(q.min===q.max&&q.min>0)?('escolha '+q.min)
        :(ilim?(q.min?('pelo menos '+q.min):'opcional')
              :('de '+q.min+' a '+q.max));
  var ex=precoExtra();
  app('<h1>'+esc(q.texto)+'</h1>'+
    '<div class="mut" style="margin:6px 0 3px">'+esc(PERGPROD.nome)+' · '+lim+'</div>'+
    '<div class="mut" style="margin-bottom:14px">'+(PERGIX+1)+' de '+PERG.length+
      (ex>0?' · <b style="color:var(--gold2)">+ R$ '+ex.toLocaleString('pt-BR',{minimumFractionDigits:2})+'</b>':'')+'</div>'+
    q.opcoes.map(function(o){
      var on=sel.indexOf(o.codigo)>=0;
      return '<div class="pr'+(on?' escolhida':'')+'" onclick="marcaOpcao('+o.codigo+')">'+
        '<span class="pn">'+(on?'✓ ':'')+esc(o.nome)+'</span>'+
        '<span class="pv">'+(Number(o.preco)>0
          ?'+ R$ '+Number(o.preco).toLocaleString('pt-BR',{minimumFractionDigits:2}):'')+'</span></div>';
    }).join('')+
    '<button class="b ped" onclick="proximaPergunta()">'+
      (PERGIX+1<PERG.length?'Continuar':'Adicionar ao pedido')+'</button>'+
    '<button class="b g" onclick="'+(PERGIX>0?'voltaPergunta()':'cancelaPergunta()')+'">'+
      (PERGIX>0?'◂ Voltar':'Cancelar')+'</button>');
}
function marcaOpcao(cod){
  var q=PERG[PERGIX], sel=PERGRESP[PERGIX], i=sel.indexOf(cod);
  if(i>=0){sel.splice(i,1);return pintaPergunta()}
  var teto=q.max||99;
  // teto 1 TROCA a escolha em vez de reclamar — é o caso mais comum
  if(teto===1)sel.length=0;
  else if(sel.length>=teto){alert('Escolha no máximo '+teto+'.');return}
  sel.push(cod);pintaPergunta();
}
function voltaPergunta(){PERGIX--;pintaPergunta()}
function cancelaPergunta(){PERG=null;PERGPROD=null;telaPedir()}
function proximaPergunta(){
  var q=PERG[PERGIX], sel=PERGRESP[PERGIX];
  if(sel.length<(q.min||0)){alert('Escolha pelo menos '+q.min+'.');return}
  if(PERGIX+1<PERG.length){PERGIX++;return pintaPergunta()}
  // acabou: junta as respostas no item, com o preço já somado
  var nomes=[], codigos=[];
  PERGRESP.forEach(function(s,i){s.forEach(function(c){
    var o=PERG[i].opcoes.find(function(x){return x.codigo===c});
    if(o){nomes.push(o.nome);codigos.push(o.codigo)}
  })});
  var p={}; for(var k in PERGPROD)p[k]=PERGPROD[k];
  p.preco=Number(PERGPROD.preco||0)+precoExtra();
  PERG=null;PERGPROD=null;
  poeNoCarrinho(p, nomes.join(', '), codigos);
  // volta pro cardápio: quem acabou de adicionar quer escolher a PRÓXIMA
  // coisa, não continuar olhando a pergunta que já respondeu. Mesmo caminho
  // que confirmaObs faz no fluxo sem pergunta.
  telaPedir();
}
async function addCartObs(p){
  // A casa ja tem observacoes cadastradas por grupo ("Mal passada" em Porcoes,
  // "Com gelo e limao" em Refrigerantes). Mostra as do grupo e deixa escrever.
  var d;try{d=await (await fetch('/api/observacoes?p='+p.codigo_pdv,{cache:'no-store'})).json()}catch(e){d={sugestoes:[]}}
  if(!d.sugestoes||!d.sugestoes.length){poeNoCarrinho(p,'');return}
  PEND=p;PENDOBS='';
  app('<h1>'+esc(p.nome)+'</h1>'+
    '<div class="mut" style="margin:6px 0 14px">Quer pedir de algum jeito?</div>'+
    '<div class="obsl">'+d.sugestoes.map(function(o){
      return '<button class="ob" onclick=\\'marcaObs('+JSON.stringify(o).replace(/'/g,"&#39;")+',this)\\'>'+esc(o)+'</button>';
    }).join('')+'</div>'+
    '<input id="obstxt" placeholder="ou escreva aqui (ex.: sem cebola)" style="margin-top:12px">'+
    '<button class="b ped" onclick="confirmaObs()">Adicionar ao pedido</button>'+
    '<button class="b g" onclick="telaPedir()">Cancelar</button>');
}
var PEND=null,PENDOBS='';
function marcaObs(o,el){
  var sel=PENDOBS.split(' · ').filter(Boolean);
  var i=sel.indexOf(o);
  if(i>=0){sel.splice(i,1);el.className='ob'}else{sel.push(o);el.className='ob on'}
  PENDOBS=sel.join(' · ');
}
function confirmaObs(){
  var livre=((document.getElementById('obstxt')||{}).value||'').trim();
  var obs=[PENDOBS,livre].filter(Boolean).join(' · ');
  poeNoCarrinho(PEND,obs);PEND=null;PENDOBS='';
  telaPedir();
}
function poeNoCarrinho(p,obs,respostas){
  var j=CART.find(function(x){return x.codigo_pdv===p.codigo_pdv&&(x.obs||'')===(obs||'')});
  if(j)j.qtd++;else CART.push({codigo_pdv:p.codigo_pdv,nome:p.nome,tamanho:p.tamanho||null,
    preco:Number(p.preco||0),qtd:1,obs:obs||'',area_codigo:p.area_codigo,junto:false,
    respostas:respostas||null});
  renderCarrinho();
}
/** O carrinho é uma barra FIXA no rodapé. Com poucos itens cabia nos 120px de
 *  padding do body; com 2 itens e o aviso do "sai junto" ela cresceu e passou
 *  a cobrir os botões da tela — o "Adicionar ao pedido" sumia atrás dela.
 *  Agora o espaço embaixo acompanha a altura real da barra. */
function folgaCarrinho(el){
  var h=(el&&el.style.display!=='none')?el.offsetHeight:0;
  document.body.style.paddingBottom=(h?h+24:24)+'px';
}
function renderCarrinho(){
  var el=document.getElementById('cart');
  if(!el){el=document.createElement('div');el.id='cart';document.body.appendChild(el)}
  if(!CART.length){el.style.display='none';folgaCarrinho(el);return}
  var t=CART.reduce(function(s,i){return s+i.preco*i.qtd},0);
  var n=CART.reduce(function(s,i){return s+i.qtd},0);
  // "sai junto" so faz sentido quando o pedido cai em cozinhas diferentes —
  // bebida e prato, por exemplo. Dois itens da mesma cozinha ja saem juntos.
  var pracas={};CART.forEach(function(i){if(i.area_codigo!=null)pracas[i.area_codigo]=1});
  var varias=Object.keys(pracas).length>1;
  var marcados=CART.filter(function(i){return i.junto}).length;
  el.style.display='block';
  el.innerHTML='<div class="cin">'+CART.map(function(i,ix){
    return '<div class="ci"><span>'+i.qtd+'x '+esc(i.nome)+
      (i.tamanho?' <b>'+esc(i.tamanho)+'</b>':'')+
      (i.obs?'<small class="obsv">✎ '+esc(i.obs)+'</small>':'')+
      (i.junto?'<small class="jmark">⇄ sai junto</small>':'')+'</span>'+
      (varias?'<button class="jt'+(i.junto?' on':'')+'" onclick="togJuntoCli('+ix+')" title="servir junto">⇄</button>':'')+
      '<button onclick="menos('+ix+')">−</button><button onclick="mais('+ix+')">+</button></div>';
  }).join('')+
  (varias?'<div class="jdica">'+(marcados>1
    ? '<b>'+marcados+' itens</b> vão sair ao mesmo tempo. Os outros vêm assim que ficarem prontos.'
    : 'Quer que algo chegue junto com outro item? Toque no <b>⇄</b> dos dois.')+'</div>':'')+
  '<div class="ct"><span>'+n+' itens</span><b>R$ '+t.toLocaleString('pt-BR',{minimumFractionDigits:2})+'</b></div>'+
  '<button class="b" style="margin:0" onclick="revisarPedido()">Revisar e enviar</button></div>';
  folgaCarrinho(el);
}
// REVISAO antes de mandar pra cozinha. O cliente pede sozinho, sem garcom pra
// conferir — entao a ultima chance de pegar "2x" trocado ou item errado e'
// esta tela. Depois do envio o item ja esta impresso na praca.
function revisarPedido(){
  if(!CART.length)return;
  var t=CART.reduce(function(s,i){return s+i.preco*i.qtd},0);
  var pracas={};CART.forEach(function(i){if(i.area_codigo!=null)pracas[i.area_codigo]=1});
  var varias=Object.keys(pracas).length>1;
  var marcados=CART.filter(function(i){return i.junto}).length;
  var el=document.getElementById('cart');if(el){el.style.display='none';folgaCarrinho(el)}
  // TELA CHEIA, de propósito: é o último olhar antes de mandar pra cozinha —
  // pedido do dono (23/08) pra ficar claro DEMAIS o que está sendo pedido,
  // sem nada mais competindo por atenção na tela.
  document.body.classList.add('revcheia');
  app('<div class="revtop"><h1>Confira seu pedido</h1>'+
    '<div class="mut" style="margin-top:4px">Mesa '+mesaAtual()+' — depois de enviar, a produção já começa a preparar</div></div>'+
    '<div class="revlista">'+CART.map(function(i,ix){
      return '<div class="rev"><span class="rq">'+i.qtd+'×</span>'+
        '<span class="rn">'+esc(i.nome)+(i.tamanho?' <b>'+esc(i.tamanho)+'</b>':'')+
        (i.obs?'<small class="obsv">✎ '+esc(i.obs)+'</small>':'')+
        (i.junto?'<small class="jmark">⇄ sai junto com os outros marcados</small>':'')+'</span>'+
        '<span class="rv">R$ '+(i.preco*i.qtd).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</span>'+
        '<button class="rx" onclick="tiraRev('+ix+')" title="tirar">✕</button></div>';
    }).join('')+
    (varias&&marcados>1?'<div class="jdica"><b>'+marcados+' itens</b> vão sair ao mesmo tempo.</div>':'')+
    '</div>'+
    '<div class="revrodape"><div class="revt"><span>total</span><b>R$ '+t.toLocaleString('pt-BR',{minimumFractionDigits:2})+'</b></div>'+
    '<button class="b" id="btnConfirmarPedido" onclick="enviarPedido()">Confirmar e enviar</button>'+
    '<button class="b g" onclick="voltaDaRev()">Voltar e ajustar</button></div>');
}
function voltaDaRev(){ document.body.classList.remove('revcheia'); renderCarrinho(); telaPedir(); }
function tiraRev(ix){
  CART.splice(ix,1);
  if(!CART.length){ document.body.classList.remove('revcheia'); renderCarrinho(); telaPedir(); return }
  revisarPedido();
}
function togJuntoCli(ix){CART[ix].junto=!CART[ix].junto;renderCarrinho()}
function mais(i){CART[i].qtd++;renderCarrinho()}
function menos(i){CART[i].qtd--;if(CART[i].qtd<1)CART.splice(i,1);renderCarrinho()}
var ENVIANDO_PEDIDO=false; // trava contra duplo toque — o servidor também protege, isto é só o feedback rápido
async function enviarPedido(){
  if(ENVIANDO_PEDIDO)return; // já está a caminho — ignora o segundo toque
  var n=mesaAtual();if(n===null)return;
  if(!(await sessaoOk()))return;
  ENVIANDO_PEDIDO=true;
  var btn=document.getElementById('btnConfirmarPedido');
  if(btn){btn.disabled=true;btn.textContent='Enviando pedido…'}
  var r;
  try{
    r=await post('/api/mesa/pedir',{mesa:n,sessao:SES&&SES.comanda,desde:SES&&SES.desde,
      itens:CART.map(function(i){return {codigo_pdv:i.codigo_pdv,qtd:i.qtd,obs:i.obs||'',
        junto:!!i.junto,respostas:i.respostas||null}})});
  } finally { ENVIANDO_PEDIDO=false; }
  if(!r.ok){
    if(btn){btn.disabled=false;btn.textContent='Confirmar e enviar'}
    if(r.reescanear){ limpaSes(); telaReescanear(r.erro); return }
    alert(r.erro||'não consegui enviar');return}
  document.body.classList.remove('revcheia');
  CART=[];renderCarrinho();
  app('<div class="enviadao"><div class="tick">✓</div>'+
    '<div class="t1">PEDIDO ENVIADO</div><div class="t2">PARA A PRODUÇÃO</div>'+
    '<div class="t3">'+r.n_itens+' item'+(r.n_itens>1?'s':'')+' · mesa '+n+'</div></div>'+
    '<button class="b ped" onclick="verJaPedido()">Ver o que já pedi</button>'+
    '<button class="b g" onclick="inicio()">Voltar ao início</button>');
}
// O que ja esta a caminho — sem isso a mesa pede a mesma coisa duas vezes.
var jaTmr=null, jaEstado='';
function pararJa(){clearInterval(jaTmr);jaTmr=null}
async function verJaPedido(){
  var n=mesaAtual();if(n===null)return;
  await pintaJa(n);
  // ao vivo: o cliente ve o item mudar de "em produção" pra "a caminho" sem
  // ter que sair e voltar. Para sozinho quando ele troca de tela.
  clearInterval(jaTmr);
  jaTmr=setInterval(function(){ if(document.getElementById('jalista'))pintaJa(n); else pararJa(); },8000);
}
async function pintaJa(n){
  var d;try{d=await (await fetch('/api/ja-pedido?n='+n,{cache:'no-store'})).json()}catch(e){return}
  var its=d.itens||[];
  var est={preparando:'em produção',pronto:'pronto, a caminho',entregue:'já na mesa'};
  var assinatura=its.map(function(i){return i.nome+i.estado}).join('|');
  var mudou=jaEstado&&jaEstado!==assinatura;
  jaEstado=assinatura;
  var prontos=its.filter(function(i){return i.estado==='pronto'}).length;
  app('<h1>O que você já pediu</h1>'+
    '<div class="mut" style="margin:6px 0 12px">Mesa '+n+' · '+its.length+' item(ns)'+
    (prontos?' · <b style="color:#0f8a3e">'+prontos+' a caminho</b>':'')+
    ' <span class="aovivo">ao vivo</span></div>'+
    // Em BLOCOS: a mesa primeiro, depois cada comanda com o número. O que foi
    // lançado numa comanda não aparecia aqui — o cliente pedia a Heineken na
    // comanda e a tela dizia que não havia nada pedido.
    '<div id="jalista">'+(its.length?(d.grupos||[]).map(function(g){
      var cab=(g.tipo==='comanda')
        ? '<div class="jcab">Comanda '+g.numero+(g.nome?' · '+esc(g.nome):'')+'</div>'
        : ((d.grupos||[]).length>1?'<div class="jcab">Mesa '+g.numero+'</div>':'');
      return cab+g.itens.map(function(i){
        var hora=function(t){return t?new Date(t).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''};
        var linha='pedido às '+hora(i.pedido_em);
        if(i.estado==='preparando'&&i.espera_min!=null) linha+=' · há '+i.espera_min+' min';
        if(i.pronto_em) linha+=' · pronto às '+hora(i.pronto_em);
        if(i.entregue_em) linha+=' · entregue às '+hora(i.entregue_em);
        return '<div class="ja '+i.estado+'"><span class="q">'+i.quantidade+'x</span>'+
          '<span class="n">'+esc(i.nome)+
          (i.observacao?'<small class="obsv">✎ '+esc(i.observacao)+'</small>':'')+
          '<small class="hr">'+linha+'</small></span>'+
          '<span class="st">'+est[i.estado]+'</span></div>';
      }).join('');
    }).join(''):'<div class="mut">nada pedido ainda</div>')+'</div>'+
    '<button class="b ped" onclick="pararJa();telaPedir()">Pedir mais</button>'+
    '<button class="b g" onclick="pararJa();inicio()">Voltar</button>');
  if(mudou&&navigator.vibrate)try{navigator.vibrate(120)}catch(e){}
}
function minhaConta(){var n=mesaAtual();if(n===null)return;location.href='/conta/ver?n='+n}
var PGGORJ=null, PGPARTES=1;   // gorjeta escolhida (null = a da casa) e em quantos divide
// PGALVO = O QUE está sendo pago: null = a mesa inteira, ou o número da
// comanda. A comanda existe justamente pra separar quem paga o quê — trazer
// sempre a conta cheia obriga a mesa a fazer conta de cabeça e errar.
// No Consumer a comanda é uma conta como outra qualquer (PEDIDOS.NUMERO), então
// cobrar dela é a MESMA chamada, só mudando o número.
var PGALVO=null, CONTAMESA=null, PGVALOR=null;
function alvoPg(){ return PGALVO==null ? mesaAtual() : PGALVO }
async function telaPix(){
  var n=mesaAtual();if(n===null)return;
  app('<h1>Pagar</h1><div class="mesa">Mesa '+n+'</div><div class="mut">carregando sua conta…</div>');
  var c=await (await fetch('/api/conta/texto?n='+n,{cache:'no-store'})).json();
  if(!c.ok){app('<div class="ok"><div class="t">Conta não encontrada</div><div class="mut" style="margin-top:8px">'+
    esc(c.erro||'')+'</div></div><button class="b g" onclick="inicio()">Voltar</button>');return}
  CONTAMESA=c;PGALVO=null;CONTA=c;
  if(PGGORJ===null)PGGORJ=c.taxa_servico;
  pintaPagar();
}
// Troca o alvo do pagamento. Recarrega a conta daquele número — o subtotal que
// a mesa já traz serve pro botão, mas o que vale na hora de cobrar é a conta
// de verdade (com o que já foi pago nela).
async function setAlvoPg(num){
  if(PGALVO===num)return;
  PGPARTES=1;
  var alvo=(num==null)?mesaAtual():num;
  app('<h1>Pagar</h1><div class="mut">carregando…</div>');
  var c=await (await fetch('/api/conta/texto?n='+alvo,{cache:'no-store'})).json();
  if(!c.ok){alert(c.erro||'não consegui abrir essa conta');pintaPagar();return}
  PGALVO=num;CONTA=c;pintaPagar();
}
var CONTA=null;
function calcPagar(){
  var itens=CONTA.total||0;
  var gorj=+(itens*PGGORJ/100).toFixed(2);
  var total=+(itens+gorj).toFixed(2);
  var resta=Math.max(0,+(total-(CONTA.pago||0)).toFixed(2));
  // A divisão é sempre sobre o que FALTA, não sobre o total: numa conta
  // rachada, quem paga depois já encontra o saldo menor. E quem quiser pagar
  // mais que a sua parte digita o valor — a diferença some do que sobra pros
  // outros, que é o rateio acontecendo sozinho.
  var minha = (PGVALOR!=null) ? Math.min(PGVALOR, resta) : +(resta/PGPARTES).toFixed(2);
  return {itens:itens,gorj:gorj,total:total,resta:resta,minha:minha};
}
// Digita e o valor grande em cima acompanha, sem redesenhar a tela toda —
// redesenhar tirava o foco do campo a cada tecla.
var vlDeb=null;
/** Le valor em portugues e perdoa o resto: "R$ 100", "100,00", "1.234,56",
 *  espaco sobrando. Antes um Number() cru virava NaN e a tela dizia so
 *  "Valor invalido" — sem dizer o que estava errado. */
function numeroBr(txt){
  // As barras sao DOBRADAS de proposito: esta tela e' um template literal, e
  // \\. vira . na hora de servir. Foi exatamente esse o bug do "Valor invalido"
  // em 01/08: /\\./g chegava no navegador como /./g, que casa com TODO
  // caractere — "100" virava string vazia e Number('') e' 0.
  var t=String(txt||'').replace(/[^\\d.,]/g,'');
  if(t.indexOf(',')>=0) t=t.replace(/\\./g,'').replace(',','.');
  else if((t.match(/\\./g)||[]).length>1) t=t.replace(/\\.(?=.*\\.)/g,'');
  var n=Number(t);
  return (isFinite(n)&&n>0)?n:null;
}
function digitouValor(txt){
  PGVALOR=numeroBr(txt);
  var v=calcPagar();
  var el=document.querySelector('#app .valor');
  if(el)el.textContent='R$ '+v.minha.toLocaleString('pt-BR',{minimumFractionDigits:2});
  var so=document.getElementById('vsobra');
  if(so)so.textContent=(PGVALOR!=null&&PGVALOR<v.resta)
    ? 'Depois deste pagamento ainda faltam R$ '+(v.resta-PGVALOR).toLocaleString('pt-BR',{minimumFractionDigits:2})+' na conta.'
    : (PGVALOR!=null&&PGVALOR>=v.resta) ? 'Isto quita a conta.' : '';
  clearTimeout(vlDeb);
  vlDeb=setTimeout(function(){ if(document.activeElement&&document.activeElement.id==='vlivre')atualizaBotoes(); },400);
}
function atualizaBotoes(){ botoesPagar(calcPagar().minha) }
function pintaPagar(){
  var v=calcPagar(), n=mesaAtual();
  var cmds=(CONTAMESA&&CONTAMESA.comandas)||[];
  // Seletor do que pagar. Só aparece quando a mesa TEM comanda vinculada —
  // numa mesa sem comanda ele seria só um botão inútil ocupando a tela.
  var sel='';
  if(cmds.length){
    sel='<div class="tit2">O que você vai pagar</div><div class="segs alvos">'+
      '<button class="seg'+(PGALVO==null?' on':'')+'" onclick="setAlvoPg(null)">A mesa toda'+
        '<small>R$ '+Number(CONTAMESA.com_servico||0).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</small></button>'+
      cmds.map(function(c){
        return '<button class="seg'+(PGALVO===c.numero?' on':'')+'" onclick="setAlvoPg('+c.numero+')">'+
          (c.nome?esc(c.nome):'Comanda '+c.numero)+
          '<small>'+(c.nome?'comanda '+c.numero+' · ':'')+'R$ '+Number(c.com_servico||0).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</small></button>';
      }).join('')+'</div>';
  }
  var titulo=(PGALVO==null)?('Mesa '+n):('Comanda '+PGALVO+(CONTA.nome?' · '+esc(CONTA.nome):'')+' · mesa '+n);
  var h='<h1>Pagar</h1><div class="mesa">'+titulo+'</div>'+sel+
    '<div class="valor">R$ '+v.minha.toLocaleString('pt-BR',{minimumFractionDigits:2})+'</div>'+
    '<div class="mut" style="margin:4px 0 16px">'+(PGPARTES>1?'sua parte · conta de R$ '+v.resta.toLocaleString('pt-BR',{minimumFractionDigits:2})+' dividida por '+PGPARTES:'total a pagar')+'</div>'+
    '<div class="card"><div class="lin"><span>Consumo</span><b>R$ '+v.itens.toLocaleString('pt-BR',{minimumFractionDigits:2})+'</b></div>'+
    (CONTA.pago>0?'<div class="lin"><span>já pago</span><b>− R$ '+Number(CONTA.pago).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</b></div>':'')+
    '<div class="lin"><span>Serviço</span><b>R$ '+v.gorj.toLocaleString('pt-BR',{minimumFractionDigits:2})+'</b></div></div>'+
    // A taxa de serviço é opcional por lei, mas tirar não é decisão de tela:
    // passa pelo garçom. Aqui o cliente só escolhe o padrão da casa ou dar
    // mais — nunca menos.
    '<div class="tit2">Serviço</div><div class="segs">'+
      [10,15].map(function(p){return '<button class="seg'+(PGGORJ===p?' on':'')+'" onclick="setGorj('+p+')">'+p+'%</button>'}).join('')+
    '</div>'+
    '<div class="tit2">Dividir por</div><div class="segs">'+
      [1,2,3,4,5,6].map(function(k){return '<button class="seg'+(PGPARTES===k&&PGVALOR==null?' on':'')+'" onclick="setPartes('+k+')">'+k+'</button>'}).join('')+
    '</div>'+
    // Campo SEMPRE visível, não escondido atrás de um prompt: "não quero pagar
    // 44, quero pagar 100" é caso comum numa conta rachada, e a pessoa tem que
    // ver onde digitar sem procurar.
    '<div class="tit2">Ou digite quanto você vai pagar</div>'+
    '<div class="vlivre"><span>R$</span>'+
      '<input id="vlivre" inputmode="decimal" placeholder="'+v.minha.toFixed(2).replace('.',',')+'" '+
        'value="'+(PGVALOR!=null?PGVALOR.toFixed(2).replace('.',','):'')+'" '+
        'oninput="digitouValor(this.value)">'+
      (PGVALOR!=null?'<button class="vx" onclick="setPartes('+PGPARTES+')">✕</button>':'')+
    '</div>'+
    '<div id="vsobra" class="mut" style="margin-top:6px;font-size:12.5px"></div>'+
    // O QUE JÁ ENTROU. Numa conta rachada, quem chega depois precisa ver o que
    // os outros já pagaram — senão ninguém sabe se está pagando a mais.
    ((CONTA.pagamentos&&CONTA.pagamentos.length)
      ? '<div class="tit2">Já pago nesta conta</div><div class="card">'+
        CONTA.pagamentos.map(function(g){
          var h=g.quando?new Date(g.quando).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';
          return '<div class="lin"><span>'+esc(g.forma||'pagamento')+(h?' · '+h:'')+'</span>'+
            '<b>R$ '+Number(g.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</b></div>';
        }).join('')+
        '<div class="lin"><span><b>ainda falta</b></span><b style="color:var(--gold2)">R$ '+
          v.resta.toLocaleString('pt-BR',{minimumFractionDigits:2})+'</b></div></div>'
      : '')+
    (PGPARTES>1?'<div class="mut" style="margin-top:8px">Cada pessoa paga a sua e a conta vai baixando sozinha. Quem pagar por último acerta a diferença.</div>':'');
  h+='<div id="pgbtns"></div>'+
     '<button class="b ver" onclick="verContaAlvo()">🧾 Ver o detalhe '+(PGALVO==null?'da conta':'da comanda '+PGALVO)+'</button>'+
     '<button class="b g" onclick="inicio()">Voltar</button>';
  app(h);
  botoesPagar(v.minha);
}
// O detalhe tem que ser o do que está sendo pago, não o da mesa inteira.
function verContaAlvo(){var a=alvoPg();if(a===null)return;location.href='/conta/ver?n='+a}
function setGorj(p){PGGORJ=p;pintaPagar()}
function setPartes(k){PGPARTES=k;PGVALOR=null;pintaPagar()}
// Um botão só — "Pagar a conta". A escolha da forma vem depois, numa tela
// própria: lá cabe explicar por que o cartão está apagado, o que no meio dos
// valores viraria ruído.
var PGSTATUS=null;
async function botoesPagar(valor){
  if(!PGSTATUS){
    var st=await (await fetch('/api/pix/status',{cache:'no-store'})).json();
    var ct=await (await fetch('/api/cartao/status',{cache:'no-store'})).json();
    PGSTATUS={pix:st,cartao:ct};
  }
  var el=document.getElementById('pgbtns');if(!el)return;
  el.innerHTML=(PGSTATUS.pix.disponivel||PGSTATUS.cartao.disponivel)
    ? '<button class="b pix" onclick="telaFormaPg()">Pagar a conta</button>'
    : '<div class="aviso">Pagamento pela tela ainda não está ligado. <b>Chame o garçom.</b></div>'+
      '<button class="b" onclick="chamar()">🔔 Chamar o garçom</button>';
}
function telaFormaPg(){
  var v=calcPagar(), alvo=alvoPg(), st=PGSTATUS||{pix:{},cartao:{}};
  var quem=(PGALVO==null)?('Mesa '+mesaAtual()):('Comanda '+PGALVO+(CONTA.nome?' · '+esc(CONTA.nome):''));
  var h='<h1>Como você quer pagar</h1><div class="mesa">'+quem+'</div>'+
    '<div class="valor">R$ '+v.minha.toLocaleString('pt-BR',{minimumFractionDigits:2})+'</div>'+
    '<div class="mut" style="margin:4px 0 16px">'+(PGPARTES>1?'sua parte · dividido por '+PGPARTES:'total a pagar')+'</div>';
  h+= st.pix.disponivel
    ? '<button class="b pix" onclick="gerarPix('+alvo+')">Pix<small>o código aparece na tela · cai na hora</small></button>'
    : '<button class="b pix off" disabled>Pix<small>indisponível agora</small></button>';
  // Cartão apagado enquanto a Cielo não libera. Fica visível de propósito: a
  // pessoa vê que existe e não fica procurando onde clicar.
  h+= st.cartao.disponivel
    ? '<button class="b cart" onclick="gerarCartao('+alvo+')">Cartão<small>crédito ou débito</small></button>'
    : '<button class="b cart off" disabled>Cartão<small>'+
      (st.cartao.motivo==='em breve'?'em breve — ainda não liberado':'não disponível aqui')+
      '</small></button>';
  h+='<button class="b g" onclick="pintaPagar()">Voltar</button>';
  app(h);
}
async function gerarPix(n){
  app('<h1>Pagar com Pix</h1><div class="mut">gerando o código…</div>');
  var r=await post('/api/pix/cobrar',{mesa:n,gorjeta_pct:PGGORJ,dividir_por:PGPARTES,
    valor:(PGVALOR!=null?calcPagar().minha:undefined)});
  if(!r.ok){app('<div class="aviso">'+esc(r.erro||'não consegui gerar')+'</div>'+
    '<button class="b" onclick="chamar()">🔔 Chamar o garçom</button>'+
    '<button class="b g" onclick="inicio()">Voltar</button>');return}
  app('<h1>Pix gerado</h1><div class="valor">R$ '+Number(r.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</div>'+
    (r.imagem?'<img class="qr" src="'+r.imagem+'" alt="QR Code Pix">':'')+
    '<div class="mut" style="margin:10px 0 6px">Ou copie o código:</div>'+
    '<div class="copia" id="cp">'+esc(r.copia_cola||'')+'</div>'+
    '<button class="b" id="btncp" onclick="copiar()">Copiar código</button>'+
    // Conta rachada: quem pagou a primeira parte manda o código pros outros
    // seguirem. wa.me sem número deixa a pessoa escolher pra quem enviar —
    // pode ser pra ela mesma, pra levar pro app do banco.

    '<div id="pgst" class="mut" style="margin-top:14px">aguardando o pagamento…</div>'+
    '<button class="b g" onclick="pararPix()">Voltar</button>');
  vigiarPix(r.txid);
}
// Confirma sozinho: o cliente paga no app do banco e a tela avisa aqui.
var pixTmr=null;
// ---- MANDAR O PASSE PRA QUEM VAI EMBORA ----
// Quem paga e' um so; quem SAI pode ser outro. Tres caminhos, nesta ordem:
//
//  1. navigator.share com ARQUIVO — manda a IMAGEM do QR de verdade. So existe
//     em contexto seguro, e a tela do cliente e' HTTP (http://IP:8790), entao
//     na loja isso praticamente nunca dispara. Fica pronto pro dia do HTTPS.
//  2. wa.me com o CODIGO — sempre funciona. Vai o numero da mesa e o codigo;
//     na catraca o codigo vale tanto quanto o QR.
//  3. segurar o dedo na imagem — o proprio Android/iPhone oferece
//     "Compartilhar imagem". E' o unico jeito de mandar a FOTO hoje.
//
// ⚠️ NAO mandamos link: o endereco e' um IP da rede da loja (192.168.x.x) e
// morre pra quem estiver no 4G. Foi por isso que "esse link nao funcionou".
// ⚠️ E nada de await ANTES do window.open — o navegador perde o gesto do
// clique e bloqueia como popup. Por isso a imagem e' baixada ANTES, quando a
// tela pinta.
var QRBLOB=null;
function preparaImagem(token){
  QRBLOB=null;
  try{
    fetch('/api/saida/qr?t='+encodeURIComponent(token))
      .then(function(r){return r.blob()})
      .then(function(b){ QRBLOB=new File([b],'passe-'+token+'.png',{type:'image/png'}) })
      .catch(function(){});
  }catch(e){}
}
function mandarZap(token){
  var n=mesaAtual();
  // ATENCAO: a quebra de linha da mensagem precisa de DUAS barras neste
  // arquivo, porque ele e um template literal. Com uma so, ela vira quebra de
  // linha DE VERDADE no meio da string e derruba o script inteiro da tela.
  // Nao escreva sequencia de escape nem em COMENTARIO aqui dentro: o comentario
  // tambem e cortado, e o resto da linha vira codigo solto.
  // ATENCAO: a quebra de linha precisa de DUAS barras neste arquivo, porque
  // ele e' um template literal. Com uma so ela vira quebra DE VERDADE no meio
  // da string e derruba o script inteiro da tela.
  var txt='${LOJA_NOME} — mesa '+n+'\\n'+
    'Conta paga. Passe de saída:\\n\\n'+token+'\\n\\n'+
    'Mostre este código na catraca.';
  if(QRBLOB&&navigator.canShare&&navigator.share){
    try{ if(navigator.canShare({files:[QRBLOB]})){ navigator.share({files:[QRBLOB],text:txt}); return } }catch(e){}
  }
  window.open('https://wa.me/?text='+encodeURIComponent(txt),'_blank');
}
function pararPix(){clearInterval(pixTmr);pixTmr=null;inicio()}
/* ---- COMPROVANTE NO CELULAR DO CLIENTE ----
   Ele APARECE na tela assim que o Pix é reconhecido — não fica atrás de
   botão. Quem acabou de pagar quer ver a prova na hora, não procurar por
   ela. O E2E vai por extenso: é o número que o banco reconhece.
   Guardar/enviar usa o compartilhar do próprio celular (WhatsApp, foto,
   e-mail) e cai no wa.me se o aparelho não tiver. */
var PIXTXID=null, PIXDOC=null;
function verComprovante(){ if(PIXTXID) window.open('/pix/comprovante?txid='+encodeURIComponent(PIXTXID),'_blank') }
async function carregaComprovante(){
  PIXDOC=null; if(!PIXTXID)return;
  try{ var d=await (await fetch('/api/pix/comprovante?txid='+encodeURIComponent(PIXTXID),{cache:'no-store'})).json();
       if(d&&d.ok)PIXDOC=d }catch(e){}
}
function blocoComprovante(){
  var d=PIXDOC; if(!d)return '';
  var q=new Date(d.quando).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  var L=function(a,b){return '<div style="display:flex;justify-content:space-between;gap:8px"><span>'+a+'</span><span>'+b+'</span></div>'};
  return '<div style="background:#fff;color:#141418;border-radius:14px;padding:15px 14px;margin:16px 0;'+
      'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.5;box-shadow:0 2px 12px rgba(0,0,0,.18)">'+
    '<div style="text-align:center"><div style="font-size:15px;font-weight:800;letter-spacing:.5px">'+esc(d.casa.toUpperCase())+'</div>'+
      '<div style="font-size:11.5px;font-weight:700">COMPROVANTE DE PAGAMENTO</div>'+
      '<div style="font-size:10px;color:#6e6e78">não é documento fiscal</div></div>'+
    '<hr style="border:0;border-top:1px dashed #9a9aa5;margin:9px 0">'+
    '<div style="font-size:14px;font-weight:800">'+esc(d.rotulo)+(d.nome?' · '+esc(d.nome):'')+'</div>'+
    '<div style="font-size:11px;color:#6e6e78">'+q+'</div>'+
    '<hr style="border:0;border-top:1px dashed #9a9aa5;margin:9px 0">'+
    L('Forma','<b>Pix</b>')+
    '<div style="display:flex;justify-content:space-between;font-size:18px;font-weight:800;margin:5px 0">'+
      '<span>PAGO</span><span>'+brlc(d.valor)+'</span></div>'+
    '<hr style="border:0;border-top:1px dashed #9a9aa5;margin:9px 0">'+
    L('Consumo da mesa',brlc(d.consumo))+L('Total pago',brlc(d.pago_geral))+
    (d.quitada?'<div style="text-align:center;font-weight:800;color:#0d7a43;border:2px solid #0d7a43;border-radius:8px;padding:6px;margin:10px 0">✓ CONTA QUITADA</div>'
              :'<div style="text-align:center;font-weight:800;color:#b3261e;border:2px solid #b3261e;border-radius:8px;padding:6px;margin:10px 0">Ainda falta '+brlc(d.falta)+'</div>')+
    (d.e2e?'<div style="font-size:10.5px;color:#6e6e78">Pix E2E:</div><div style="font-size:10.5px;color:#6e6e78;word-break:break-all">'+esc(d.e2e)+'</div>':'')+
    '<div style="font-size:10.5px;color:#6e6e78;word-break:break-all">ID: '+esc(d.txid)+'</div>'+
  '</div>'+
  '<button class="b g" onclick="guardarComprovante()">💾 Guardar / enviar</button>';
}
function brlc(v){return 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
async function guardarComprovante(){
  var d=PIXDOC; if(!d){verComprovante();return}
  var url=location.origin+'/pix/comprovante?txid='+encodeURIComponent(d.txid);
  var txt=d.casa+' — comprovante de pagamento\\n'+d.rotulo+' · '+brlc(d.valor)+' via Pix\\n'+
    (d.e2e?'Pix E2E: '+d.e2e+'\\n':'')+url;
  try{ if(navigator.share){ await navigator.share({title:'Comprovante '+d.rotulo,text:txt}); return } }catch(e){ return }
  window.open('https://wa.me/?text='+encodeURIComponent(txt),'_blank');
}
function btnComprovante(){ return PIXTXID&&!PIXDOC?'<button class="b g" onclick="verComprovante()">📄 Ver comprovante</button>':'' }
function vigiarPix(txid){
  clearInterval(pixTmr);
  var tentativas=0,ocupado=false;
  pixTmr=setInterval(async function(){
    if(++tentativas>120){clearInterval(pixTmr);return} // ~10 min
    if(ocupado)return; // a conferida anterior ainda nao voltou
    ocupado=true;
    var s;try{s=await (await fetch('/api/pix/conferir?txid='+encodeURIComponent(txid),{cache:'no-store'})).json()}
    catch(e){return}finally{ocupado=false}
    if(s.ok&&s.pago){
      clearInterval(pixTmr);pixTmr=null;
      PIXTXID=txid; // o comprovante do que ACABOU de ser pago
      aposPagar('pix');
    }
  },5000);
}
// Pagou — mas pagou TUDO? O passe de saida so nasce com a conta zerada.
// Numa mesa rachada entre seis, o primeiro que paga a parte dele nao pode
// sair levando o passe: quem fica ainda deve. Entao aqui a gente re-consulta
// a conta (nao confia no que estava na tela antes do pagamento) e so oferece
// o passe se nao faltar nada. O servidor barra de novo em /api/saida/gerar.
async function aposPagar(origem){
  var n=mesaAtual();if(n===null){inicio();return}
  await carregaComprovante(); // o papel do cliente sai junto com a confirmação
  var c;try{c=await (await fetch('/api/conta/texto?n='+n,{cache:'no-store'})).json()}catch(e){c=null}
  if(c&&c.ok){CONTAMESA=c;if(!PGALVO)CONTA=c}
  var consumo=c&&c.ok?(Number(c.total||0)+(c.comandas||[]).reduce(function(s,x){return s+Number(x.subtotal||0)},0)):0;
  var falta=c&&c.ok?Math.max(0,+(consumo-Number(c.pago_geral||0)).toFixed(2)):0;
  if(falta>0.009){
    app('<div class="ok"><div class="t">✓ Pagamento confirmado</div>'+
      '<div class="mut" style="margin-top:6px">Obrigado! Entrou na conta da mesa.</div></div>'+
      '<div class="cx" style="margin-top:18px;text-align:center">'+
        '<div class="mut">Ainda falta nesta conta</div>'+
        '<div class="valor" style="margin:2px 0 0">R$ '+falta.toLocaleString('pt-BR',{minimumFractionDigits:2})+'</div>'+
      '</div>'+
      '<div class="mut" style="margin:14px 0 4px">O <b>passe de saída</b> sai quando a conta zerar. '+
      'Quem ainda não pagou pode pagar pelo QR da mesa, ou chamar o garçom.</div>'+
      blocoComprovante()+
      '<button class="b" onclick="telaPix()">Pagar o que falta</button>'+
      btnComprovante()+
      '<button class="b g" onclick="inicio()">Voltar ao início</button>');
    return;
  }
  telaPessoas(origem);
}
// Conta zerada: agora o QR da saida. Cada leitura na catraca libera uma pessoa.
// Crianca de ate 10 anos nao conta — passa junto com o responsavel.
function telaPessoas(origem){
  app('<div class="ok"><div class="t">✓ Pagamento confirmado</div>'+
    '<div class="mut" style="margin-top:6px">Obrigado! Falta só uma coisa.</div></div>'+
    '<h1 style="margin-top:22px">Quem sai com você?</h1>'+
    '<div class="mut" style="margin:6px 0 14px">É o que a catraca vai liberar na saída. '+
    'Crianças de até 10 anos passam com o responsável e não precisam ser contadas.</div>'+
    '<div class="cont"><span>Adultos</span>'+
      '<button onclick="passo(\\'ad\\',-1)">−</button><b id="ad">1</b><button onclick="passo(\\'ad\\',1)">+</button></div>'+
    '<div class="cont"><span>Crianças acima de 10 anos</span>'+
      '<button onclick="passo(\\'cr\\',-1)">−</button><b id="cr">0</b><button onclick="passo(\\'cr\\',1)">+</button></div>'+
    '<h1 style="margin-top:22px">Veio de carro?</h1>'+
    '<div class="mut" style="margin:6px 0 14px">A cancela do estacionamento lê a placa. '+
    'Sem a placa aqui, o carro para na saída e precisa chamar alguém.</div>'+
    '<div class="cont"><span>Carros</span>'+
      '<button onclick="passo(\\'ca\\',-1)">−</button><b id="ca">0</b><button onclick="passo(\\'ca\\',1)">+</button></div>'+
    '<div id="placas"></div>'+
    blocoComprovante()+
    '<button class="b" onclick="gerarSaida(\\''+origem+'\\')">Gerar meu QR de saída</button>'+
    btnComprovante()+
    '<button class="b g" onclick="inicio()">Agora não</button>');
  pintaPlacas();
}
var PES={ad:1,cr:0,ca:0};
function passo(q,d){
  var min=(q==='ad')?1:0;
  PES[q]=Math.max(min,Math.min(q==='ca'?8:50,PES[q]+d));
  document.getElementById(q).textContent=PES[q];
  if(q==='ca')pintaPlacas();
}
// Um campo por carro. Guarda o que ja foi digitado ao mudar a quantidade —
// aumentar de 1 pra 2 nao pode apagar a placa que a pessoa ja escreveu.
var PLACAS=[];
function pintaPlacas(){
  var el=document.getElementById('placas');if(!el)return;
  var h='';
  for(var i=0;i<PES.ca;i++){
    h+='<div class="vlivre" style="margin-bottom:8px"><span>🚗</span>'+
       '<input id="pl'+i+'" maxlength="8" autocapitalize="characters" autocomplete="off" '+
       'placeholder="ABC1D23" value="'+(PLACAS[i]||'')+'" oninput="guardaPlaca('+i+',this)"></div>';
  }
  el.innerHTML=h;
}
function guardaPlaca(i,inp){
  var v=String(inp.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7);
  if(inp.value!==v)inp.value=v;
  PLACAS[i]=v;
  // placa valida fica verde; a validacao de verdade e no servidor
  inp.style.color=/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v)?'#17803d':'';
}
async function gerarSaida(origem){
  var n=mesaAtual();if(n===null)return;
  var pl=[];
  for(var i=0;i<PES.ca;i++){var v=(PLACAS[i]||'').trim();if(v)pl.push(v)}
  var faltando=[];
  for(var j=0;j<PES.ca;j++) if(!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(PLACAS[j]||'')) faltando.push(j+1);
  if(faltando.length){
    alert('Confira a placa do carro '+faltando.join(' e ')+'. São 7 caracteres, como ABC1D23 ou ABC1234.');
    return;
  }
  var r=await post('/api/saida/gerar',{mesa:n,adultos:PES.ad,criancas:PES.cr,placas:pl,origem:origem});
  if(!r.ok){alert(r.erro||'não consegui gerar');return}
  app('<h1>Seu QR de saída</h1>'+
    '<div class="mut" style="margin:6px 0 2px">É <b>um código só</b> pra mesa toda. '+
    'Na catraca, cada pessoa encosta e passa — uma de cada vez.</div>'+
    '<img class="qr" id="qrimg" src="/api/saida/qr?t='+encodeURIComponent(r.token)+'" alt="QR de saída">'+
    '<div class="codigo">'+esc(r.token)+'</div>'+
    '<div id="prog"></div>'+
    ((r.placas&&r.placas.length)
      ? '<div class="cx" style="margin-top:12px"><div class="mut">Carros liberados na cancela</div>'+
        '<div style="font-weight:700;font-size:18px;letter-spacing:.06em;margin-top:3px">'+
        r.placas.map(esc).join(' · ')+'</div></div>'
      : '')+
    '<div class="mut" style="margin-top:10px">Vale por '+r.validade_min+' minutos.</div>'+
    '<button class="b zap" onclick="mandarZap(\\''+r.token+'\\')">Enviar no WhatsApp</button>'+
    '<a class="b g" style="display:block;text-align:center;text-decoration:none" '+
      'href="/api/saida/qr?t='+encodeURIComponent(r.token)+'" download="passe-'+r.token+'.png">'+
      'Salvar a imagem do QR</a>'+
    '<div class="mut" style="margin:2px 0 12px;font-size:12.5px">Pra mandar o <b>QR</b> pra alguém: '+
    'segure o dedo na imagem acima e escolha <b>Compartilhar</b>. Se preferir, o botão do WhatsApp '+
    'manda o <b>código</b> — na catraca ele vale igual.</div>'+
    '<button class="b g" onclick="pararSaida()">Voltar ao início</button>');
  preparaImagem(r.token);
  vigiarSaida(r.token);
}
// O cliente vê na própria tela quantos já passaram — evita a dúvida de
// "será que a catraca leu?" com a fila esperando atrás.
var saidaTmr=null;
function pararSaida(){clearInterval(saidaTmr);saidaTmr=null;inicio()}
function vigiarSaida(token){
  clearInterval(saidaTmr);
  var pinta=async function(){
    var d;try{d=await (await fetch('/api/saida/consultar?t='+encodeURIComponent(token),{cache:'no-store'})).json()}catch(e){return}
    if(!d.ok)return;
    var el=document.getElementById('prog');if(!el)return;
    var bolas='';for(var i=0;i<d.pessoas;i++)bolas+='<span class="bo'+(i<d.usados?' on':'')+'"></span>';
    el.innerHTML='<div class="passou"><b>'+d.usados+'</b> de <b>'+d.pessoas+'</b> já passaram'+
      '<div class="bolas">'+bolas+'</div></div>';
    if(d.restantes===0){
      clearInterval(saidaTmr);saidaTmr=null;
      app('<div class="ok"><div class="t">✓ Todos passaram</div>'+
        '<div class="mut" style="margin-top:8px">Obrigado pela visita! Volte sempre.</div></div>'+
        '<button class="b g" onclick="inicio()">Fechar</button>');
    }
  };
  pinta();
  saidaTmr=setInterval(pinta,4000);
}
// Cartão NÃO é digitado aqui: esta página é HTTP na rede da casa. O cliente vai
// pro app em HTTPS, e a gente só espera a confirmação.
async function gerarCartao(n){
  app('<h1>Pagar com cartão</h1><div class="mut">preparando…</div>');
  var r=await post('/api/cartao/cobrar',{mesa:n,gorjeta_pct:PGGORJ,dividir_por:PGPARTES});
  if(!r.ok){app('<div class="aviso">'+esc(r.erro||'não consegui')+'</div>'+
    '<button class="b" onclick="chamar()">🔔 Chamar o garçom</button>'+
    '<button class="b g" onclick="inicio()">Voltar</button>');return}
  app('<h1>Pagar com cartão</h1><div class="valor">R$ '+Number(r.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</div>'+
    '<div class="mut" style="margin:8px 0 4px">Toque no botão para abrir a página segura de pagamento.</div>'+
    '<a class="b cart" style="display:block;text-align:center;text-decoration:none" href="'+esc(r.url)+'" target="_blank" rel="noopener">Abrir pagamento seguro</a>'+
    '<div class="mut" style="margin:14px 0 6px">Ou aponte a câmera de outro celular:</div>'+
    (r.imagem?'<img class="qr" src="'+r.imagem+'" alt="QR do pagamento">':'')+
    '<div id="pgst" class="mut">aguardando o pagamento…</div>'+
    '<button class="b g" onclick="pararCartao()">Voltar</button>');
  vigiarCartao(r.ref);
}
var cartTmr=null;
function pararCartao(){clearInterval(cartTmr);cartTmr=null;inicio()}
function vigiarCartao(ref){
  clearInterval(cartTmr);
  var t=0;
  cartTmr=setInterval(async function(){
    if(++t>120){clearInterval(cartTmr);return}
    var s;try{s=await (await fetch('/api/cartao/conferir?ref='+encodeURIComponent(ref),{cache:'no-store'})).json()}catch(e){return}
    var el=document.getElementById('pgst');
    if(s.ok&&s.pago){
      clearInterval(cartTmr);cartTmr=null;
      aposPagar('cartao');
    } else if(el&&s.erro_cielo){ el.innerHTML='<span style="color:#b45309">'+esc(s.erro_cielo)+' — tente outro cartão</span>' }
  },5000);
}
// COPIAR O CÓDIGO PIX
//
// navigator.clipboard SÓ existe em contexto seguro: HTTPS ou localhost. A loja
// roda em HTTP num IP da rede (http://192.168.x.x:8790), então lá ele é
// undefined — o botão avisava "copiado" e não copiava nada, e a pessoa só
// descobria no app do banco, sem ter o que colar.
//
// O execCommand('copy') é obsoleto, mas é o que funciona em HTTP. E o aviso
// agora só aparece quando a cópia deu certo de verdade; falhando, o código
// fica selecionado na tela pra pessoa copiar na mão.
function copiaTexto(t){
  if(navigator.clipboard&&window.isSecureContext){
    return navigator.clipboard.writeText(t).then(function(){return true},function(){return copiaAntiga(t)});
  }
  return Promise.resolve(copiaAntiga(t));
}
function copiaAntiga(t){
  try{
    var ta=document.createElement('textarea');
    ta.value=t;ta.setAttribute('readonly','');
    ta.style.position='fixed';ta.style.top='0';ta.style.left='0';ta.style.opacity='0';
    document.body.appendChild(ta);
    ta.focus();ta.select();
    try{ta.setSelectionRange(0,t.length)}catch(e){}   // iOS precisa disto
    var ok=document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  }catch(e){return false}
}
/** Deixa o código selecionado na tela — último recurso quando nada copia. */
function selecionaNaTela(el){
  try{
    var s=window.getSelection(),r=document.createRange();
    r.selectNodeContents(el);s.removeAllRanges();s.addRange(r);
  }catch(e){}
}
function copiar(){
  var el=document.getElementById('cp'); if(!el)return;
  var t=el.textContent||''; if(!t)return;
  var btn=document.getElementById('btncp');
  copiaTexto(t).then(function(ok){
    if(ok){
      if(btn){var antes=btn.textContent;btn.textContent='✓ Copiado — cole no app do banco';
        setTimeout(function(){if(btn)btn.textContent=antes},2500)}
      return;
    }
    // não deu: em vez de mentir, mostra o código pronto pra copiar na mão
    selecionaNaTela(el);
    if(btn)btn.textContent='segure no código acima e escolha Copiar';
  });
}
function mesaAtual(){
  if(MESA)return Number(MESA);
  var el=document.getElementById('nm');
  var n=el?Number(el.value):0;
  if(!(n>=1)){alert('Digite o número da mesa');return null}
  return n;
}
async function post(u,b){return (await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)})).json()}
async function chamar(){
  var n=mesaAtual();if(n===null)return;
  await post('/api/chamado',{mesa:n,tipo:'garcom',origem:'qr-mesa'});
  app('<div class="ok"><div class="t">✓ Garçom avisado</div><div class="mut" style="margin-top:8px">Ele já está a caminho da mesa '+n+'.</div></div>'+
    '<button class="b g" onclick="inicio()">Voltar</button>');
}
// ---- RECLAMACAO EM DOIS PASSOS ----
// Antes era um campo de texto vazio: o cliente escrevia "demorou" e a cozinha
// recebia isso sem saber DE QUE prato. Agora ele escolhe o assunto e, quando
// o assunto tem a ver com comida, aponta o item na propria lista do que pediu.
// O texto que chega no KDS sai pronto: "DEMORA - Pato confitado (32min)".
var ASSUNTO=null, ITSEL={}, ITENS=[];
function telaProblema(){
  ASSUNTO=null;ITSEL={};
  app('<h1>O que aconteceu?</h1>'+
    '<div class="mut" style="margin:8px 0 16px">Escolha o assunto — a equipe é avisada na hora.</div>'+
    (MESA?'':'<input id="nm" inputmode="numeric" placeholder="número da sua mesa" style="margin-bottom:12px">')+
    '<button class="b op" onclick="probItens(\\'demora\\')">⏱ Está demorando</button>'+
    '<button class="b op" onclick="probItens(\\'errado\\')">🍽 Veio errado</button>'+
    '<button class="b op" onclick="probItens(\\'frio\\')">🌡 Veio frio</button>'+
    '<button class="b op" onclick="probItens(\\'faltou\\')">➖ Faltou alguma coisa</button>'+
    '<button class="b op" onclick="probTexto(\\'salao\\')">🧹 Mesa, louça ou limpeza</button>'+
    '<button class="b op" onclick="probTexto(\\'outro\\')">💬 Outro assunto</button>'+
    '<button class="b g" onclick="inicio()">Voltar</button>');
}
var TITULO={demora:'O que está demorando?',errado:'O que veio errado?',
  frio:'O que veio frio?',faltou:'O que faltou?'};
// Na DEMORA so faz sentido o que ainda nao chegou. Nos outros assuntos o
// problema costuma ser justamente com o que JA chegou — entao a lista muda.
async function probItens(assunto){
  ASSUNTO=assunto;ITSEL={};
  var n=mesaAtual();if(n===null)return;
  app('<h1>'+TITULO[assunto]+'</h1><div class="mut">carregando o seu pedido…</div>');
  var d;try{d=await (await fetch('/api/ja-pedido?n='+n,{cache:'no-store'})).json()}catch(e){d=null}
  ITENS=[];
  ((d&&d.grupos)||[]).forEach(function(g){
    (g.itens||[]).forEach(function(i){
      if(assunto==='demora'&&i.estado==='entregue')return;
      ITENS.push({cod:i.item_codigo,nome:i.nome,qtd:i.quantidade,estado:i.estado,min:i.espera_min,
        onde:g.numero&&Number(g.numero)!==Number(n)?('comanda '+g.numero):null});
    });
  });
  var lista=ITENS.length
    ? ITENS.map(function(i,k){
        var sub=(i.estado==='entregue'?'já entregue':i.estado==='pronto'?'pronto, saindo':'em produção')+
          (i.min!=null?' · há '+i.min+'min':'')+(i.onde?' · '+i.onde:'');
        return '<button class="it" id="it'+k+'" onclick="marcaIt('+k+')">'+
          '<b>'+(i.qtd>1?i.qtd+'x ':'')+esc(i.nome)+'</b><span>'+sub+'</span></button>';
      }).join('')
    : '<div class="mut" style="margin:10px 0">'+(assunto==='demora'
        ? 'Não achei nada em produção agora. Se mesmo assim está esperando, escreva abaixo.'
        : 'Não achei itens no seu pedido. Escreva abaixo o que houve.')+'</div>';
  app('<h1>'+TITULO[assunto]+'</h1>'+
    (ITENS.length?'<div class="mut" style="margin:6px 0 12px">Toque no que tem problema. Pode marcar mais de um.</div>':'')+
    '<div class="itens">'+lista+'</div>'+
    '<input id="tx" placeholder="quer contar mais alguma coisa? (opcional)" style="margin-top:14px">'+
    '<button class="b" onclick="enviarProblema()">Avisar a equipe</button>'+
    '<button class="b g" onclick="telaProblema()">Voltar</button>');
}
function marcaIt(k){
  ITSEL[k]=!ITSEL[k];
  var el=document.getElementById('it'+k);if(el)el.className='it'+(ITSEL[k]?' on':'');
}
function probTexto(assunto){
  ASSUNTO=assunto;ITSEL={};ITENS=[];
  app('<h1>'+(assunto==='salao'?'Mesa, louça ou limpeza':'Conta pra gente')+'</h1>'+
    '<div class="mut" style="margin:8px 0 14px">Escreva o que houve — alguém vai até a sua mesa.</div>'+
    '<input id="tx" placeholder="'+(assunto==='salao'?'ex.: falta talher, mesa suja':'o que aconteceu?')+'">'+
    '<button class="b" onclick="enviarProblema()">Avisar a equipe</button>'+
    '<button class="b g" onclick="telaProblema()">Voltar</button>');
}
var ROTULO={demora:'DEMORA',errado:'VEIO ERRADO',frio:'VEIO FRIO',
  faltou:'FALTOU',salao:'SALÃO',outro:'OUTRO'};
async function enviarProblema(){
  var n=mesaAtual();if(n===null)return;
  var livre=((document.getElementById('tx')||{}).value||'').trim();
  var marcados=Object.keys(ITSEL).filter(function(k){return ITSEL[k]}).map(function(k){
    var i=ITENS[k];
    return (i.qtd>1?i.qtd+'x ':'')+i.nome+(i.min!=null?' ('+i.min+'min)':'');
  });
  if(!marcados.length&&!livre&&ITENS.length){alert('Toque no item com problema, ou escreva o que houve.');return}
  if(!marcados.length&&!livre){alert('Escreva o que houve.');return}
  var txt=(ROTULO[ASSUNTO]||'PROBLEMA')+(marcados.length?' — '+marcados.join(', '):'')+
    (livre?(marcados.length?' · ':' — ')+livre:'');
  var cods=Object.keys(ITSEL).filter(function(k){return ITSEL[k]})
    .map(function(k){return ITENS[k]&&ITENS[k].cod}).filter(Boolean);
  await post('/api/chamado',{mesa:n,tipo:'reclamacao',origem:'qr-mesa',assunto:ASSUNTO,texto:txt,itens:cods});
  app('<div class="ok"><div class="t">✓ Recebemos</div>'+
    '<div class="mut" style="margin-top:8px">Desculpe pelo transtorno. '+
    (ASSUNTO==='demora'?'A cozinha já foi avisada e o seu pedido passa na frente.'
      :'A equipe já foi avisada e vem falar com você.')+'</div></div>'+
    '<div class="cx" style="margin-top:14px"><div class="mut">O que avisamos</div>'+
    '<div style="margin-top:3px">'+esc(txt)+'</div></div>'+
    '<button class="b g" onclick="inicio()">Voltar</button>');
}
// Voltar pro app depois de um tempo revalida: e' exatamente quando a mesa
// pode ter sido fechada e passada pra outra pessoa.
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible'&&MESA)sessaoOk();
});
// ---- VERSÃO NOVA NO SERVIDOR ----
// O app é uma página só: navegar não recarrega nada, então o celular segue
// rodando o JavaScript de quando abriu — mesmo com versão nova no ar. Isso já
// fez três correções "não funcionarem" que estavam certas.
// Confere de minuto em minuto e recarrega SOZINHO quando a versão muda, mas
// só com o carrinho vazio e a tela parada: ninguém perde pedido pela metade.
var VERSAO_MINHA='${VERSAO}';
setInterval(async function(){
  var v;try{v=await (await fetch('/api/versao',{cache:'no-store'})).json()}catch(e){return}
  if(!v||!v.versao||v.versao===VERSAO_MINHA)return;
  if(CART.length)return;                       // tem pedido montado: não mexe
  if(document.visibilityState!=='visible')return;
  location.reload();
},60000);
inicio();
</script></body></html>`;

// ---- TELA DE CONTA / PAGAMENTO (Fase 2) ----
const CONTA_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${LOJA_NOME} — Conta</title><style>
:root{--bg:#f2f2f5;--card:#fff;--line:#e3e3e9;--ink:#1b1b20;--mut:#6e6e78;--gold2:#e0651a;--green:#15a34a;--green2:#0f8a3e;--red:#dc2626}
*{box-sizing:border-box}body{margin:0;font-family:'Outfit',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;padding-bottom:40px}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:10px}
h1{font-size:17px;margin:0}h1 b{color:var(--gold2)}
.back{background:#f0f0f4;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:7px 12px;font:inherit;font-size:14px;cursor:pointer;text-decoration:none;display:inline-block}
.wrap{max-width:560px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.num{width:100%;font:inherit;font-size:26px;text-align:center;padding:14px;border:2px solid var(--line);border-radius:12px}
.big{width:100%;padding:16px;border:0;border-radius:12px;background:var(--green);color:#fff;font:inherit;font-size:17px;font-weight:700;cursor:pointer}
.big:disabled{opacity:.5}
.it{display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid #f0f0f4;font-size:14px}
.it:last-child{border:0}.it .q{color:var(--mut);font-size:12px}
.tot{display:flex;justify-content:space-between;font-size:15px;padding:6px 0}
.tot.g{font-size:22px;font-weight:800;border-top:2px solid var(--line);margin-top:8px;padding-top:12px}
.saldo{color:var(--red)}.quit{color:var(--green2)}
.formas{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
.f{padding:14px;border:2px solid var(--line);background:#fff;border-radius:12px;font:inherit;font-size:15px;font-weight:600;cursor:pointer}
.f.on{border-color:var(--green);background:#eafaf0;color:var(--green2)}
.lbl{font-size:12px;color:var(--mut);margin:10px 0 4px;display:block}
.inp{width:100%;font:inherit;font-size:16px;padding:12px;border:1px solid var(--line);border-radius:10px}
.mut{color:var(--mut);font-size:13px}
.ok{background:#eafaf0;border:1px solid #b6e6c9;color:#12643a;padding:12px;border-radius:12px;margin-top:10px}
.err{background:#fdecec;border:1px solid #f6c5c5;color:#a11;padding:12px;border-radius:12px;margin-top:10px}
.pg{display:flex;justify-content:space-between;font-size:13px;padding:5px 0;color:var(--mut)}
.conta{width:100%;display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:left;
  padding:14px;margin-bottom:8px;border:2px solid var(--line);background:#fff;border-radius:12px;font:inherit;font-size:15px;cursor:pointer}
.conta:active{border-color:var(--gold2);background:#fff8f3}
.conta .v{font-weight:800;font-size:17px;white-space:nowrap}
</style></head><body>
<header><a class="back" href="/venda">‹ Venda</a><h1>${LOJA_HTML} · Conta</h1></header>
<div class="wrap" id="app"></div>
<script>
var NUM=null,MESA=null,DADOS=null,FORMA=null,MODOS=['manual'];
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function brl(v){return 'R$ '+Number(v||0).toFixed(2).replace('.',',')}
async function jget(u){var r=await fetch(u);return r.json()}
async function jpost(u,b){var r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});return r.json()}

function telaNumero(){
  MESA=null;NUM=null;FORMA=null;
  document.getElementById('app').innerHTML=
    '<div class="card"><div class="mut" style="margin-bottom:8px">Número da MESA</div>'+
    '<input class="num" id="n" type="number" inputmode="numeric" placeholder="ex.: 12" autofocus>'+
    '<button class="big" style="margin-top:12px" onclick="abrirMesa()">VER CONTAS DA MESA</button>'+
    '<div class="mut" style="margin-top:10px;text-align:center">${COMANDA_ATIVA ? 'A mesa pode ter várias comandas (' + COMANDA_MIN + '–' + COMANDA_MAX + ').<br>Se souber o número da comanda, digite ele direto.' : 'Digite o número da sua mesa.'}</div></div>';
  document.getElementById('n').addEventListener('keydown',function(e){if(e.key==='Enter')abrirMesa()});
}
/** Mesa -> mostra as contas dela (a própria mesa + comandas vinculadas). */
async function abrirMesa(){
  var n=Number(document.getElementById('n').value);
  if(!n)return;
  if(n>=${COMANDA_DE}){NUM=n;return carregar();}   // digitou a comanda direto
  MESA=n;
  var d=await jget('/api/venda/mesa?n='+n);
  var contas=(d.abertos||[]);
  if(!contas.length){
    document.getElementById('app').innerHTML='<div class="card"><div class="err">Mesa '+n+' não tem conta aberta.</div>'+
      '<button class="big" style="margin-top:12px;background:#888" onclick="telaNumero()">VOLTAR</button></div>';return;
  }
  if(contas.length===1){NUM=contas[0].numero;return carregar();}
  var geral=contas.reduce(function(s,c){return s+Number(c.valor_total||0)},0);
  var h='<div class="card"><div style="font-weight:700;font-size:16px">Mesa '+n+'</div>'+
    '<div class="mut" style="margin:2px 0 12px">'+contas.length+' contas abertas · total geral '+brl(geral)+'</div>';
  contas.forEach(function(c){
    var eh=c.numero>=${COMANDA_DE};
    h+='<button class="conta" onclick="NUM='+c.numero+';carregar()">'+
       '<span><b>'+(eh?'Comanda '+c.numero:'Mesa '+c.numero)+'</b><br><span class="mut">'+c.itens+' itens</span></span>'+
       '<span class="v">'+brl(c.valor_total)+'</span></button>';
  });
  h+='<div class="mut" style="margin-top:10px">Cada conta é paga separada. Se for tudo junto, cobre uma de cada vez.</div>'+
     '<button class="big" style="background:#888;margin-top:10px" onclick="telaNumero()">OUTRA MESA</button></div>';
  document.getElementById('app').innerHTML=h;
}
async function carregar(){
  var d=await jget('/api/conta?n='+NUM);
  if(!d.ok){document.getElementById('app').innerHTML='<div class="card"><div class="err">'+esc(d.erro)+'</div>'+
    '<button class="big" style="margin-top:12px;background:#888" onclick="telaNumero()">VOLTAR</button></div>';return}
  DADOS=d;var s=await jget('/api/pag/status');MODOS=s.modos||['manual'];
  render();
}
function render(){
  var d=DADOS,h='';
  h+='<div class="card"><div style="font-weight:700;font-size:16px;margin-bottom:8px">'+
     (d.numero>=${COMANDA_DE}?'Comanda '+d.numero+(d.mesa?' · Mesa '+d.mesa:''):'Mesa '+d.numero)+
     ' <span class="mut">· pedido #'+d.pedido_fb+'</span></div>';
  d.itens.filter(function(i){return i.tipo!==2}).forEach(function(i){
    h+='<div class="it"><div>'+esc(i.nome)+' <span class="q">×'+i.qtd+'</span></div><div>'+brl(i.valor)+'</div></div>';
  });
  h+='<div class="tot"><span>Subtotal</span><span>'+brl(d.total)+'</span></div>';
  if(d.servico>0)h+='<div class="tot"><span>Serviço</span><span>'+brl(d.servico)+'</span></div>';
  if(d.pago>0)h+='<div class="tot"><span>Já pago</span><span class="quit">− '+brl(d.pago)+'</span></div>';
  h+='<div class="tot g"><span>'+(d.saldo<=0.01?'QUITADA':'A pagar')+'</span><span class="'+(d.saldo<=0.01?'quit':'saldo')+'">'+brl(Math.max(0,d.saldo))+'</span></div></div>';

  if(d.pagamentos&&d.pagamentos.length){
    h+='<div class="card"><div class="mut" style="margin-bottom:6px">Pagamentos registrados por nós</div>';
    d.pagamentos.forEach(function(p){
      h+='<div class="pg"><span>'+esc(p.forma)+(p.nsu?' · NSU '+esc(p.nsu):'')+'</span><span>'+brl(p.valor)+' · '+esc(p.status)+'</span></div>';
    });
    h+='</div>';
  }

  if(d.saldo>0.01){
    h+='<div class="card"><div class="mut">Forma de pagamento</div><div class="formas">'+
      ['dinheiro|Dinheiro','credito|Crédito','debito|Débito','pix|Pix'].map(function(f){
        var k=f.split('|')[0],n=f.split('|')[1];
        return '<button class="f'+(FORMA===k?' on':'')+'" onclick="setForma(\\''+k+'\\')">'+n+'</button>';
      }).join('')+'</div>';
    if(FORMA){
      h+='<label class="lbl">Valor</label><input class="inp" id="v" type="number" step="0.01" value="'+Math.max(0,d.saldo).toFixed(2)+'">';
      if(FORMA==='credito'||FORMA==='debito'||FORMA==='pix'){
        h+='<label class="lbl">NSU (opcional — o que aparece no comprovante da maquininha)</label>'+
           '<input class="inp" id="nsu" inputmode="numeric" placeholder="ex.: 136282">'+
           '<label class="lbl">Autorização (opcional)</label><input class="inp" id="aut" placeholder="ex.: 440774">';
      }
      h+='<button class="big" style="margin-top:12px" id="btn" onclick="pagar()">'+
         (MODOS.indexOf('lio')>=0&&(FORMA==='credito'||FORMA==='debito')?'COBRAR NA MAQUININHA':'REGISTRAR PAGAMENTO')+'</button>';
      if(MODOS.indexOf('lio')<0&&(FORMA==='credito'||FORMA==='debito'))
        h+='<div class="mut" style="margin-top:8px">Cobre na maquininha normalmente e registre aqui. (Quando as credenciais da LIO chegarem, o valor vai direto pro terminal.)</div>';
    }
    h+='</div>';
  }
  h+='<div id="msg"></div>';
  if(MESA)h+='<button class="big" style="background:#5b5b66;margin-top:6px" onclick="document.getElementById(\\'n\\')||0;voltarMesa()">‹ CONTAS DA MESA '+MESA+'</button>';
  h+='<button class="big" style="background:#888;margin-top:6px" onclick="telaNumero()">OUTRA MESA</button>';
  document.getElementById('app').innerHTML=h;
}
function setForma(f){FORMA=(FORMA===f?null:f);render()}
/** volta pra lista de contas da mesa sem perder o contexto */
async function voltarMesa(){
  var m=MESA;FORMA=null;
  document.getElementById('app').innerHTML='<div class="card"><input class="num" id="n" value="'+m+'" style="display:none"></div>';
  await abrirMesa();
}
async function pagar(){
  var btn=document.getElementById('btn');btn.disabled=true;btn.textContent='…';
  var modo=(MODOS.indexOf('lio')>=0&&(FORMA==='credito'||FORMA==='debito'))?'lio':'manual';
  var body={numero:NUM,forma:FORMA,valor:Number(document.getElementById('v').value),modo:modo};
  var nsu=document.getElementById('nsu'),aut=document.getElementById('aut');
  if(nsu&&nsu.value)body.nsu=nsu.value.trim();
  if(aut&&aut.value)body.autorizacao=aut.value.trim();
  var r=await jpost('/api/conta/pagar',body);
  if(r.ok&&r.aguardando){
    document.getElementById('msg').innerHTML='<div class="ok">'+esc(r.msg)+'</div>';
    poll(r.pagamento_id,0);return;
  }
  if(r.ok){
    FORMA=null;
    document.getElementById('msg').innerHTML='<div class="ok"><b>✓ Pagamento registrado</b><div class="mut" style="margin-top:4px">'+
      (r.quitada?'Conta quitada. Feche a comanda no Consumer pra sair a nota.':'Falta '+brl(r.saldo))+'</div></div>';
    await carregar();
  } else {
    document.getElementById('msg').innerHTML='<div class="err">'+esc(r.erro||'erro')+'</div>';
    btn.disabled=false;btn.textContent='REGISTRAR PAGAMENTO';
  }
}
async function poll(id,n){
  if(n>60){document.getElementById('msg').innerHTML='<div class="err">Não confirmou a tempo. Confira na maquininha.</div>';return}
  var r=await jpost('/api/conta/conferir',{pagamento_id:id});
  if(r.ok&&r.pago){FORMA=null;await carregar();
    document.getElementById('msg').innerHTML='<div class="ok"><b>✓ Aprovado na maquininha</b>'+(r.nsu?'<div class="mut">NSU '+esc(r.nsu)+'</div>':'')+'</div>';return}
  setTimeout(function(){poll(id,n+1)},3000);
}
telaNumero();
</script></body></html>`;

// ---- /caixa — tela restrita (Bloco 1): login, abrir mesa, desconto/acréscimo, receber dinheiro ----
const CAIXA_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><link rel="manifest" href="/app.webmanifest?t=caixa"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><link rel="apple-touch-icon" href="/app-icon.png">
<title>${LOJA_NOME} — Caixa</title><style>
:root{--bg:#f2f2f5;--card:#fff;--line:#e3e3e9;--ink:#1b1b20;--mut:#6e6e78;--gold2:#e0651a;--green:#15a34a;--green2:#0f8a3e;--red:#dc2626}
*{box-sizing:border-box}body{margin:0;font-family:'Outfit',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;padding-bottom:40px}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;justify-content:space-between}
h1{font-size:17px;margin:0}h1 b{color:var(--gold2)}
.wrap{max-width:560px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
input{width:100%;font:inherit;padding:12px;border:2px solid var(--line);border-radius:12px}
.num{font-size:24px;text-align:center}
.big{width:100%;padding:15px;border:0;border-radius:12px;background:var(--green);color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer;margin-top:8px}
.big.g{background:#5b5b66}.big.o{background:var(--gold2)}.big:disabled{opacity:.5}
.it{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f4;font-size:14px}
.it:last-child{border:0}
.tot{display:flex;justify-content:space-between;font-size:15px;padding:5px 0}
.tot.g{font-size:22px;font-weight:800;border-top:2px solid var(--line);margin-top:6px;padding-top:10px}
.desc{color:var(--green2)}.acr{color:var(--gold2)}.saldo{color:var(--red)}.quit{color:var(--green2)}
.mut{color:var(--mut);font-size:13px}.tit{font-weight:700;margin:14px 0 6px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.seg{padding:11px;border:1.5px solid var(--line);border-radius:10px;background:#fff;font:inherit;cursor:pointer}
.seg.on{border-color:var(--gold2);background:rgba(224,101,26,.08);color:var(--gold2);font-weight:700}
.err{color:var(--red);font-size:13px;margin-top:6px}
.x{background:none;border:1px solid #eda3a3;color:var(--red);border-radius:7px;padding:1px 7px;font-size:12px;cursor:pointer;margin-right:3px}
a.sair{color:var(--mut);font-size:13px;text-decoration:underline;cursor:pointer}
.lst{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px}
.mchip{text-align:center;padding:8px 4px;border:1.5px solid var(--line);border-radius:12px;background:#fff;font:inherit;cursor:pointer;color:var(--ink)}
.mchip .mn{display:block;font-size:19px;font-weight:800;line-height:1.1}
.mchip b{display:block;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mchip small{display:block;color:var(--mut);font-size:10.5px;margin-top:1px}
.mchip.st-andamento{border-color:#8ed4a8;background:#f1fbf5}
.mchip.st-atrasada{border-color:#e8c25a;background:#fffaeb}
.mchip.st-fechando{border-color:#eda3a3;background:#fdf2f2}
.mchip.sel{border-color:var(--gold2);box-shadow:0 0 0 2px rgba(224,101,26,.22)}
/* teclado numérico PRÓPRIO (POS): botões grandes, teclado do Android nem abre */
.kp{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.kp button{padding:14px 0;font:inherit;font-size:22px;font-weight:800;border:1.5px solid var(--line);border-radius:12px;background:#fff;cursor:pointer}
.kp button:active{background:#f0f0f4}
input.kalvo{border-color:var(--gold2)}
/* celular: um painel por vez (mesa aberta esconde a lista); o convite "toque
   numa mesa" só faz sentido quando os dois painéis estão visíveis */
@media (max-width:899px){body.m #lado{display:none}.ph{display:none}}
/* HOME: as MESAS dominam a tela (regra do dono: mesa é o trabalho, caixa é
   apoio) — grade cheia à esquerda, busca com teclado POS "do lado", e o
   cartão do caixa ABAIXO das mesas. Telas de conta: duas colunas clássicas. */
.wrap.home{max-width:1400px}
@media (min-width:900px){
  .wrap{max-width:1200px;display:grid;grid-template-columns:360px minmax(0,1fr);gap:16px;align-items:start}
  .wrap.home{max-width:1400px;grid-template-columns:minmax(0,1fr) 300px}
  .wrap.home #hside{position:sticky;top:66px}
  .wrap.solo{display:block;max-width:560px}
  #lado{position:sticky;top:66px;max-height:calc(100vh - 80px);overflow:auto}
  .lst{grid-template-columns:repeat(auto-fill,minmax(96px,1fr))}
}
</style><script>if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(function(){});</script></head><body>
<header><h1>${LOJA_NOME} <b>Caixa</b></h1><span id="hdr"></span></header>
<div class="wrap" id="app"></div>
<script>
var TOK=null; try{TOK=localStorage.getItem('caixa_tok')||null}catch(e){}
var NOME=null,PODE={desconto:false,fiado:false,abrir:false,divergente:false,lancar:false,cancItem:false,cancPed:false},MESA=null,CONTA=null,DMODO='valor',CANCIT=null;
var TELA='login',MESAS=null,FLASH=null,CXE=null,TICK=0,CANCEL_ON=false;
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function brl(v){return 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}
function hdrs(x){var h=x||{};if(TOK)h['x-garcom']=TOK;return h}
async function jget(u){var r=await fetch(u,{headers:hdrs(),cache:'no-store'});return r.json()}
async function jpost(u,b){var r=await fetch(u,{method:'POST',headers:hdrs({'content-type':'application/json'}),body:JSON.stringify(b||{})});return r.json()}
function numBr(s){var t=String(s||'').replace(/[^\\d.,]/g,'');if(t.indexOf(',')>=0)t=t.replace(/\\./g,'').replace(',','.');var n=Number(t);return isFinite(n)&&n>0?n:0}
/* teclado numérico da casa: campo de valor/PIN é readonly — o do Android
   ocupava metade da tela e errava fácil. Toque no campo escolhe o alvo. */
var KP_ALVO=null;
function kpAlvo(el){KP_ALVO=el.id;document.querySelectorAll('input.kalvo').forEach(function(x){x.classList.remove('kalvo')});el.classList.add('kalvo')}
function kpHtml(alvo){KP_ALVO=alvo;
  return '<div class="kp">'+['7','8','9','4','5','6','1','2','3',',','0','⌫'].map(function(k){
    return '<button type="button" onclick="kpT(\\''+(k==='⌫'?'back':k)+'\\')">'+k+'</button>'}).join('')+'</div>';}
function kpT(k){
  var e=KP_ALVO&&document.getElementById(KP_ALVO);if(!e)return;
  var v=e.value||'';
  if(k==='back')v=v.slice(0,-1);
  else if(k===','){if(v.indexOf(',')<0)v+=(v?',':'0,')}
  else v+=k;
  e.value=v;
  e.dispatchEvent(new Event('input'));
}
function setHdr(){var e=document.getElementById('hdr');if(e)e.innerHTML=NOME?('<span class="mut">'+esc(NOME)+'</span> · <a class="sair" onclick="sair()">sair</a>'):''}
function sair(){try{localStorage.removeItem('caixa_tok');localStorage.removeItem('garcom_tok')}catch(e){}TOK=null;NOME=null;MESA=null;CONTA=null;TELA='login';setHdr();render()}
/* ---- DOIS painéis ----
   #lado = mesas abertas (fica de pé o tempo todo, se renova a cada 10s)
   #main = conta e ações da mesa escolhida
   No tablet deitado os dois vivem lado a lado (CSS >=900px): toca na mesa à
   esquerda, recebe à direita. No celular, um painel por vez (body.m). */
function irTela(t){TELA=t;render()}
function render(){
  var app=document.getElementById('app');
  document.body.className=(TELA!=='login'&&TELA!=='home')?'m':'';
  if(TELA==='login'){app.className='wrap solo';app.innerHTML='<div id="main"></div>';pintaMain();return}
  if(TELA==='home'){
    app.className='wrap home';
    app.innerHTML='<div id="hgrid">'+
      (FLASH?'<div class="card" style="border-color:var(--green);color:var(--green2);font-weight:700">'+esc(FLASH)+'</div>':'')+
      '<div class="card"><div class="tit" style="margin-top:0">Mesas abertas — toque pra receber</div><div id="lista">'+chips()+'</div></div>'+
      '<div class="card" id="cxbx">'+bannerCx()+'</div></div>'+
      '<div id="hside"><div class="card"><div class="tit" style="margin-top:0">Nº da mesa</div>'+
      '<input id="nm" class="num" inputmode="numeric" placeholder="número" readonly onclick="kpAlvo(this)">'+kpHtml('nm')+
      '<button class="big" onclick="carregar()">Abrir</button><div id="aerr" class="err"></div>'+
      '<div style="margin-top:10px;text-align:right"><a class="sair" onclick="irTela(\\'cancrel\\')">🗒 cancelamentos</a></div></div></div>';
    FLASH=null;return}
  app.className='wrap';
  if(!document.getElementById('lado')||!document.getElementById('main'))
    app.innerHTML='<div id="lado"></div><div id="main"></div>';
  pintaLado();pintaMain();
}
/* banner do MEU caixa: aberto (fundo/dinheiro na gaveta) ou fechado. É a
   porta de abrir/fechar o dia e do relatório. */
function bannerCx(){
  if(!CXE||!CXE.ok)return '';
  if(CXE.aberto){var a=CXE.aberto;
    return '<div class="tit" style="margin-top:0">🧰 Seu caixa · <b style="color:var(--green2)">ABERTO</b></div>'+
      '<div class="mut">fundo '+brl(a.fundo)+' · dinheiro recebido '+brl(a.dinheiro)+
      (a.saidas?' · saídas '+brl(a.saidas):'')+' · na gaveta ~'+brl(a.esperado)+'</div>'+
      '<div class="row" style="margin-top:8px">'+
      (PODE.mov?'<button class="seg" onclick="irTela(\\'mov\\')">↕ Gaveta</button>':'')+
      '<button class="seg" onclick="irTela(\\'rel\\')">📊 Movimento</button>'+
      '<button class="seg" onclick="irTela(\\'fechacx\\')">Fechar caixa</button></div>'+
      (PODE.admin?'<div style="margin-top:8px;text-align:right"><a class="sair" onclick="irTela(\\'usu\\')">👤 usuários do sistema</a></div>':'');}
  return '<div class="tit" style="margin-top:0">🧰 Seu caixa · fechado</div>'+
    (PODE.abrir
      ?'<button class="big o" style="margin-top:6px" onclick="irTela(\\'abrircx\\')">Abrir caixa</button>'
      :'<div class="mut">sem permissão de abrir caixa — dinheiro bloqueado (cartão/Pix seguem normais)</div>')+
    '<div style="margin-top:8px;text-align:right">'+
      '<a class="sair" onclick="irTela(\\'rel\\')">📊 Movimento do caixa</a>'+
      (PODE.admin?' · <a class="sair" onclick="irTela(\\'usu\\')">👤 usuários do sistema</a>':'')+
    '</div>';
}
async function cxEstado(){
  try{var r=await jget('/api/caixa/estado');if(r&&r.ok)CXE=r}catch(e){}
  var b=document.getElementById('cxbx');if(b)b.innerHTML=bannerCx();
}
function pintaLado(){
  var el=document.getElementById('lado');if(!el)return;
  if(TELA==='login'){el.innerHTML='';return}
  var st=el.scrollTop; // repintar não pode jogar a lista de volta pro topo
  el.innerHTML='<div class="card"><div class="tit" style="margin-top:0">Mesas</div><div id="lista">'+chips()+'</div>'+
    '<button class="seg" style="margin-top:8px;width:100%" onclick="voltarMesas()">◂ todas as mesas · caixa</button></div>';
  el.scrollTop=st;
}
function chips(){
  if(MESAS==null)return '<span class="mut">carregando…</span>';
  var h='';
  (MESAS.mesas||[]).forEach(function(m){h+=mchip(m.numero,'Mesa '+m.numero,m)});
  (MESAS.comandas||[]).forEach(function(c){h+=mchip(c.numero,'Comanda '+c.numero,c)});
  return h?('<div class="lst">'+h+'</div>'):'<span class="mut">nenhuma mesa aberta agora</span>';
}
/* "há 14h" — entrega aberta desde ontem quase sempre é conta que ninguém
   fechou, não pedido em andamento. O tempo na cara evita a caça no fim do mês. */
function haQuanto(ab){
  if(!ab)return '';
  var min=Math.round((Date.now()-new Date(ab).getTime())/60000);
  if(min<60)return ' · '+min+'min';
  var h=Math.floor(min/60);
  return h<24?(' · '+h+'h'):(' · '+Math.floor(h/24)+'d');
}
/* Entrega não tem mesa: no Consumer ela nasce com NUMERO=0. A grade mostrava
   um "0" seco e todo mundo perguntava que mesa era essa. Agora diz o canal. */
/* origem 7 = DeliveryHub, o integrador. Na Tabuará quem está plugado nele é
   o iFood (confirmado pelo dono, 23/08/2026) — então é iFood que o caixa
   precisa ler. Entrando outro canal no mesmo hub, este rótulo mente: aí o
   certo é ler o canal real do pedido, não a origem. */
var ORIGEM_LBL={4:'iFood',5:'MenuDino',6:'MenuDino',7:'iFood',8:'Totem'};
function mchip(num,lbl,m){
  // denso de propósito: a casa tem MUITAS mesas — número grande pra bater o
  // olho de longe, nome e valor pequenos embaixo
  var com=Number(num)>=${COMANDA_DE};
  var ent=ORIGEM_LBL[Number(m.origem)];
  if(ent||Number(num)===0){
    return '<button class="mchip st-'+(m.status||'andamento')+(Number(m.codigo)===Number(PEDALVO)?' sel':'')+'" onclick="carregar('+num+','+(m.codigo||0)+')">'+
      '<span class="mn" style="font-size:15px;line-height:1.5">🛵</span>'+
      '<b>'+esc(ent||'Balcão')+(m.codigo?' #'+m.codigo:'')+'</b>'+
      '<small>'+brl(m.valor_total)+haQuanto(m.data_abertura)+'</small></button>';
  }
  return '<button class="mchip st-'+(m.status||'andamento')+(Number(num)===Number(MESA)?' sel':'')+'" onclick="carregar('+num+')">'+
    '<span class="mn">'+(com?'C':'')+num+'</span>'+
    (m.nome?'<b>'+esc(m.nome)+'</b>':'')+
    '<small>'+brl(m.valor_total)+'</small></button>';
}
async function listar(){
  // renova SÓ o miolo da lista: o campo "digite o número" pode estar em uso
  try{MESAS=await jget('/api/venda/abertas')}catch(e){return}
  var el=document.getElementById('lista');if(el)el.innerHTML=chips();
}
function pintaMain(){
  var el=document.getElementById('main');if(!el)return;
  if(TELA==='login')return telaLogin(el);
  if(TELA==='home')return; // home é desenhada direto no render()
  if(TELA==='conta')return pinta(el);
  if(TELA==='desc')return telaDesc(el);
  if(TELA==='acr')return telaAcr(el);
  if(TELA==='rec')return telaReceber(el);
  if(TELA==='manual')return telaManual(el);
  if(TELA==='fiado')return telaFiado(el);
  if(TELA==='pix')return; // desenhada pelo pixCaixa()
  if(TELA==='abrircx')return telaAbrirCx(el);
  if(TELA==='fechacx')return telaFechaCx(el);
  if(TELA==='confcx')return telaConfCx(el);
  if(TELA==='rel')return telaRel(el);
  if(TELA==='mov')return telaMov(el);
  if(TELA==='usu')return telaUsu(el);
  if(TELA==='canc')return telaCancItem(el);
  if(TELA==='libcanc')return telaLibCanc(el);
  if(TELA==='cancrel')return telaCancRel(el);
}
async function inicio(){
  var s=null; if(TOK){try{s=await jget('/api/caixa/sessao')}catch(e){}}
  if(s&&s.ok){NOME=s.nome||s.login;PODE={admin:!!s.admin,desconto:!!s.pode_desconto,fiado:!!s.pode_fiado,abrir:!!s.pode_abrir,divergente:!!s.pode_divergente,mov:!!s.pode_mov,transf:!!s.pode_transf,lancar:!!s.pode_lancar,cancItem:!!s.pode_canc_item,cancPed:!!s.pode_canc_pedido};
    try{localStorage.setItem('garcom_tok',TOK)}catch(e){} // mesmo token: /venda abre logado pro caixa lançar
    TELA='home';setHdr();render();listar();cxEstado()}
  else {TOK=null;TELA='login';render()}
}
function telaLogin(el){
  setHdr();
  el.innerHTML='<div class="card"><div class="tit" style="margin-top:0">Entrar no caixa</div>'+
    '<div class="mut" style="margin-bottom:10px">Só quem tem acesso a pagamentos no Consumer.</div>'+
    '<input id="lg" placeholder="seu login" autocapitalize="none">'+
    '<input id="pn" class="num" type="password" autocomplete="off" inputmode="numeric" placeholder="PIN" style="margin-top:8px" maxlength="8" readonly onclick="kpAlvo(this)">'+
    '<div id="pn2box"></div>'+kpHtml('pn')+
    '<button class="big" onclick="entrar()">Entrar</button>'+
    '<div id="lerr" class="err"></div></div>';
  var e=document.getElementById('lg');if(e)e.focus();
}
async function entrar(){
  var login=(document.getElementById('lg')||{}).value||'';
  var pin=((document.getElementById('pn')||{}).value||'').replace(/\\D/g,'');
  var z=document.getElementById('pn2'); var pin2=z?(z.value||'').replace(/\\D/g,''):undefined;
  var er=document.getElementById('lerr');er.textContent='';
  var r=await jpost('/api/caixa/entrar',{login:login,pin:pin,pin2:pin2});
  if(r.primeira_vez&&!r.token){
    document.getElementById('pn2box').innerHTML='<div class="mut" style="margin-top:8px">Primeira vez — repita o PIN pra criar:</div>'+
      '<input id="pn2" class="num" type="password" autocomplete="off" inputmode="numeric" placeholder="repita o PIN" maxlength="8" style="margin-top:6px" readonly onclick="kpAlvo(this)">';
    er.textContent=r.erro||'';var y=document.getElementById('pn2');if(y)y.focus();return;
  }
  if(!r.ok){er.textContent=r.erro||'não entrou';return}
  TOK=r.token;try{localStorage.setItem('caixa_tok',TOK);localStorage.setItem('garcom_tok',TOK)}catch(e){}
  NOME=r.nome||login;PODE={admin:!!r.admin,desconto:!!r.pode_desconto,fiado:!!r.pode_fiado,abrir:!!r.pode_abrir,divergente:!!r.pode_divergente,mov:!!r.pode_mov,transf:!!r.pode_transf,lancar:!!r.pode_lancar,cancItem:!!r.pode_canc_item,cancPed:!!r.pode_canc_pedido};
  setHdr();TELA='home';MESAS=null;render();listar();cxEstado();
}
var HOME_Y=0;
/* ALVO da conta aberta: null = mesa comum (o servidor acha pelo número);
   número = pedido específico, o caso da ENTREGA (número 0, várias abertas).
   alvo() carimba o corpo de toda ação que mexe em dinheiro — esquecer numa
   delas faria a ação cair em outra entrega. */
var PEDALVO=null;
function alvo(b){ if(PEDALVO)b.ped=PEDALVO; return b }
function ehEntrega(){ return PEDALVO!=null && Number(MESA)===0 }
function voltarMesas(){pixPara();MESA=null;CONTA=null;CANCEL_ON=false;PEDALVO=null;irTela('home');
  setTimeout(function(){window.scrollTo(0,HOME_Y)},0)} // volta NO MESMO lugar da lista
async function carregar(n,ped){
  var num=n!=null?n:Number(((document.getElementById('nm')||{}).value||'').replace(/\\D/g,''));
  // ENTREGA vem com número 0 e só é endereçável pelo código do pedido; mesa
  // continua exigindo número. O servidor confere o par (pedidoAlvo).
  PEDALVO=ped?Number(ped):null;
  if(!(num>0)&&!PEDALVO){var a=document.getElementById('aerr');if(a)a.textContent='digite o número';return}
  if(TELA==='home')HOME_Y=window.scrollY||0; // pra voltar no mesmo ponto da lista
  if(MESA==null||Number(num)!==Number(MESA)){CANCEL_ON=false;PAGON=false} // trocou de mesa: trava de novo
  if(!CONTA||Number(CONTA.numero)!==Number(num))CONTA=null;
  MESA=num;irTela('conta');
  var c=await jget('/api/caixa/conta?n='+num+(PEDALVO?'&ped='+PEDALVO:''));
  if(!c.ok){var el=document.getElementById('main');if(el)el.innerHTML='<div class="card"><div class="err">'+esc(c.erro||'não achei a conta')+'</div>'+
    (PODE.lancar&&num>0?'<button class="big o" onclick="lancarNum('+num+')">🍽 Abrir lançando produtos</button>':'')+
    '<button class="big" style="background:#eef2f7;color:#0f172a" onclick="nfceOferecer('+num+',function(){voltarMesas()})">🧾 NFC-e do último pedido fechado (12h)</button>'+
    '<button class="big g" onclick="voltarMesas()">Voltar</button></div>';return}
  CONTA=c; // já vem com comandas_mesa/geral do servidor (atômico — sem piscar)
  if(TELA==='conta'&&Number(MESA)===Number(c.numero))pintaMain();
  var el2=document.getElementById('lista');if(el2)el2.innerHTML=chips(); // marca o chip escolhido
}
/* ---- IDENTIFICAR na própria tela (overlay): CPF ou WhatsApp → busca o nome
   (casa → já-atendidos → grupo → SPC) → confirma → o chip vira o nome. */
var IDACH=null;
function identCx(){
  var ov=document.createElement('div');ov.id='idov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML='<div class="card" style="max-width:400px;width:100%;margin:0;max-height:88vh;overflow:auto">'+
    '<div class="tit" style="margin-top:0">👤 Identificar — '+(MESA>=${COMANDA_DE}?'comanda':'mesa')+' '+MESA+'</div>'+
    '<div class="mut">CPF ou WhatsApp — o sistema acha o nome sozinho.</div>'+
    '<input id="iddoc" class="num" inputmode="numeric" placeholder="CPF ou WhatsApp (só números)" style="margin-top:8px">'+
    '<button class="big" onclick="identBusca(this)">🔎 Buscar</button>'+
    '<div id="idres"></div>'+
    '<button class="big" style="background:#eef2f7;color:#0f172a" onclick="document.getElementById(\\'idov\\').remove()">Voltar</button>'+
    '<div id="iderr" class="err"></div></div>';
  document.body.appendChild(ov);
  var e=document.getElementById('iddoc');if(e)e.focus();
}
async function identBusca(btn){
  var v=((document.getElementById('iddoc')||{}).value||'').replace(/\\D/g,'');
  var er=document.getElementById('iderr');if(er)er.textContent='';
  if(v.length<10){if(er)er.textContent='digite o CPF (11) ou o WhatsApp com DDD';return}
  var ehCpf=(v.length===11);
  btn.disabled=true;
  var r=await jget('/api/venda/identificar?cpf='+(ehCpf?v:'')+'&tel='+(ehCpf?'':v));
  if(ehCpf&&(!r||!r.ok)){r=await jget('/api/venda/identificar?cpf=&tel='+v);ehCpf=false} // 11 dígitos que não é CPF: tenta como fone
  btn.disabled=false;
  IDACH={cpf:ehCpf?v:null,tel:ehCpf?null:v,contato_fb:(r&&r.contato_fb)||null,nome:(r&&r.nome)||null};
  var res=document.getElementById('idres');if(!res)return;
  if(r&&r.nome){
    res.innerHTML='<div class="it" style="margin-top:8px"><span><b>'+esc(r.nome)+'</b><small class="mut" style="display:block">'+esc(r.fonte||'')+'</small></span><b></b></div>'+
      '<button class="big" style="background:#0a7d38" onclick="identSalva(this,false)">✓ É essa pessoa — identificar</button>';
  }else{
    res.innerHTML='<div class="mut" style="margin-top:8px">'+((r&&r.aviso)?esc(r.aviso)+' — ':'')+'não achei. Digita o nome:</div>'+
      '<input id="idnome" placeholder="nome do cliente" style="margin-top:6px">'+
      '<button class="big" style="background:#0a7d38" onclick="identSalva(this,true)">✓ Cadastrar e identificar</button>';
  }
}
async function identSalva(btn,novo){
  var nome=(IDACH&&IDACH.nome)||((document.getElementById('idnome')||{}).value||'').trim();
  var er=document.getElementById('iderr');
  if(!nome){if(er)er.textContent='sem nome não dá';return}
  btn.disabled=true;
  var b={numero:MESA,nome:nome};
  if(IDACH&&IDACH.cpf)b.cpf=IDACH.cpf;
  if(IDACH&&IDACH.tel)b.telefone=IDACH.tel;
  if(IDACH&&IDACH.contato_fb)b.contato_fb=IDACH.contato_fb;else if(novo)b.cadastrar=true;
  var r=await jpost('/api/venda/identificar',b);
  btn.disabled=false;
  if(!r||!r.ok){if(er)er.textContent=(r&&r.erro)||'não salvou';return}
  var o=document.getElementById('idov');if(o)o.remove();
  await carregar(MESA);
}
/* 👤 quem lançou o item. O pedido que nasce no celular da mesa vem com o
   autor 'cliente' — antes ficava em branco e virava discussão no caixa. */
function autorItem(i){
  if(i.tipo===2||!i.quem)return '';
  var cli=String(i.quem).toUpperCase().indexOf('CLIENTE')===0;
  var t=cli?'📱 pedido pela mesa':'👤 '+esc(String(i.quem).split(' ')[0]);
  return '<small class="mut" style="display:block;padding-left:22px">'+t+'</small>';
}
/* ⏱ o relógio do item na conta do caixa. Entregue: cinza, é histórico —
   "esse veio em 12min". Esperando: cor, é problema em curso — e vermelho
   quando já passou do tempo da praça. Complemento (tipo 2) não tem relógio
   próprio: ele sai junto com o prato-pai. */
function relogioItem(i){
  if(i.tipo===2||i.espera_min==null)return '';
  var t=i.espera_min<60?(i.espera_min+'min')
        :(Math.floor(i.espera_min/60)+'h'+String(i.espera_min%60).padStart(2,'0'));
  if(!i.esperando)return ' <small class="mut">⏱ '+t+'</small>';
  var cor=i.atrasado?'#b3261e':'#8a6d00';
  return ' <small style="color:'+cor+';font-weight:700">⏳ '+t+(i.atrasado?' ⚠':'')+'</small>';
}
function pinta(el){
  var c=CONTA;
  if(!c||Number(c.numero)!==Number(MESA)){el.innerHTML='<div class="mut" style="padding:16px">abrindo…</div>';return}
  var h='<button class="seg" style="margin-bottom:10px" onclick="voltarMesas()">◂ mesas</button>'+
    '<div class="card"><div class="tit" style="margin-top:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
      '<span>'+(ehEntrega()?'🛵 Entrega #'+PEDALVO:((c.numero>=${COMANDA_DE}?'Comanda ':'Mesa ')+c.numero))+(c.nome?' · '+esc(c.nome):'')+'</span>'+
      '<span style="flex:1"></span>'+
      // comandas da mesa como chips ao lado do número — um toque troca a conta
      (c.comandas_mesa||[]).map(function(cc){return '<button class="seg" onclick="carregar('+cc.numero+')">C'+cc.numero+(cc.nome?' '+esc(String(cc.nome).split(' ')[0]):'')+'</button>'}).join('')+
      (ehEntrega()?'':'<button class="seg" onclick="identCx()">👤 '+(c.nome?esc(String(c.nome).split(' ')[0]):'identificar')+'</button>')+
    '</div>';
  h+=(c.itens||[]).map(function(i,ix){
    return '<div class="it"><span>'+
      (CANCEL_ON&&PODE.cancItem&&i.item_codigo&&i.tipo!==2?'<button class="x" onclick="cancItem('+ix+')" title="cancelar este item">✕</button> ':'')+
      (i.tipo===2?'<span style="display:inline-block;width:22px"></span>+ ':i.quantidade+'× ')+esc(i.nome)+
      (i.tipo!==2&&i.detalhes&&i.detalhes!=='NENHUM'?'<small class="mut" style="display:block;padding-left:22px">✎ '+esc(String(i.detalhes).split('|').map(function(s){return s.trim()}).filter(function(s){return s&&s!=='NENHUM'&&s.indexOf('>>')!==0}).join(' · '))+'</small>':'')+
      (i.status==='entregue'?' <small class="mut">✓entregue</small>':i.status==='pronto'?' <small class="mut">✓pronto</small>':'')+
      // ⏱ TEMPO DE ESPERA: entregue = quanto o cliente esperou de verdade;
      // ainda não = relógio correndo, vermelho quando passa do tempo da praça.
      relogioItem(i)+
      // QUEM LANÇOU: conferir a conta com o cliente na frente é discutir item a
      // item. Sem o nome, "eu não pedi isso" não tem com quem esclarecer.
      // 📱 = a própria mesa pediu pelo celular; 👤 = garçom (o nosso ou o do
      // Consumer). Os dois casos são resposta — em branco é que não era.
      autorItem(i)+
      '</span><b>'+(i.tipo===2&&!(i.valor_total>0)?'':brl(i.valor_total))+'</b></div>'}).join('')||'<div class="mut">sem itens no espelho</div>';
  h+='<div class="tot"><span>Subtotal</span><b>'+brl(c.subtotal)+'</b></div>';
  // O cliente pode se recusar a pagar os 10% — é direito dele. Um toque aqui
  // TIRA a taxa (some do total), em vez do caixa ter que calcular e lançar
  // desconto na mão. Quem pode é quem tem "Aplicar Descontos / Modificar
  // Taxas" no Consumer, e fica registrado quem tirou.
  if(c.servico>0)h+='<div class="tot"><span>Serviço (10%)'+
    (PODE.desconto?' <a class="sair" style="font-size:12px" onclick="tiraServico(1)">tirar</a>':'')+
    '</span><b>'+brl(c.servico)+'</b></div>';
  else if(c.subtotal>0)h+='<div class="tot"><span style="color:var(--red)">Serviço (10%) retirado'+
    (PODE.desconto?' <a class="sair" style="font-size:12px" onclick="tiraServico(0)">cobrar</a>':'')+
    '</span><b>—</b></div>';
  if(c.desconto>0)h+='<div class="tot desc"><span>Desconto</span><b>− '+brl(c.desconto)+'</b></div>';
  if(c.acrescimo>0)h+='<div class="tot acr"><span>Acréscimo</span><b>+ '+brl(c.acrescimo)+'</b></div>';
  if(c.pago>0)h+='<div class="tot"><span>Já pago</span><b>− '+brl(c.pago)+'</b></div>';
  h+='<div class="tot g"><span>'+(c.pago>0?'Falta':'Total')+'</span><b class="'+(c.falta>0?'saldo':'quit')+'">'+brl(c.falta)+'</b></div></div>';
  // MESA COM COMANDAS PENDURADAS: cada uma listada aqui, um toque abre a conta
  // dela (contas separadas — quem paga é cada comanda; o GERAL soma tudo)
  if(c.comandas_mesa&&c.comandas_mesa.length){
    h+='<div class="card"><div class="tit" style="margin-top:0">Comandas nesta mesa</div>'+
      c.comandas_mesa.map(function(cc){return '<button style="display:flex;justify-content:space-between;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid #eee;padding:12px 2px;font:inherit;font-size:16px;cursor:pointer" onclick="carregar('+cc.numero+')">'+
        '<span><b>Comanda '+cc.numero+'</b>'+(cc.nome?' · '+esc(cc.nome):'')+'</span>'+
        '<b>'+(cc.quitada?'✓ paga':brl(cc.resta))+'</b></button>'}).join('')+
      (c.geral!=null?'<div class="tot g"><span>Mesa + comandas</span><b>'+brl(c.geral)+'</b></div>':'')+
      '</div>';
  }
  h+='<div class="card">';
  // ORDEM DO USO REAL (regra do dono, 11/08): lançar/transferir/pedir conta na
  // frente; dinheiro/desconto moram dentro de 💰 Pagamento — pagar é o ato
  // mais raro do caixa, não o primeiro botão.
  // ENTREGA: o pedido é do canal (iFood/hub) — aqui o caixa só RECEBE e fecha.
  // Lançar item, transferir de mesa e "pedir conta" não existem nesse mundo, e
  // botão que não faz sentido é botão que alguém aperta por engano.
  if(!ehEntrega()){
    if(PODE.lancar)h+='<button class="big o" onclick="lancarCx()">🍽 Pedir itens</button>';
    h+='<div class="row"><button class="big" style="margin-top:0;background:#475569" onclick="transfCx()">⇄ Transferir</button>'+
       '<button class="big" style="margin-top:0;background:#8a6d0b" onclick="pedirContaCx(this)">🔒 Pedir conta</button></div>';
  }
  if(c.falta>0){
    h+='<button class="big" style="background:#0b5c8a" onclick="PAGON=!PAGON;pintaMain()">💰 Pagamento '+(PAGON?'▴':'▾')+'</button>';
    if(PAGON){
      // desconto e acréscimo = a MESMA permissão do Consumer (12: Descontos/Taxas)
      h+='<div class="row" style="margin-top:6px">'+(PODE.desconto?'<button class="seg" onclick="irTela(\\'desc\\')">% Desconto</button>':'<button class="seg" disabled style="opacity:.5">Desconto (sem permissão)</button>')+
         (PODE.desconto?'<button class="seg" onclick="irTela(\\'acr\\')">+ Acréscimo</button>':'<button class="seg" disabled style="opacity:.5">Acréscimo (sem permissão)</button>')+'</div>';
      h+='<div class="row"><button class="big" style="margin-top:6px" onclick="irTela(\\'rec\\')">💵 Dinheiro</button>'+
         '<button class="big" style="margin-top:6px;background:#0f8a3e" onclick="pixCaixa()">📲 Pix</button></div>';
      // A maquininha às vezes recebe e NÃO baixa a comanda. Aqui o caixa
      // registra o que entrou, com a foto do comprovante — e pode ser parcial.
      h+='<button class="big" style="margin-top:6px;background:#0369a1" onclick="irTela(\\'manual\\')">🧾 Recebimento manual (com comprovante)</button>';
      // FIADO: fecha a conta lançando na conta corrente do cliente (perm 16)
      if(PODE.fiado)h+='<button class="big" style="margin-top:6px;background:#7c3aed" onclick="irTela(\\'fiado\\')">🧾 Fiado (conta do cliente)</button>';
    }
  }
  // quitou (ou mesa sem consumo)? o ato que resta é FECHAR — libera a mesa
  else h+='<button class="big" onclick="fecharConta()">✓ Fechar conta e liberar a mesa</button>';
  // cancelamentos ficam ATRÁS do cadeado: gerente libera, os ✕ aparecem
  if(CANCEL_ON&&PODE.cancPed&&!(c.pago>0))h+='<button class="big" style="background:#fff;color:var(--red);border:1.5px solid #eda3a3" onclick="cancPedido()">🗑 Cancelar o pedido inteiro</button>';
  h+='<div id="cerr" class="err"></div>';
  if(PODE.cancItem&&!CANCEL_ON)h+='<div style="margin-top:10px;text-align:right"><a class="sair" onclick="irTela(\\'libcanc\\')">🔒 cancelar item…</a></div>';
  if(CANCEL_ON)h+='<div style="margin-top:10px;text-align:right;font-size:13px"><b style="color:var(--red)">🔓 cancelamentos liberados nesta mesa</b> · <a class="sair" onclick="CANCEL_ON=false;pintaMain()">travar</a></div>';
  h+='<div class="mut" style="margin-top:8px">Cartão na maquininha · Pix na tela do cliente/garçom.</div></div>';
  el.innerHTML=h;
}
/* ---- RECEBIMENTO MANUAL (a maquininha recebeu e não baixou a comanda) ----
   Fluxo do balcão: escolhe a forma, digita o valor (pode ser parcial), anexa
   a foto do comprovante e confirma. Repete até a conta fechar.
   A foto vem da câmera do tablet quando o navegador libera; quando não libera
   (HTTP, tablet sem câmera), um QR manda o caixa fotografar pelo celular. */
var MAN = { forma: 'pix', token: null, foto: null, arquivo: null, poll: null };
function manParar(){ if(MAN.poll){clearInterval(MAN.poll);MAN.poll=null} }
function telaManual(el){
  manParar(); MAN.token=null; MAN.foto=null; MAN.arquivo=null;
  var c=CONTA||{};
  var formas=[['dinheiro','💵 Dinheiro'],['pix','📲 Pix'],['credito','💳 Crédito'],['debito','💳 Débito']];
  var chips=formas.map(function(f){
    return '<button class="seg'+(MAN.forma===f[0]?' on':'')+'" onclick="manForma(\\''+f[0]+'\\')">'+f[1]+'</button>';
  }).join('');
  el.innerHTML='<button class="seg" style="margin-bottom:10px" onclick="manParar();irTela(\\'conta\\')">◂ voltar</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">Recebimento manual · mesa '+MESA+'</div>'+
    '<div class="mut">Falta <b>'+brl(c.falta||0)+'</b>. Pode receber em partes — cada entrada com seu comprovante.</div>'+
    '<div class="row" style="margin-top:10px" id="mchips">'+chips+'</div>'+
    '<input id="mv" class="num" inputmode="decimal" placeholder="quanto entrou?" readonly onclick="kpAlvo(this)" style="margin-top:10px">'+kpHtml('mv')+
    '<div id="mcomp"></div>'+
    '<button class="big" id="mok" onclick="manConfirmar()">Confirmar recebimento</button>'+
    '<div id="merr" class="err"></div></div>';
  manForma(MAN.forma);
  var mv=document.getElementById('mv'); if(mv)mv.addEventListener('input',manEstado);
}
/* A trava tem que ser VISÍVEL. Antes o botão ficava verde e clicável mesmo sem
   comprovante — só o servidor recusava, e o caixa descobria depois de clicar. */
function manEstado(){
  var b=document.getElementById('mok'); if(!b)return;
  var v=numBr((document.getElementById('mv')||{}).value);
  var temFoto=!!(MAN.foto||MAN.arquivo);
  var precisa=MAN.forma!=='dinheiro';
  var falta = !(v>0) ? 'digite o valor' : (precisa&&!temFoto ? 'falta o comprovante' : null);
  b.disabled=!!falta;
  b.style.opacity=falta?'.45':'1';
  b.style.background=falta?'#94a3b8':'';
  b.textContent=falta?('🔒 '+falta):'Confirmar recebimento';
}
function manForma(f){
  MAN.forma=f; MAN.foto=null; MAN.arquivo=null; MAN.token=null; MAN.dados=null; manParar();
  var chips=document.getElementById('mchips');
  if(chips)Array.prototype.forEach.call(chips.children,function(b){
    b.classList.toggle('on', b.textContent.toLowerCase().indexOf(f==='dinheiro'?'dinheiro':f==='pix'?'pix':f==='credito'?'crédito':'débito')>=0);
  });
  var box=document.getElementById('mcomp'); if(!box)return;
  if(f==='dinheiro'){ box.innerHTML='<div class="mut" style="margin-top:10px">Dinheiro não precisa de comprovante — entra na sua gaveta.</div>'; manEstado(); return }
  // NSU: cartão manual SEM o NSU não tem par na conciliação e o caixa não
  // fecha sozinho (caso do pedido 158633, 20/08). O número está impresso no
  // próprio comprovante (DOC/NSU) — digitar aqui resolve na origem.
  // Pix na casa SEMPRE passa pela maquininha (regra do dono: não se aceita Pix
  // direto na conta) — então Pix sem NSU é erro igual cartão sem NSU.
  var nsuHtml=(f==='credito'||f==='debito'||f==='pix')
    ? '<div class="mut" style="margin-top:12px"><b>NSU do comprovante</b> — número impresso no papel da maquininha'+(f==='pix'?' (o Pix daqui sempre passa por ela)':'')+'</div>'+
      '<input id="mnsu" inputmode="numeric" autocomplete="off" placeholder="a foto preenche sozinha" style="margin-top:6px">'
    : '';
  box.innerHTML=nsuHtml+
    '<div class="mut" style="margin-top:12px"><b>Comprovante (obrigatório)</b></div>'+
    '<div class="row" style="margin-top:6px">'+
      '<button class="seg" onclick="manCamera()">📷 Câmera do tablet</button>'+
      '<button class="seg" onclick="manCelular()">📱 Pelo meu celular</button>'+
    '</div><div id="mcbox"></div>';
  manEstado();
}
/* Câmera do tablet: só existe em contexto seguro (https). Se não der, avisa e
   oferece o celular — em vez de deixar o caixa preso numa tela morta. */
async function manCamera(){
  var box=document.getElementById('mcbox'); if(!box)return;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    box.innerHTML='<div class="mut" style="margin-top:8px">Este tablet não libera a câmera aqui (precisa do modo seguro). Use <b>Pelo meu celular</b>.</div>';
    return;
  }
  box.innerHTML='<video id="mvid" autoplay playsinline muted style="width:100%;border-radius:12px;margin-top:8px;background:#000"></video>'+
    '<button class="big" onclick="manClicar()">📸 Tirar a foto</button>';
  try{
    var st=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    var v=document.getElementById('mvid'); if(v){v.srcObject=st;MAN.stream=st}
  }catch(e){
    box.innerHTML='<div class="mut" style="margin-top:8px">A câmera não abriu ('+esc(e.name||'erro')+'). Use <b>Pelo meu celular</b>.</div>';
  }
}
async function manClicar(){
  var v=document.getElementById('mvid'); if(!v)return;
  var c=document.createElement('canvas');
  var k=Math.min(1,1280/Math.max(v.videoWidth||1280,v.videoHeight||720));
  c.width=(v.videoWidth||1280)*k; c.height=(v.videoHeight||720)*k;
  c.getContext('2d').drawImage(v,0,0,c.width,c.height);
  MAN.foto=c.toDataURL('image/jpeg',0.8);
  if(MAN.stream){MAN.stream.getTracks().forEach(function(t){t.stop()});MAN.stream=null}
  var box=document.getElementById('mcbox');
  box.innerHTML='<img src="'+MAN.foto+'" style="width:100%;border-radius:12px;margin-top:8px">'+
    '<div class="mut">✓ foto pronta · lendo o comprovante…</div>';
  manEstado();
  // sobe agora (em vez de só na confirmação) pra IA ler e preencher o NSU
  var r=await jpost('/api/caixa/comprovante-foto',{numero:MESA,forma:MAN.forma,foto:MAN.foto,
    valor:numBr((document.getElementById('mv')||{}).value)});
  if(r&&r.ok){MAN.arquivo=r.arquivo;MAN.foto=null;MAN.token=r.token;manLido(r.arquivo,r.dados,'tablet')}
  else{box.innerHTML='<img src="'+MAN.foto+'" style="width:100%;border-radius:12px;margin-top:8px">'+
    '<div class="mut">✓ foto pronta</div><button class="seg" onclick="manCamera()">tirar outra</button>'}
  manEstado();
}
/* O QUE A IA LEU NO PAPEL. Preenche o NSU sozinho (é o número que casa com o
   extrato da operadora) e avisa das duas coisas que o caixa não pode deixar
   passar: via do CLIENTE em vez da loja, e valor do papel diferente do
   digitado. Nada disso bloqueia — quem decide é quem está com o papel na mão. */
function manLido(arquivo, d, origem){
  var box=document.getElementById('mcbox'); if(!box)return;
  MAN.dados=d||null;
  var img='<img src="/foto/'+esc(arquivo)+'" style="width:100%;border-radius:12px;margin-top:8px">';
  var vindo='<div class="mut">✓ comprovante '+(origem==='tablet'?'anexado':'recebido do celular')+'</div>';
  if(!d||d.confianca==='erro'){
    box.innerHTML=img+vindo+'<div class="mut">não consegui ler o papel — pode confirmar assim mesmo'+
      (d&&d.observacao?' ('+esc(d.observacao)+')':'')+'</div>'+
      '<button class="seg" onclick="manCamera()">tirar outra</button>';
    return;
  }
  var nsu=(d.nsu||'').replace(/\\D/g,'');
  var campo=document.getElementById('mnsu');
  if(campo&&nsu&&!campo.value)campo.value=nsu;
  var linha=[d.operadora,d.tipo,d.bandeira,d.valor!=null?brl(d.valor):null].filter(Boolean).join(' · ');
  var vLido=d.valor, vDig=numBr((document.getElementById('mv')||{}).value);
  var avisos='';
  if(d.via==='loja')avisos+='<div style="color:#0f8a3e;font-weight:600">✅ VIA LOJA</div>';
  else if(d.via==='cliente')avisos+='<div style="color:var(--red);font-weight:600">⚠️ é a VIA DO CLIENTE — a via da loja é a que prova o recebimento</div>';
  if(vLido!=null&&vDig>0&&Math.abs(vLido-vDig)>0.009)
    avisos+='<div style="color:var(--red);font-weight:600">⚠️ o papel diz '+brl(vLido)+' e você digitou '+brl(vDig)+'</div>';
  if(vLido!=null&&!(vDig>0))
    avisos+='<div class="mut">o papel diz '+brl(vLido)+' — <a class="sair" onclick="manUsarValor('+vLido+')">usar esse valor</a></div>';
  if(d.confianca==='baixa')avisos+='<div class="mut">⚠️ foto difícil de ler — confira o NSU</div>';
  if(d.observacao)avisos+='<div class="mut">'+esc(d.observacao)+'</div>';
  box.innerHTML=img+vindo+
    '<div class="card" style="margin:8px 0;padding:10px">'+
      (linha?'<div><b>'+esc(linha)+'</b></div>':'')+
      (nsu?'<div class="mut">NSU/DOC <b>'+esc(nsu)+'</b>'+(campo?' — preenchido':'')+'</div>':'<div class="mut">NSU não encontrado no papel</div>')+
      (d.idPix?'<div class="mut" style="word-break:break-all">Pix '+esc(d.idPix)+'</div>':'')+
      (d.pagador?'<div class="mut">pagador: '+esc(d.pagador)+'</div>':'')+
      (d.dataHora?'<div class="mut">'+esc(d.dataHora)+'</div>':'')+
      avisos+
    '</div><button class="seg" onclick="manCamera()">tirar outra</button>';
}
function manUsarValor(v){
  var mv=document.getElementById('mv'); if(!mv)return;
  mv.value=String(v).replace('.',','); manEstado();
}
/* Celular do caixa: QR com um link de 10 minutos. A foto chega aqui sozinha. */
async function manCelular(externo){
  var box=document.getElementById('mcbox'); if(!box)return;
  box.innerHTML='<div class="mut" style="margin-top:8px">gerando o link…</div>';
  var r=await jpost('/api/caixa/comprovante',{numero:MESA,forma:MAN.forma,valor:numBr((document.getElementById('mv')||{}).value),externo:externo===true});
  if(!r.ok){box.innerHTML='<div class="err" style="display:block">'+esc(r.erro||'não deu')+'</div>';return}
  MAN.token=r.token; MAN.t0=Date.now();
  box.innerHTML='<div style="text-align:center;margin-top:10px;background:#fff;padding:10px;border-radius:12px">'+r.qr+'</div>'+
    '<div class="mut" style="text-align:center">Aponte a câmera do celular · o link vale 10 minutos'+
      (r.externo?' · <b>link da internet</b>':'')+'</div>'+
    '<div class="mut" style="text-align:center;word-break:break-all;font-size:12px">'+esc(r.url)+'</div>'+
    '<div id="mchegou" class="mut" style="text-align:center;margin-top:6px">aguardando a foto…</div>'+
    // O celular no 4G NUNCA alcança o IP da loja — e é o caso mais comum, porque
    // o Android/iPhone abandona sozinho um Wi-Fi sem internet. Um toque troca
    // pro endereço público (Tailscale), que funciona no 4G.
    (r.tem_externo&&!r.externo
      ? '<button class="seg" style="margin-top:8px;width:100%" onclick="manCelular(true)">📶 o celular está no 4G? gerar link da internet</button>'
      : (!r.tem_externo?'<div class="mut" style="text-align:center;margin-top:6px">o celular precisa estar no <b>Wi-Fi da casa</b></div>':''))+
    (r.externo?'<button class="seg" style="margin-top:8px;width:100%" onclick="manCelular(false)">◂ voltar pro link do Wi-Fi</button>':'');
  manParar();
  MAN.poll=setInterval(async function(){
    try{
      // jget, NÃO fetch cru: a sessão do caixa vai no header x-garcom (hdrs()).
      // Com fetch puro toda consulta voltava "sem sessão" — e era ISSO que
      // deixava a tela em "aguardando a foto" pra sempre, com a foto já
      // gravada no servidor.
      var st=await jget('/api/caixa/comprovante?t='+encodeURIComponent(MAN.token)+'&n='+MESA);
      // sessão caiu? antes ficava girando calado — o caixa achava que travou
      if(st&&st.sem_sessao){manParar();var cs=document.getElementById('mchegou');
        if(cs)cs.innerHTML='<b style="color:var(--red)">sua sessão caiu — entre no caixa de novo</b>';return}
      if(st.ok&&st.chegou){
        manParar(); MAN.arquivo=st.arquivo;
        manLido(st.arquivo, st.dados, 'celular');
        manEstado();
        // a leitura roda em segundo plano no servidor: se ainda não veio,
        // busca de novo uma vez, senão o caixa perde o NSU automático
        if(!st.dados)setTimeout(async function(){
          try{var s2=await jget('/api/caixa/comprovante?t='+encodeURIComponent(MAN.token)+'&n='+MESA);
            if(s2&&s2.ok&&s2.dados)manLido(s2.arquivo||MAN.arquivo,s2.dados,'celular')}catch(e){}
        },6000);
        return;
      }
      // o celular ABRIU o link mas a foto não veio: quase sempre é o celular
      // saindo do Wi-Fi na hora do envio — o caixa fica sabendo o que houve.
      var ch=document.getElementById('mchegou');
      if(ch&&st.ok&&st.abriu)ch.innerHTML='📱 o celular abriu o link — se a foto não chegar, confira se ele está <b>no Wi-Fi da casa</b> (sem 4G) e mande de novo';
      else if(ch&&Date.now()-(MAN.t0||0)>20000)ch.innerHTML='⏳ o celular ainda não abriu o link. Se ele estiver no <b>4G</b>, use o botão do <b>link da internet</b> aqui embaixo.';
    }catch(e){}
  },2000);
}
async function manConfirmar(){
  manEstado();
  var v=numBr((document.getElementById('mv')||{}).value);
  var e=document.getElementById('merr'); e.textContent='';
  if(!(v>0)){e.textContent='digite o valor que entrou';return}
  if(MAN.forma!=='dinheiro'&&!MAN.foto&&!MAN.arquivo){e.textContent='anexe a foto do comprovante';return}
  var nsu=((document.getElementById('mnsu')||{}).value||'').replace(/\\D/g,'');
  if((MAN.forma==='credito'||MAN.forma==='debito'||MAN.forma==='pix')&&!nsu){
    if(!confirm('Sem o NSU esse cartão NÃO bate sozinho na conciliação e o caixa fica aberto pra conferência manual.\\n\\nO número está no comprovante (DOC/NSU). Continuar sem ele?'))return;
  }
  var b=alvo({numero:MESA,forma:MAN.forma,valor:v});
  if(nsu)b.nsu=nsu;
  if(MAN.foto)b.foto=MAN.foto; else if(MAN.token)b.token=MAN.token;
  if(MAN.dados)b.dados=MAN.dados;
  var r=await jpost('/api/caixa/receber-manual',b);
  if(!r.ok){
    if(r.sem_caixa)e.innerHTML=esc(r.erro)+' <button class="seg" style="margin-left:8px" onclick="irTela(\\'abrircx\\')">Abrir meu caixa</button>';
    else e.textContent=r.erro||'não deu';
    return;
  }
  manParar();
  if(r.fechada){FLASH='✓ '+esc(r.forma)+' '+brl(v)+' — conta fechada, '+(MESA>=${COMANDA_DE}?'comanda ':'mesa ')+MESA+' liberada.';nfceOferecer(MESA,function(){voltarMesas();listar()});return}
  FLASH='✓ '+esc(r.forma)+' '+brl(v)+' registrado. Falta '+brl(r.saldo||0)+'.';
  await carregar(MESA); irTela('manual');
}
function telaLibCanc(el){
  var souG=!!PODE.cancPed; // gerente local = admin ou Excluir Pedido (o server revalida)
  el.innerHTML='<button class="seg" style="margin-bottom:10px" onclick="irTela(\\'conta\\')">◂ voltar</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">🔒 Liberar cancelamentos — mesa '+MESA+'</div>'+
    '<div class="mut">'+(souG?'Confirme com o SEU PIN.':'Cancelar item é ação de gerente: chame quem autoriza pra digitar o login e o PIN dele.')+'</div>'+
    (souG?'':'<input id="lcl" placeholder="login do gerente" autocapitalize="none" style="margin-top:8px">')+
    '<input id="lcp" class="num" type="password" autocomplete="off" inputmode="numeric" maxlength="8" placeholder="PIN" style="margin-top:8px" readonly onclick="kpAlvo(this)">'+kpHtml('lcp')+
    '<button class="big o" onclick="liberaCanc()">Liberar os botões de cancelar</button>'+
    '<div id="lcerr" class="err"></div></div>';
  var e=document.getElementById(souG?'lcp':'lcl');if(e)e.focus();
}
async function liberaCanc(){
  var b={pin:((document.getElementById('lcp')||{}).value||'')};
  var l=document.getElementById('lcl');if(l)b.gerente_login=l.value||'';
  var r=await jpost('/api/caixa/liberar-cancel',b);
  if(!r.ok){document.getElementById('lcerr').textContent=r.erro||'não liberou';return}
  CANCEL_ON=true;irTela('conta');
}
function telaDesc(el){
  DMODO='valor';
  el.innerHTML='<button class="seg" style="margin-bottom:10px" onclick="irTela(\\'conta\\')">◂ voltar</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">Desconto na mesa '+MESA+'</div>'+
    '<div class="row" style="margin-bottom:8px"><button class="seg on" id="dmv" onclick="setDM(\\'valor\\')">R$</button><button class="seg" id="dmp" onclick="setDM(\\'pct\\')">%</button></div>'+
    '<input id="dv" class="num" inputmode="decimal" placeholder="quanto?" readonly onclick="kpAlvo(this)">'+kpHtml('dv')+
    '<div class="mut" id="dprev" style="margin-top:6px"></div>'+
    '<button class="big o" onclick="aplicaDesc()">Aplicar desconto</button>'+
    '<div id="derr" class="err"></div></div>';
  var e=document.getElementById('dv');if(e){e.focus();e.addEventListener('input',prevDesc)}
}
function setDM(m){DMODO=m;document.getElementById('dmv').className='seg'+(m==='valor'?' on':'');document.getElementById('dmp').className='seg'+(m==='pct'?' on':'');prevDesc()}
function prevDesc(){
  var v=numBr((document.getElementById('dv')||{}).value);
  var d=DMODO==='pct'?+(CONTA.subtotal*v/100).toFixed(2):v;
  var el=document.getElementById('dprev');
  if(el)el.textContent=d>0?('Desconto de '+brl(d)+' → novo total '+brl(Math.max(0,CONTA.total-d))):'';
}
async function aplicaDesc(){
  var v=numBr((document.getElementById('dv')||{}).value);
  if(!(v>0)){document.getElementById('derr').textContent='digite o valor';return}
  var r=await jpost('/api/caixa/ajuste',alvo({numero:MESA,tipo:'desconto',modo:DMODO,valor:v}));
  if(!r.ok){document.getElementById('derr').textContent=r.erro||'não deu';return}
  await carregar(MESA);
}
/* ---- PIX NO CAIXA ----
   A forma de pagamento é escolha do cliente: o caixa tem que aceitar as duas.
   Mesma cobrança do garçom (/api/pix/cobrar), QR na tela do caixa, e a
   confirmação chega sozinha — quando cai, o servidor já fecha a conta e a
   tela oferece a nota. */
var PIXT=null;
function pixPara(){if(PIXT){clearInterval(PIXT);PIXT=null}}
async function pixCaixa(){
  TELA='pix';
  var el=document.getElementById('main');
  el.innerHTML='<div class="mut" style="padding:16px">gerando o código Pix…</div>';
  var r=await jpost('/api/pix/cobrar',alvo({mesa:MESA,valor:CONTA.falta}));
  if(!r.ok){el.innerHTML='<div class="card"><div class="err">'+esc(r.erro||'não consegui gerar o Pix')+'</div>'+
    '<button class="big g" onclick="irTela(\\'conta\\')">Voltar</button></div>';return}
  el.innerHTML='<button class="seg" style="margin-bottom:10px" onclick="pixPara();irTela(\\'conta\\')">◂ voltar</button>'+
    '<div class="card" style="text-align:center"><div class="tit" style="margin-top:0">Pix · '+(MESA>=${COMANDA_DE}?'comanda ':'mesa ')+MESA+'</div>'+
    '<div style="font-size:32px;font-weight:800;margin:4px 0 10px">'+brl(r.valor)+'</div>'+
    (r.imagem?'<img src="'+r.imagem+'" alt="QR Pix" style="width:min(60vw,260px);display:block;margin:0 auto">':'')+
    '<div class="mut" style="margin-top:10px">O cliente aponta a câmera do app do banco. A confirmação aparece aqui sozinha.</div>'+
    '<div style="font-size:11px;word-break:break-all;background:#f7f7fa;border:1px solid var(--line);border-radius:10px;padding:10px;margin-top:8px">'+esc(r.copia_cola||'')+'</div>'+
    '<div id="pixst" style="margin-top:12px;font-weight:700;color:var(--mut)">aguardando o pagamento…</div></div>';
  var cobrado=Number(r.valor||0),tent=0,ocup=false;
  pixPara();
  PIXT=setInterval(async function(){
    if(++tent>120){pixPara();var s0=document.getElementById('pixst');if(s0)s0.textContent='não confirmou em 10 min — volte e gere outro código';return}
    if(ocup)return;ocup=true;
    var s;try{s=await jget('/api/pix/conferir?txid='+encodeURIComponent(r.txid))}catch(e){ocup=false;return}
    ocup=false;
    if(s.ok&&s.pago){
      pixPara();
      // comprovante do Pix: sai sozinho na térmica (se houver) e fica o link
      // na tela pra mostrar ao cliente ou reimprimir. Pedido do dono, 22/08.
      var tx=r.txid;
      FLASH='✓ Pix de '+brl(cobrado)+' recebido — '+(MESA>=${COMANDA_DE}?'comanda ':'mesa ')+MESA+' liberada.';
      var st=document.getElementById('pixst');
      if(st)st.innerHTML='<span style="color:var(--green2)">✓ pago</span> · '+
        '<a href="/pix/comprovante?txid='+encodeURIComponent(tx)+'" target="_blank" style="text-decoration:underline">ver comprovante</a> · '+
        '<a onclick="reimprimirPix(\\''+tx+'\\')" style="text-decoration:underline;cursor:pointer">imprimir</a>';
      nfceOferecer(MESA,function(){voltarMesas();listar()});
    }
  },4000);
}
/* reimprime o comprovante do Pix na térmica do caixa */
async function reimprimirPix(tx){
  var r=await jget('/api/pix/reimprimir?txid='+encodeURIComponent(tx));
  alert(r.ok?'Comprovante enviado pra impressora.':(r.erro||'não deu pra imprimir'));
}
function telaAcr(el){
  el.innerHTML='<button class="seg" style="margin-bottom:10px" onclick="irTela(\\'conta\\')">◂ voltar</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">Acréscimo (gorjeta a mais) — mesa '+MESA+'</div>'+
    '<input id="av" class="num" inputmode="decimal" placeholder="quanto a mais? (R$)" readonly onclick="kpAlvo(this)">'+kpHtml('av')+
    '<button class="big o" onclick="aplicaAcr()">Aplicar acréscimo</button>'+
    '<div id="aerr2" class="err"></div></div>';
  var e=document.getElementById('av');if(e)e.focus();
}
async function aplicaAcr(){
  var v=numBr((document.getElementById('av')||{}).value);
  if(!(v>0)){document.getElementById('aerr2').textContent='digite o valor';return}
  var r=await jpost('/api/caixa/ajuste',alvo({numero:MESA,tipo:'acrescimo',modo:'valor',valor:v}));
  if(!r.ok){document.getElementById('aerr2').textContent=r.erro||'não deu';return}
  await carregar(MESA);
}
/* ---- FIADO ----
   Fecha a conta lançando o que falta na conta corrente do cliente. O cliente
   pode ser o que já está na conta (identificado pelo garçom) ou buscado aqui.
   Só entra quem tem LIMITE cadastrado no Consumer — é o "habilitado pra
   fiado" que o dono pediu. */
var FIADOCLI=null;
function telaFiado(el){
  var falta=CONTA.falta;
  el.innerHTML='<button class="seg" style="margin-bottom:10px" onclick="irTela(\\'conta\\')">◂ voltar</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">🧾 Fiado — '+(MESA>=${COMANDA_DE}?'comanda ':'mesa ')+MESA+'</div>'+
    '<div class="mut">Vai pra conta corrente do cliente: <b>'+brl(falta)+'</b></div>'+
    '<input id="fq" placeholder="nome ou CPF do cliente" style="margin-top:10px" oninput="buscaFiado()">'+
    '<div id="flista"></div><div id="fsel" style="margin-top:8px"></div>'+
    '<div id="ferr" class="err"></div></div>';
  FIADOCLI=null;
  var e=document.getElementById('fq');
  if(e){ e.focus(); if(CONTA.nome){ e.value=CONTA.nome; buscaFiado(); } }
}
var _fT2=null;
function buscaFiado(){
  clearTimeout(_fT2);
  _fT2=setTimeout(async function(){
    var q=((document.getElementById('fq')||{}).value||'').trim();
    var l=document.getElementById('flista');if(!l)return;
    if(q.length<3){l.innerHTML='';return}
    var r;try{r=await jget('/api/caixa/fiado-busca?q='+encodeURIComponent(q))}catch(e){return}
    if(!r.ok){l.innerHTML='<div class="err">'+esc(r.erro||'busca falhou')+'</div>';return}
    l.innerHTML=r.clientes.length
      ? '<div class="lst" style="grid-template-columns:1fr;margin-top:6px">'+r.clientes.map(function(c){
          var st=c.habilitado?('limite '+brl(c.limite)+' · deve '+brl(c.saldo)+' · disponível '+brl(c.disponivel))
                             :'⚠ sem limite cadastrado';
          return '<button class="mchip" style="text-align:left" onclick="escolheFiado('+c.codigo+',\\''+esc(c.nome).replace(/\\'/g,'')+'\\','+(c.habilitado?1:0)+')">'+
            '<b>'+esc(c.nome)+'</b><small>'+(c.doc?esc(c.doc)+' · ':'')+st+'</small></button>';
        }).join('')+'</div>'
      : '<div class="mut" style="margin-top:6px">nenhum cliente com esse nome/CPF</div>';
  },300);
}
function escolheFiado(cod,nome,hab){
  FIADOCLI={codigo:cod,nome:nome,habilitado:!!hab};
  var l=document.getElementById('flista');if(l)l.innerHTML='';
  var s=document.getElementById('fsel');
  if(s)s.innerHTML='<div class="card" style="margin:0;border-color:#7c3aed"><b>'+esc(nome)+'</b>'+
    (hab?'':'<div class="mut" style="color:var(--red)">sem limite cadastrado — pode ser recusado</div>')+
    '<button class="big" style="background:#7c3aed" onclick="lancaFiado(this)">Lançar '+brl(CONTA.falta)+' no fiado</button></div>';
}
async function lancaFiado(btn){
  if(!FIADOCLI)return;
  var er=document.getElementById('ferr');er.textContent='';
  btn.disabled=true;
  var r=await jpost('/api/caixa/fiado',alvo({numero:MESA,cliente:FIADOCLI.codigo}));
  btn.disabled=false;
  if(!r.ok){er.textContent=r.erro||'não lançou';return}
  FLASH='✓ '+brl(r.valor)+' no fiado de '+r.cliente+' — conta fechada. Ele deve '+brl(r.saldo_novo)+'.';
  FIADOCLI=null;voltarMesas();listar();
}
function telaReceber(el){
  var falta=CONTA.falta;
  el.innerHTML='<button class="seg" style="margin-bottom:10px" onclick="irTela(\\'conta\\')">◂ voltar</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">Receber em dinheiro</div>'+
    '<div class="mut">Falta '+brl(falta)+' na mesa '+MESA+'</div>'+
    '<input id="rv" class="num" inputmode="decimal" value="'+falta.toFixed(2).replace('.',',')+'" style="margin-top:8px" readonly onclick="kpAlvo(this)">'+kpHtml('rv')+
    '<div class="mut" id="rtroco" style="margin-top:6px"></div>'+
    '<button class="big" onclick="receber()">Confirmar recebimento</button>'+
    '<div id="rerr" class="err"></div></div>';
  var e=document.getElementById('rv');if(e){e.focus();e.addEventListener('input',troco)}
}
function troco(){
  var v=numBr((document.getElementById('rv')||{}).value);
  var el=document.getElementById('rtroco');
  if(el)el.textContent=(v>CONTA.falta)?('Troco: '+brl(v-CONTA.falta)):'';
}
async function receber(){
  var v=numBr((document.getElementById('rv')||{}).value);
  if(!(v>0)){document.getElementById('rerr').textContent='digite o valor';return}
  var reg=Math.min(v,CONTA.falta);
  var r=await jpost('/api/caixa/receber',alvo({numero:MESA,valor:reg}));
  if(!r.ok){
    var eo=document.getElementById('rerr');
    /* dinheiro exige o caixa DO operador aberto — em vez de só reclamar, leva lá */
    if(r.sem_caixa)eo.innerHTML=esc(r.erro||'Abra o SEU caixa antes de receber dinheiro.')+
      ' <button class="seg" style="margin-left:8px" onclick="irTela(\\'abrircx\\')">Abrir meu caixa</button>';
    else eo.textContent=r.erro||'não deu';
    return
  }
  if(r.fechada){FLASH='✓ Recebido e conta fechada — '+(MESA>=${COMANDA_DE}?'comanda ':'mesa ')+MESA+' liberada.';nfceOferecer(MESA,function(){voltarMesas();listar()});return}
  await carregar(MESA);
}
async function tiraServico(tirar){
  var t=(tirar===1||tirar===true);
  if(t&&!confirm('Tirar os 10% de serviço desta conta? O cliente não vai pagar a taxa.'))return;
  var r=await jpost('/api/caixa/servico',alvo({numero:MESA,tirar:t}));
  if(!r.ok){var e=document.getElementById('cerr');if(e)e.textContent=r.erro||'não deu';return}
  FLASH=t?('✓ 10% retirados ('+brl(r.valor)+') da '+(MESA>=${COMANDA_DE}?'comanda ':'mesa ')+MESA)
         :('✓ 10% de volta na conta');
  await carregar(MESA);
}
async function fecharConta(){
  var r=await jpost('/api/caixa/fechar',alvo({numero:MESA}));
  if(!r.ok){var e=document.getElementById('cerr');if(e)e.textContent=r.erro||'não fechou';return}
  FLASH='✓ Conta da '+(MESA>=${COMANDA_DE}?'comanda ':'mesa ')+MESA+' fechada — liberada.';
  nfceOferecer(MESA,function(){voltarMesas();listar()});
}
/* ---- NFC-e: oferta da nota ao fechar a conta ----
   O fechamento JÁ aconteceu quando o diálogo aparece — recusar/errar a nota
   nunca desfaz nada. "Sem nota" ou fora do ar = segue a vida normal. */
function nfceDocOk(d){d=String(d||'').replace(/\\D/g,'');
  if(/^(\\d)\\1+$/.test(d))return false;
  if(d.length===11){var f=function(p){var s=0;for(var i=0;i<p;i++)s+=+d[i]*(p+1-i);return ((s*10)%11)%10};return f(9)===+d[9]&&f(10)===+d[10]}
  if(d.length===14){var g=function(b){var s=0,q=2;for(var i=b.length-1;i>=0;i--){s+=+b[i]*q;q=q===9?2:q+1}var r=s%11;return r<2?0:11-r};return g(d.slice(0,12))===+d[12]&&g(d.slice(0,13))===+d[13]}
  return false}
function nfceDocFmt(d){d=String(d||'').replace(/\\D/g,'');
  if(d.length===11)return d.slice(0,3)+'.'+d.slice(3,6)+'.'+d.slice(6,9)+'-'+d.slice(9);
  if(d.length===14)return d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5,8)+'/'+d.slice(8,12)+'-'+d.slice(12);
  return d}
function nfceFecha(){var o=document.getElementById('nfceov');if(o)o.remove()}
function nfceOferecer(mesa,depois){
  window.nfceDepois=depois||function(){};
  jget('/api/nfce/info?n='+mesa).then(function(i){
    if(!i||!i.ok||!i.ativo||i.sem_pedido){nfceDepois();return}
    nfceDialog(mesa,i);
  }).catch(function(){nfceDepois()});
}
function nfceDialog(mesa,info){
  nfceFecha();
  var ov=document.createElement('div');ov.id='nfceov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px';
  var doc=info.documento_sugerido||'';
  var h='<div class="card" style="max-width:430px;width:100%;margin:0">';
  if(info.emitida&&info.nota){
    // O caixa imprime SÓ na emissão. 2ª via do DANFE é papel da administração:
    // painel do Concilia → Movimentação → NFC-e emitidas → 🖨 DANFE.
    h+='<div class="tit" style="margin-top:0">🧾 Nota já emitida</div>'+
      '<div class="mut">NFC-e nº '+info.nota.numero+' (série '+info.nota.serie+') deste pedido já foi autorizada.'+
      '<br>2ª via do DANFE: no Concilia (app.prainhabar.com) → Movimentação → NFC-e emitidas → 🖨 DANFE.</div>'+
      '<button class="big" style="background:#eef2f7;color:#0f172a" onclick="nfceFecha();nfceDepois()">OK</button>';
  }else if(info.na_fila){
    h+='<div class="tit" style="margin-top:0">🕐 Nota na fila</div>'+
      '<div class="mut">A NFC-e deste pedido está aguardando a SEFAZ/central responder — o sistema reenvia sozinho a cada 2 min e imprime quando sair. A mesa já está liberada.</div>'+
      '<button class="big g" onclick="nfceEmitir('+mesa+',null)">⚡ Tentar agora</button>'+
      '<button class="big" style="background:#eef2f7;color:#0f172a" onclick="nfceFecha();nfceDepois()">OK</button>';
  }else{
    h+='<div class="tit" style="margin-top:0">🧾 Emitir nota fiscal (NFC-e)?</div>'+
      (info.ambiente===2?'<div class="mut" style="color:#b45309">ambiente de HOMOLOGAÇÃO — sem valor fiscal</div>':'')+
      (info.ultima_falha?'<div class="err" style="display:block">Tentativa anterior falhou: '+esc(info.ultima_falha.erro||info.ultima_falha.status)+'</div>':'')+
      '<div class="mut" style="margin-top:6px">CPF ou CNPJ na nota (opcional):</div>'+
      '<input id="nfcedoc" class="num" inputmode="numeric" placeholder="só números — vazio = sem CPF" value="'+doc+'" style="margin-top:8px">'+
      (doc?'<div class="mut" style="margin-top:4px">↑ do cadastro do cliente: '+nfceDocFmt(doc)+' — confirme ou apague</div>':'')+
      '<div id="nfceerr" class="err"></div>'+
      '<button class="big" onclick="nfceEmitirDoInput('+mesa+')">✓ Emitir nota</button>'+
      '<button class="big" style="background:#eef2f7;color:#0f172a" onclick="nfceFecha();nfceDepois()">Sem nota</button>';
  }
  ov.innerHTML=h+'</div>';
  document.body.appendChild(ov);
}
function nfceEmitirDoInput(mesa){
  var v=((document.getElementById('nfcedoc')||{}).value||'').replace(/\\D/g,'');
  if(v&&!nfceDocOk(v)){document.getElementById('nfceerr').textContent='CPF/CNPJ inválido — confira os dígitos';return}
  nfceEmitir(mesa,v||null);
}
async function nfceEmitir(mesa,doc){
  var ov=document.getElementById('nfceov');
  if(ov)ov.firstChild.innerHTML='<div class="tit" style="margin-top:0">🧾 Emitindo NFC-e…</div><div class="mut">falando com a SEFAZ — segura uns segundos</div>';
  try{
    var r=await jpost('/api/nfce/emitir',alvo({numero:mesa,documento:doc,destino:'caixa'}));
    if(!r.ok&&r.pendente){
      // SEFAZ/central fora do ar: a nota ficou na FILA e sai sozinha — não é erro
      if(ov)ov.firstChild.innerHTML='<div class="tit" style="margin-top:0">🕐 Nota na fila</div>'+
        '<div class="mut">'+esc(r.erro)+'</div>'+
        '<button class="big" onclick="nfceFecha();nfceDepois()">OK</button>';
      return;
    }
    if(!r.ok){
      if(ov)ov.firstChild.innerHTML='<div class="tit" style="margin-top:0">✗ Nota não saiu</div>'+
        '<div class="err" style="display:block">'+esc(r.erro||'falhou')+'</div>'+
        '<div class="mut">A conta continua fechada e a mesa liberada. Corrija o motivo e tente de novo pela própria mesa.</div>'+
        '<button class="big" onclick="nfceFecha();nfceDepois()">OK</button>';
      return;
    }
    FLASH=(FLASH?FLASH+' ':'')+'🧾 NFC-e nº '+r.nota.numero+(r.impresso?' impressa.':' autorizada'+(r.imp_erro?' (impressão: '+r.imp_erro+')':'')+'.');
    nfceFecha();nfceDepois();
  }catch(e2){
    if(ov)ov.firstChild.innerHTML='<div class="tit" style="margin-top:0">✗ Erro</div><div class="err" style="display:block">'+esc(e2.message)+'</div><button class="big" onclick="nfceFecha();nfceDepois()">OK</button>';
  }
}
/* ---- abrir/fechar o MEU caixa + relatório do dia ---- */
function telaAbrirCx(el){
  el.innerHTML='<button class="seg" style="margin-bottom:10px" onclick="voltarMesas()">◂ voltar</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">Abrir o meu caixa</div>'+
    '<div class="mut">Fundo de troco que entra na gaveta (pode ser 0):</div>'+
    '<input id="cxf" class="num" inputmode="decimal" placeholder="R$ 0,00" style="margin-top:8px" readonly onclick="kpAlvo(this)">'+kpHtml('cxf')+
    '<button class="big" onclick="acaoAbrirCx()">Abrir caixa</button>'+
    '<div id="cxerr" class="err"></div></div>';
  var e=document.getElementById('cxf');if(e)e.focus();
}
async function acaoAbrirCx(){
  var v=numBr((document.getElementById('cxf')||{}).value);
  var r=await jpost('/api/caixa/abrir',{fundo:v||0});
  if(!r.ok){document.getElementById('cxerr').textContent=r.erro||'não abriu';return}
  FLASH='✓ Caixa aberto'+(v?' com fundo de '+brl(v):' sem fundo')+'. Bom serviço!';
  await cxEstado();voltarMesas();
}
/* ---- FECHAMENTO COM CONFERÊNCIA (cega, forma a forma) ----
   Antes o caixa informava UM número (dinheiro) com o esperado já na tela —
   bastava digitar o esperado pra "bater" sempre. Agora ele declara primeiro,
   forma a forma, e só depois vê o que o sistema tinha. */
var DECL=null;
function telaFechaCx(el){
  DECL=null;
  el.innerHTML='<button class="seg" style="margin-bottom:10px" onclick="voltarMesas()">◂ voltar</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">Fechar o meu caixa · conferência</div>'+
    '<div class="mut">Conte cada coisa e informe. <b>Os valores do sistema só aparecem depois</b> — é isso que faz a conferência valer.</div>'+
    '<div class="mut" style="margin-top:12px">💵 Dinheiro na gaveta (com o fundo)</div>'+
    '<input id="f_din" class="num" inputmode="decimal" placeholder="obrigatório" readonly onclick="kpAlvo(this)">'+
    '<div class="mut" style="margin-top:10px">💳 Crédito (fechamento da maquininha)</div>'+
    '<input id="f_cre" class="num" inputmode="decimal" placeholder="opcional" readonly onclick="kpAlvo(this)">'+
    '<div class="mut" style="margin-top:10px">💳 Débito</div>'+
    '<input id="f_deb" class="num" inputmode="decimal" placeholder="opcional" readonly onclick="kpAlvo(this)">'+
    '<div class="mut" style="margin-top:10px">📲 Pix</div>'+
    '<input id="f_pix" class="num" inputmode="decimal" placeholder="opcional" readonly onclick="kpAlvo(this)">'+
    kpHtml('f_din')+
    '<button class="big o" onclick="acaoConferir()">Conferir</button>'+
    '<div id="cxerr2" class="err"></div></div>';
}
function _vc(id){var e=document.getElementById(id);return (e&&String(e.value||'').trim()!=='')?numBr(e.value):null}
async function acaoConferir(){
  var er=document.getElementById('cxerr2');er.textContent='';
  var d={dinheiro:_vc('f_din'),credito:_vc('f_cre'),debito:_vc('f_deb'),pix:_vc('f_pix')};
  if(d.dinheiro==null){er.textContent='conte a gaveta e informe o dinheiro';return}
  var r=await jpost('/api/caixa/conferir',d);
  if(!r.ok){er.textContent=r.erro||'não consegui conferir';return}
  DECL={decl:d,conf:r};irTela('confcx');
}
function telaConfCx(el){
  if(!DECL){irTela('fechacx');return}
  var c=DECL.conf;
  var h='<button class="seg" style="margin-bottom:10px" onclick="irTela(\\'fechacx\\')">◂ corrigir contagem</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">Conferência do caixa</div>';
  c.linhas.forEach(function(l){
    var ok=(l.informado==null)||Math.abs(l.dif)<=0.01;
    var lado=(l.informado==null)?'não conferido':(Math.abs(l.dif)<=0.01?'bateu ✓':((l.dif>0?'sobra ':'falta ')+brl(Math.abs(l.dif))));
    h+='<div class="it" style="display:block">'+
      '<div style="display:flex;justify-content:space-between;gap:8px"><b>'+esc(l.rotulo)+'</b>'+
      '<b class="'+(ok?'quit':'saldo')+'">'+lado+'</b></div>'+
      '<div class="mut" style="font-size:12.5px">sistema '+brl(l.esperado)+' · contado '+(l.informado==null?'—':brl(l.informado))+
      (l.obs?' · '+esc(l.obs):'')+'</div></div>';
  });
  h+='<div class="tot g"><span>Total do sistema</span><b>'+brl(c.total_sistema)+'</b></div></div>';
  if(c.eletronico_divergente&&c.eletronico_divergente.length)
    h+='<div class="card" style="border-color:var(--gold2)"><b>⚠ Confira na maquininha:</b> '+esc(c.eletronico_divergente.join(', '))+
       '<div class="mut">Não trava o fechamento — mas sai no comprovante pra apurar depois.</div></div>';
  if(c.precisa_permissao)
    h+='<div class="card" style="border-color:var(--red)"><b style="color:var(--red)">Diferença no dinheiro: '+brl(c.dif_dinheiro)+'</b>'+
       '<div class="mut">Só gerente fecha caixa com diferença no dinheiro. Chame quem pode, ou volte e reconte.</div></div>';
  h+='<div class="card"><input id="f_obs" placeholder="observação do fechamento (opcional)">'+
     '<button class="big'+(c.precisa_permissao?' g':'')+'" onclick="acaoFechaCx()"'+(c.precisa_permissao?' disabled':'')+'>✓ Confirmar e fechar o caixa</button>'+
     '<div class="mut" style="margin-top:6px">Sai um comprovante na impressora do caixa.</div>'+
     '<div id="cxerr3" class="err"></div></div>';
  el.innerHTML=h;
}
async function acaoFechaCx(){
  if(!DECL){irTela('fechacx');return}
  var er=document.getElementById('cxerr3');
  var b=DECL.decl; b.obs=((document.getElementById('f_obs')||{}).value||'').trim()||null;
  var r=await jpost('/api/caixa/fechar-caixa',b);
  if(!r.ok){if(er)er.textContent=(r.erro||'não fechou')+(r.divergente?' — esperado: '+brl(r.esperado):'');return}
  FLASH='✓ Caixa fechado. Dinheiro: sistema '+brl(r.esperado)+' · contado '+brl(r.contado)+
    (Math.abs(r.dif)>0.009?' · diferença '+brl(r.dif):' · bateu certinho 🎯');
  DECL=null;await cxEstado();voltarMesas();
}
/* ---- USUÁRIOS DO SISTEMA (só admin) ----
   Login que existe só aqui, sem passar pelo cadastro do Consumer. Usa os
   MESMOS códigos de permissão do PDV, então a regra do caixa é uma só. */
async function telaUsu(el){
  el.innerHTML='<div class="mut" style="padding:16px">carregando…</div>';
  var d;try{d=await jget('/api/caixa/usuarios')}catch(e){d=null}
  if(!d||!d.ok){el.innerHTML='<div class="card"><div class="err">'+esc((d&&d.erro)||'não deu')+'</div>'+
    '<button class="big g" onclick="voltarMesas()">Voltar</button></div>';return}
  var h='<button class="seg" style="margin-bottom:10px" onclick="voltarMesas()">◂ voltar</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">👤 Usuários criados aqui</div>'+
    '<div class="mut">Não mexem no cadastro do Consumer. Quem já é do PDV continua entrando com o login de lá.</div>';
  h+=(d.usuarios||[]).map(function(u){
    return '<div class="it"><span><b>'+esc(u.login)+'</b> <span class="mut">'+esc(u.nome||'')+'</span></span>'+
      '<b class="'+(u.ativo?'quit':'saldo')+'">'+(u.ativo?'ativo':'desativado')+'</b></div>';
  }).join('')||'<div class="mut" style="margin-top:8px">nenhum ainda</div>';
  h+='</div><div class="card"><div class="tit" style="margin-top:0">Novo usuário (ou trocar o PIN de um)</div>'+
    '<input id="u_login" placeholder="login (sem espaço)" autocapitalize="none">'+
    '<input id="u_nome" placeholder="nome da pessoa" style="margin-top:8px">'+
    '<div class="mut" style="margin-top:10px">PIN (4 a 8 números)</div>'+
    '<input id="u_pin" class="num" inputmode="numeric" maxlength="8" readonly onclick="kpAlvo(this)">'+kpHtml('u_pin')+
    '<div class="mut" style="margin-top:10px">O que ele pode fazer</div>'+
    '<select id="u_perfil" style="width:100%;font:inherit;padding:12px;border:2px solid var(--line);border-radius:12px">'+
    (d.perfis||[]).map(function(p){return '<option value="'+p.id+'">'+esc(p.nome)+'</option>'}).join('')+'</select>'+
    '<button class="big" onclick="salvaUsu()">Salvar usuário</button>'+
    '<div id="uerr" class="err"></div></div>';
  el.innerHTML=h;
}
async function salvaUsu(){
  var er=document.getElementById('uerr');er.textContent='';
  var b={login:(document.getElementById('u_login')||{}).value||'',
    nome:(document.getElementById('u_nome')||{}).value||'',
    pin:(document.getElementById('u_pin')||{}).value||'',
    perfil:(document.getElementById('u_perfil')||{}).value||'garcom'};
  var r=await jpost('/api/caixa/usuarios',b);
  if(!r.ok){er.textContent=r.erro||'não deu';return}
  FLASH='✓ '+(r.criado?'Usuário '+r.login+' criado':'Usuário '+r.login+' atualizado');
  telaUsu(document.getElementById('main'));
}
/* ---- gaveta: sangria / despesa / suprimento ---- */
var MOVT='sangria',FORN=null;
function telaMov(el){
  MOVT='sangria';FORN=null;
  el.innerHTML='<button class="seg" style="margin-bottom:10px" onclick="voltarMesas()">◂ voltar</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">↕ Gaveta do meu caixa</div>'+
    '<div class="row" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:8px">'+
      '<button class="seg on" id="mv-sangria" onclick="setMov(\\'sangria\\')">Sangria</button>'+
      '<button class="seg" id="mv-despesa" onclick="setMov(\\'despesa\\')">Despesa</button>'+
      '<button class="seg" id="mv-suprimento" onclick="setMov(\\'suprimento\\')">Suprimento</button></div>'+
    '<div class="mut" id="mvdica"></div>'+
    '<div id="mvxtra"></div>'+
    '<input id="mvv" class="num" inputmode="decimal" placeholder="quanto? (R$)" style="margin-top:8px" readonly onclick="kpAlvo(this)">'+kpHtml('mvv')+
    '<input id="mvm" placeholder="motivo (obrigatório)" style="margin-top:8px">'+
    '<button class="big o" onclick="acaoMov()">Confirmar</button>'+
    '<div id="mverr" class="err"></div></div>';
  setMov('sangria');
}
function setMov(t){
  MOVT=t;FORN=null;
  ['sangria','despesa','suprimento'].forEach(function(k){var b=document.getElementById('mv-'+k);if(b)b.className='seg'+(k===t?' on':'')});
  var d=document.getElementById('mvdica');
  if(d)d.textContent=t==='sangria'?'Sangria = retirar dinheiro da gaveta pro cofre.'
    :t==='despesa'?'Despesa = pagamento com dinheiro da gaveta. Escolha QUEM recebe (funcionário também é cadastrado como fornecedor).'
    :'Suprimento = dinheiro ENTRANDO na gaveta (troco, reforço).';
  var x=document.getElementById('mvxtra');
  if(!x)return;
  if(t==='sangria')x.innerHTML='<input id="mvleva" placeholder="QUEM está levando o dinheiro? (obrigatório)" style="margin-top:8px">';
  else if(t==='despesa')x.innerHTML='<input id="mvfq" placeholder="buscar fornecedor/pessoa… (2+ letras)" style="margin-top:8px" oninput="buscaForn()">'+
    '<div id="mvfl"></div><div id="mvfsel" class="mut" style="margin-top:4px"></div>';
  else x.innerHTML='';
}
var _fT=null;
function buscaForn(){
  clearTimeout(_fT);
  _fT=setTimeout(async function(){
    var q=((document.getElementById('mvfq')||{}).value||'').trim();
    var l=document.getElementById('mvfl');if(!l)return;
    if(q.length<2){l.innerHTML='';return}
    var r;try{r=await jget('/api/caixa/fornecedores?q='+encodeURIComponent(q))}catch(e){return}
    if(!r.ok){l.innerHTML='<div class="err">'+esc(r.erro||'busca falhou')+'</div>';return}
    l.innerHTML=r.fornecedores.length
      ? '<div class="lst" style="grid-template-columns:1fr;margin-top:6px">'+r.fornecedores.map(function(f){
          return '<button class="mchip" onclick="escolheForn('+f.codigo+',\\''+esc(f.nome).replace(/'/g,'')+'\\')"><b>'+esc(f.nome)+'</b>'+(f.doc?'<small>'+esc(f.doc)+'</small>':'')+'</button>'}).join('')+'</div>'
      : '<div class="mut" style="margin-top:6px">ninguém com esse nome — cadastre o fornecedor no Consumer primeiro</div>';
  },300);
}
function escolheForn(c,n){
  FORN={codigo:c,nome:n};
  var l=document.getElementById('mvfl');if(l)l.innerHTML='';
  var q=document.getElementById('mvfq');if(q)q.value=n;
  var s=document.getElementById('mvfsel');if(s)s.innerHTML='✓ recebe: <b>'+esc(n)+'</b>';
}
async function acaoMov(){
  var v=numBr((document.getElementById('mvv')||{}).value);
  var m=((document.getElementById('mvm')||{}).value||'').trim();
  var er=document.getElementById('mverr');
  if(!(v>0)){er.textContent='digite o valor';return}
  if(!m){er.textContent='diga o motivo';return}
  var b={tipo:MOVT,valor:v,motivo:m};
  if(MOVT==='sangria'){
    b.quem_leva=((document.getElementById('mvleva')||{}).value||'').trim();
    if(!b.quem_leva){er.textContent='diga QUEM está levando o dinheiro';return}
  }
  if(MOVT==='despesa'){
    if(!FORN){er.textContent='busque e escolha quem está recebendo';return}
    b.fornecedor_codigo=FORN.codigo;
    b.fornecedor_nome=FORN.nome; // vai pro comprovante ("Pago a:")
  }
  var r=await jpost('/api/caixa/movimento',b);
  if(!r.ok){er.textContent=r.erro||'não deu';return}
  // COMPROVANTE: saiu dinheiro, tem que ter papel. Se a térmica imprimiu, a
  // tela só confirma; se não tem impressora, ela MOSTRA o comprovante pra
  // imprimir daqui — o movimento nunca fica sem registro visível.
  if(r.comprovante&&!r.impresso){ telaCompGaveta(r.comprovante); return }
  FLASH='✓ '+(MOVT==='suprimento'?'Suprimento de ':MOVT==='sangria'?'Sangria de ':'Despesa de ')+brl(v)+
    (MOVT==='sangria'?' — levou '+b.quem_leva:MOVT==='despesa'?' — pra '+FORN.nome+' (conta a pagar criada)':'')+
    (r.impresso?' · comprovante impresso (2 vias)':'')+'.';
  await cxEstado();voltarMesas();
}
/* Comprovante da gaveta na TELA — quando não há térmica configurada. Mesmo
   conteúdo do papel, com botão de imprimir no navegador. */
function telaCompGaveta(d){
  var TIT={sangria:'SANGRIA — SAÍDA DE DINHEIRO',despesa:'DESPESA PAGA DA GAVETA',
           suprimento:'SUPRIMENTO — ENTRADA DE DINHEIRO'}[d.tipo]||'MOVIMENTO DE CAIXA';
  var q=new Date(d.quando).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  var L=function(a,b){return '<div style="display:flex;justify-content:space-between;gap:10px"><span>'+a+'</span><b>'+b+'</b></div>'};
  var app=document.getElementById('main')||document.getElementById('app');
  app.innerHTML='<div class="card" id="cpg">'+
    '<div class="tit" style="margin-top:0;text-align:center">'+esc(TIT)+'</div>'+
    '<div class="mut" style="text-align:center">não é documento fiscal</div>'+
    '<div style="font-size:30px;font-weight:800;text-align:center;margin:10px 0">'+
      (d.tipo==='suprimento'?'+':'−')+' '+brl(d.valor)+'</div>'+
    '<div style="border-top:1px dashed #bbb;padding-top:10px">'+
    '<div class="mut">Motivo</div><div style="font-weight:600;margin-bottom:8px">'+esc(d.motivo||'—')+'</div>'+
    (d.para?'<div class="mut">'+(d.tipo==='despesa'?'Pago a':'Entregue a')+'</div><div style="font-weight:600;margin-bottom:8px">'+esc(d.para)+'</div>':'')+
    L('Caixa nº',esc(String(d.caixa)))+L('Operador',esc(d.operador||'?'))+L('Data',q)+
    L('Gaveta depois',brl(d.gaveta_depois))+
    (d.tipo!=='suprimento'?'<div style="margin-top:18px">Recebi o valor acima:</div>'+
      '<div style="border-bottom:1px solid #333;height:34px"></div>'+
      '<div class="mut">'+esc(d.para||'nome e assinatura')+'</div>':'')+
    '</div></div>'+
    '<div class="row" style="margin-top:10px">'+
    '<button class="seg" onclick="print()">🖨 Imprimir</button>'+
    '<button class="big" onclick="cxEstado().then(voltarMesas)">Pronto</button></div>';
}
var REL_DATA=''; // '' = hoje
async function telaRel(el){
  el.innerHTML='<div class="mut" style="padding:16px">montando o movimento…</div>';
  var d;try{d=await jget('/api/caixa/relatorio'+(REL_DATA?('?data='+REL_DATA):''))}catch(e){}
  if(!d||!d.ok){el.innerHTML='<div class="card"><div class="err">'+esc((d&&d.erro)||'sem movimento agora')+'</div></div>';return}
  var tot=0;d.formas.forEach(function(f){tot+=f.valor});
  var quando=REL_DATA?REL_DATA.split('-').reverse().join('/'):'Hoje';
  var h='<button class="seg" style="margin-bottom:10px" onclick="voltarMesas()">◂ voltar</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">🗓 Movimento do caixa — <b>'+quando+'</b></div>'+
    '<div class="mut" style="margin-bottom:6px">Escolha o dia:</div>'+
    '<input type="date" onchange="REL_DATA=this.value;render()" value="'+(REL_DATA||'')+'" style="padding:8px;border:1px solid #d7dde6;border-radius:9px;font-size:15px">'+
    (REL_DATA?' <a class="sair" style="margin-left:8px" onclick="REL_DATA=\\'\\';render()">hoje</a>':'')+'</div>';
  h+='<div class="card"><div class="tit" style="margin-top:0">📊 Por forma de pagamento</div>';
  h+=d.formas.map(function(f){return '<div class="it"><span>'+esc(f.nome)+' <span class="mut">('+f.n+'×)</span></span><b>'+brl(f.valor)+'</b></div>'}).join('')||'<div class="mut">nenhum pagamento nesse dia</div>';
  h+='<div class="tot g"><span>Total</span><b>'+brl(tot)+'</b></div></div>';
  h+='<div class="card"><div class="tit" style="margin-top:0">👤 Por operador</div>'+
    (d.caixas.map(function(c){
      var st=c.fechado_em
        ?('<span class="mut">fechado</span> · esperado '+brl(c.esperado||0)+' · contado '+brl(c.contado==null?0:c.contado))
        :'<b style="color:var(--green2)">ABERTO</b> · fundo '+brl(c.fundo);
      var fmts=(c.formas||[]).map(function(f){return esc(f.nome)+' '+brl(f.valor)+' ('+f.n+'×)'}).join(' · ')||'sem recebimentos';
      return '<div class="it" style="display:block"><div style="display:flex;justify-content:space-between"><b>'+esc(c.quem||('caixa '+c.codigo))+'</b><b>'+brl(c.recebido||0)+'</b></div>'+
        '<div class="mut" style="font-size:12px;margin-top:2px">'+fmts+'</div>'+
        '<div class="mut" style="font-size:11.5px">'+st+'</div></div>';
    }).join('')||'<div class="mut">nenhum caixa nesse dia</div>')+'</div>';
  if(d.movs.length)h+='<div class="card"><div class="tit" style="margin-top:0">↕ Entradas/saídas da gaveta</div>'+
    d.movs.map(function(m){return '<div class="it"><span>'+esc(m.obs||'—')+'</span><b>'+(m.saida?'− '+brl(m.saida):'+ '+brl(m.entrada))+'</b></div>'}).join('')+'</div>';
  var nab=(d.caixas||[]).filter(function(c){return !c.fechado_em}).length;
  if(PODE.admin&&nab>0)h+='<div class="card"><button class="big" style="background:#dc2626;color:#fff" onclick="fechaTodosCx(this)">🔒 Fechar os '+nab+' caixas abertos</button>'+
    '<div class="mut" style="margin-top:6px">Fecha em lote, cada um pelo esperado. Organização — cartão/Pix já concilia por NSU.</div></div>';
  el.innerHTML=h;
}
async function fechaTodosCx(btn){
  if(!confirm('Fechar TODOS os caixas abertos agora? Cada um fecha pelo esperado (organização).'))return;
  if(btn){btn.disabled=true;btn.textContent='fechando…'}
  var r=await jpost('/api/caixa/fechar-todos',{});
  if(!r.ok){alert(r.erro||'erro');if(btn){btn.disabled=false;btn.textContent='🔒 Fechar os caixas abertos'}return}
  alert('✓ '+r.total+' caixa(s) fechado(s).');await cxEstado();render();
}
async function imprimirCx(btn){
  if(btn){btn.disabled=true;btn.textContent='🧾 Imprimindo…'}
  var r=await jpost('/api/caixa/imprimir',alvo({numero:MESA}));
  if(btn){btn.disabled=false;btn.textContent='🧾 Imprimir conta'}
  if(!r.ok){alert(r.erro||'não imprimiu');return}
  await carregar(MESA); // a conta volta já com o serviço aplicado
}
/* ---- TRANSFERIR e PEDIR CONTA direto do caixa ---- */
var PAGON=false; // seção 💰 Pagamento aberta/fechada na tela da mesa
function transfCx(){
  var ov=document.createElement('div');ov.id='trov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML='<div class="card" style="max-width:380px;width:100%;margin:0">'+
    '<div class="tit" style="margin-top:0">⇄ Transferir '+(MESA>=${COMANDA_DE}?'comanda':'mesa')+' '+MESA+'</div>'+
    '<div class="mut">'+(MESA>=${COMANDA_DE}?'Pra qual MESA vai a comanda?':'Pra qual mesa vai?')+'</div>'+
    '<input id="trdest" class="num" inputmode="numeric" placeholder="mesa destino" style="margin-top:8px">'+
    // ⚠️ ANTES ERA TUDO OU NADA: só dava pra levar a mesa inteira. O caixa
    // precisa mover UM item (a cerveja que era da mesa ao lado, o prato
    // lançado no número errado). Marcou algum? vai só o marcado.
    (TRITENS()?'<div class="mut" style="margin-top:10px">Marque os itens, ou mande a mesa inteira:</div>'+TRITENS():'')+
    // dois botões, sem adivinhação: o de cima leva o que está marcado, o de
    // baixo leva tudo (era um texto miúdo dizendo "nada marcado = tudo")
    (TRITENS()?'<button class="big" id="trbmarc" onclick="doTransfCx(this,0)" disabled>Transferir os marcados</button>':'')+
    '<button class="big'+(TRITENS()?' o':'')+'" onclick="doTransfCx(this,1)">Transferir a '+(MESA>=${COMANDA_DE}?'comanda':'mesa')+' INTEIRA</button>'+
    '<button class="big" style="background:#eef2f7;color:#0f172a" onclick="document.getElementById(\\'trov\\').remove()">Voltar</button>'+
    '<div id="trerr" class="err"></div></div>';
  document.body.appendChild(ov);
  var e=document.getElementById('trdest');if(e)e.focus();
}
/* itens da conta pra marcar na transferência (só quem pode transferir item) */
function TRITENS(){
  if(!PODE.transf&&!PODE.cancPed)return '';
  var its=(CONTA&&CONTA.itens||[]).filter(function(i){return i.item_codigo});
  if(!its.length)return '';
  return '<div style="max-height:190px;overflow:auto;margin-top:6px">'+
    '<label style="display:flex;gap:8px;align-items:center;padding:6px 2px;border-bottom:1px solid var(--line);font-size:13px;color:var(--mut)">'+
      '<input type="checkbox" id="triall" onchange="triTodos(this)" style="width:20px;height:20px"><span>marcar todos</span></label>'+
    its.map(function(i,ix){
      return '<label style="display:flex;gap:8px;align-items:center;padding:6px 2px;border-bottom:1px solid #f0f0f4;font-size:14px">'+
        '<input type="checkbox" class="tri" value="'+i.item_codigo+'" onchange="triConta()" style="width:20px;height:20px">'+
        '<span style="flex:1">'+i.quantidade+'× '+esc(i.nome)+'</span><b>'+brl(i.valor_total)+'</b></label>';
    }).join('')+'</div>';
}
function triTodos(el){
  [].slice.call(document.querySelectorAll('.tri')).forEach(function(c){c.checked=el.checked});
  triConta();
}
function triConta(){
  var n=document.querySelectorAll('.tri:checked').length;
  var b=document.getElementById('trbmarc');if(!b)return;
  b.disabled=!n; b.textContent=n?('Transferir os '+n+' marcado'+(n>1?'s':'')):'Transferir os marcados';
}
async function doTransfCx(btn,tudo){
  var d=Number(((document.getElementById('trdest')||{}).value||'').replace(/\\D/g,''));
  var er=document.getElementById('trerr');
  if(!(d>0)){if(er)er.textContent='digite a mesa destino';return}
  var marcados=tudo?[]:[].slice.call(document.querySelectorAll('.tri:checked')).map(function(c){return Number(c.value)});
  if(!tudo&&!marcados.length){if(er)er.textContent='marque os itens (ou use "a mesa INTEIRA")';return}
  btn.disabled=true;
  var r=marcados.length
    ? await jpost('/api/caixa/transferir-itens',{de:MESA,para:d,itens:marcados})
    : await jpost('/api/venda/transferir',{de:MESA,para:d,por:NOME||''});
  btn.disabled=false;
  if(!r||!r.ok){if(er)er.textContent=(r&&r.erro)||'não transferiu';return}
  var o=document.getElementById('trov');if(o)o.remove();
  FLASH='✓ '+(r.msg||('Transferido pra mesa '+d+'.'));
  voltarMesas();listar();
}
async function pedirContaCx(btn){
  // pedir = imprimir: os dois aplicam o serviço e travam lançamentos; este
  // também manda a conferência pra térmica (botão único, sem duplicata)
  btn.disabled=true;
  var r=await jpost('/api/caixa/imprimir',alvo({numero:MESA}));
  btn.disabled=false;
  var e=document.getElementById('cerr');
  if(!r||!r.ok){if(e){e.style.color='';e.textContent=(r&&r.erro)||'não deu'}return}
  if(e){e.style.color='#0a7d38';e.textContent='✓ Conta pedida — 10% aplicado, lançamentos travados e conferência impressa.'}
  await carregar(MESA);
}
/* ---- BLOQUEIO por inatividade: 5 min parado = pede o PIN (só o PIN — o
   operador continua o mesmo; é pro caixa largado não ficar aberto). */
var IDLE_MS=5*60*1000, ultAtiv=Date.now(), BLOQ=false;
['click','touchstart','keydown','input'].forEach(function(ev){document.addEventListener(ev,function(){if(!BLOQ)ultAtiv=Date.now()},true)});
setInterval(function(){if(!BLOQ&&NOME&&Date.now()-ultAtiv>IDLE_MS)bloquear()},15000);
function bloquear(){
  if(BLOQ)return;BLOQ=true;
  var ov=document.createElement('div');ov.id='lockov';
  ov.style.cssText='position:fixed;inset:0;background:#0f172a;z-index:200;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML='<div style="max-width:340px;width:100%;text-align:center;color:#e2e8f0">'+
    '<div style="font-size:44px">🔒</div>'+
    '<div style="font-size:20px;font-weight:800;margin-top:6px">Caixa bloqueado</div>'+
    '<div style="opacity:.75;margin-top:4px">'+esc(NOME||'')+' — digite seu PIN pra voltar</div>'+
    '<input id="lockpin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="PIN" style="margin-top:14px;width:100%;padding:14px;border-radius:10px;border:0;font-size:22px;text-align:center;letter-spacing:6px">'+
    '<button class="big" style="margin-top:10px" onclick="desbloquear()">Desbloquear</button>'+
    '<div id="lockerr" class="err" style="display:block;min-height:18px"></div></div>';
  document.body.appendChild(ov);
  var e=document.getElementById('lockpin');
  if(e){e.focus();e.addEventListener('keydown',function(k){if(k.key==='Enter')desbloquear()})}
}
async function desbloquear(){
  var pin=((document.getElementById('lockpin')||{}).value||'').replace(/\\D/g,'');
  if(!pin){document.getElementById('lockerr').textContent='digite o PIN';return}
  var r=await jpost('/api/caixa/desbloquear',{pin:pin});
  if(r&&r.sem_sessao){location.reload();return}
  if(!r||!r.ok){var e=document.getElementById('lockerr');if(e)e.textContent=(r&&r.erro)||'PIN não confere';var i=document.getElementById('lockpin');if(i){i.value='';i.focus()}return}
  var o=document.getElementById('lockov');if(o)o.remove();
  BLOQ=false;ultAtiv=Date.now();
}
/* ---- LANÇAR PRODUTOS: manda pro /venda (mesmo login/token) já na mesa ---- */
function lancarCx(){location.href='/venda?mesa='+MESA+'&volta=caixa'}
function lancarNum(n){location.href='/venda?mesa='+n+'&volta=caixa'}
/* ---- CANCELAR ITEM (pronto/entregue = dupla senha) e PEDIDO INTEIRO ---- */
/* ---- MOTIVOS DE CANCELAMENTO padronizados ----
   O texto livre virava "teste"/"" e o relatório não dizia ONDE a perda nasce
   (salão, cozinha, cliente, estoque). Motivo agora é obrigatório e vem de
   uma lista fixa — "Outro…" abre o texto livre pra exceção de verdade. */
var MOTIVOS_CANC=['Lançamento errado do garçom','Cozinha errou o pedido','Cliente recusou o prato','Cliente desistiu / mudou o pedido','Produto em falta','Demora no preparo','Devolução — produto voltou pro bar/estoque'];
var MOTIVO_DEV=6; // devolução exige FOTO do produto devolvido (só pra item, não pro pedido inteiro)
var MOTSEL=null,MOTPED=null;
function chipsMotivoHtml(sel,fn,semDev){
  return '<div class="mut" style="margin-top:10px">Motivo do cancelamento (obrigatório):</div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">'+
    MOTIVOS_CANC.map(function(m,ix){if(semDev&&ix===MOTIVO_DEV)return '';return '<button type="button" class="seg'+(sel===ix?' on':'')+'" style="flex:1 1 45%" onclick="'+fn+'('+ix+')">'+(ix===MOTIVO_DEV?'📷 ':'')+m+'</button>'}).join('')+
    '<button type="button" class="seg'+(sel==='O'?' on':'')+'" style="flex:1 1 45%" onclick="'+fn+'(\\'O\\')">Outro…</button></div>'+
    (sel==='O'?'<input id="cmot" placeholder="qual o motivo?" style="margin-top:8px">':'');
}
function motivoDe(sel){
  if(sel==null)return null;
  if(sel==='O'){var t=((document.getElementById('cmot')||{}).value||'').trim();return t?('Outro: '+t):null}
  return MOTIVOS_CANC[sel];
}
function selMotivoItem(v){MOTSEL=v;pintaMain()}
/* ---- FOTO DA DEVOLUÇÃO: mesmo caminho do comprovante (QR → celular → foto),
   ou a câmera do tablet. Sem foto o servidor recusa cancelar como devolução. */
var CFOTO={token:null,arquivo:null,foto:null,poll:null,stream:null,t0:0};
function devParar(){if(CFOTO.poll){clearInterval(CFOTO.poll);CFOTO.poll=null}if(CFOTO.stream){CFOTO.stream.getTracks().forEach(function(t){t.stop()});CFOTO.stream=null}}
function devReset(){devParar();CFOTO={token:null,arquivo:null,foto:null,poll:null,stream:null,t0:0}}
function devFotoHtml(){
  if(CFOTO.arquivo||CFOTO.foto)return '<div class="card" style="margin-top:10px;border:1.5px solid #16a34a">'+
    '<div class="mut"><b style="color:#16a34a">✓ foto do produto devolvido recebida</b></div>'+
    '<img src="'+(CFOTO.foto||('/foto/'+CFOTO.arquivo))+'" style="width:100%;border-radius:12px;margin-top:8px">'+
    '<button type="button" class="seg" style="margin-top:8px" onclick="devReset();pintaMain()">tirar outra</button></div>';
  return '<div class="card" style="margin-top:10px;border:1.5px solid #f59e0b">'+
    '<div class="mut"><b>📷 Foto do produto devolvido (obrigatória)</b> — mostre a garrafa/lata que voltou.</div>'+
    '<div class="row" style="margin-top:8px;gap:8px">'+
      '<button type="button" class="seg" style="flex:1" onclick="devCelular(false)">📱 Pelo meu celular</button>'+
      '<button type="button" class="seg" style="flex:1" onclick="devCamera()">📸 Câmera do tablet</button></div>'+
    '<div id="dvbox"></div></div>';
}
async function devCelular(externo){
  var box=document.getElementById('dvbox');if(!box)return;
  devParar();
  box.innerHTML='<div class="mut" style="margin-top:8px">gerando o link…</div>';
  var r=await jpost('/api/caixa/comprovante',{numero:MESA,forma:'devolucao',valor:CANCIT?CANCIT.valor:null,externo:externo===true});
  if(!r.ok){box.innerHTML='<div class="err" style="display:block">'+esc(r.erro||'não deu')+'</div>';return}
  CFOTO.token=r.token;CFOTO.t0=Date.now();
  box.innerHTML='<div style="text-align:center;margin-top:10px;background:#fff;padding:10px;border-radius:12px">'+r.qr+'</div>'+
    '<div class="mut" style="text-align:center">Aponte a câmera do celular · o link vale 10 minutos'+(r.externo?' · <b>link da internet</b>':'')+'</div>'+
    '<div id="dvchegou" class="mut" style="text-align:center;margin-top:6px">aguardando a foto…</div>'+
    (r.tem_externo&&!r.externo?'<button type="button" class="seg" style="margin-top:8px;width:100%" onclick="devCelular(true)">📶 o celular está no 4G? gerar link da internet</button>':'')+
    (r.externo?'<button type="button" class="seg" style="margin-top:8px;width:100%" onclick="devCelular(false)">◂ voltar pro link do Wi-Fi</button>':'');
  CFOTO.poll=setInterval(async function(){
    try{
      var st=await jget('/api/caixa/comprovante?t='+encodeURIComponent(CFOTO.token)+'&n='+MESA+'&forma=devolucao');
      if(st&&st.sem_sessao){devParar();var cs=document.getElementById('dvchegou');if(cs)cs.innerHTML='<b style="color:var(--red)">sua sessão caiu — entre no caixa de novo</b>';return}
      if(st.ok&&st.chegou){devParar();CFOTO.arquivo=st.arquivo;CFOTO.token=st.token||CFOTO.token;pintaMain();return}
      var ch=document.getElementById('dvchegou');
      if(ch&&st.ok&&st.abriu)ch.innerHTML='📱 o celular abriu o link — se a foto não chegar, confira se ele está <b>no Wi-Fi da casa</b> (sem 4G) e mande de novo';
      else if(ch&&Date.now()-(CFOTO.t0||0)>20000)ch.innerHTML='⏳ o celular ainda não abriu o link. Se ele estiver no <b>4G</b>, use o botão do <b>link da internet</b>.';
    }catch(e){}
  },2000);
}
async function devCamera(){
  var box=document.getElementById('dvbox');if(!box)return;
  devParar();
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){box.innerHTML='<div class="mut" style="margin-top:8px">Este tablet não libera a câmera aqui (precisa do modo seguro). Use <b>Pelo meu celular</b>.</div>';return}
  box.innerHTML='<video id="dvvid" autoplay playsinline muted style="width:100%;border-radius:12px;margin-top:8px;background:#000"></video>'+
    '<button type="button" class="big" onclick="devClicar()">📸 Tirar a foto</button>';
  try{var st=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});var v=document.getElementById('dvvid');if(v){v.srcObject=st;CFOTO.stream=st}}
  catch(e){box.innerHTML='<div class="mut" style="margin-top:8px">A câmera não abriu ('+esc(e.name||'erro')+'). Use <b>Pelo meu celular</b>.</div>'}
}
function devClicar(){
  var v=document.getElementById('dvvid');if(!v)return;
  var c=document.createElement('canvas');
  var k=Math.min(1,1280/Math.max(v.videoWidth||1280,v.videoHeight||720));
  c.width=(v.videoWidth||1280)*k;c.height=(v.videoHeight||720)*k;
  c.getContext('2d').drawImage(v,0,0,c.width,c.height);
  CFOTO.foto=c.toDataURL('image/jpeg',0.8);
  devParar();pintaMain();
}
function cancItem(ix){
  var i=(CONTA&&CONTA.itens||[])[ix];if(!i)return;
  devReset();
  var q=Math.round(Number(i.quantidade)||1);
  CANCIT={codigo:i.item_codigo,nome:i.nome,qtd:q,valor:i.valor_total,status:i.status||'a_produzir',
    resta:(q>1?q-1:null)}; // lançou 5, quer cancelar 2: ajusta o que FICA (3)
  MOTSEL=null;
  irTela('canc');
}
function cancMenos(){if(CANCIT&&CANCIT.resta>0){CANCIT.resta--;pintaMain()}}
function cancMais(){if(CANCIT&&CANCIT.resta<CANCIT.qtd-1){CANCIT.resta++;pintaMain()}}
function telaCancItem(el){
  var i=CANCIT;if(!i){irTela('conta');return}
  var precisa=i.status!=='a_produzir';
  var h='<button class="seg" style="margin-bottom:10px" onclick="irTela(\\'conta\\')">◂ voltar</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">Cancelar item — mesa/comanda '+MESA+'</div>'+
    '<div class="it"><span>'+i.qtd+'× '+esc(i.nome)+'</span><b>'+brl(i.valor)+'</b></div>'+
    (i.qtd>1?'<div class="mut" style="margin-top:10px">Quantos FICAM na conta?</div>'+
      '<div class="row" style="align-items:center;gap:12px;margin-top:6px">'+
        '<button type="button" class="seg" style="font-size:22px;min-width:52px" onclick="cancMenos()">−</button>'+
        '<b style="font-size:26px;min-width:40px;text-align:center">'+i.resta+'</b>'+
        '<button type="button" class="seg" style="font-size:22px;min-width:52px" onclick="cancMais()">+</button>'+
        '<span class="mut">serão cancelados <b>'+(i.qtd-i.resta)+'</b> de '+i.qtd+'</span>'+
      '</div>':'')+
    (precisa?'<div class="err" style="margin-top:8px">Este item já está <b>'+(i.status==='entregue'?'ENTREGUE':'PRONTO')+'</b>. '+
      'Precisa de DUAS senhas: o seu PIN e a autorização do gerente.</div>':'')+
    chipsMotivoHtml(MOTSEL,'selMotivoItem')+(MOTSEL===MOTIVO_DEV?devFotoHtml():'');
  if(precisa){
    h+='<input id="cpin" class="num" type="password" inputmode="numeric" maxlength="8" placeholder="SEU PIN ('+esc(NOME||'')+')" style="margin-top:8px">';
    if(!PODE.cancPed)h+='<div class="row" style="margin-top:8px">'+
      '<input id="cglog" placeholder="login do gerente" autocapitalize="none">'+
      '<input id="cgpin" class="num" type="password" inputmode="numeric" maxlength="8" placeholder="PIN do gerente"></div>';
    else h+='<div class="mut" style="margin-top:6px">Você já é gerente — só o seu PIN basta.</div>';
  }
  h+='<button class="big" style="background:var(--red)" onclick="doCancItem(this)">Cancelar este item</button>'+
    '<div id="cierr" class="err"></div></div>';
  el.innerHTML=h;
}
async function doCancItem(btn){
  var mot=motivoDe(MOTSEL);
  if(!mot){var e0=document.getElementById('cierr');if(e0)e0.textContent='escolha o motivo do cancelamento';return}
  var b={numero:MESA,item_codigo:CANCIT.codigo,motivo:mot};
  if(MOTSEL===MOTIVO_DEV){
    if(CFOTO.arquivo)b.token=CFOTO.token; else if(CFOTO.foto)b.foto=CFOTO.foto;
    else{var e1=document.getElementById('cierr');if(e1)e1.textContent='devolução precisa da foto do produto devolvido';return}
  }
  if(CANCIT.resta!=null)b.qtd=CANCIT.qtd-CANCIT.resta;
  var cp=document.getElementById('cpin');if(cp)b.caixa_pin=cp.value||'';
  var gl=document.getElementById('cglog');if(gl)b.gerente_login=gl.value||'';
  var gp=document.getElementById('cgpin');if(gp)b.gerente_pin=gp.value||'';
  btn.disabled=true;
  var r=await jpost('/api/caixa/cancelar-item',alvo(b));
  btn.disabled=false;
  if(!r.ok){
    // o servidor manda o status REAL (a tela podia estar velha): re-pinta já exigindo as senhas
    if(r.precisa_gerente&&CANCIT.status==='a_produzir'){CANCIT.status=r.status||'pronto';pintaMain()}
    var e=document.getElementById('cierr');if(e)e.textContent=r.erro||'não cancelou';return;
  }
  CANCIT=null;devReset();await carregar(MESA);
}
function cancPedido(){MOTPED=null;pintaMotivoPedido()}
function selMotivoPed(v){MOTPED=v;pintaMotivoPedido()}
function fechaMotivoPed(){var o=document.getElementById('mcov');if(o)o.remove()}
function pintaMotivoPedido(){
  var ov=document.getElementById('mcov');
  if(!ov){
    ov=document.createElement('div');ov.id='mcov';
    ov.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(ov);
  }
  ov.innerHTML='<div class="card" style="max-width:430px;width:100%;margin:0;max-height:88vh;overflow:auto">'+
    '<div class="tit" style="margin-top:0">🗑 Cancelar o pedido INTEIRO — mesa/comanda '+MESA+'</div>'+
    '<div class="mut">A conta inteira some (no Consumer também) e cai no relatório de cancelamentos.</div>'+
    chipsMotivoHtml(MOTPED,'selMotivoPed',true)+
    '<button class="big" style="background:var(--red)" onclick="doCancPedido(this)">Confirmar cancelamento</button>'+
    '<button class="big" style="background:#eef2f7;color:#0f172a" onclick="fechaMotivoPed()">Voltar</button>'+
    '<div id="cperr" class="err"></div></div>';
}
async function doCancPedido(btn){
  var mot=motivoDe(MOTPED);
  var er=document.getElementById('cperr');
  if(!mot){if(er)er.textContent='escolha o motivo do cancelamento';return}
  btn.disabled=true;
  var r=await jpost('/api/caixa/cancelar-pedido',alvo({numero:MESA,motivo:mot}));
  btn.disabled=false;
  if(!r.ok){if(er)er.textContent=r.erro||'não cancelou';return}
  fechaMotivoPed();
  FLASH='Pedido da mesa/comanda '+MESA+' cancelado ('+brl(r.valor)+').';
  voltarMesas();listar();
}
/* ---- RELATÓRIO DE CONTROLE dos cancelamentos ---- */
async function telaCancRel(el){
  el.innerHTML='<button class="seg" style="margin-bottom:10px" onclick="voltarMesas()">◂ mesas</button><div class="card"><div class="mut">carregando…</div></div>';
  var d=await jget('/api/caixa/cancelamentos');
  var h='<button class="seg" style="margin-bottom:10px" onclick="voltarMesas()">◂ mesas</button>'+
    '<div class="card"><div class="tit" style="margin-top:0">🗒 Cancelamentos (30 dias)</div>';
  if(!d.ok||!(d.cancelamentos||[]).length)h+='<div class="mut">nenhum cancelamento registrado.</div>';
  else d.cancelamentos.forEach(function(x){
    var q=new Date(x.quando);
    var quando=('0'+q.getDate()).slice(-2)+'/'+('0'+(q.getMonth()+1)).slice(-2)+' '+('0'+q.getHours()).slice(-2)+':'+('0'+q.getMinutes()).slice(-2);
    h+='<div class="it"><span>'+quando+' · '+(x.numero||'—')+' · '+esc(x.nome||'')+
      '<small class="mut" style="display:block">por '+esc(x.login||'?')+
      (x.gerente&&x.gerente!==x.login?' · autorizou: '+esc(x.gerente):'')+
      (x.status_item&&x.status_item!=='a_produzir'&&x.status_item!=='pedido'?' · estava '+esc(x.status_item):'')+
      (x.motivo?' · "'+esc(x.motivo)+'"':'')+'</small></span>'+
      '<b>'+brl(x.valor)+'</b></div>';
  });
  h+='</div>';
  el.innerHTML=h;
}
/* o caixa fica horas ligado: a lista e a conta na tela se renovam sozinhas.
   A conta SÓ quando é a tela ativa — nunca por cima de um valor sendo digitado
   (desconto/acréscimo/receber não são tocados pelo timer). */
setInterval(function(){
  if(document.hidden||!TOK||TELA==='login')return;
  listar();
  TICK++;if(TICK%3===0)cxEstado(); // banner do caixa a cada 30s
  if(TELA==='conta'&&MESA!=null)jget('/api/caixa/conta?n='+MESA).then(function(c){
    if(c&&c.ok&&TELA==='conta'&&Number(c.numero)===Number(MESA)){CONTA=c;pintaMain()}}).catch(function(){});
},10000);
// versão nova no servidor -> recarrega, mas nunca no meio de uma conta aberta
var VERSAO_MINHA='${VERSAO}';
setInterval(function(){
  if(document.hidden||(TELA!=='home'&&TELA!=='login'))return;
  fetch('/api/versao',{cache:'no-store'}).then(function(r){return r.json()}).then(function(v){
    if(v&&v.versao&&v.versao!==VERSAO_MINHA)location.reload()}).catch(function(){});
},60000);
inicio();
</script></body></html>`;

// Ícone do atalho: PNG gerado aqui (zlib do próprio Node), sem arquivo nem
// dependência — quadrado na cor da casa com uma faixa clara no meio.
let _iconeCache = new Map();
function iconePng(n) {
  if (_iconeCache.has(n)) return _iconeCache.get(n);
  const crcTab = [];
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); crcTab[i] = c >>> 0; }
  const crc = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTab[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (tipo, dados) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
    const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dados]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(corpo));
    return Buffer.concat([len, corpo, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  const linhas = [];
  const faixa0 = Math.floor(n * 0.42), faixa1 = Math.floor(n * 0.58);
  for (let y = 0; y < n; y++) {
    const l = Buffer.alloc(1 + n * 3); // filtro 0 + pixels
    for (let x = 0; x < n; x++) {
      const dentro = y >= faixa0 && y < faixa1 && x > n * 0.18 && x < n * 0.82;
      const [r, g, b] = dentro ? [255, 255, 255] : [224, 101, 26]; // laranja da casa
      l[1 + x * 3] = r; l[2 + x * 3] = g; l[3 + x * 3] = b;
    }
    linhas.push(l);
  }
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(linhas))), chunk('IEND', Buffer.alloc(0))]);
  _iconeCache.set(n, png);
  return png;
}
const TABLET_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="manifest" href="/app.webmanifest?t=caixa"><meta name="mobile-web-app-capable" content="yes">
<title>${LOJA_NOME} — Ajustar este tablet</title><style>
:root{--bg:#f2f2f5;--card:#fff;--line:#e3e3e9;--ink:#1b1b20;--mut:#6e6e78;--gold2:#e0651a;--green:#15a34a;--green2:#0f8a3e;--red:#dc2626}
*{box-sizing:border-box}body{margin:0;font-family:'Outfit',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink);padding-bottom:40px}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:10px}
h1{font-size:17px;margin:0}h1 b{color:var(--gold2)}
a.back{color:var(--mut);text-decoration:none;font-size:14px}
.wrap{max-width:760px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px}
.tit{font-weight:700;margin:0 0 8px}
.mut{color:var(--mut);font-size:14px;line-height:1.5}
.big{width:100%;padding:15px;border:0;border-radius:12px;background:var(--green);color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer;margin-top:10px}
.big.g{background:#5b5b66}.big.o{background:var(--gold2)}.big:disabled{opacity:.45}
.end{display:flex;align-items:center;gap:8px;background:#f7f7fa;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:8px;font-family:ui-monospace,Menlo,monospace;font-size:14px;word-break:break-all}
.end button{flex:0 0 auto;padding:8px 12px;border:1px solid var(--line);border-radius:9px;background:#fff;font:inherit;font-size:13px;cursor:pointer}
ol{margin:8px 0 0;padding-left:20px;line-height:1.7}ol li{margin-bottom:4px}
.st{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.pill{font-size:12.5px;border-radius:20px;padding:4px 11px;border:1px solid var(--line);background:#f4f4f7;color:var(--mut)}
.pill.ok{background:#eafaf0;color:var(--green2);border-color:#8ed4a8}
.pill.no{background:#fdf2f2;color:var(--red);border-color:#eda3a3}
</style></head><body>
<header><a class="back" href="/">◂ voltar</a><h1>${LOJA_HTML} · <b>Ajustar este tablet</b></h1></header>
<div class="wrap">
  <div class="card"><div class="tit">Como este tablet está agora</div><div class="st" id="st"></div>
    <div class="mut" id="dica" style="margin-top:10px"></div>
    <button class="big" id="binst" onclick="instalar()" style="display:none">📲 Instalar em tela cheia</button>
    <button class="big g" onclick="atualizar()">🔄 Atualizar o sistema agora</button>
  </div>
  <div class="card"><div class="tit">1 · Liberar este endereço no Chrome</div>
    <div class="mut">É o que deixa o tablet instalar o app em tela cheia <b>e</b> usar a câmera. Uma vez por aparelho.</div>
    <div class="end"><span id="flagurl"></span><button onclick="copiar('flagurl',this)">copiar</button></div>
    <ol>
      <li>Abra uma aba e vá em <b>chrome://flags/#unsafely-treat-insecure-origin-as-secure</b></li>
      <li>Cole o endereço acima no campo de texto</li>
      <li>Troque <b>Disabled</b> por <b>Enabled</b></li>
      <li>Toque em <b>Relaunch</b> (o Chrome reinicia)</li>
    </ol>
    <div class="end"><span id="flaglink">chrome://flags/#unsafely-treat-insecure-origin-as-secure</span><button onclick="copiar('flaglink',this)">copiar</button></div>
  </div>
  <div class="card"><div class="tit">2 · Instalar a tela como app</div>
    <div class="mut">Depois do passo 1: volte na tela que este tablet vai usar, toque nos <b>⋮</b> (canto superior direito) e escolha <b>Instalar app</b>. Abra sempre pelo ícone novo — sem barra de endereço.</div>
    <div class="mut" style="margin-top:8px">Se aparecer só "Adicionar à tela inicial", espere 5 segundos na página e tente de novo.</div>
  </div>
  <div class="card"><div class="tit">KDS desta loja</div>
    <div class="mut">Casa que produz e entrega usa as duas telas. Casa onde quem
      produz já entrega precisa só da <b>Produção</b> — a fila de Entregas viraria
      um passo sem ninguém pra executar.</div>
    <div class="row" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="seg" id="km_ambos" onclick="setKds('ambos')">Produção + Entrega</button>
      <button class="seg" id="km_producao" onclick="setKds('producao')">Só Produção</button>
      <button class="seg" id="km_entrega" onclick="setKds('entrega')">Só Entrega</button>
    </div>
    <div class="mut" id="kmsg" style="margin-top:8px"></div>
  </div>
  <div class="card"><div class="tit">Endereços desta loja</div>
    <div class="mut">Toque pra abrir, ou copie pra digitar em outro aparelho.</div>
    <div class="end"><span id="e1"></span><button onclick="ir('e1')">abrir</button><button onclick="copiar('e1',this)">copiar</button></div>
    <div class="end"><span id="e2"></span><button onclick="ir('e2')">abrir</button><button onclick="copiar('e2',this)">copiar</button></div>
    <div class="end"><span id="e3"></span><button onclick="ir('e3')">abrir</button><button onclick="copiar('e3',this)">copiar</button></div>
    <div class="end"><span id="e4"></span><button onclick="ir('e4')">abrir</button><button onclick="copiar('e4',this)">copiar</button></div>
  </div>
  <div class="card"><div class="tit">Não conseguiu de jeito nenhum?</div>
    <div class="mut">Instale o app <b>Fully Kiosk Browser</b> (grátis, Play Store), abra as configurações dele, ponha o endereço do caixa em <b>Start URL</b> e ligue o <b>Kiosk Mode</b>. Ele abre em tela cheia sempre, trava o tablet no sistema e reabre sozinho se cair.</div>
  </div>
</div>
<script>
/* KDS: producao e/ou entrega — vale pra loja inteira, nao so pra este tablet */
async function pintaKds(m){
  ['ambos','producao','entrega'].forEach(function(k){
    var b=document.getElementById('km_'+k); if(b)b.classList.toggle('on', k===m);
  });
  var t={ambos:'As duas telas ligadas.',producao:'Só Produção — a aba Entregas some do KDS.',
         entrega:'Só Entrega.'}[m]||'';
  var e=document.getElementById('kmsg'); if(e)e.textContent=t;
}
async function carregaKds(){
  try{var r=await (await fetch('/api/kds/modo',{cache:'no-store'})).json(); if(r.ok)pintaKds(r.modo)}catch(e){}
}
async function setKds(m){
  var e=document.getElementById('kmsg'); if(e)e.textContent='salvando…';
  try{
    var r=await (await fetch('/api/kds/modo',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({modo:m})})).json();
    if(r.ok){pintaKds(r.modo); if(e)e.textContent+=' ✓ salvo — atualize o KDS'}
    else if(e)e.textContent=r.erro||'não deu';
  }catch(x){if(e)e.textContent='sem conexão com a loja'}
}
carregaKds();
var PROMPT=null;
var base=location.protocol+'//'+location.host;
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();PROMPT=e;pinta()});
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function pinta(){
  var seguro=window.isSecureContext;
  var app=window.matchMedia('(display-mode: fullscreen)').matches||window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  var sw=('serviceWorker' in navigator)&&!!navigator.serviceWorker.controller;
  document.getElementById('st').innerHTML=
    '<span class="pill '+(app?'ok':'no')+'">'+(app?'✓ abrindo como app':'✕ ainda com a barra do navegador')+'</span>'+
    '<span class="pill '+(seguro?'ok':'no')+'">'+(seguro?'✓ endereço liberado':'✕ endereço não liberado (passo 1)')+'</span>'+
    '<span class="pill '+(sw?'ok':'')+'">'+(sw?'✓ pronto pra instalar':'aguardando registro…')+'</span>';
  var d=document.getElementById('dica');
  d.innerHTML=app?'Este tablet já está do jeito certo. 👌'
    :(!seguro?'Faça o <b>passo 1</b> abaixo — sem ele o Chrome não instala o app nem libera a câmera.'
    :(PROMPT?'Tudo pronto: toque no botão verde pra instalar.'
    :'Endereço liberado. Toque nos <b>⋮</b> do Chrome e escolha <b>Instalar app</b> (se não aparecer, espere 5s e recarregue).'));
  document.getElementById('binst').style.display=(PROMPT&&!app)?'block':'none';
}
async function instalar(){ if(!PROMPT)return; PROMPT.prompt(); try{await PROMPT.userChoice}catch(e){} PROMPT=null; pinta(); }
async function atualizar(){
  try{ var rs=await navigator.serviceWorker.getRegistrations(); for(var i=0;i<rs.length;i++)await rs[i].unregister(); }catch(e){}
  location.reload(true);
}
function copiar(id,btn){
  var t=document.getElementById(id).textContent;
  var ok=function(){var v=btn.textContent;btn.textContent='copiado!';setTimeout(function(){btn.textContent=v},1500)};
  if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t).then(ok,manual);
  else manual();
  function manual(){var a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();try{document.execCommand('copy');ok()}catch(e){}a.remove()}
}
function ir(id){location.href=document.getElementById(id).textContent}
document.getElementById('flagurl').textContent='http://'+location.hostname+':8790';
document.getElementById('e1').textContent=base+'/caixa';
document.getElementById('e2').textContent=base+'/';
document.getElementById('e3').textContent=base+'/entrega';
document.getElementById('e4').textContent=base+'/venda';
pinta();setInterval(pinta,3000);
</script></body></html>`;

// LER DUAS VEZES O MESMO CORPO: o stream só vem uma vez, e uma guarda que
// precisa espiar o body (a do iFood no caixa) deixaria o handler seguinte sem
// nada — todo POST do caixa cairia com corpo vazio. Guardando a promessa no
// próprio req, a segunda chamada recebe o mesmo objeto.
function readBody(req) {
  if (req._corpo) return req._corpo;
  req._corpo = new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
  return req._corpo;
}

// VERSAO do arquivo que esta rodando — pra saber, a distancia, se o celular
// da loja pegou a atualizacao ou esta com pagina velha.
const INICIADO_EM = new Date().toISOString();

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname.replace(/\/+$/, '') || '/';

    // ⚠️ SEM ISTO, A LOJA NAO RECEBE ATUALIZACAO.
    // O servidor nao mandava header de cache nenhum. Sem Cache-Control nem
    // ETag, o Chrome do celular aplica cache heuristico e serve a pagina
    // ANTIGA por horas — o tablet do KDS e o celular do garcom continuavam
    // rodando o JS de antes do deploy, e o bug "parecia" nao ter sido
    // corrigido. Toda tela e toda API sao dinamicas aqui: nada pode ser
    // guardado.
    res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('pragma', 'no-cache');
    res.setHeader('expires', '0');
    res.setHeader('x-app-versao', VERSAO);

    // ---- ATALHO DE TELA CHEIA (sem barra de endereço) ----
    // "Adicionar à tela inicial" só abre em modo app quando existe manifest
    // com display=standalone. O ?t= diz QUAL tela o atalho abre, então o mesmo
    // servidor vira "app do caixa", "app do KDS" e "app da entrega".
    if (p === '/app.webmanifest') {
      const t = String(u.searchParams.get('t') || 'kds');
      const TELAS = { caixa: { nome: LOJA_NOME + ' Caixa', start: '/caixa' },
        venda: { nome: LOJA_NOME + ' Garçom', start: '/venda' },
        entrega: { nome: LOJA_NOME + ' Entrega', start: '/entrega' },
        kds: { nome: LOJA_NOME + ' Produção', start: '/' } };
      const cfg = TELAS[t] || TELAS.kds;
      res.writeHead(200, { 'content-type': 'application/manifest+json; charset=utf-8' });
      return res.end(JSON.stringify({
        name: cfg.nome, short_name: cfg.nome.split(' ').pop(), start_url: cfg.start, scope: '/',
        display: 'fullscreen', display_override: ['fullscreen', 'standalone'],
        orientation: 'landscape', background_color: '#f2f2f5', theme_color: '#1b1b20',
        icons: [{ src: '/app-icon.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
                { src: '/app-icon.png?g=512', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
      }));
    }
    // O Chrome só instala como APP (sem barra de endereço) se houver service
    // worker com handler de fetch. Este é o mínimo: repassa tudo pra rede — a
    // loja é local, cache offline aqui só criaria tela velha na mão do garçom.
    if (p === '/sw.js') {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end("self.addEventListener('install',function(e){self.skipWaiting()});\n" +
        "self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim())});\n" +
        "self.addEventListener('fetch',function(e){e.respondWith(fetch(e.request))});\n");
    }
    if (p === '/app-icon.png') {
      const n = Number(u.searchParams.get('g')) === 512 ? 512 : 192;
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      return res.end(iconePng(n));
    }
    if (p === '/api/versao') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ versao: VERSAO, iniciado_em: INICIADO_EM })); }
    // URL pública atual do túnel de certificação (cloudflared quick tunnel na
    // mesma pasta escreve tunel.log; a URL troca a cada restart do processo).
    // Só revela a própria URL pública — nada sensível.
    if (p === '/api/tunel') {
      let url = null;
      try {
        const m = readFileSync('tunel.log', 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
        if (m && m.length) url = m[m.length - 1];
      } catch {}
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: !!url, url }));
    }
    if (req.method === 'POST' && p === '/api/kds/modo') {
      const b = await readBody(req);
      const m = String(b.modo || '').toLowerCase();
      res.writeHead(200, { 'content-type': 'application/json' });
      if (!['ambos', 'producao', 'entrega'].includes(m)) return res.end(JSON.stringify({ ok: false, erro: 'modo inválido' }));
      await cfgSet('kds_modo', m);
      return res.end(JSON.stringify({ ok: true, modo: m }));
    }
    if (p === '/api/kds/modo') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, modo: await kdsModo() }));
    }
    if (p === '/api/config') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(apiConfig())); }
    // ---- CONFERÊNCIA DE CAIXA pelo CENTRAL (Concilia web) — assinado, sem PIN.
    // Sintético (relatorio), analítico (detalhe) e FECHAR (um/todos). O central
    // é confiável (assinatura), então age como Administrador.
    if (p.startsWith('/api/central/caixa/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (!centralAssinou(u)) return res.end(JSON.stringify({ ok: false, erro: 'assinatura inválida' }));
      const central = { login: 'central', nome: 'Concilia (central)', admin: true };
      if (p === '/api/central/caixa/relatorio') return res.end(JSON.stringify(await apiCaixaRelatorio(u.searchParams.get('data'))));
      if (p === '/api/central/caixa/detalhe') return res.end(JSON.stringify(await apiCaixaDetalhe(u.searchParams.get('caixa'))));
      if (req.method === 'POST' && p === '/api/central/caixa/fechar-um') return res.end(JSON.stringify(await apiCaixaFecharUm(await readBody(req), central)));
      if (req.method === 'POST' && p === '/api/central/caixa/fechar-todos') return res.end(JSON.stringify(await apiCaixaFecharTodos(central)));
      return res.end(JSON.stringify({ ok: false, erro: 'rota inválida' }));
    }
    if (req.method === 'POST' && p === '/api/marca') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await marcar(body))); }
    // quem baixou o quê: lista e a foto em si
    if (p === '/api/baixas') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiBaixas(u.searchParams.get('n'), u.searchParams.get('area')))); }
    if (p === '/comprovantes') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(COMPROVANTES_HTML); }
    if (p === '/api/comprovantes') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiComprovantes(u.searchParams.get('data')))); }
    if (req.method === 'POST' && p === '/api/nsu/casar') {
      const b = await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await apiNsuCasar(b.data)));
    }
    if (req.method === 'POST' && p === '/api/nsu/ler-fotos') {
      const b = await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await apiNsuLerFotos(b.data)));
    }
    if (req.method === 'POST' && p === '/api/nsu/definir') {
      const b = await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await apiNsuDefinir(b)));
    }
    if (p.startsWith('/foto/')) {
      // caminho vem do banco, mas normalizo assim mesmo: nada de subir pasta
      const rel = decodeURIComponent(p.slice(6));
      if (!/^\d{4}-\d{2}-\d{2}\/[a-z0-9]+\.jpg$/i.test(rel)) { res.writeHead(400); return res.end('caminho inválido'); }
      const arq = path.join(DIR_FOTOS, rel);
      if (!existsSync(arq)) { res.writeHead(404); return res.end('não encontrada'); }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': statSync(arq).size,
        'cache-control': 'private, max-age=3600' });
      return createReadStream(arq).pipe(res);
    }
    if (p === '/tablet') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(TABLET_HTML); }
    if (p === '/baixas') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(BAIXAS_HTML); }
    if (p.startsWith('/produto-foto/')) {
      const cod = Number(p.slice(14).replace(/\.[a-z]+$/i, ''));
      if (!(cod > 0)) { res.writeHead(400); return res.end('código inválido'); }
      const f = (await sql`SELECT mime, bytes FROM produto_foto WHERE produto_codigo=${cod}`)[0];
      if (!f) { res.writeHead(404); return res.end('sem foto'); }
      // a foto do produto quase não muda: deixa o navegador guardar
      res.writeHead(200, { 'content-type': f.mime, 'content-length': f.bytes.length,
        'cache-control': 'public, max-age=86400' });
      return res.end(f.bytes);
    }
    if (p === '/camera') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(CAMERA_HTML); }
    // ---- login do garçom (PIN) ----
    if (req.method === 'POST' && p === '/api/garcom/entrar') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiGarcomEntrar(body))); }
    if (p === '/api/garcom/sessao') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiGarcomSessao(req, u))); }
    if (p === '/api/gerentes') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiGerentesListar(req, u))); }
    if (req.method === 'POST' && p === '/api/gerente') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiGerenteSet(req, u, body))); }
    // ---- CAIXA (Bloco 1): login próprio + ações que exigem sessão de caixa ----
    if (p.startsWith('/api/caixa/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.method === 'POST' && p === '/api/caixa/entrar') return res.end(JSON.stringify(await apiCaixaEntrar(await readBody(req))));
      if (p === '/api/caixa/sessao') return res.end(JSON.stringify(await apiCaixaSessao(req, u)));
      const quem = await caixaDaRequisicao(req, u); // as demais exigem caixa logado
      if (!quem) return res.end(JSON.stringify({ ok: false, erro: 'Entre no caixa de novo.', sem_sessao: true }));
      // PEDIDO DO IFOOD (código negativo) não se recebe no caixa: o cliente já
      // pagou no app e o dinheiro vem no repasse. Sem esta guarda a ação caía
      // no pedidoAlvo() e voltava "não há conta aberta no número 0" — verdade
      // técnica que não explica nada pra quem está no caixa. A conta em si
      // (GET) passa: ver o pedido é justamente o que se quer ali.
      if (req.method === 'POST' && p !== '/api/caixa/imprimir') {
        const espia = await readBody(req).catch(() => ({}));
        if (Number(espia?.ped) < 0) {
          return res.end(JSON.stringify({ ok: false,
            erro: 'Pedido do iFood: já pago no app, não passa pelo caixa. O repasse aparece em Financeiro → Receber de canal.' }));
        }
      }
      if (p === '/api/caixa/conta') return res.end(JSON.stringify(await apiCaixaConta(u.searchParams.get('n') || 0, u.searchParams.get('ped'))));
      if (req.method === 'POST' && p === '/api/caixa/ajuste') return res.end(JSON.stringify(await apiCaixaAjuste(await readBody(req), quem)));
      if (req.method === 'POST' && p === '/api/caixa/receber-manual') {
        return res.end(JSON.stringify(await apiCaixaReceberManual(await readBody(req), quem)));
      }
      if (req.method === 'POST' && p === '/api/caixa/comprovante-foto') {
        return res.end(JSON.stringify(await apiComprovanteFoto(await readBody(req), quem)));
      }
      if (req.method === 'POST' && p === '/api/caixa/comprovante') {
        return res.end(JSON.stringify(await apiComprovanteAbrir(await readBody(req), quem)));
      }
      if (p === '/api/caixa/comprovante') {
        return res.end(JSON.stringify(await apiComprovanteStatus(
          u.searchParams.get('t'), u.searchParams.get('n'), u.searchParams.get('forma'))));
      }
      if (req.method === 'POST' && p === '/api/caixa/receber') {
        const b = await readBody(req);
        // dinheiro entra na gaveta de QUEM está logado — sem o caixa dele
        // aberto, não recebe (regra do dono: abertura só pra quem pega dinheiro)
        const cx = await fbCaixaDoOperador(quem.login);
        if (!cx) return res.end(JSON.stringify({ ok: false, sem_caixa: true, erro: 'Abra o SEU caixa antes de receber dinheiro.' }));
        const r = await apiContaPagar({ numero: b.numero, ped: b.ped, valor: b.valor, forma: 'dinheiro', modo: 'manual',
          caixa_codigo: cx.codigo, observacao: 'Caixa · ' + (quem.nome || quem.login) });
        // caixa que recebe é caixa que libera: quitou -> fecha o pedido na hora
        if (r.ok && r.quitada) { const f = await apiCaixaFechar(b.numero, b.ped); r.fechada = !!f.ok; }
        return res.end(JSON.stringify(r));
      }
      if (req.method === 'POST' && p === '/api/caixa/fechar') { const b = await readBody(req); return res.end(JSON.stringify(await apiCaixaFechar(b.numero, b.ped))); }
      if (req.method === 'POST' && p === '/api/caixa/desbloquear') return res.end(JSON.stringify(await apiCaixaDesbloquear(await readBody(req), quem)));
      if (p === '/api/caixa/estado') return res.end(JSON.stringify(await apiCaixaEstado(quem)));
      if (req.method === 'POST' && p === '/api/caixa/abrir') return res.end(JSON.stringify(await apiCaixaAbrir(await readBody(req), quem)));
      if (req.method === 'POST' && p === '/api/caixa/conferir') return res.end(JSON.stringify(await apiCaixaConferir(await readBody(req), quem)));
      if (req.method === 'POST' && p === '/api/caixa/fechar-caixa') return res.end(JSON.stringify(await apiCaixaFecharCaixa(await readBody(req), quem)));
      if (req.method === 'POST' && p === '/api/caixa/fechar-todos') return res.end(JSON.stringify(await apiCaixaFecharTodos(quem)));
      if (p === '/api/caixa/usuarios' && req.method !== 'POST') return res.end(JSON.stringify(await apiUsuariosLocais(quem)));
      if (req.method === 'POST' && p === '/api/caixa/usuarios') return res.end(JSON.stringify(await apiUsuarioLocalSalvar(await readBody(req), quem)));
      if (req.method === 'POST' && p === '/api/caixa/transferir-itens') return res.end(JSON.stringify(await apiCaixaTransferirItens(await readBody(req), quem)));
      if (p === '/api/caixa/fiado-busca') return res.end(JSON.stringify(await apiCaixaFiadoBusca(u.searchParams.get('q') || '')));
      if (req.method === 'POST' && p === '/api/caixa/fiado') return res.end(JSON.stringify(await apiCaixaFiado(await readBody(req), quem)));
      if (req.method === 'POST' && p === '/api/caixa/servico') return res.end(JSON.stringify(await apiCaixaServico(await readBody(req), quem)));
      if (req.method === 'POST' && p === '/api/caixa/movimento') return res.end(JSON.stringify(await apiCaixaMovimento(await readBody(req), quem)));
      if (p === '/api/caixa/fornecedores') return res.end(JSON.stringify(await apiCaixaFornecedores(u.searchParams.get('q') || '')));
      if (p === '/api/caixa/relatorio') return res.end(JSON.stringify(await apiCaixaRelatorio(u.searchParams.get('data'))));
      // imprimir a conta daqui = a mesma ação do garçom (pede a conta, aplica
      // o serviço e manda pra térmica — ou pra fila do Consumer se não tiver)
      if (req.method === 'POST' && p === '/api/caixa/imprimir') { const b = await readBody(req); return res.end(JSON.stringify(await apiVendaConta({ numero: b.numero, acao: 'imprimir' }))); }
      // pedir a conta pelo caixa = mesmo ato do garçom: aplica o serviço,
      // trava novos lançamentos e imprime a conferência
      if (req.method === 'POST' && p === '/api/caixa/pedir-conta') { const b = await readBody(req); return res.end(JSON.stringify(await apiVendaConta({ numero: b.numero, acao: 'fechar' }))); }
      if (req.method === 'POST' && p === '/api/caixa/liberar-cancel') { const b = await readBody(req); return res.end(JSON.stringify(await apiCaixaLiberarCancel(b, quem))); }
      if (req.method === 'POST' && p === '/api/caixa/cancelar-item') { const b = await readBody(req); return res.end(JSON.stringify(await apiCaixaCancelarItem(b, quem))); }
      if (req.method === 'POST' && p === '/api/caixa/cancelar-pedido') { const b = await readBody(req); return res.end(JSON.stringify(await apiCaixaCancelarPedido(b, quem))); }
      if (p === '/api/caixa/cancelamentos') return res.end(JSON.stringify(await apiCaixaCancelamentos()));
      return res.end(JSON.stringify({ ok: false, erro: 'rota inválida' }));
    }
    // ---- NFC-e: oferecida ao fechar a conta (caixa E maquininha) ----
    // Aceita sessão de garçom OU de caixa (os dois usam o header x-garcom).
    if (p === '/api/nfce/info' || (req.method === 'POST' && p === '/api/nfce/emitir')) {
      let quem = await garcomDaRequisicao(req, u);
      if (!quem) { const cx = await caixaDaRequisicao(req, u); if (cx) quem = { login: cx.login, nome: cx.nome }; }
      if (!quem) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, erro: 'Faça login pra continuar.', sem_sessao: true })); }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (p === '/api/nfce/info') return res.end(JSON.stringify(await apiNfceInfo(u.searchParams.get('n') || 0)));
      return res.end(JSON.stringify(await apiNfceEmitir(await readBody(req), quem)));
    }
    // ---- LIO (app da maquininha): registra o pagamento que o terminal cobrou ----
    if (req.method === 'POST' && p === '/api/lio/pagar') {
      const g = await garcomDaRequisicao(req, u);
      if (!g) {
        // ⚠️ ISTO PRECISA APARECER NO LOG. Cobrança da maquininha que falha é
        // dinheiro que entrou e conta que não fechou — e até 21/08 sumia sem
        // deixar rastro, o que custou horas de investigação às cegas.
        console.error('[lio] RECUSADO sem sessão · token inválido ou expirado');
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, erro: 'Faça login pra continuar.', sem_sessao: true }));
      }
      const body = await readBody(req);
      const rl = await apiLioPagar(body, g);
      console.log('[lio] ' + g.login + ' · mesa ' + body.numero + ' · ' + body.forma
        + ' R$ ' + body.valor + (body.nsu ? ' · NSU ' + body.nsu : ' · SEM NSU')
        + (body.terminal ? ' · term ' + body.terminal : '')
        + ' → ' + (rl.ok ? (rl.ja_registrado ? 'JÁ REGISTRADO (ignorado)' : 'ok' + (rl.quitada ? ' · quitada' : ' · falta ' + rl.saldo)) : 'ERRO: ' + rl.erro));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(rl));
    }
    // MANUTENÇÃO: reconstrói os totais de um pedido desgarrado (a mesa 1 de
    // 11/08 tinha VALORTOTAL=13,10 com itens somando 21 — corrompida por
    // deltas de antes do recálculo canônico). Usa o próprio fbAtualizarTotal.
    if (req.method === 'POST' && p === '/api/lio/recalcular') {
      const g = await garcomDaRequisicao(req, u);
      if (!g) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, erro: 'Faça login pra continuar.', sem_sessao: true })); }
      const body = await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      const ped = await fbAcharPedido(Number(body.numero)).catch(() => null);
      if (!ped) return res.end(JSON.stringify({ ok: false, erro: 'não há pedido aberto nesse número' }));
      try { await fbAtualizarTotal(ped); espelho().catch(() => {}); } catch (e) { return res.end(JSON.stringify({ ok: false, erro: e.message })); }
      const t = (await qi(`SELECT VALORTOTALITENS I, TOTALSERVICO S, VALORTOTAL T FROM PEDIDOS WHERE CODIGO=${ped}`)).rows?.[0] || {};
      return res.end(JSON.stringify({ ok: true, itens: Number(t.I) || 0, servico: Number(t.S) || 0, total: Number(t.T) || 0 }));
    }
    // Fechamento do dia da maquininha (leitura; exige garçom logado).
    if (p === '/api/lio/resumo-dia') {
      const g = await garcomDaRequisicao(req, u);
      if (!g) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, erro: 'Faça login pra continuar.', sem_sessao: true })); }
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiLioResumoDia(u, g)));
    }
    // Fechar o MEU caixa da maquininha (troca de turno): só o do LOGADO, só se
    // BATER (mesma régua do autofechamento). Caixa do sistema é recusado.
    if (req.method === 'POST' && p === '/api/lio/fechar-caixa') {
      const g = await garcomDaRequisicao(req, u);
      if (!g) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, erro: 'Faça login pra continuar.', sem_sessao: true })); }
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiLioFecharCaixa(g)));
    }
    // Fechar conta QUITADA pela maquininha (mesmo ato final do caixa — o
    // apiCaixaFechar barra sozinho se ainda faltar dinheiro).
    if (req.method === 'POST' && p === '/api/lio/fechar') {
      const g = await garcomDaRequisicao(req, u);
      if (!g) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, erro: 'Faça login pra continuar.', sem_sessao: true })); }
      const body = await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiCaixaFechar(Number(body.numero))));
    }
    // Ações da comanda mobile: só quem está logado (login com AcessarComandaMobile
    // no Consumer). Leitura fica aberta; o que MEXE na conta exige sessão.
    if (req.method === 'POST' && (p === '/api/venda/vincular' || p === '/api/venda/transferir'
        || p === '/api/venda/conta' || p === '/api/venda/enviar' || p === '/api/venda/comanda-baixa')) {
      const g = await garcomDaRequisicao(req, u);
      if (!g) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, erro: 'Faça login pra continuar.', sem_sessao: true })); }
      const body = await readBody(req);
      body._garcom = g.login;                 // quem fez a ação (auditoria)
      body._garcom_nome = g.nome || g.login;  // e o nome, que é o que sai na conta
      const fn = p === '/api/venda/vincular' ? apiVendaVincular
        : p === '/api/venda/transferir' ? apiTransferir
        : p === '/api/venda/conta' ? apiVendaConta
        : p === '/api/venda/comanda-baixa' ? apiComandaBaixa : apiVendaEnviar;
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await fn(body)));
    }
    if (p === '/api/venda/transferencias') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiTransferencias())); }
    if (p === '/conta') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(CONTA_HTML); }
    if (p === '/caixa') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(CAIXA_HTML); }
    if (p === '/api/pag/status') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(pagStatus())); }
    if (p === '/api/conta') {
      const n = u.searchParams.get('n') || 0;
      // Abriu a mesa = o garçom foi até lá → limpa o 🔔 dela (o app não tem
      // botão "Vou lá"; abrir a conta É o atendimento). Fire-and-forget.
      atenderChamadoGarcom(n, 'conta-aberta').catch(() => {});
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiConta(n)));
    }
    if (req.method === 'POST' && p === '/api/conta/pagar') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiContaPagar(body))); }
    if (req.method === 'POST' && p === '/api/conta/conferir') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiContaConferir(body.pagamento_id))); }
    if (p === '/' || p === '/entrega') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(HTML); }
    if (p === '/venda') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(VENDA_HTML); }
    if (p === '/api/areas') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiAreas())); }
    if (p === '/api/kds') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiKds(Number(u.searchParams.get('area') || 0)))); }
    // ?area ausente = todas as praças (compatibilidade). Cuidado: Number('')
    // e Number(null) dão 0, que aqui significa "sem praça definida" — por isso
    // o teste é pela AUSÊNCIA do parâmetro, não pelo valor.
    if (p === '/api/entrega') {
      const a = u.searchParams.get('area');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await apiEntrega(a == null || a === '' ? null : Number(a))));
    }
    if (p === '/api/venda/busca') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaBusca(u.searchParams.get('q') || '', u.searchParams.get('cliente') === '1'))); }
    if (p === '/api/venda/mesa') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaMesa(u.searchParams.get('n') || 0))); }
    if (req.method === 'POST' && p === '/api/venda/identificar') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiIdentificarSalvar(body))); }
    if (p === '/api/venda/identificar') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaIdentificar(u.searchParams.get('cpf') || '', u.searchParams.get('tel') || ''))); }
    if (p === '/api/observacoes') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiObservacoes(u.searchParams.get('p') || 0))); }
    if (p === '/api/mesa/sessao') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiMesaSessao(u.searchParams.get('n'), u.searchParams.get('c'), u.searchParams.get('t')))); }
    if (p === '/api/ja-pedido') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiJaPedido(u.searchParams.get('n') || 0))); }
    if (p === '/api/venda/abertas') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaAbertas())); }
    if (p === '/api/historico') {
      const a = u.searchParams.get('area');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await apiHistorico(
        a == null || a === '' ? null : Number(a),
        u.searchParams.get('modo') || 'producao',
      )));
    }
    // Rota compatível com QR codes impressos: /Cardapio/Login/Mesa/129 → cardápio da mesa 129
    const cardapioMatch = p.match(/^\/Cardapio\/Login\/Mesa\/(\d+)$/i);
    if (cardapioMatch) {
      const mesa = cardapioMatch[1];
      res.writeHead(302, { 'location': `/mesa?n=${mesa}` });
      return res.end();
    }
    if (p === '/mesa') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(MESA_HTML); }
      if (req.method === 'POST' && p === '/api/cancelado/visto') {
      const b = await readBody(req);
      await sql`UPDATE cancelamento SET visto_em=now(), visto_por=${String(b.por || 'kds').slice(0, 40)}
        WHERE id=${Number(b.id)} AND visto_em IS NULL`;
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true }));
    }
  if (p === '/api/chamados') { res.writeHead(200, { 'content-type': 'application/json' });
      const aq = u.searchParams.get('area');
      return res.end(JSON.stringify(await apiChamados(aq == null || aq === '' ? null : Number(aq)))); }
    if (p === '/api/cliente/historico') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiClienteHistorico({ numero: u.searchParams.get('n'), contato: u.searchParams.get('contato') }))); }
    if (req.method === 'POST' && p === '/api/mesa/pedir') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiMesaPedir(body))); }
    if (p === '/qrcodes') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(QRCODES_HTML); }
    // Página do CELULAR do caixa: abre a câmera e manda a foto do comprovante.
    // Sem login de propósito — quem chegou aqui tem o token, que vale 10 min e
    // uma vez só. Fica na LAN da loja, não na internet.
    if (p === '/comprovante') {
      comprovanteAbriu(u.searchParams.get('t')); // não bloqueia a página
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(COMPROVANTE_HTML);
    }
    if (req.method === 'POST' && p === '/api/comprovante/enviar') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await apiComprovanteEnviar(await readBody(req))));
    }
    if (p === '/api/qrcodes') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiQrcodes(u.searchParams.get('de'), u.searchParams.get('ate')))); }
    if (p === '/api/cpf/status') {
      const st = cpfStatus();
      try { st.cache = Number((await sql`SELECT count(*) n FROM spc_cache`)[0].n); } catch { /* segue */ }
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(st));
    }
    if (p === '/api/pix/status') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(pixStatus())); }
    if (req.method === 'POST' && p === '/api/saida/gerar') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiSaidaGerar(body))); }
    if (p === '/api/saida/passar') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiSaidaPassar(u.searchParams.get('t') || u.searchParams.get('token') || ''))); }
    if (p === '/api/saida/cancela') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiSaidaCancela(u.searchParams.get('placa') || u.searchParams.get('p') || ''))); }
    if (p === '/api/saida/ativos') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiSaidaAtivos())); }
    if (p === '/api/saida/qr') {
      const t = String(u.searchParams.get('t') || '').toUpperCase();
      if (!/^[A-Z0-9]{1,40}$/.test(t)) { res.writeHead(400); return res.end(); }
      // PNG, nao SVG: e' o PNG que o celular sabe salvar e compartilhar no zap.
      // O nome do arquivo leva a mesa, pra quem recebe saber do que se trata.
      const png = qrPng(t, 640);
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length,
        'cache-control': 'no-store',
        'content-disposition': 'inline; filename="passe-' + t + '.png"' });
      return res.end(png);
    }
    if (p === '/api/saida/consultar') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiSaidaConsultar(u.searchParams.get('t') || ''))); }
    if (p === '/catraca') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(CATRACA_HTML); }
    if (p === '/passe') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PASSE_HTML); }
    if (p === '/api/cartao/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        disponivel: cartaoDisponivel(),
        configurado: cartaoConfigurado(),
        // a tela usa isto pra apagar o botão com uma explicação, em vez de sumir
        motivo: cartaoDisponivel() ? null : (cartaoConfigurado() ? 'em breve' : 'não configurado'),
      }));
    }
    if (req.method === 'POST' && p === '/api/cartao/cobrar') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiCartaoCobrar(body))); }
    if (p === '/api/cartao/conferir') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiCartaoConferir(u.searchParams.get('ref') || ''))); }
    if (p === '/api/pix/conferir') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiPixConferir(u.searchParams.get('txid') || ''))); }
    if (req.method === 'POST' && p === '/api/pix/cobrar') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiPixCobrar(body))); }
    if (p === '/conta/ver') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(CONTAVER_HTML); }
    if (p === '/pix/comprovante') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PIXCOMPROV_HTML); }
    if (p === '/api/pix/comprovante') {
      const d = await dadosComprovantePix(u.searchParams.get('txid') || '');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(d ? { ok: true, ...d } : { ok: false, erro: 'comprovante não encontrado' }));
    }
    if (p === '/api/pix/orfaos') {
      // Pix pago que não achou conta aberta (dinheiro entrou, ninguém baixou).
      const r = await sql`SELECT txid, mesa, valor, e2e, pago_em, criado_em FROM pix_cobranca
         WHERE sem_conta AND criado_em > now() - interval '30 days' ORDER BY pago_em DESC`;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, n: r.length,
        total: +r.reduce((a, x) => a + Number(x.valor || 0), 0).toFixed(2), orfaos: r }));
    }
    if (p === '/api/pix/reimprimir') {
      const ok = await imprimirComprovantePix(u.searchParams.get('txid') || '');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok, erro: ok ? null : 'sem impressora configurada (ou falhou)' }));
    }
    if (p === '/api/conta/texto') {
      // app antigo da maquininha (HttpURLConnection = UA Dalvik, sem o header
      // x-concilia-app) recebe o desconto dobrado no `total` (ver apiContaTexto)
      const modoApp = /Dalvik/i.test(String(req.headers['user-agent'] || '')) && !req.headers['x-concilia-app'];
      // FIADO só pra quem está LOGADO (maquininha do garçom, tela do caixa).
      // Esta rota é aberta na rede da loja de propósito — é o celular do
      // cliente que a usa. Sem a trava, qualquer um no Wi-Fi digitava um
      // número de mesa e via a dívida de quem estava sentado nela.
      const quemPede = await garcomDaRequisicao(req, u).catch(() => null);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await apiContaTexto(u.searchParams.get('n') || 0, modoApp, !!quemPede)));
    }
    if (p.startsWith('/api/ifood')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (p === '/api/ifood') return res.end(JSON.stringify(await apiIfood()));
      if (req.method === 'POST' && p === '/api/ifood/salvar') return res.end(JSON.stringify(await apiIfoodSalvar(await readBody(req))));
      if (req.method === 'POST' && p === '/api/ifood/testar') return res.end(JSON.stringify(await ifoodTestar()));
      if (req.method === 'POST' && p === '/api/ifood/parear') return res.end(JSON.stringify(await ifoodParear()));
      if (req.method === 'POST' && p === '/api/ifood/concluir') return res.end(JSON.stringify(await ifoodConcluirPareamento((await readBody(req)).codigo)));
      if (p === '/api/ifood/loja') {
        try { return res.end(JSON.stringify(await ifoodLojaStatus())); }
        catch (e) { return res.end(JSON.stringify({ ok: false, erro: String(e.message).slice(0, 300) })); }
      }
      if (req.method === 'POST' && p === '/api/ifood/pausar') {
        const b = await readBody(req);
        try { return res.end(JSON.stringify(await ifoodPausar(b.minutos, b.motivo))); }
        catch (e) { return res.end(JSON.stringify({ ok: false, erro: String(e.message).slice(0, 300) })); }
      }
      if (req.method === 'POST' && p === '/api/ifood/retomar') {
        const b = await readBody(req).catch(() => ({}));
        try { return res.end(JSON.stringify(await ifoodRetomar(b.id))); }
        catch (e) { return res.end(JSON.stringify({ ok: false, erro: String(e.message).slice(0, 300) })); }
      }
      if (req.method === 'POST' && p === '/api/ifood/imprimir') {
        const b = await readBody(req);
        try { return res.end(JSON.stringify(await imprimirNotaIfood(b.id))); }
        catch (e) { return res.end(JSON.stringify({ ok: false, erro: String(e.message).slice(0, 300) })); }
      }
      if (p === '/api/ifood/motivos') {
        try { return res.end(JSON.stringify(await ifoodMotivosCancel(u.searchParams.get('id') || ''))); }
        catch (e) { return res.end(JSON.stringify({ ok: false, erro: String(e.message).slice(0, 300) })); }
      }
      if (req.method === 'POST' && p === '/api/ifood/comando') {
        const b = await readBody(req);
        // erro do iFood vira mensagem na tela, não 500: quem está no caixa
        // precisa LER o motivo (pedido já cancelado, janela de aceite vencida)
        try { return res.end(JSON.stringify(await ifoodComando(b.id, b.acao, b.motivo || null))); }
        catch (e) { return res.end(JSON.stringify({ ok: false, erro: String(e.message).slice(0, 300) })); }
      }
      return res.end(JSON.stringify({ ok: false, erro: 'rota desconhecida' }));
    }
    if (p === '/ifood') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(IFOOD_HTML); }
    if (p === '/tempos') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(TEMPOS_HTML); }
    // POST antes do GET: o `if` sem checar método engoliria o POST
    if (req.method === 'POST' && p === '/api/tempos') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiTemposSalvar(body))); }
    if (p === '/api/tempos') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiTempos())); }
    if (req.method === 'POST' && p === '/api/impressora/teste') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiImpressoraTeste(body))); }
    if (p === '/api/impressora') { res.writeHead(200, { 'content-type': 'application/json' }); if (req.method === 'POST') return res.end(JSON.stringify(await apiImpressoraSalvar(await readBody(req)))); return res.end(JSON.stringify(await apiImpressora())); }
    if (req.method === 'POST' && p === '/api/chamado') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiChamadoCriar(body))); }
    if (req.method === 'POST' && p === '/api/chamado/atender') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiChamadoAtender(body))); }
    if (p === '/api/venda/categorias') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaCategorias(u.searchParams.get('cliente') === '1'))); }
    if (p === '/api/produtos') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiProdutos(u.searchParams.get('q') || '', u.searchParams.get('so') || ''))); }
    if (req.method === 'POST' && p === '/api/produto/salvar') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiProdutoSalvar(body))); }
    if (req.method === 'POST' && p === '/api/produto/foto') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiProdutoFoto(body))); }
    if (p === '/produtos') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PRODUTOS_HTML); }
    if (p === '/api/venda/perguntas') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiPerguntas(u.searchParams.get('pdv') || 0))); }
    if (p === '/api/venda/variantes') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaVariantes(u.searchParams.get('p') || 0, u.searchParams.get('cliente') === '1'))); }
    if (p === '/api/venda/categoria') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaCategoria(u.searchParams.get('c') || '', u.searchParams.get('cliente') === '1'))); }
    if (p === '/api/grupos-ocultos') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiGruposOcultos())); }
    if (req.method === 'POST' && p === '/api/grupo-ocultar') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiGrupoOcultar(body))); }
    res.writeHead(404); res.end('not found');
  } catch (e) { res.writeHead(500); res.end('erro: ' + e.message); }
});
// Importa as fotos que o Consumer exporta (<PRODUTOS.CODIGO>.jpg numa pasta).
//   node server.mjs --fotos C:\\fotos-produto
// Roda, importa e sai — não sobe o servidor.
async function importarFotos(dir) {
  await initSchema();
  const arqs = readdirSync(dir).filter((f) => /^\d+\.(jpg|jpeg|png|webp)$/i.test(f));
  console.log(`[fotos] ${arqs.length} arquivo(s) em ${dir}`);
  let ok = 0, pulou = 0;
  for (const f of arqs) {
    const cod = Number(f.split('.')[0]);
    if (!(cod > 0)) { pulou++; continue; }
    const ext = f.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const b = readFileSync(path.join(dir, f));
    if (!b.length || b.length > 3_000_000) { pulou++; continue; }
    await sql`INSERT INTO produto_foto (produto_codigo, mime, bytes, tam, atualizado)
      VALUES (${cod}, ${mime}, ${b}, ${b.length}, now())
      ON CONFLICT (produto_codigo) DO UPDATE SET mime=EXCLUDED.mime, bytes=EXCLUDED.bytes,
        tam=EXCLUDED.tam, atualizado=now()`;
    ok++;
  }
  const t = (await sql`SELECT count(*) n, sum(tam) b FROM produto_foto`)[0];
  console.log(`[fotos] importadas ${ok}, puladas ${pulou} — banco tem ${t.n} fotos (${Math.round(Number(t.b||0)/1024/1024*10)/10} MB)`);
  await sql.end();
}
// ---- AS TELAS COMPILAM? ----
// Este arquivo é um template literal gigante: uma barra a menos num '\\n' ou
// uma crase solta viram caractere de verdade no HTML e derrubam o script
// INTEIRO da tela — que continua respondendo HTTP 200, em branco. Já aconteceu
// duas vezes hoje, e nas duas só descobri pelo usuário.
// Agora o servidor avisa na partida, antes de alguém abrir a página.
function conferirTelas() {
  const telas = { '/': HTML, '/venda': VENDA_HTML, '/tablet': TABLET_HTML, '/mesa': MESA_HTML, '/conta': CONTA_HTML, '/caixa': CAIXA_HTML,
    '/conta/ver': CONTAVER_HTML, '/pix/comprovante': PIXCOMPROV_HTML, '/produtos': PRODUTOS_HTML, '/baixas': BAIXAS_HTML,
    '/camera': CAMERA_HTML, '/qrcodes': QRCODES_HTML, '/saida': CATRACA_HTML, '/tempos': TEMPOS_HTML,
      '/passe': PASSE_HTML };
  let ruins = 0;
  for (const [rota, html] of Object.entries(telas)) {
    if (typeof html !== 'string') continue;
    const i = html.lastIndexOf('<script>'), j = html.lastIndexOf('</script>');
    if (i < 0 || j < i) continue;
    try {
      new Function(html.slice(i + 8, j));            // só compila, não executa
    } catch (e) {
      ruins++;
      console.error(`[telas] ⚠️  ${rota} NÃO COMPILA — a página vai abrir em branco: ${e.message}`);
    }
  }
  console.log(ruins ? `[telas] ${ruins} tela(s) quebrada(s)` : '[telas] ok — todas compilam');
}
async function main() {
  conferirTelas();
  const iF = process.argv.indexOf('--fotos');
  if (iF > 0) {
    // com --fotos, ou importa ou SAI — caminho vazio/errado não pode virar um
    // segundo servidor rodando por engano (aconteceu na 0001 em 19/08: a
    // variável da pasta veio vazia e o "importador" subiu espelho e tudo)
    const dirFotos = process.argv[iF + 1];
    if (!dirFotos || !existsSync(dirFotos)) { console.error('[fotos] pasta inválida: ' + JSON.stringify(dirFotos || '(vazia)') + ' — nada importado, servidor NÃO sobe com --fotos'); process.exit(2); }
    await importarFotos(dirFotos); return;
  }
  await initSchema(); console.log('[schema] ok');
  await carregarGarcomSecret().catch((e) => console.error('[garcom] segredo: ' + e.message));
  // limpa nome de colaborador que a busca antiga gravou como se fosse cliente
  // ⚠️ Os dois sao INDEPENDENTES: encadear o segundo no fim do primeiro fazia
  // ele nunca rodar, porque o primeiro sai cedo quando nao ha contato vinculado.
  await repararNomesDeColaborador().catch((e) => console.error('[reparo] ' + e.message));
  await repararPorCpfDeColaborador().catch((e) => console.error('[reparo] ' + e.message));
  await limparTestes().catch((e) => console.error('[reparo] ' + e.message));
  await repararCacheSpc().catch((e) => console.error('[reparo] ' + e.message));
  server.listen(PORT, () => console.log(`KDS em http://localhost:${PORT}  (/=produção, /entrega=entrega, /venda=garçom)`));
  // PORTAS EXTRAS (set "PORT_EXTRA=8790", ou lista: "8790,9090"): a loja
  // atende nos dois endereços AO MESMO TEMPO — caso da 0001, onde o QR
  // impresso do Consumer usa :8080 e os atalhos antigos dos tablets, :8790.
  // Porta ocupada não derruba o servidor: loga e segue nas outras.
  for (const p of String(process.env.PORT_EXTRA || '').split(',').map((x) => Number(x.trim())).filter((n) => n > 0 && n !== PORT)) {
    http.createServer(server.listeners('request')[0])
      .listen(p, () => console.log(`[http] também em http://localhost:${p}`))
      .on('error', (e) => console.log(`[http] porta extra ${p} não subiu: ` + e.message));
  }
  // HTTPS ao lado: é o endereço que libera a câmera nos tablets
  const cred = certificado();
  if (cred) {
    https.createServer(cred, server.listeners('request')[0])
      .listen(PORT_HTTPS, () => console.log(`[https] no ar em https://localhost:${PORT_HTTPS}  (necessário pra câmera)`))
      .on('error', (e) => console.log('[https] não subiu: ' + e.message));
  }
  loopEspelho();
  loopPixPendente();
  loopAutoUpdate();
  // polling do iFood: só sai da toca quando a loja estiver pareada E ligada.
  // Desligado (o padrão), o loop apenas acorda e volta a dormir.
  loopIfood();
  espelhoCatalogo().catch(() => {});
  setInterval(() => espelhoCatalogo().catch(() => {}), 5 * 60 * 1000);
  // fila de NFC-e pendente de envio (SEFAZ/central fora na hora): reenvia sozinha
  setTimeout(() => loopFiadoFila().catch(() => {}), 40 * 1000);
  setInterval(() => loopFiadoFila().catch(() => {}), 60 * 1000);
  setTimeout(() => loopCancelNuvem().catch(() => {}), 50 * 1000);
  setInterval(() => loopCancelNuvem().catch(() => {}), 60 * 1000);
  setTimeout(() => loopProdutoFila().catch(() => {}), 50 * 1000);
  setInterval(() => loopProdutoFila().catch(() => {}), 60 * 1000);
  loopCatalogoNuvem().catch(() => {});
  setInterval(() => loopCatalogoNuvem().catch(() => {}), 5 * 60 * 1000);
  setTimeout(() => loopEspelhoWizard().catch(() => {}), 90 * 1000);
  setInterval(() => loopEspelhoWizard().catch(() => {}), 30 * 60 * 1000);
  setTimeout(() => loopNfceFila().catch(() => {}), 30 * 1000);
  setInterval(() => loopNfceFila().catch(() => {}), 2 * 60 * 1000);
  // 2ª via de DANFE pedida no painel: puxa e imprime na térmica do caixa
  setInterval(() => loopNfceImpressao().catch(() => {}), 20 * 1000);
  // 04:00–07:00 BRT: fecha sozinho os caixas da MAQUININHA (nunca os do sistema)
  setInterval(() => loopFecharCaixasMaquininha().catch(() => {}), 10 * 60 * 1000);
  // fotos de quem baixou: apaga o que passou do prazo. No boot e de 6 em 6h —
  // a máquina da loja passa dias ligada, e sem isso a pasta cresce pra sempre.
  limparFotosAntigas();
  setInterval(limparFotosAntigas, 6 * 60 * 60 * 1000);
}
main().catch((e) => { console.error('fatal:', e); process.exit(1); });

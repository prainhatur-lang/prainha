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
import { createHmac, createHash, generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync, createReadStream, statSync,
  readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
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
async function addCol(tabela, ddl) {
  try { await sql.unsafe(`ALTER TABLE ${tabela} ADD COLUMN ${ddl}`); }
  catch (e) { if (e.code !== '42701') throw e; } // 42701 = coluna já existe
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
  await addCol('produto_local', 'cardapio_digital boolean DEFAULT true');
  // grupos que a CASA decidiu esconder do cliente, independente do Consumer
  // (ex.: "Artistas" vem marcado como cardapio digital la, mas nao e' pra mesa)
  await sql`CREATE TABLE IF NOT EXISTS grupo_oculto (categoria text PRIMARY KEY, criado_em timestamptz DEFAULT now())`;
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
  // CHAMADOS da mesa: "chamar garçom" e reclamação (avaliação ruim).
  // Reclamação muda a ordem da cozinha — a mesa insatisfeita passa na frente.
  await sql`CREATE TABLE IF NOT EXISTS chamado (id bigserial PRIMARY KEY,
    mesa integer, tipo text NOT NULL, origem text, nota integer, texto text,
    criado_em timestamptz DEFAULT now(), atendido_em timestamptz, atendido_por text)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_chamado_aberto ON chamado(atendido_em, criado_em)`;
  // TEMPO DE PREPARO: cada praça tem o seu (bebida sai em 5min, carne em 25).
  // Prato demorado soma minutos EXTRA por cima do tempo da praça dele.
  await sql`CREATE TABLE IF NOT EXISTS pix_cobranca (txid text PRIMARY KEY, mesa integer, valor numeric,
    copia_cola text, criado_em timestamptz DEFAULT now(), pago_em timestamptz, e2e text)`;
  await addCol('pix_cobranca', "provedor text DEFAULT 'cielo'");
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
  // nome NULL = "o SPC ja foi consultado e nao devolveu nome util". Guardar
  // isso evita pagar de novo pelo mesmo CPF sem resposta.
  await sql`ALTER TABLE spc_cache ALTER COLUMN nome DROP NOT NULL`.catch(() => {});
  await sql`CREATE TABLE IF NOT EXISTS saida_qr (token text PRIMARY KEY, mesa integer,
    pessoas integer NOT NULL, adultos integer, criancas integer, usados integer NOT NULL DEFAULT 0,
    origem text, criado_em timestamptz DEFAULT now(), expira_em timestamptz, ultima_em timestamptz)`;
  await sql`CREATE TABLE IF NOT EXISTS cartao_cobranca (ref text PRIMARY KEY, mesa integer, valor numeric,
    criado_em timestamptz DEFAULT now(), expira_em timestamptz, pago_em timestamptz, autorizacao text)`;
  await sql`CREATE TABLE IF NOT EXISTS praca_config (area_codigo integer PRIMARY KEY, minutos integer NOT NULL)`;
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
}

// ---- espelho (Firebird -> Postgres, snapshot) ----
let ultimoStatus = { ok: false, comandas: 0, itens: 0 };
async function espelho() {
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
      AND p.DATAABERTURA >= ${DESDE} ORDER BY p.NUMERO`);
  if (!c.ok) throw new Error('FB comandas: ' + c.err);
  const it = await q(`SELECT i.CODIGO ITEM, i.CODIGOPAI PAI, i.CODIGOPEDIDO PED, i.CODIGOPRODUTODETALHE PDV, i.DATAHORACADASTRO CRIADO, TRIM(i.NOMEPRODUTO) NOME, i.QUANTIDADE QTD, i.VALORTOTAL VT, i.CODIGOITEMPEDIDOTIPO TIPO, TRIM(i.DETALHES) DET, i.DATAHORAPRODUZIDO PROD, i.DATAHORAENTREGUE ENTR, pr.CODIGOCOZINHA AREA
    FROM ITENSPEDIDO i JOIN PEDIDOS p ON p.CODIGO=i.CODIGOPEDIDO
    LEFT JOIN PRODUTODETALHE pd ON pd.CODIGO=i.CODIGOPRODUTODETALHE
    LEFT JOIN PRODUTOS pr ON pr.CODIGO=pd.CODIGOPRODUTO
    WHERE p.DATAFECHAMENTO IS NULL AND p.DATADELETE IS NULL AND p.DATAABERTURA >= ${DESDE} AND i.DATADELETE IS NULL ORDER BY i.CODIGO`);
  if (!it.ok) throw new Error('FB itens: ' + it.err);

  const areas = az.ok ? az.rows.map((x) => ({ codigo: N(x.CODIGO), nome: T(x.D) || ('Área ' + x.CODIGO) })) : [];
  const comandas = c.rows.map((x) => ({ codigo: N(x.CODIGO), numero: N(x.NUMERO), origem: N(x.ORI), nome: T(x.NOME), valor_total: N(x.VALORTOTAL) || 0, subtotal_pago: N(x.SUBTOTALPAGO) || 0, qtd_pessoas: N(x.QP), data_abertura: x.DATAABERTURA || null, conta_pedida: T(x.CS) === 'S' }));
  const itens = it.rows.map((x) => ({ item_codigo: N(x.ITEM), codigo_pai: N(x.PAI), comanda_codigo: N(x.PED), codigo_pdv: N(x.PDV), criado: x.CRIADO || null, nome: T(x.NOME), quantidade: N(x.QTD) || 0, valor_total: N(x.VT) || 0, tipo: N(x.TIPO), detalhes: T(x.DET), area_codigo: N(x.AREA), produzido: x.PROD || null, entregue: x.ENTR || null }));
  // COMPLEMENTO (tipo 2) sai na cozinha do PRATO-PAI: se não tem área própria, herda a do pai (CODIGOPAI).
  const areaPorItem = new Map(itens.map((i) => [i.item_codigo, i.area_codigo]));
  for (const i of itens) {
    if (i.tipo === 2 && i.area_codigo == null && i.codigo_pai != null && areaPorItem.get(i.codigo_pai) != null) i.area_codigo = areaPorItem.get(i.codigo_pai);
  }

  await sql.begin(async (sql) => {
    if (areas.length) for (const a of areas) await sql`INSERT INTO area (codigo, nome) VALUES (${a.codigo}, ${a.nome}) ON CONFLICT (codigo) DO UPDATE SET nome=EXCLUDED.nome`;
    await sql`TRUNCATE comanda, comanda_item`;
    if (comandas.length) await sql`INSERT INTO comanda ${sql(comandas, 'codigo', 'numero', 'origem', 'nome', 'valor_total', 'subtotal_pago', 'qtd_pessoas', 'data_abertura', 'conta_pedida')}`;
    if (itens.length) await sql`INSERT INTO comanda_item ${sql(itens, 'item_codigo', 'codigo_pai', 'comanda_codigo', 'codigo_pdv', 'criado', 'nome', 'quantidade', 'valor_total', 'tipo', 'detalhes', 'area_codigo', 'produzido', 'entregue')}`;
    await sql`UPDATE sync_estado SET ultimo_ok=now(), ultimo_erro=null, comandas=${comandas.length}, itens=${itens.length} WHERE id=1`;
  });

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
  return ultimoStatus;
}
// watchdog: o espelho NUNCA pode travar o loop em silêncio (bug do node-firebird em queda de VPN).
// Se um ciclo passar de 90s, ele é abandonado, logado e o loop reprograma — nunca morre calado.
function comTimeout(p, ms, msg) { return Promise.race([p, sleep(ms).then(() => { throw new Error(msg); })]); }
async function loopEspelho() {
  try { const r = await comTimeout(espelho(), 90000, 'espelho travou (>90s) — pulando ciclo'); console.log(`[espelho] ok — ${r.comandas} comandas, ${r.itens} itens (${new Date().toLocaleTimeString('pt-BR')})`); }
  catch (e) { ultimoStatus = { ...ultimoStatus, ok: false }; await sql`UPDATE sync_estado SET ultimo_erro=${String(e.message).slice(0, 200)} WHERE id=1`.catch(() => {}); console.error('[espelho] ERRO:', e.message); }
  finally { setTimeout(loopEspelho, INTERVALO_MS); }
}

// ---- CATÁLOGO local (Firebird -> Postgres, a cada 5 min) ----
/** Traz as perguntas do Consumer pro espelho local. Sai junto do catalogo,
 *  no mesmo ciclo de 5 min — pergunta nova cadastrada la aparece aqui sozinha. */
async function espelhoPerguntas() {
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
    // nome_busca = nome+tamanho sem acento e minusculo. O garcom digita "acai",
    // "FILE", "caipirinha" e acha do mesmo jeito. Feito aqui em JS porque o
    // Postgres da loja e' o 9.5 legado (sem garantia da extensao unaccent).
    return { codigo_pdv: N(x.PDV), produto_codigo: N(x.PROD), nome, tamanho: tam, preco: N(x.PV) || 0, area_codigo: N(x.COZ), comanda_mobile: N(x.CM) === 1, nome_busca: semAcento(nome + ' ' + (tam || '')), categoria: T(x.CAT) || 'Outros', categoria_ordem: N(x.CATORD) ?? 999, sem_estoque: semEstoque,
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
  await sql.begin(async (sql) => {
    await sql`TRUNCATE produto_local`;
    if (rows.length) await sql`INSERT INTO produto_local ${sql(rows, 'codigo_pdv', 'produto_codigo', 'nome', 'tamanho', 'preco', 'area_codigo', 'comanda_mobile', 'nome_busca', 'categoria', 'categoria_ordem', 'sem_estoque', 'cardapio_digital', 'descricao', 'preparo')}`;
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
async function fbAcharPedido(numero) {
  const r = await q(`SELECT FIRST 1 CODIGO FROM PEDIDOS WHERE NUMERO=${Number(numero)} AND DATAFECHAMENTO IS NULL AND DATADELETE IS NULL ORDER BY CODIGO DESC`);
  if (!r.ok) throw new Error('FB achar pedido: ' + r.err);
  return r.rows.length ? Number(r.rows[0].CODIGO) : null;
}
async function fbCriarPedido(numero) {
  // INSERT sem CODIGO (BI trigger gera). RETURNING crasha intermitente no FB4 -> insert simples + SELECT.
  const ins = await q(`INSERT INTO PEDIDOS (NUMERO, DATAABERTURA, CODIGOPEDIDOORIGEM, VALORENTREGA, QUANTIDADEPESSOAS, ICMSDESONDIMINUIVALORNF, TAG, CONTASOLICITADA, IMPRESSAOSOLICITADA, VALORTOTAL, SUBTOTALPAGO)
    VALUES (${Number(numero)}, CURRENT_TIMESTAMP, ${VENDA_ORIGEM_FB}, 0, 1, 0, '', 'N', 'N', 0, 0)`);
  if (!ins.ok) throw new Error('FB criar pedido: ' + ins.err);
  const ped = await fbAcharPedido(numero);
  if (!ped) throw new Error('FB criar pedido: inserido mas não encontrado');
  return ped;
}
async function fbInserirItem(ped, it) {
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
  return g.ok && g.rows.length ? Number(g.rows[0].CODIGO) : null;
}
/** Carimba quem é a pessoa da comanda no PEDIDOS do Consumer.
 *  NOME sai na comanda impressa e no KDS; o CPF fica pronto pra NFC-e. */
async function fbIdentificarPedido(ped, { nome, cpf, contatoFb }) {
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
  const r = await qi(`INSERT INTO PEDIDOIMPRESSAO (INSERIDOEM, CODIGOPEDIDO, CODIGOTIPOIMPRESSAO, CODIGOORIGEMIMPRESSAO, CODIGOSITUACAOIMPRESSAO, AUTORIZADOEM)
    VALUES (CURRENT_TIMESTAMP, ${Number(ped)}, 2, 0, 2, CURRENT_TIMESTAMP)`);
  if (!r.ok) throw new Error('FB imprimir conta: ' + r.err);
}
/** Marca que a mesa pediu a conta — é isso que deixa ela vermelha na tela. */
async function fbPedirConta(ped, on = true) {
  const r = await qi(`UPDATE PEDIDOS SET CONTASOLICITADA='${on ? 'S' : 'N'}' WHERE CODIGO=${Number(ped)}`);
  if (!r.ok) throw new Error('FB pedir conta: ' + r.err);
}
/** As três ações do rodapé da mesa. NÃO fecha o pedido no Consumer:
 *  quem encerra e emite a nota continua sendo ele. */
async function apiVendaConta(body) {
  const numero = Number(body.numero);
  const acao = String(body.acao || '');
  if (!(numero >= 1 && numero <= NUMERO_MAX)) return { ok: false, erro: 'número inválido' };
  let ped;
  try { ped = await fbAcharPedido(numero); } catch (e) { return { ok: false, erro: e.message }; }
  if (!ped) return { ok: false, erro: 'não há pedido aberto no ' + (numero >= COMANDA_DE ? 'comanda ' : 'mesa ') + numero };
  try {
    if (acao === 'imprimir') { await fbPedirConta(ped, true); await fbImprimirConta(ped);
      return { ok: true, pedido_fb: ped, msg: 'Conta enviada pra impressora do caixa.' }; }
    if (acao === 'fechar') { await fbPedirConta(ped, true);
      return { ok: true, pedido_fb: ped, msg: 'Mesa marcada como “conta pedida”.' }; }
    if (acao === 'reabrir') { await fbPedirConta(ped, false);
      return { ok: true, pedido_fb: ped, msg: 'Mesa voltou pra em andamento.' }; }
    return { ok: false, erro: 'ação inválida' };
  } catch (e) { return { ok: false, erro: e.message }; }
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
  const r = await q(`UPDATE PEDIDOS SET VALORTOTAL=(SELECT COALESCE(SUM(VALORTOTAL),0) FROM ITENSPEDIDO WHERE CODIGOPEDIDO=${ped} AND DATADELETE IS NULL) WHERE CODIGO=${ped}`);
  if (!r.ok) throw new Error('FB total: ' + r.err);
}
async function fbJobCozinha(ped) {
  const r = await q(`INSERT INTO PEDIDOIMPRESSAO (INSERIDOEM, CODIGOPEDIDO, CODIGOTIPOIMPRESSAO, CODIGOORIGEMIMPRESSAO, CODIGOSITUACAOIMPRESSAO, AUTORIZADOEM)
    VALUES (CURRENT_TIMESTAMP, ${ped}, 1, 0, 2, CURRENT_TIMESTAMP)`);
  if (!r.ok) throw new Error('FB job impressão: ' + r.err);
}

// ---- PAGAMENTO no Consumer (Fase 2, Rota A) ----
// Grava em PAGAMENTOS o que NÓS cobramos, com NSU/autorização, do mesmo jeito
// que a integração "Smart POS Cielo" grava hoje (INTEGRADOAUTOMACAO='1'). Isso
// mantém o Consumer capaz de emitir a NFC-e enquanto a Fase 3 não chega.
// NÃO fecha o pedido — quem fecha/emite a nota segue sendo o Consumer.
const FORMA = { DINHEIRO: 1, CREDITO: 3, DEBITO: 4, PIX_MANUAL: 18, PIX_ONLINE: 21 };
async function fbCaixaAberto() {
  const r = await qi(`SELECT FIRST 1 CODIGO FROM CAIXA WHERE DATAFECHAMENTO IS NULL ORDER BY CODIGO DESC`);
  if (!r.ok) throw new Error('FB caixa: ' + r.err);
  if (!r.rows.length) throw new Error('nenhum caixa aberto no Consumer');
  return Number(r.rows[0].CODIGO);
}
async function fbInserirPagamento(ped, pg) {
  const caixa = await fbCaixaAberto();
  const nsu = pg.nsu ? Number(String(pg.nsu).replace(/\D/g, '')) || null : null;
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
    out.push({ grupo: true, produto_codigo: base.produto_codigo, nome: base.nome,
      descricao: base.descricao ?? null, tem_foto: !!base.tem_foto,
      area_codigo: base.area_codigo, variantes: vs.length, disponiveis: disp.length,
      preco: Math.min(...precos), preco_max: Math.max(...precos),
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
      p.categoria, p.sem_estoque, p.cardapio_digital AS padrao_cliente,
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
  const rows = await sql`SELECT codigo_pdv, produto_codigo, nome, tamanho, preco, area_codigo, sem_estoque, descricao,
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
  const rows = await sql`SELECT codigo_pdv, produto_codigo, nome, tamanho, preco, area_codigo, sem_estoque, descricao,
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
  const rows = await sql`SELECT codigo_pdv, produto_codigo, nome, tamanho, preco, area_codigo, sem_estoque, descricao,
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
  const rows = await sql`SELECT c.numero, c.valor_total, c.data_abertura, c.conta_pedida,
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
    GROUP BY c.numero, c.codigo, c.valor_total, c.data_abertura, c.conta_pedida ORDER BY c.numero`;
  for (const r of rows) {
    r.status = r.conta_pedida ? 'fechando' : ((r.atrasados > 0 || r.parados > 0) ? 'atrasada' : 'andamento');
  }
  // a comanda leva junto a mesa dela: clicar na comanda abre a MESA certa
  const vinc = await sql`SELECT comanda, mesa FROM mesa_comanda WHERE fechada_em IS NULL`;
  const mapa = new Map(vinc.map((v) => [Number(v.comanda), Number(v.mesa)]));
  return {
    mesas: rows.filter((x) => Number(x.numero) < COMANDA_DE),
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
  return { mesa: m, comandas: comandas.map((x) => x.comanda), nomes, cliente: nomes[m] || null, abertos };
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
  // `if (!ped) ped = await fbCriarPedido(numero)`.
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
  const r = await sql`SELECT ci.nome, ci.quantidade, ci.detalhes, ci.tipo,
      COALESCE(ci.produzido, m.pronto_em) AS pronto, COALESCE(ci.entregue, m.entregue_em) AS entregue, ci.criado
    FROM comanda_item ci LEFT JOIN marca m ON m.item_codigo = ci.item_codigo
    WHERE ci.comanda_codigo=${contaCodigo} AND ci.tipo IS DISTINCT FROM 2
    ORDER BY ci.criado NULLS LAST, ci.id`;
  const agora = Date.now();
  return r.map((x) => {
    // ">> SAI JUNTO C/ ..." e' recado pra COZINHA. O cliente nao precisa ver
    // como a casa se organiza por dentro — só a observação dele.
    const det = temMod(x.detalhes)
      ? String(x.detalhes).split('|').map((p) => p.trim()).filter((p) => p && !/^>>/.test(p)).join(' · ')
      : '';
    const criado = x.criado ? new Date(x.criado).getTime() : null;
    return {
      nome: x.nome, quantidade: Number(x.quantidade) || 1,
      observacao: det || null,
      estado: x.entregue ? 'entregue' : x.pronto ? 'pronto' : 'preparando',
      pedido_em: x.criado, pronto_em: x.pronto, entregue_em: x.entregue,
      espera_min: criado ? Math.max(0, Math.floor((agora - criado) / 60000)) : null,
    };
  });
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
    pedPara = await fbAcharPedido(para);
    if (!pedPara) pedPara = await fbCriarPedido(para);
  } catch (e) { return { ok: false, erro: e.message }; }

  const cont = await qi(`SELECT COUNT(*) N FROM ITENSPEDIDO WHERE CODIGOPEDIDO=${pedDe} AND DATADELETE IS NULL`);
  const n = cont.ok ? Number(cont.rows[0].N) : 0;
  if (!n) return { ok: false, erro: `a mesa ${de} não tem itens pra mover` };

  const mv = await qi(`UPDATE ITENSPEDIDO SET CODIGOPEDIDO=${pedPara} WHERE CODIGOPEDIDO=${pedDe} AND DATADELETE IS NULL`);
  if (!mv.ok) return { ok: false, erro: 'não consegui mover os itens: ' + mv.err };
  try { await fbAtualizarTotal(pedPara); await fbAtualizarTotal(pedDe); } catch { /* total recalcula no próximo ciclo */ }

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

async function apiVendaEnviar(body) {
  const numero = Number(body.numero);
  if (!(numero >= 1 && numero <= NUMERO_MAX)) return { ok: false, erro: 'número inválido' };
  const ehComanda = numero >= COMANDA_DE;
  const mesa = ehComanda ? (await sql`SELECT mesa FROM mesa_comanda WHERE comanda=${numero} AND fechada_em IS NULL`)[0]?.mesa ?? null : numero;
  const pedidos = Array.isArray(body.itens) ? body.itens : [];
  if (!pedidos.length) return { ok: false, erro: 'sem itens' };
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
  const [log] = await sql`INSERT INTO venda_envio (numero, mesa, comanda, itens, total, status, junto)
    VALUES (${numero}, ${mesa}, ${ehComanda ? numero : null}, ${JSON.stringify(itens)}, ${total}, 'enviando', ${junto && areas.length > 1}) RETURNING id`;
  try {
    let ped = await fbAcharPedido(numero);
    if (!ped) {
      ped = await fbCriarPedido(numero);
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
    espelho().catch(() => {}); // KDS atualiza já, sem esperar os 15s
    return { ok: true, pedido_fb: ped, numero, mesa, total, n_itens: itens.length };
  } catch (e) {
    await sql`UPDATE venda_envio SET status='erro', erro=${String(e.message).slice(0, 300)} WHERE id=${log.id}`;
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
  return {
    ok: true, numero: n, mesa, pedido_fb: ped,
    itens: it.rows.map((x) => ({ nome: x.NOME, qtd: Number(x.QTD), valor: Number(x.VT), tipo: Number(x.TIPO) })),
    total, servico, pago: +pago.toFixed(2), saldo: +(total - pago).toFixed(2),
    pagamentos: await sql`SELECT id, forma, valor, origem, nsu, status, criado_em FROM venda_pagamento WHERE pedido_fb=${ped} ORDER BY id`,
  };
}

/** Registra um pagamento. body: {numero, forma, valor, modo, nsu?, autorizacao?, bandeira?} */
async function apiContaPagar(body) {
  const n = Number(body.numero);
  const valor = +Number(body.valor || 0).toFixed(2);
  const forma = String(body.forma || '').toLowerCase(); // dinheiro|credito|debito|pix
  const modo = String(body.modo || 'manual').toLowerCase(); // manual|lio
  if (!(valor > 0)) return { ok: false, erro: 'valor inválido' };
  const MAPA = {
    dinheiro: { cod: FORMA.DINHEIRO, nome: 'Dinheiro' },
    credito: { cod: FORMA.CREDITO, nome: 'Cartão de Crédito' },
    debito: { cod: FORMA.DEBITO, nome: 'Cartão de Débito' },
    pix: { cod: FORMA.PIX_MANUAL, nome: 'Pix Manual' },
  };
  const fp = MAPA[forma];
  if (!fp) return { ok: false, erro: 'forma inválida' };
  const ped = await fbAcharPedido(n);
  if (!ped) return { ok: false, erro: 'comanda não está aberta' };
  const saldo = +((Number((await qi(`SELECT VALORTOTAL FROM PEDIDOS WHERE CODIGO=${ped}`)).rows?.[0]?.VALORTOTAL) || 0) - (await fbPagoDoPedido(ped))).toFixed(2);
  if (valor > saldo + 0.01) return { ok: false, erro: `valor maior que o saldo (R$ ${saldo.toFixed(2)})` };

  const [log] = await sql`INSERT INTO venda_pagamento (numero, pedido_fb, forma_codigo, forma, valor, origem, status)
    VALUES (${n}, ${ped}, ${fp.cod}, ${fp.nome}, ${valor}, ${modo}, 'iniciado') RETURNING id`;

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
      bandeira: dados.bandeira, observacao: 'Prainha Vendas',
    });
    await sql`UPDATE venda_pagamento SET status='ok', nsu=${dados.nsu}, autorizacao=${dados.autorizacao},
      bandeira=${dados.bandeira}, pagamento_fb=${pagFb} WHERE id=${log.id}`;
    const pagoAgora = await fbPagoDoPedido(ped);
    const totalPed = Number((await qi(`SELECT VALORTOTAL FROM PEDIDOS WHERE CODIGO=${ped}`)).rows?.[0]?.VALORTOTAL) || 0;
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
  const r = await qi(`SELECT FIRST 1 CODIGO, TRIM(NOME) NOME FROM CONTATOS
    WHERE DATADELETE IS NULL AND REPLACE(REPLACE(REPLACE(CNPJOUCPF,'.',''),'-',''),'/','') = '${c}'`);
  // banco fora do ar NÃO é "cliente não cadastrado" — o garçom precisa saber a diferença
  if (!r.ok) throw new Error('cadastro indisponível: ' + r.err);
  if (!r.rows.length) return null;
  return { contato_fb: Number(r.rows[0].CODIGO), nome: T(r.rows[0].NOME), fonte: 'consumer' };
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
  const h = hashCpfGrupo(cpf);
  const e = Math.floor(Date.now() / 1000) + 120;
  await fetch(`${PAGAR_MESA_URL}/api/cliente-documento`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ h, f: FILIAL_ID, e, s: assinaGrupo(h, e), nome, tel: telefone || '', origem: origem || 'manual' }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {}); // publicar é best-effort: não pode travar o atendimento
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
async function consultarCpfExterno(cpf) {
  if (CPF_PROVEDOR !== 'spc') return null;
  const user = process.env.SPC_USER, senha = process.env.SPC_PASSWORD;
  if (!user || !senha) throw new Error('SPC sem credencial (SPC_USER/SPC_PASSWORD)');
  const doc = soDig(cpf);
  // Cache: o mesmo CPF não pode ser cobrado duas vezes. Guarda só o hash.
  const hash = createHash('sha256').update(doc).digest('hex');
  const cache = (await sql`SELECT nome FROM spc_cache WHERE cpf_hash=${hash}`)[0];
  if (cache) {
    // Já consultamos esse CPF antes. Se veio sem nome útil (ou com mensagem
    // de status, de quando o filtro ainda não existia), responde "não achei"
    // SEM consultar de novo — a consulta é paga.
    if (!cache.nome || ehStatusNaoNome(cache.nome)) {
      if (cache.nome) await sql`UPDATE spc_cache SET nome=NULL WHERE cpf_hash=${hash}`.catch(() => {});
      return null;
    }
    return { nome: cache.nome, fonte: 'spc-cache' };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000); // a mesa não pode esperar demais
  try {
    const r = await fetch(SPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json',
        authorization: 'Basic ' + Buffer.from(`${user}:${senha}`).toString('base64') },
      body: JSON.stringify({ codigoProduto: SPC_PRODUTO, tipoConsumidor: 'F',
        documentoConsumidor: doc, codigoInsumoOpcional: [] }),
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
    const bruto = pf?.nome ? String(pf.nome).trim() : null;
    const nome = bruto && !ehStatusNaoNome(bruto) ? bruto : null;
    // grava SEMPRE (mesmo sem nome): a consulta já foi cobrada, não repetir
    await sql`INSERT INTO spc_cache (cpf_hash, nome) VALUES (${hash}, ${nome})
      ON CONFLICT (cpf_hash) DO UPDATE SET nome=EXCLUDED.nome`.catch(() => {});
    return nome ? { nome, fonte: 'spc' } : null;
  } finally { clearTimeout(t); }
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
async function fbCriarContato({ nome, cpf, telefone }) {
  const n = String(nome || '').trim().slice(0, 100);
  if (!n) throw new Error('nome é obrigatório pra cadastrar');
  const campos = ['NOME', 'TIPO', 'DATAINSERT', 'LIMITECREDITOCONTACORRENTE', 'SALDOATUALCONTACORRENTE',
    'COMISSAOCOLABORADOR', 'ICMSDESONDIMINUIVALORNF', 'BLOQUEARVENDAAPOSLIMITE', 'ARQUIVARFIADO'];
  const vals = [`'${fbEsc(n)}'`, `'CF'`, 'CURRENT_TIMESTAMP', '0', '0', '0', '0', `'N'`, `'N'`];
  if (cpf) { campos.push('CNPJOUCPF'); vals.push(`'${fbEsc(soDig(cpf))}'`); }
  if (telefone) { campos.push('FONECELULAR'); vals.push(`'${fbEsc(soDig(telefone))}'`); }
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
      return { ok: true, nome: null, fonte: 'nao_cadastrado' };
    } catch (e) { return { ok: true, nome: null, fonte: 'erro', aviso: String(e.message).slice(0, 120) }; }
  }
  if (!cpfValido(cpf)) return { ok: false, erro: 'CPF inválido' };
  // 1º) cadastro do Consumer — a base oficial da casa
  try {
    const local = await contatoPorCpf(cpf);
    if (local) return { ok: true, ...local, nome_curto: nomeCurto(local.nome) };
  } catch (e) { return { ok: true, nome: null, fonte: 'erro', aviso: String(e.message).slice(0, 120) }; }
  // 2º) quem já identificamos em alguma mesa antes, mesmo sem cadastrar no
  //     Consumer. Sem isto, essa pessoa seria consultada (e cobrada) de novo.
  const jaVisto = (await sql`SELECT nome, contato_fb FROM identificacao
    WHERE cpf=${soDig(cpf)} AND nome IS NOT NULL ORDER BY criado_em DESC LIMIT 1`)[0];
  if (jaVisto?.nome) return { ok: true, nome: jaVisto.nome, contato_fb: jaVisto.contato_fb ?? null,
    fonte: 'ja-atendido', nome_curto: nomeCurto(jaVisto.nome) };
  // 3º) base do GRUPO: quem já foi identificado em QUALQUER filial. Um cliente
  //     conhecido no Tabuará não pode ser consultado de novo na Prainha Bar.
  try {
    const grupo = await clienteDoGrupo(cpf);
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
    try { contatoFb = await fbCriarContato({ nome, cpf, telefone: tel }); }
    catch (e) { return { ok: false, erro: e.message }; }
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

// ---- CHAMADOS da mesa (garçom / reclamação) ----
const TIPOS_CHAMADO = new Set(['garcom', 'reclamacao']);
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
  const [ja] = await sql`SELECT id FROM chamado
    WHERE mesa IS NOT DISTINCT FROM ${mesa} AND tipo=${tipo} AND atendido_em IS NULL
      AND (origem IS NOT DISTINCT FROM ${'pedido-cliente'}) = ${auto} LIMIT 1`;
  if (ja) return { ok: true, id: Number(ja.id), repetido: true };
  const [r] = await sql`INSERT INTO chamado (mesa, tipo, origem, nota, texto)
    VALUES (${mesa}, ${tipo}, ${origem},
            ${body.nota == null ? null : Number(body.nota)}, ${String(body.texto || '').slice(0, 500) || null})
    RETURNING id`;
  return { ok: true, id: Number(r.id) };
}
async function apiChamados() {
  const rows = await sql`SELECT id, mesa, tipo, origem, nota, texto, criado_em FROM chamado
    WHERE atendido_em IS NULL ORDER BY criado_em`;
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
async function mesasComReclamacao() {
  const r = await sql`SELECT DISTINCT mesa FROM chamado WHERE tipo='reclamacao' AND atendido_em IS NULL AND mesa IS NOT NULL`;
  return new Set(r.map((x) => Number(x.mesa)));
}

async function apiAreas() {
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
     WHERE ci.area_codigo IS NULL`)[0];
  if (Number(semArea?.total ?? 0) > 0) {
    rows.unshift({ codigo: 0, nome: 'Sem praça definida', orfa: true,
      a_produzir: Number(semArea.a_produzir), total: Number(semArea.total),
      a_entregar: Number(semArea.a_entregar) });
  }
  const ent = (await sql`
    SELECT COUNT(*) AS n FROM comanda_item ci LEFT JOIN marca m ON m.item_codigo = ci.item_codigo
    WHERE ci.tipo IS DISTINCT FROM 2 AND COALESCE(ci.produzido, m.pronto_em) IS NOT NULL AND COALESCE(ci.entregue, m.entregue_em) IS NULL`)[0];
  const est = (await sql`SELECT * FROM sync_estado WHERE id=1`)[0] || null;
  return { areas: rows, entrega_n: Number(ent?.n ?? 0), online: ultimoStatus.ok, sync: est };
}

// ---- API: KDS de PRODUÇÃO de uma área (itens a produzir, ordem de CHEGADA = FIFO) ----
async function apiKds(areaCod) {
  const cond = areaCod === 0 ? sql`ci.area_codigo IS NULL` : sql`ci.area_codigo=${areaCod}`;
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
  const reclamou = await mesasComReclamacao();
  for (const c of r.comandas) c.reclamou = reclamou.has(Number(c.numero));
  r.comandas.sort((a, b) => (b.reclamou ? 1 : 0) - (a.reclamou ? 1 : 0));

  const ch = await apiChamados();
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
  return { area: { codigo: areaCod, nome: areaNome }, limite_atraso_min: LIMITE_ATRASO_MIN, ...r,
    esperando, reclamacoes: ch.reclamacoes, online: ultimoStatus.ok };
}

// ---- API: ENTREGA (global) — itens prontos, FIFO por hora do "pronto" ----
// A entrega é SEPARADA POR PRAÇA, igual à produção: quem corre o prato da
// cozinha não é quem corre a bebida do bar. Uma tela só, com tudo misturado,
// faz os dois runners disputarem a mesma fila e ninguém saber o que é seu.
//   areaCod null .. tudo (compatibilidade; a tela nova sempre manda uma praça)
//   areaCod 0 ..... itens sem praça definida
//   areaCod N ..... só aquela praça
async function apiEntrega(areaCod = null) {
  const filtroArea =
    areaCod == null ? sql`TRUE` : areaCod === 0 ? sql`ci.area_codigo IS NULL` : sql`ci.area_codigo=${areaCod}`;
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
  const agora = Date.now();
  for (const c of r.comandas) {
    c.aguarda_min = c.pronta_desde ? Math.max(0, Math.floor((agora - new Date(c.pronta_desde).getTime()) / 60000)) : null;
    for (const i of c.itens) {
      i.prod_min = (i.criado && i.pronto_em) ? Math.max(0, Math.round((new Date(i.pronto_em).getTime() - new Date(i.criado).getTime()) / 60000)) : null;
    }
  }
  return { ...r, online: ultimoStatus.ok };
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
    c.itens.push({ item_codigo: i.item_codigo, codigo_pdv: i.codigo_pdv, nome: i.nome, quantidade: i.quantidade, tipo: i.tipo, detalhes: i.detalhes, area_nome: i.area_nome, criado: i.criado, pronto_em: i.pronto_em, modificado: temMod(i.detalhes), pareado: false, esperando_par: null });
    if (i.criado && (!c.chegada || new Date(i.criado) < new Date(c.chegada))) c.chegada = i.criado;
    if (i.pronto_em && (!c.pronta_desde || new Date(i.pronto_em) < new Date(c.pronta_desde))) c.pronta_desde = i.pronto_em;
  }
  const comandas = [...porC.values()].map((c) => ({ ...c, ...classificar(c.origem, c.numero) }));
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
const HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${LOJA_NOME} — KDS</title><style>
:root{--bg:#f2f2f5;--card:#ffffff;--line:#e3e3e9;--ink:#1b1b20;--mut:#6e6e78;--gold2:#e0651a;--green:#15a34a;--green2:#0f8a3e;--red:#dc2626;--deliv:#2563eb;--mesa:#c0850f;--roxo:#6d5bd0;--roxo2:#5a49bd}
*{box-sizing:border-box}body{margin:0;font-family:'Outfit',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:12px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;box-shadow:0 1px 3px rgba(0,0,0,.05)}
h1{font-size:18px;margin:0}h1 b{color:var(--gold2)}
.back,.linkbtn{background:#f0f0f4;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:7px 13px;font:inherit;font-size:14px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:7px}
.back:hover,.linkbtn:hover{background:#e9e9ef}
.linkbtn.go{background:#eafaf0;border-color:#bfe9cf;color:var(--green2);font-weight:600}
.linkbtn .n{background:var(--green);color:#fff;border-radius:20px;padding:1px 8px;font-size:12px;font-weight:700}
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
</style></head><body>
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
  if(modo!=='entrega'&&c.critico) badge+='<span class="flag">⏰ estourou '+(c.prazo_min?'· prazo '+c.prazo_min+'min':'')+'</span>';
  else if(modo!=='entrega'&&c.atrasado) badge+='<span class="badge late">atrasado'+(c.prazo_min?' · '+c.prazo_min+'min':'')+'</span>';
  if(c.reclamou) badge+='<span class="flag">⚠ reclamou · adiantar</span>';
  if(esperandoNesta(c.numero)) badge+='<span class="flagj">sai junto</span>';
  var tchip=modo==='entrega'
    ? (c.aguarda_min!=null?'<span class="tchip">⏱ '+fmtMin(c.aguarda_min)+'</span>':'')
    : (c.espera_min!=null?'<span class="tchip">⏱ '+fmtMin(c.espera_min)+'</span>':'');
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
  return '<div class="c '+c.tipo+(modo!=='entrega'&&c.atrasado?' atrasado':'')+
    (c.reclamou?' reclamou':'')+(esperandoNesta(c.numero)?' junto-alvo':'')+'">'+
    '<div class="chd"><div class="rot"><span class="pos">'+(idx+1)+'º</span>'+esc(c.rotulo)+badge+'</div>'+tchip+'</div>'+
    nome+'<div class="its">'+its+'</div>'+foot+'</div>';
}
async function selecao(){
  var d=await (await fetch('/api/areas',{cache:'no-store'})).json();
  document.getElementById('hd').innerHTML='<h1>${LOJA_HTML} · Produção</h1><span class="grow"></span>'+
    '<a class="linkbtn go" href="/entrega">Entregas <span class="n">'+d.entrega_n+'</span> ▸</a>'+
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
    '<a class="linkbtn go" href="/entrega">Entregas ▸</a>'+
    '<span class="pill"><span class="dot '+(d.online?'on':'off')+'"></span>'+(d.online?'ao vivo':'offline')+'</span>';
  var app=document.getElementById('app');
  var topo=faixaReclamacao(d)+faixaJunto(d);
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
  var mesas=rs.map(function(r){
    return '<span class="ms">'+(r.mesa?'MESA '+r.mesa:'SEM MESA')+(r.ha_min>0?' · '+r.ha_min+'min':'')+'</span>';
  }).join('');
  var txts=rs.filter(function(r){return r.texto}).map(function(r){return (r.mesa?'Mesa '+r.mesa+': ':'')+esc(r.texto)});
  return '<div class="alerta">⚠️ ATENÇÃO '+mesas+
    '<span class="sub">Cliente reclamou — adiante o que for dessa mesa.'+
    (txts.length?' — '+txts.join(' · '):'')+'</span></div>';
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
</script></body></html>`;

// ---- /venda — tela do garçom (mobile) ----
const VENDA_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
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
</style></head><body>
<header><h1>${LOJA_HTML} · Venda</h1><span style="flex:1"></span><a class="back" href="/">KDS</a></header>
<div id="chamados"></div>
<div class="wrap" id="app"></div>
<div class="cart" id="cart" style="display:none"><div class="in" id="cartin"></div></div>
<script>
var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')};
var brl=function(n){return 'R$ '+Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2})};
var MESA=null, INFO=null, ALVO=null, CART=[], BUSCA='', debounce=null, CATS=null, CATSEL=null, AREAS=null, JUNTO=false;
function app(h){document.getElementById('app').innerHTML=h}
async function jget(u){return (await fetch(u,{cache:'no-store'})).json()}
async function jpost(u,b){return (await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)})).json()}

async function telaMesa(){
  MESA=null;ALVO=null;CART=[];CATSEL=null;BUSCA='';renderCart();
  app('<div class="tit">Mesas abertas — toque pra lançar</div>'+
    '<div class="chips" id="abertas"><span class="mut">carregando…</span></div>'+
    '<div class="tit" style="margin-top:18px">Ou digite o número</div>'+
    '<input type="number" id="nmesa" inputmode="numeric" placeholder="ex.: 5">'+
    '<button class="big" onclick="abrirMesa()">Abrir mesa</button>'+
    '<div class="mut" style="margin-top:14px">${COMANDA_ATIVA ? 'A <b>mesa</b> é o lugar; a <b>comanda (' + COMANDA_MIN + '–' + COMANDA_MAX + ')</b> é a pessoa. Dentro da mesa dá pra abrir comandas.' : 'Cada <b>mesa</b> tem a sua própria conta.'}</div>');
  var el=document.getElementById('nmesa');
  el.addEventListener('keydown',function(e){if(e.key==='Enter')abrirMesa()});
  var d=await jget('/api/venda/abertas');
  var h='';
  (d.mesas||[]).forEach(function(m){
    h+='<button class="chip st-'+(m.status||'andamento')+'" onclick="irPara('+m.numero+','+m.numero+')">Mesa '+m.numero+
       '<small>'+m.itens+' itens · '+brl(m.valor_total)+'</small></button>';
  });
  (d.comandas||[]).forEach(function(c){
    h+='<button class="chip st-'+(c.status||'andamento')+'" onclick="irPara('+(c.mesa||c.numero)+','+c.numero+')">Comanda '+c.numero+
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
    '<input type="number" id="dest" inputmode="numeric" placeholder="número da mesa de destino">'+
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
  app('<button class="back" onclick="telaMesa()">◂ trocar mesa</button>'+
    '<div class="cliente" onclick="telaCliente('+MESA+')">'+
      (quemMesa?'<span class="av">'+esc(quemMesa.charAt(0))+'</span><b>'+esc(quemMesa)+'</b><span class="mut">na mesa '+MESA+'</span>'
               :'<span class="av vazio">+</span><b>Identificar o cliente</b><span class="mut">CPF ou WhatsApp</span>')+
      '<span class="seta">›</span></div>'+
    '<div class="tit" style="margin-top:12px">Lançar em</div><div class="chips">'+chips+'</div>'+
    '<div class="tit">Produto</div>'+
    '<input type="search" id="busca" placeholder="buscar produto… (ex.: file, caipirinha)" value="'+esc(BUSCA)+'" oninput="buscar(this.value)">'+
    '<div id="grupos"><div class="tit" style="margin-top:12px">ou escolha o grupo</div>'+
    '<div class="cats" id="cats"><span class="mut">carregando…</span></div></div>'+
    '<div class="res" id="res" style="display:none"></div>'+
    '<div id="msg"></div>'+
    '<div class="tit" style="margin-top:22px">Conta</div>'+
    '<div class="acoes">'+
      '<button class="ac" onclick="verConta()">👁<span>Ver / imprimir</span></button>'+
      '<button class="ac" onclick="acaoConta(\\'imprimir\\')">🧾<span>Imprimir no caixa</span></button>'+
      '<button class="ac" onclick="acaoConta(\\'fechar\\')">🔒<span>Conta pedida</span></button>'+
    '</div>'+
    '<button class="big" style="background:#5b5b66;margin-top:9px" onclick="telaTransferir()">⇄ Transferir '+
      (ALVO>=${COMANDA_DE}?'comanda '+ALVO+' pra outra mesa':'a mesa '+MESA+' pra outra')+'</button>'+
    '<div class="mut" style="margin-top:8px">O recebimento é na maquininha. O cliente também paga sozinho por Pix na tela da mesa.</div>');
  var el=document.getElementById('busca');
  el.addEventListener('keydown',function(e){if(e.key==='Escape'){this.value='';buscar('')}});
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
function addComanda(){
  var c=prompt('Número da comanda (${COMANDA_MIN}–${COMANDA_MAX}):');if(!c)return;
  criarComanda(Number(c));
}
async function criarComanda(c){
  if(!(c>=${COMANDA_MIN}&&c<=${COMANDA_MAX})){alert('Comanda de ${COMANDA_MIN} a ${COMANDA_MAX}');return}
  var r=await jpost('/api/venda/vincular',{mesa:MESA,comanda:c});
  if(!r.ok){alert(r.erro);return}
  ALVO=c;await carregarMesa();
  telaCliente(c); // logo em seguida: quem vai usar essa comanda
}
var CPFINFO=null,cpfDeb=null,ALVOID=null;
// Identificar quem está no lugar — serve pra MESA e pra COMANDA.
// CPF ou WhatsApp: o cliente dá o que quiser.
function telaCliente(numero){
  ALVOID=Number(numero);CPFINFO=null;
  app('<button class="back" onclick="carregarMesa()">◂ voltar</button>'+
    '<div class="tit" style="margin-top:12px">Quem está '+(ALVOID>=${COMANDA_DE}?'na comanda '+ALVOID:'na mesa '+ALVOID)+'</div>'+
    '<div class="tit" style="margin-top:14px">CPF</div>'+
    '<input type="text" id="ncpf" inputmode="numeric" placeholder="000.000.000-00" oninput="olhaCpf(this.value)">'+
    '<div id="quem" class="mut" style="margin-top:10px">Digite o CPF que o nome vem sozinho.</div>'+
    '<div id="passo2"></div>'+
    '<button class="mini" onclick="modoDoc(\\'tel\\')">Não tem CPF? usar o WhatsApp</button>');
  var el=document.getElementById('ncpf');if(el)el.focus();
}
// CPF acha o nome; o WhatsApp vem DEPOIS, no passo 2 — é o que a casa usa
// pra avisar de reserva, promoção e mesa pronta.
var MODODOC='cpf';
function modoDoc(m){
  MODODOC=m;CPFINFO=null;
  var i=document.getElementById('ncpf');
  i.value='';i.placeholder=m==='cpf'?'000.000.000-00':'(79) 90000-0000';i.focus();
  document.getElementById('quem').innerHTML=m==='cpf'
    ? 'Digite o CPF que o nome vem sozinho.' : 'Digite o WhatsApp de quem já é cliente da casa.';
  document.getElementById('passo2').innerHTML='';
  var b=document.querySelector('.mini');
  if(b)b.outerHTML='<button class="mini" onclick="modoDoc(\\''+(m==='cpf'?'tel':'cpf')+'\\')">'+
    (m==='cpf'?'Não tem CPF? usar o WhatsApp':'Voltar a usar o CPF')+'</button>';
}
function olhaCpf(v){
  CPFINFO=null;clearTimeout(cpfDeb);
  var d=String(v||'').replace(/\\D/g,'');
  var q=document.getElementById('quem'),p2=document.getElementById('passo2');
  if(!q)return;
  var min=MODODOC==='cpf'?11:10;
  if(d.length<min){q.style.color='';q.innerHTML=MODODOC==='cpf'?'Digite o CPF que o nome vem sozinho.':'Digite o WhatsApp de quem já é cliente.';if(p2)p2.innerHTML='';return}
  q.style.color='';q.textContent='consultando…';
  cpfDeb=setTimeout(async function(){
    var r=await jget('/api/venda/identificar?'+(MODODOC==='cpf'?'cpf=':'tel=')+d);
    if(!r.ok){q.style.color='#dc2626';q.textContent=r.erro||'inválido';return}
    q.style.color='';
    if(r.nome){
      CPFINFO=r;
      q.innerHTML='<b style="color:#0f8a3e">'+esc(r.nome_curto)+'</b> — '+esc(r.nome)+
        ' <span class="mut">('+fonteTexto(r.fonte)+')</span>';
      passo2(r.telefone_fim);
    } else if(r.fonte==='erro'){
      q.innerHTML='<span style="color:#b45309">consulta indisponível — digite o nome</span>';
      passo2(null,true);
    } else {
      q.innerHTML='<span class="mut">Não encontrado. Digite o nome:</span>';
      passo2(null,true);
    }
  },500);
}
function fonteTexto(f){
  return f==='consumer'?'já é cliente da casa'
    :f==='grupo'?'já veio em outra unidade'
    :f==='ja-atendido'?'já atendido aqui'
    :f==='spc'||f==='spc-cache'?'consulta externa':'cadastro';
}
// Passo 2: o WhatsApp. Se já conhecemos o final do número, mostra pra
// confirmar em vez de fazer a pessoa ditar tudo de novo.
function passo2(telFim, pedeNome){
  var p2=document.getElementById('passo2');if(!p2)return;
  p2.innerHTML=(pedeNome?'<input type="text" id="nnome" placeholder="nome completo" style="margin-top:10px">':'')+
    '<div class="tit" style="margin-top:16px">WhatsApp'+(telFim?' <span class="mut">(temos o final '+esc(telFim.slice(-4))+')</span>':'')+'</div>'+
    '<input type="text" id="nzap" inputmode="numeric" placeholder="(79) 90000-0000">'+
    (pedeNome?'<label class="chk"><input type="checkbox" id="ncad" checked> cadastrar pra próxima visita</label>':'')+
    '<button class="big" onclick="salvarCliente()">Salvar</button>'+
    '<div class="mut" style="margin-top:8px">O WhatsApp é opcional — serve pra avisar de reserva e mesa pronta.</div>';
  var z=document.getElementById('nzap');if(z)z.focus();
}
async function salvarCliente(){
  var doc=((document.getElementById('ncpf')||{}).value||'').replace(/\\D/g,'');
  var zap=((document.getElementById('nzap')||{}).value||'').replace(/\\D/g,'');
  var nome=CPFINFO?CPFINFO.nome:(((document.getElementById('nnome')||{}).value||'').trim());
  if(!nome){alert('Informe o nome');return}
  var body={numero:ALVOID,nome:nome};
  if(MODODOC==='cpf'&&doc.length===11)body.cpf=doc;
  if(zap.length>=10)body.telefone=zap;
  else if(MODODOC==='tel'&&doc.length>=10)body.telefone=doc;
  if(CPFINFO&&CPFINFO.contato_fb)body.contato_fb=CPFINFO.contato_fb;
  else if((document.getElementById('ncad')||{}).checked)body.cadastrar=true;
  var r=await jpost('/api/venda/identificar',body);
  if(!r.ok){alert(r.erro);return}
  CPFINFO=null;
  if(ALVOID>=${COMANDA_DE})ALVO=ALVOID;
  await carregarMesa();
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
  app('<button class="back" onclick="telaMesa()">◂ trocar mesa</button>'+
    '<div class="cliente" onclick="telaCliente('+MESA+')">'+
      (quemMesa?'<span class="av">'+esc(quemMesa.charAt(0))+'</span><b>'+esc(quemMesa)+'</b><span class="mut">na mesa '+MESA+'</span>'
               :'<span class="av vazio">+</span><b>Identificar o cliente</b><span class="mut">CPF ou WhatsApp</span>')+
      '<span class="seta">›</span></div>'+
    '<div class="tit" style="margin-top:12px">Lançar em</div><div class="chips">'+chips+'</div>'+
    '<div class="tit">Produto</div>'+
    '<input type="search" id="busca" placeholder="buscar produto… (ex.: file, caipirinha)" value="'+esc(BUSCA)+'" oninput="buscar(this.value)">'+
    '<div id="grupos"><div class="tit" style="margin-top:12px">ou escolha o grupo</div>'+
    '<div class="cats" id="cats"><span class="mut">carregando…</span></div></div>'+
    '<div class="res" id="res" style="display:none"></div>'+
    '<div id="msg"></div>'+
    '<div class="tit" style="margin-top:22px">Conta</div>'+
    '<div class="acoes">'+
      '<button class="ac" onclick="verConta()">👁<span>Ver / imprimir</span></button>'+
      '<button class="ac" onclick="acaoConta(\\'imprimir\\')">🧾<span>Imprimir no caixa</span></button>'+
      '<button class="ac" onclick="acaoConta(\\'fechar\\')">🔒<span>Conta pedida</span></button>'+
    '</div>'+
    '<button class="big" style="background:#5b5b66;margin-top:9px" onclick="telaTransferir()">⇄ Transferir '+
      (ALVO>=${COMANDA_DE}?'comanda '+ALVO+' pra outra mesa':'a mesa '+MESA+' pra outra')+'</button>'+
    '<div class="mut" style="margin-top:8px">O recebimento é na maquininha. O cliente também paga sozinho por Pix na tela da mesa.</div>');
  var el=document.getElementById('busca');
  el.addEventListener('keydown',function(e){if(e.key==='Escape'){this.value='';buscar('')}});
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
function addComanda(){
  var c=prompt('Número da comanda (${COMANDA_MIN}–${COMANDA_MAX}):');if(!c)return;
  criarComanda(Number(c));
}
async function criarComanda(c){
  if(!(c>=${COMANDA_MIN}&&c<=${COMANDA_MAX})){alert('Comanda de ${COMANDA_MIN} a ${COMANDA_MAX}');return}
  var r=await jpost('/api/venda/vincular',{mesa:MESA,comanda:c});
  if(!r.ok){alert(r.erro);return}
  ALVO=c;await carregarMesa();
  telaCliente(c); // logo em seguida: quem vai usar essa comanda
}
var CPFINFO=null,cpfDeb=null,ALVOID=null;
// Identificar quem está no lugar — serve pra MESA e pra COMANDA.
// CPF ou WhatsApp: o cliente dá o que quiser.
function telaCliente(numero){
  ALVOID=Number(numero);CPFINFO=null;
  app('<button class="back" onclick="carregarMesa()">◂ voltar</button>'+
    '<div class="tit" style="margin-top:12px">Quem está '+(ALVOID>=${COMANDA_DE}?'na comanda '+ALVOID:'na mesa '+ALVOID)+'</div>'+
    '<div class="segs"><button class="seg on" id="sgc" onclick="modoDoc(\\'cpf\\')">CPF</button>'+
    '<button class="seg" id="sgt" onclick="modoDoc(\\'tel\\')">WhatsApp</button></div>'+
    '<input type="text" id="ncpf" inputmode="numeric" placeholder="000.000.000-00" oninput="olhaCpf(this.value)">'+
    '<div id="quem" class="mut" style="margin-top:10px">O nome aparece na comanda impressa e na tela da cozinha.</div>'+
    '<button class="big" onclick="salvarCliente()">Salvar</button>');
  var el=document.getElementById('ncpf');if(el)el.focus();
}
function modoDoc(m){
  MODODOC=m;CPFINFO=null;
  document.getElementById('sgc').className='seg'+(m==='cpf'?' on':'');
  document.getElementById('sgt').className='seg'+(m==='tel'?' on':'');
  var i=document.getElementById('ncpf');
  i.value='';i.placeholder=m==='cpf'?'000.000.000-00':'(79) 90000-0000';
  var q=document.getElementById('quem');
  q.style.color='';q.innerHTML='O nome aparece na comanda impressa e na tela da cozinha.';
}
function olhaCpf(v){
  CPFINFO=null;clearTimeout(cpfDeb);
  var d=String(v||'').replace(/\\D/g,'');
  var q=document.getElementById('quem');if(!q)return;
  var min=MODODOC==='cpf'?11:10;
  if(d.length<min){q.style.color='';q.innerHTML='O nome aparece na comanda impressa e na tela da cozinha.';return}
  q.style.color='';q.textContent='consultando…';
  cpfDeb=setTimeout(async function(){
    var r=await jget('/api/venda/identificar?'+(MODODOC==='cpf'?'cpf=':'tel=')+d);
    if(!r.ok){q.style.color='#dc2626';q.textContent=r.erro||'inválido';return}
    q.style.color='';
    if(r.nome){CPFINFO=r;q.innerHTML='<b style="color:#0f8a3e">'+esc(r.nome_curto)+'</b> — '+esc(r.nome)+
      ' <span class="mut">('+(r.fonte==='consumer'?'já é cliente da casa':'consulta externa')+')</span>';}
    else if(r.fonte==='erro'){q.innerHTML='<span style="color:#b45309">consulta indisponível — dá pra digitar o nome</span>'+campoNome()}
    else {q.innerHTML='<span class="mut">Não encontrado no cadastro. Digite o nome pra cadastrar:</span>'+campoNome()}
  },500);
}
function campoNome(){return '<input type="text" id="nnome" placeholder="nome completo da pessoa" style="margin-top:8px">'+
  '<label class="chk"><input type="checkbox" id="ncad" checked> cadastrar no sistema pra próxima visita</label>'}
async function salvarCliente(){
  var doc=((document.getElementById('ncpf')||{}).value||'').replace(/\\D/g,'');
  var nome=CPFINFO?CPFINFO.nome:(((document.getElementById('nnome')||{}).value||'').trim());
  if(!nome){alert('Informe o nome (ou um CPF/WhatsApp já cadastrado)');return}
  var body={numero:ALVOID,nome:nome};
  if(MODODOC==='cpf'&&doc.length===11)body.cpf=doc; else if(doc.length>=10)body.telefone=doc;
  if(CPFINFO&&CPFINFO.contato_fb)body.contato_fb=CPFINFO.contato_fb;
  else if((document.getElementById('ncad')||{}).checked)body.cadastrar=true;
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
function addItem(p){
  if(p.sem_estoque)return;
  var j=CART.find(function(x){return x.codigo_pdv===p.codigo_pdv&&!x.obs});
  if(j)j.qtd++;else CART.push({codigo_pdv:p.codigo_pdv,nome:p.nome,tamanho:p.tamanho,preco:Number(p.preco),qtd:1,obs:'',area_codigo:p.area_codigo});
  renderCart();
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
  var r=await jpost('/api/venda/enviar',{numero:ALVO,itens:CART.map(function(i){return {codigo_pdv:i.codigo_pdv,qtd:i.qtd,obs:i.obs,junto:!!i.junto}})});
  if(r.ok){
    CART=[];JUNTO=false;renderCart();
    app('<div class="ok"><div class="t">✓ Enviado pra cozinha</div>'+
      '<div class="mut" style="margin-top:6px">'+(r.numero>=${COMANDA_DE}?'Comanda '+r.numero+(r.mesa?' · Mesa '+r.mesa:''):'Mesa '+r.numero)+
      ' · '+r.n_itens+' item(ns) · '+brl(r.total)+' · pedido #'+r.pedido_fb+'</div></div>'+
      '<button class="big" onclick="carregarMesa()">Continuar nesta mesa</button>'+
      '<button class="big" style="background:#888" onclick="telaMesa()">Outra mesa</button>');
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
  var d;try{d=await jget('/api/chamados')}catch(e){return}
  var h='';
  (d.reclamacoes||[]).forEach(function(r){
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
puxarChamados();setInterval(puxarChamados,15000);
telaMesa();
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
  const r = await apiVendaEnviar({ numero, itens, junto: false }); // obs vai dentro de cada item
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
function ipDaLoja() {
  if (process.env.URL_PUBLICA) return process.env.URL_PUBLICA.replace(/\/+$/, '');
  const nets = os.networkInterfaces();
  for (const lista of Object.values(nets)) {
    for (const n of lista || []) {
      if (n.family === 'IPv4' && !n.internal) return `http://${n.address}:${PORT}`;
    }
  }
  return `http://localhost:${PORT}`;
}
function qrSvg(texto, px = 150) {
  return new QRCode({ content: texto, padding: 0, width: px, height: px, ecl: 'M', join: true }).svg();
}
async function apiQrcodes(de, ate) {
  const base = ipDaLoja();
  const ini = Math.max(1, Number(de) || 1);
  const fim = Math.min(MESA_MAX, Number(ate) || 30);
  const mesas = [];
  for (let n = ini; n <= fim; n++) mesas.push({ numero: n, url: `${base}/mesa?n=${n}`, svg: qrSvg(`${base}/mesa?n=${n}`) });
  return { base, de: ini, ate: fim, mesas };
}
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
async function apiSaidaGerar(body) {
  const mesa = Number(body.mesa);
  const adultos = Math.max(0, Math.min(50, Number(body.adultos) || 0));
  const criancas = Math.max(0, Math.min(50, Number(body.criancas) || 0));
  const pessoas = adultos + criancas;
  if (!(pessoas >= 1)) return { ok: false, erro: 'informe pelo menos 1 pessoa' };
  if (!(mesa >= 1 && mesa <= NUMERO_MAX)) return { ok: false, erro: 'mesa inválida' };
  const token = 'S' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1e8).toString(36).toUpperCase();
  await sql`INSERT INTO saida_qr (token, mesa, pessoas, adultos, criancas, origem, expira_em)
    VALUES (${token}, ${mesa}, ${pessoas}, ${adultos}, ${criancas}, ${String(body.origem || '').slice(0, 20) || null},
            now() + (${SAIDA_VALIDADE_MIN} || ' minutes')::interval)`;
  return { ok: true, token, pessoas, adultos, criancas, validade_min: SAIDA_VALIDADE_MIN,
    imagem: 'data:image/svg+xml;base64,' + Buffer.from(qrSvg(token, 250)).toString('base64') };
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
  return { ok: true, mesa: q.mesa, pessoas: Number(q.pessoas), usados: Number(q.usados),
    restantes: Number(q.pessoas) - Number(q.usados), expira_em: q.expira_em };
}

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
  await sql`UPDATE pix_cobranca SET pago_em=now(), e2e=${e2e} WHERE txid=${String(txid)}`;
  try {
    const ped = await fbAcharPedido(Number(cob.mesa));
    if (ped) await fbInserirPagamento(ped, { forma_codigo: FORMA.PIX_ONLINE, valor: Number(cob.valor),
      autorizacao: e2e, observacao: 'Pix do cliente (Inter) ' + txid });
  } catch (err) { console.error('[pix] registrar no Consumer falhou:', err.message); }
  return { ok: true, pago: true, e2e };
}

// ---- /conta/ver?n=12 — a conta na TELA, imprimível em papel comum ----
// A impressão do Consumer (TIPOIMPRESSAO 2) depende da impressora do caixa
// estar configurada, e a maquininha Cielo ainda está inacessível. Esta página
// resolve hoje: abre no navegador, imprime em qualquer impressora, ou só mostra.
/** Taxa de serviço da casa (CONFIG.TAXASERVICO do Consumer, hoje 10%). */
const TAXA_SERVICO = Number(process.env.TAXA_SERVICO ?? 10);
async function apiContaTexto(numero) {
  const n = Number(numero);
  const c = (await sql`SELECT codigo, numero, nome, valor_total, subtotal_pago, data_abertura, qtd_pessoas
    FROM comanda WHERE numero=${n} LIMIT 1`)[0];
  if (!c) return { ok: false, erro: 'não há conta aberta no número ' + n };
  const itens = await sql`SELECT nome, quantidade, valor_total, tipo, detalhes FROM comanda_item
    WHERE comanda_codigo=${c.codigo} ORDER BY criado NULLS LAST, id`;
  // nome: a identificacao nova ganha da tabela antiga de vinculo
  const ident = (await sql`SELECT nome_curto FROM identificacao WHERE numero=${n} AND fechada_em IS NULL`)[0];
  const quem = ident || (await sql`SELECT nome_curto FROM mesa_comanda WHERE comanda=${n} AND fechada_em IS NULL`)[0];
  const total = itens.filter((i) => i.tipo !== 2).reduce((s, i) => s + Number(i.valor_total || 0), 0);
  const pago = Number(c.subtotal_pago || 0);

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
      const sub = its.filter((i) => i.tipo !== 2).reduce((s, i) => s + Number(i.valor_total || 0), 0);
      const idc = (await sql`SELECT nome_curto FROM identificacao WHERE numero=${Number(v.comanda)} AND fechada_em IS NULL`)[0];
      // rastro da transferência: de onde essa comanda veio, quando e por quem
      const tr = (await sql`SELECT de_numero, para_numero, criado_em, por, itens_movidos
        FROM transferencia WHERE para_numero=${Number(v.comanda)} OR de_numero=${Number(v.comanda)}
        ORDER BY criado_em DESC LIMIT 1`)[0] || null;
      // O QUE JÁ FOI PAGO NA COMANDA. Sem isto, quem pagava a comanda no Pix
      // via a conta da mesa continuar cheia — o dinheiro tinha entrado e a
      // mesa não sabia. Cada comanda é um PEDIDOS próprio no Consumer, com
      // seu SUBTOTALPAGO; é ele que diz o que já foi quitado ali.
      const comSvc = +(sub * (1 + TAXA_SERVICO / 100)).toFixed(2);
      const pagoC = Number(cc.subtotal_pago || 0);
      const restaC = Math.max(0, +(comSvc - pagoC).toFixed(2));
      comandas.push({ numero: Number(v.comanda), nome: idc?.nome_curto || v.nome_curto || cc.nome || null,
        itens: its, transferencia: tr,
        subtotal: sub, servico: +(sub * TAXA_SERVICO / 100).toFixed(2),
        com_servico: comSvc,
        pago: pagoC, resta: restaC, quitada: pagoC > 0 && restaC <= 0.009 });
    }
  }
  const servico = +(total * TAXA_SERVICO / 100).toFixed(2);
  const comServico = +(total + servico).toFixed(2);
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
  return { ok: true, numero: n, nome: quem?.nome_curto || c.nome || null, abertura: c.data_abertura,
    pessoas: c.qtd_pessoas, itens, comandas, pagamentos,
    total, taxa_servico: TAXA_SERVICO, servico, com_servico: comServico,
    total_comandas: +totalComandas.toFixed(2), geral,
    pago_comandas: +pagoComandas.toFixed(2), pago_geral: pagoGeral,
    falta_geral: Math.max(0, +(geral - pagoGeral).toFixed(2)),
    pago, resta: Math.max(0, comServico - pago) };
}
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
  return '<button class="'+cls+'" onclick="gira('+ix+',\''+campo+'\')">'+rot+'</button>';
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
async function carregar(){D=await jget('/api/tempos');pinta();pintaGrupos()}
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
  var h='<div class="mut">Quanto tempo cada praça tem pra entregar. Passou disso, o pedido fica <b>vermelho</b> no KDS. '+
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
/* revisao antes de enviar: linha grande, dedo grosso, valor visivel */
.rev{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);
  border-radius:12px;padding:12px 13px;margin-bottom:8px}
.rev .rq{font-weight:800;color:var(--gold2);font-size:16px;min-width:34px}
.rev .rn{flex:1;font-size:15px;line-height:1.25}
.rev .rv{font-weight:700;white-space:nowrap;font-size:15px}
.rev .rx{background:#f4f4f7;border:1px solid var(--line);color:var(--mut);border-radius:9px;
  width:34px;height:34px;font:inherit;font-size:15px;cursor:pointer;flex:none}
.rev .rx:active{background:#ffe9e9;color:var(--red)}
.revt{display:flex;justify-content:space-between;align-items:center;margin:14px 0 4px;
  padding-top:12px;border-top:1px dashed var(--line);font-size:17px}
.revt b{font-size:21px;color:var(--gold2)}
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
.ja.preparando{border-left-color:#e0a413}
.ja.pronto{border-left-color:#15a34a}
.ja.entregue{border-left-color:#c8c8d0;opacity:.7}
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
.segs.alvos .seg.on small{color:var(--gold2)}
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
  var q='/api/mesa/sessao?n='+n+(SES&&SES.comanda!=null?'&c='+SES.comanda+(SES.desde!=null?'&t='+SES.desde:''):'');
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
    '<input id="ccpf" inputmode="numeric" placeholder="000.000.000-00" oninput="olhaCpfCli(this.value)">'+
    '<div id="cquem" class="mut" style="margin-top:9px">Digite o CPF que o nome vem sozinho.</div>'+
    '<div id="cpasso2"></div>'+
    '<button class="b g" onclick="inicio()">Agora não</button>');
  var el=document.getElementById('ccpf');if(el)el.focus();
}
var CADINFO=null, cadDeb=null;
// (removida a saída "não quero informar o CPF": o CPF virou obrigatório —
// é ele que identifica quem está consumindo e o que a consulta ao SPC usa)
function olhaCpfCli(v){
  CADINFO=null;clearTimeout(cadDeb);
  var d=String(v||'').replace(/\\D/g,'');
  var q=document.getElementById('cquem'), p2=document.getElementById('cpasso2');
  if(!q)return;
  if(d.length<11){q.style.color='';q.textContent='Digite o CPF que o nome vem sozinho.';if(p2)p2.innerHTML='';return}
  q.style.color='';q.textContent='consultando…';
  cadDeb=setTimeout(async function(){
    var r=await (await fetch('/api/venda/identificar?cpf='+d,{cache:'no-store'})).json();
    if(!r.ok){q.style.color='#dc2626';q.textContent=r.erro||'CPF inválido';if(p2)p2.innerHTML='';return}
    q.style.color='';
    if(r.nome){
      CADINFO=r;
      q.innerHTML='Olá, <b style="color:#0f8a3e">'+esc(r.nome_curto)+'</b>!';
      passo2Cli(r.telefone_fim,false);
    } else {
      q.innerHTML='<span class="mut">Primeira vez aqui? Só o nome então:</span>';
      passo2Cli(null,true);
    }
  },500);
}
// WhatsApp: nao validamos se o numero existe, mas o DDD e' obrigatorio —
// numero sem DDD nao serve pra avisar de reserva nem de mesa pronta.
function passo2Cli(telFim, pedeNome){
  var p2=document.getElementById('cpasso2');if(!p2)return;
  p2.innerHTML=(pedeNome?'<div class="tit2">Seu nome</div><input id="cnome" placeholder="como quer ser chamado">':'')+
    '<div class="tit2">WhatsApp <span class="mut">(opcional)</span>'+(telFim?' <span class="mut">· temos o final '+esc(String(telFim).slice(-4))+'</span>':'')+'</div>'+
    '<input id="czap" inputmode="numeric" placeholder="(79) 90000-0000" oninput="olhaZap(this.value)">'+
    '<div id="czapmsg" class="mut" style="margin-top:6px">Com DDD. Opcional, mas é por aqui que avisamos quando seu pedido sai e quando sua reserva está pronta.</div>'+
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
  var nome=CADINFO?CADINFO.nome:(((document.getElementById('cnome')||{}).value||'').trim());
  if(cpf.length!==11){alert('O CPF é obrigatório pra abrir a conta.');return}
  if(!nome){alert('Digite seu nome');return}
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
    '<div class="lbf">toque pra fechar</div></div>';
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
  app('<h1>Confira seu pedido</h1>'+
    '<div class="mut" style="margin:6px 0 14px">Mesa '+mesaAtual()+' · depois de enviar, a produção já começa a preparar</div>'+
    CART.map(function(i,ix){
      return '<div class="rev"><span class="rq">'+i.qtd+'x</span>'+
        '<span class="rn">'+esc(i.nome)+(i.tamanho?' <b>'+esc(i.tamanho)+'</b>':'')+
        (i.obs?'<small class="obsv">✎ '+esc(i.obs)+'</small>':'')+
        (i.junto?'<small class="jmark">⇄ sai junto com os outros marcados</small>':'')+'</span>'+
        '<span class="rv">R$ '+(i.preco*i.qtd).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</span>'+
        '<button class="rx" onclick="tiraRev('+ix+')" title="tirar">✕</button></div>';
    }).join('')+
    (varias&&marcados>1?'<div class="jdica"><b>'+marcados+' itens</b> vão sair ao mesmo tempo.</div>':'')+
    '<div class="revt"><span>total</span><b>R$ '+t.toLocaleString('pt-BR',{minimumFractionDigits:2})+'</b></div>'+
    '<button class="b" onclick="enviarPedido()">Confirmar e enviar</button>'+
    '<button class="b g" onclick="voltaDaRev()">Voltar e ajustar</button>');
}
function voltaDaRev(){ renderCarrinho(); telaPedir(); }
function tiraRev(ix){
  CART.splice(ix,1);
  if(!CART.length){ renderCarrinho(); telaPedir(); return }
  revisarPedido();
}
function togJuntoCli(ix){CART[ix].junto=!CART[ix].junto;renderCarrinho()}
function mais(i){CART[i].qtd++;renderCarrinho()}
function menos(i){CART[i].qtd--;if(CART[i].qtd<1)CART.splice(i,1);renderCarrinho()}
async function enviarPedido(){
  var n=mesaAtual();if(n===null)return;
  if(!(await sessaoOk()))return;
  var r=await post('/api/mesa/pedir',{mesa:n,sessao:SES&&SES.comanda,desde:SES&&SES.desde,
    itens:CART.map(function(i){return {codigo_pdv:i.codigo_pdv,qtd:i.qtd,obs:i.obs||'',
      junto:!!i.junto,respostas:i.respostas||null}})});
  if(!r.ok){
    if(r.reescanear){ limpaSes(); telaReescanear(r.erro); return }
    alert(r.erro||'não consegui enviar');return}
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
function setValorLivre(){
  var v=prompt('Quanto você quer pagar? (falta R$ '+
    calcPagar().resta.toLocaleString('pt-BR',{minimumFractionDigits:2})+')');
  if(v==null)return;
  var n=Number(String(v).replace(/\./g,'').replace(',','.'));
  if(!(n>0)){alert('Valor inválido');return}
  PGVALOR=n;PGPARTES=1;pintaPagar();
}
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
      '<button class="seg'+(PGVALOR!=null?' on':'')+'" onclick="setValorLivre()" style="flex:1 1 100%;margin-top:4px">'+
        (PGVALOR!=null?'pagando R$ '+PGVALOR.toLocaleString('pt-BR',{minimumFractionDigits:2}):'outro valor')+'</button>'+
    '</div>'+
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
    '<button class="b zap" onclick="mandarZap()">Enviar no WhatsApp</button>'+
    '<div id="pgst" class="mut" style="margin-top:14px">aguardando o pagamento…</div>'+
    '<button class="b g" onclick="pararPix()">Voltar</button>');
  vigiarPix(r.txid);
}
// Confirma sozinho: o cliente paga no app do banco e a tela avisa aqui.
var pixTmr=null;
function mandarZap(){
  var cod=(document.getElementById('cp')||{}).textContent||'';
  var v=(document.querySelector('#app .valor')||{}).textContent||'';
  var n=mesaAtual();
  var txt='${LOJA_NOME} — mesa '+n+'\n'+
    'Pix de '+v.trim()+'\n\n'+cod+'\n\n'+
    'Cole no app do banco pra pagar a sua parte.';
  window.open('https://wa.me/?text='+encodeURIComponent(txt),'_blank');
}
function pararPix(){clearInterval(pixTmr);pixTmr=null;inicio()}
function vigiarPix(txid){
  clearInterval(pixTmr);
  var tentativas=0;
  pixTmr=setInterval(async function(){
    if(++tentativas>120){clearInterval(pixTmr);return} // ~10 min
    var s;try{s=await (await fetch('/api/pix/conferir?txid='+encodeURIComponent(txid),{cache:'no-store'})).json()}catch(e){return}
    if(s.ok&&s.pago){
      clearInterval(pixTmr);pixTmr=null;
      telaPessoas('pix');
    }
  },5000);
}
// Pago: agora o QR da saida. Cada leitura na catraca libera uma pessoa.
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
    '<button class="b" onclick="gerarSaida(\\''+origem+'\\')">Gerar meu QR de saída</button>'+
    '<button class="b g" onclick="inicio()">Agora não</button>');
}
var PES={ad:1,cr:0};
function passo(q,d){
  PES[q]=Math.max(q==='ad'?1:0,Math.min(50,PES[q]+d));
  document.getElementById(q).textContent=PES[q];
}
async function gerarSaida(origem){
  var n=mesaAtual();if(n===null)return;
  var r=await post('/api/saida/gerar',{mesa:n,adultos:PES.ad,criancas:PES.cr,origem:origem});
  if(!r.ok){alert(r.erro||'não consegui gerar');return}
  app('<h1>Seu QR de saída</h1>'+
    '<div class="mut" style="margin:6px 0 2px">É <b>um código só</b> pra mesa toda. '+
    'Na catraca, cada pessoa encosta e passa — uma de cada vez.</div>'+
    (r.imagem?'<img class="qr" src="'+r.imagem+'" alt="QR de saída">':'')+
    '<div class="codigo">'+esc(r.token)+'</div>'+
    '<div id="prog"></div>'+
    '<div class="mut" style="margin-top:10px">Vale por '+r.validade_min+' minutos.</div>'+
    '<button class="b g" onclick="pararSaida()">Voltar ao início</button>');
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
      telaPessoas('cartao');
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
function telaProblema(){
  app('<h1>Como podemos ajudar?</h1>'+
    '<div class="mut" style="margin:8px 0 16px">Conta rapidinho o que houve — a equipe é avisada na hora e vai até você.</div>'+
    (MESA?'':'<input id="nm" inputmode="numeric" placeholder="número da sua mesa">')+
    '<input id="tx" placeholder="ex.: demora no pedido">'+
    '<button class="b" onclick="reclamar()">Enviar</button>'+
    '<button class="b g" onclick="inicio()">Voltar</button>');
}
async function reclamar(){
  var n=mesaAtual();if(n===null)return;
  var t=(document.getElementById('tx')||{}).value||'';
  await post('/api/chamado',{mesa:n,tipo:'reclamacao',origem:'qr-mesa',texto:t});
  app('<div class="ok"><div class="t">✓ Recebemos</div><div class="mut" style="margin-top:8px">Desculpe pelo transtorno. A equipe já foi avisada e vem falar com você.</div></div>'+
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

function readBody(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); }); }

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

    if (p === '/api/versao') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ versao: VERSAO, iniciado_em: INICIADO_EM })); }
    if (req.method === 'POST' && p === '/api/marca') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await marcar(body))); }
    // quem baixou o quê: lista e a foto em si
    if (p === '/api/baixas') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiBaixas(u.searchParams.get('n'), u.searchParams.get('area')))); }
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
    if (req.method === 'POST' && p === '/api/venda/vincular') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaVincular(body))); }
    if (req.method === 'POST' && p === '/api/venda/transferir') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiTransferir(body))); }
    if (p === '/api/venda/transferencias') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiTransferencias())); }
    if (req.method === 'POST' && p === '/api/venda/conta') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaConta(body))); }
    if (req.method === 'POST' && p === '/api/venda/enviar') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaEnviar(body))); }
    if (p === '/conta') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(CONTA_HTML); }
    if (p === '/api/pag/status') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(pagStatus())); }
    if (p === '/api/conta') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiConta(u.searchParams.get('n') || 0))); }
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
    if (p === '/mesa') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(MESA_HTML); }
    if (p === '/api/chamados') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiChamados())); }
    if (p === '/api/cliente/historico') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiClienteHistorico({ numero: u.searchParams.get('n'), contato: u.searchParams.get('contato') }))); }
    if (req.method === 'POST' && p === '/api/mesa/pedir') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiMesaPedir(body))); }
    if (p === '/qrcodes') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(QRCODES_HTML); }
    if (p === '/api/qrcodes') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiQrcodes(u.searchParams.get('de'), u.searchParams.get('ate')))); }
    if (p === '/api/pix/status') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(pixStatus())); }
    if (req.method === 'POST' && p === '/api/saida/gerar') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiSaidaGerar(body))); }
    if (p === '/api/saida/passar') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiSaidaPassar(u.searchParams.get('t') || u.searchParams.get('token') || ''))); }
    if (p === '/api/saida/ativos') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiSaidaAtivos())); }
    if (p === '/api/saida/consultar') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiSaidaConsultar(u.searchParams.get('t') || ''))); }
    if (p === '/catraca') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(CATRACA_HTML); }
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
    if (p === '/api/conta/texto') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiContaTexto(u.searchParams.get('n') || 0))); }
    if (p === '/tempos') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(TEMPOS_HTML); }
    // POST antes do GET: o `if` sem checar método engoliria o POST
    if (req.method === 'POST' && p === '/api/tempos') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiTemposSalvar(body))); }
    if (p === '/api/tempos') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiTempos())); }
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
async function main() {
  const iF = process.argv.indexOf('--fotos');
  if (iF > 0 && process.argv[iF + 1]) { await importarFotos(process.argv[iF + 1]); return; }
  await initSchema(); console.log('[schema] ok');
  server.listen(PORT, () => console.log(`KDS em http://localhost:${PORT}  (/=produção, /entrega=entrega, /venda=garçom)`));
  // HTTPS ao lado: é o endereço que libera a câmera nos tablets
  const cred = certificado();
  if (cred) {
    https.createServer(cred, server.listeners('request')[0])
      .listen(PORT_HTTPS, () => console.log(`[https] no ar em https://localhost:${PORT_HTTPS}  (necessário pra câmera)`))
      .on('error', (e) => console.log('[https] não subiu: ' + e.message));
  }
  loopEspelho();
  espelhoCatalogo().catch(() => {});
  setInterval(() => espelhoCatalogo().catch(() => {}), 5 * 60 * 1000);
  // fotos de quem baixou: apaga o que passou do prazo. No boot e de 6 em 6h —
  // a máquina da loja passa dias ligada, e sem isso a pasta cresce pra sempre.
  limparFotosAntigas();
  setInterval(limparFotosAntigas, 6 * 60 * 60 * 1000);
}
main().catch((e) => { console.error('fatal:', e); process.exit(1); });

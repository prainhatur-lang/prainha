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
import Firebird from 'node-firebird';
import postgres from 'postgres';

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
const INTERVALO_MS = 15000;
// Janela de comandas do espelho. CURRENT_DATE = só o dia de HOJE (a partir de 00:00).
// Se de madrugada faltar a virada (comanda aberta ontem à noite ainda aberta), trocar por:
//   DATEADD(-16 HOUR TO CURRENT_TIMESTAMP)   (janela rolante de 16h, como o Consumer usa)
const DESDE = 'CURRENT_DATE';
const LIMITE_ATRASO_MIN = 15; // prato esperando mais que isso sem "pronto" = ATRASADO (vermelho)
// Comandas individuais (cartão da PESSOA) usam a faixa 300–400; mesas do Prainha vão até ~220.
// Mesa = ONDE entregar; comanda = DE QUEM é. Uma mesa pode ter várias comandas.
const COMANDA_MIN = 300, COMANDA_MAX = 400;
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
  const nums = comandas.filter((c) => c.numero >= COMANDA_MIN && c.numero <= COMANDA_MAX).map((c) => c.numero);
  if (!nums.length) return comandas;
  const vinc = await sql`SELECT comanda, mesa FROM mesa_comanda WHERE comanda = ANY(${nums}) AND fechada_em IS NULL`;
  const mapa = new Map(vinc.map((v) => [Number(v.comanda), Number(v.mesa)]));
  for (const c of comandas) {
    if (c.numero >= COMANDA_MIN && c.numero <= COMANDA_MAX) {
      const mesa = mapa.get(c.numero);
      c.rotulo = 'Comanda ' + c.numero + (mesa ? ' · Mesa ' + mesa : '');
      c.mesa_local = mesa ?? null;
    }
  }
  return comandas;
}
const temMod = (d) => { const s = (d || '').trim().toUpperCase(); return s && s !== 'NENHUM' && s !== 'N/A'; };

// ---- Firebird serializado (só leitura) ----
let pending = null;
process.on('uncaughtException', () => { if (pending) { const r = pending; pending = null; r({ ok: false, err: 'uncaught' }); } });
process.on('unhandledRejection', () => { if (pending) { const r = pending; pending = null; r({ ok: false, err: 'unhandled' }); } });
let chain = Promise.resolve();
function q1(s) {
  return new Promise((res) => { pending = res; const fin = (r) => { if (pending) { pending = null; res(r); } }; setTimeout(() => fin({ ok: false, err: 'timeout' }), 15000);
    try { Firebird.attach(FB, (err, db) => { if (err) return fin({ ok: false, err: String(err.message).slice(0, 150) }); db.query(s, [], (e, rows) => { try { db.detach(() => {}); } catch {} if (e) return fin({ ok: false, err: String(e.message).slice(0, 180) }); fin({ ok: true, rows }); }); }); } catch (e) { fin({ ok: false, err: String(e.message).slice(0, 150) }); } });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function q(s, tries = 3) { const run = async () => { for (let i = 0; i < tries; i++) { const r = await q1(s); if (r.ok) return r; await sleep(400); } return { ok: false, err: 'retry' }; }; const p = chain.then(run); chain = p.catch(() => {}); return p; }
const N = (v) => (v == null ? null : Number(v));
const T = (v) => { const s = (v == null ? '' : String(v)).trim(); return s || null; };

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
  await sql`CREATE TABLE IF NOT EXISTS marca (item_codigo bigint PRIMARY KEY, pronto_em timestamptz, entregue_em timestamptz)`;
  await addCol('marca', 'criado_em timestamptz');
  await addCol('marca', 'comanda_codigo integer');
  await addCol('marca', 'area_codigo integer');
  await addCol('marca', 'nome text');
  await sql`CREATE INDEX IF NOT EXISTS ix_ci_item ON comanda_item(item_codigo)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_ci_pai ON comanda_item(codigo_pai)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_ci_area ON comanda_item(area_codigo)`;
  await sql`CREATE TABLE IF NOT EXISTS sync_estado (id int PRIMARY KEY DEFAULT 1, ultimo_ok timestamptz, ultimo_erro text, comandas int, itens int)`;
  await sql`INSERT INTO sync_estado (id) VALUES (1) ON CONFLICT DO NOTHING`;
  // --- VENDA (Fase 1) ---
  // catálogo local (cache do Firebird; a busca do garçom lê daqui — funciona offline)
  await sql`CREATE TABLE IF NOT EXISTS produto_local (codigo_pdv integer PRIMARY KEY, produto_codigo integer, nome text, tamanho text, preco numeric, area_codigo integer, comanda_mobile boolean, atualizado timestamptz DEFAULT now())`;
  // vínculo comanda (300-400, a pessoa) -> mesa (o lugar)
  await sql`CREATE TABLE IF NOT EXISTS mesa_comanda (comanda integer PRIMARY KEY, mesa integer NOT NULL, aberta_em timestamptz DEFAULT now(), fechada_em timestamptz)`;
  // log durável de TUDO que o nosso app lançou (a venda mora aqui mesmo se o FB falhar)
  await sql`CREATE TABLE IF NOT EXISTS venda_envio (id bigserial PRIMARY KEY, criado_em timestamptz DEFAULT now(), numero integer, mesa integer, comanda integer, pedido_fb integer, itens jsonb, total numeric, status text, erro text)`;
}

// ---- espelho (Firebird -> Postgres, snapshot) ----
let ultimoStatus = { ok: false, comandas: 0, itens: 0 };
async function espelho() {
  const az = await q(`SELECT CODIGO, TRIM(DESCRICAO) D FROM COZINHAS ORDER BY CODIGO`);
  const c = await q(`SELECT CODIGO, NUMERO, CODIGOPEDIDOORIGEM ORI, TRIM(NOME) NOME, VALORTOTAL, SUBTOTALPAGO, QUANTIDADEPESSOAS QP, DATAABERTURA FROM PEDIDOS WHERE DATAFECHAMENTO IS NULL AND DATADELETE IS NULL AND DATAABERTURA >= ${DESDE} ORDER BY NUMERO`);
  if (!c.ok) throw new Error('FB comandas: ' + c.err);
  const it = await q(`SELECT i.CODIGO ITEM, i.CODIGOPAI PAI, i.CODIGOPEDIDO PED, i.DATAHORACADASTRO CRIADO, TRIM(i.NOMEPRODUTO) NOME, i.QUANTIDADE QTD, i.VALORTOTAL VT, i.CODIGOITEMPEDIDOTIPO TIPO, TRIM(i.DETALHES) DET, i.DATAHORAPRODUZIDO PROD, i.DATAHORAENTREGUE ENTR, pr.CODIGOCOZINHA AREA
    FROM ITENSPEDIDO i JOIN PEDIDOS p ON p.CODIGO=i.CODIGOPEDIDO
    LEFT JOIN PRODUTODETALHE pd ON pd.CODIGO=i.CODIGOPRODUTODETALHE
    LEFT JOIN PRODUTOS pr ON pr.CODIGO=pd.CODIGOPRODUTO
    WHERE p.DATAFECHAMENTO IS NULL AND p.DATADELETE IS NULL AND p.DATAABERTURA >= ${DESDE} AND i.DATADELETE IS NULL ORDER BY i.CODIGO`);
  if (!it.ok) throw new Error('FB itens: ' + it.err);

  const areas = az.ok ? az.rows.map((x) => ({ codigo: N(x.CODIGO), nome: T(x.D) || ('Área ' + x.CODIGO) })) : [];
  const comandas = c.rows.map((x) => ({ codigo: N(x.CODIGO), numero: N(x.NUMERO), origem: N(x.ORI), nome: T(x.NOME), valor_total: N(x.VALORTOTAL) || 0, subtotal_pago: N(x.SUBTOTALPAGO) || 0, qtd_pessoas: N(x.QP), data_abertura: x.DATAABERTURA || null }));
  const itens = it.rows.map((x) => ({ item_codigo: N(x.ITEM), codigo_pai: N(x.PAI), comanda_codigo: N(x.PED), criado: x.CRIADO || null, nome: T(x.NOME), quantidade: N(x.QTD) || 0, valor_total: N(x.VT) || 0, tipo: N(x.TIPO), detalhes: T(x.DET), area_codigo: N(x.AREA), produzido: x.PROD || null, entregue: x.ENTR || null }));
  // COMPLEMENTO (tipo 2) sai na cozinha do PRATO-PAI: se não tem área própria, herda a do pai (CODIGOPAI).
  const areaPorItem = new Map(itens.map((i) => [i.item_codigo, i.area_codigo]));
  for (const i of itens) {
    if (i.tipo === 2 && i.area_codigo == null && i.codigo_pai != null && areaPorItem.get(i.codigo_pai) != null) i.area_codigo = areaPorItem.get(i.codigo_pai);
  }

  await sql.begin(async (sql) => {
    if (areas.length) for (const a of areas) await sql`INSERT INTO area (codigo, nome) VALUES (${a.codigo}, ${a.nome}) ON CONFLICT (codigo) DO UPDATE SET nome=EXCLUDED.nome`;
    await sql`TRUNCATE comanda, comanda_item`;
    if (comandas.length) await sql`INSERT INTO comanda ${sql(comandas, 'codigo', 'numero', 'origem', 'nome', 'valor_total', 'subtotal_pago', 'qtd_pessoas', 'data_abertura')}`;
    if (itens.length) await sql`INSERT INTO comanda_item ${sql(itens, 'item_codigo', 'codigo_pai', 'comanda_codigo', 'criado', 'nome', 'quantidade', 'valor_total', 'tipo', 'detalhes', 'area_codigo', 'produzido', 'entregue')}`;
    await sql`UPDATE sync_estado SET ultimo_ok=now(), ultimo_erro=null, comandas=${comandas.length}, itens=${itens.length} WHERE id=1`;
  });
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
async function espelhoCatalogo() {
  const r = await q(`SELECT pd.CODIGO PDV, p.CODIGO PROD, TRIM(p.NOME) NOME, TRIM(pt.DESCRICAO) TAM, pd.PRECOVENDA PV, p.CODIGOCOZINHA COZ, pd.COMANDAMOBILE CM
    FROM PRODUTODETALHE pd JOIN PRODUTOS p ON p.CODIGO=pd.CODIGOPRODUTO
    LEFT JOIN PRODUTOTAMANHO pt ON pt.CODIGO=pd.CODIGOPRODUTOTAMANHO
    WHERE pd.DATADELETE IS NULL AND pd.DATAPAUSADO IS NULL AND (p.DESCONTINUADO IS NULL OR p.DESCONTINUADO<>'S') AND pd.PRECOVENDA>0`);
  if (!r.ok) { console.error('[catalogo] ERRO:', r.err); return; }
  const rows = r.rows.map((x) => ({ codigo_pdv: N(x.PDV), produto_codigo: N(x.PROD), nome: T(x.NOME) || '?', tamanho: T(x.TAM), preco: N(x.PV) || 0, area_codigo: N(x.COZ), comanda_mobile: N(x.CM) === 1 }));
  await sql.begin(async (sql) => {
    await sql`TRUNCATE produto_local`;
    if (rows.length) await sql`INSERT INTO produto_local ${sql(rows, 'codigo_pdv', 'produto_codigo', 'nome', 'tamanho', 'preco', 'area_codigo', 'comanda_mobile')}`;
  });
  console.log(`[catalogo] ok — ${rows.length} produtos vendíveis`);
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
  const r = await q(`INSERT INTO ITENSPEDIDO (CODIGOPEDIDO, CODIGOPRODUTO, CODIGOPRODUTODETALHE, NOMEPRODUTO, QUANTIDADE, VALORUNITARIO, VALORITEM, VALORCOMPLEMENTO, VALORFILHO, VALORTOTAL, VALORDESCONTO, CODIGOITEMPEDIDOTIPO, DETALHES, DATAHORACADASTRO, IMPRESSO, CODIGOPEDIDOORIGEM)
    VALUES (${ped}, ${Number(it.produto_codigo)}, ${Number(it.codigo_pdv)}, '${fbEsc(it.nome)}', ${fbNum(it.qtd)}, ${fbNum(it.preco)}, ${vt}, 0, 0, ${vt}, 0, 1, '${fbEsc(it.obs || 'NENHUM')}', CURRENT_TIMESTAMP, 'N', ${VENDA_ORIGEM_FB})`);
  if (!r.ok) throw new Error('FB item "' + it.nome + '": ' + r.err);
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

// ---- API de VENDA ----
async function apiVendaBusca(termo) {
  const t = '%' + String(termo || '').trim() + '%';
  const rows = await sql`SELECT codigo_pdv, produto_codigo, nome, tamanho, preco, area_codigo FROM produto_local
    WHERE nome ILIKE ${t} ORDER BY comanda_mobile DESC, nome LIMIT 30`;
  return { produtos: rows };
}
async function apiVendaMesa(mesa) {
  const m = Number(mesa);
  const comandas = await sql`SELECT comanda FROM mesa_comanda WHERE mesa=${m} AND fechada_em IS NULL ORDER BY comanda`;
  const numeros = [m, ...comandas.map((x) => x.comanda)];
  const abertos = await sql`SELECT c.numero, count(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2) AS itens, c.valor_total
    FROM comanda c LEFT JOIN comanda_item ci ON ci.comanda_codigo=c.codigo
    WHERE c.numero = ANY(${numeros}) GROUP BY c.numero, c.codigo ORDER BY c.numero`;
  return { mesa: m, comandas: comandas.map((x) => x.comanda), abertos };
}
async function apiVendaVincular(body) {
  const mesa = Number(body.mesa), comanda = Number(body.comanda);
  if (!(mesa >= 1 && mesa < COMANDA_MIN)) return { ok: false, erro: 'mesa inválida (1–' + (COMANDA_MIN - 1) + ')' };
  if (!(comanda >= COMANDA_MIN && comanda <= COMANDA_MAX)) return { ok: false, erro: 'comanda é de ' + COMANDA_MIN + ' a ' + COMANDA_MAX };
  const jaEm = await sql`SELECT mesa FROM mesa_comanda WHERE comanda=${comanda} AND fechada_em IS NULL AND mesa<>${mesa}`;
  if (jaEm.length) return { ok: false, erro: 'comanda ' + comanda + ' já está na mesa ' + jaEm[0].mesa };
  await sql`INSERT INTO mesa_comanda (comanda, mesa) VALUES (${comanda}, ${mesa})
    ON CONFLICT (comanda) DO UPDATE SET mesa=EXCLUDED.mesa, aberta_em=now(), fechada_em=NULL`;
  return { ok: true, comanda, mesa };
}
async function apiVendaEnviar(body) {
  const numero = Number(body.numero);
  if (!(numero >= 1 && numero <= COMANDA_MAX)) return { ok: false, erro: 'número inválido' };
  const ehComanda = numero >= COMANDA_MIN;
  const mesa = ehComanda ? (await sql`SELECT mesa FROM mesa_comanda WHERE comanda=${numero} AND fechada_em IS NULL`)[0]?.mesa ?? null : numero;
  const pedidos = Array.isArray(body.itens) ? body.itens : [];
  if (!pedidos.length) return { ok: false, erro: 'sem itens' };
  // resolve cada item no catálogo local (preço/nome/área da NOSSA cópia — nunca confiar no client)
  const itens = [];
  for (const p of pedidos) {
    const cat = (await sql`SELECT codigo_pdv, produto_codigo, nome, tamanho, preco FROM produto_local WHERE codigo_pdv=${Number(p.codigo_pdv)}`)[0];
    if (!cat) return { ok: false, erro: 'produto ' + p.codigo_pdv + ' não está no catálogo' };
    const qtd = Math.max(1, Math.min(99, Number(p.qtd) || 1));
    itens.push({ ...cat, preco: Number(cat.preco), qtd, obs: String(p.obs || '').trim() });
  }
  const total = itens.reduce((s, i) => s + i.preco * i.qtd, 0);
  const [log] = await sql`INSERT INTO venda_envio (numero, mesa, comanda, itens, total, status)
    VALUES (${numero}, ${mesa}, ${ehComanda ? numero : null}, ${JSON.stringify(itens)}, ${total}, 'enviando') RETURNING id`;
  try {
    let ped = await fbAcharPedido(numero);
    if (!ped) ped = await fbCriarPedido(numero);
    for (const it of itens) await fbInserirItem(ped, it);
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

// ---- status efetivo = timestamp do Firebird OU a nossa marca local ----
// pronto  = COALESCE(ci.produzido, m.pronto_em)
// entregue= COALESCE(ci.entregue,  m.entregue_em)

// ---- API: seleção de áreas (produção) ----
async function apiAreas() {
  const rows = await sql`
    SELECT a.codigo, a.nome,
      COUNT(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2 AND COALESCE(ci.produzido, m.pronto_em) IS NULL) AS a_produzir,
      COUNT(ci.id) FILTER (WHERE ci.tipo IS DISTINCT FROM 2) AS total
    FROM area a
    LEFT JOIN comanda_item ci ON ci.area_codigo = a.codigo
    LEFT JOIN marca m ON m.item_codigo = ci.item_codigo
    GROUP BY a.codigo, a.nome
    ORDER BY a_produzir DESC, a.nome`;
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
  const agora = Date.now();
  for (const c of r.comandas) {
    c.espera_min = c.chegada ? Math.max(0, Math.floor((agora - new Date(c.chegada).getTime()) / 60000)) : null;
    c.atrasado = c.espera_min != null && c.espera_min >= LIMITE_ATRASO_MIN;
  }
  const areaNome = areaCod === 0 ? 'Sem área' : ((await sql`SELECT nome FROM area WHERE codigo=${areaCod}`)[0]?.nome || ('Área ' + areaCod));
  return { area: { codigo: areaCod, nome: areaNome }, limite_atraso_min: LIMITE_ATRASO_MIN, ...r, online: ultimoStatus.ok };
}

// ---- API: ENTREGA (global) — itens prontos, FIFO por hora do "pronto" ----
async function apiEntrega() {
  const itens = await sql`
    SELECT ci.*, COALESCE(ci.produzido, m.pronto_em) AS pronto_em,
           c.numero, c.origem, c.nome AS comanda_nome, c.qtd_pessoas, a.nome AS area_nome
    FROM comanda_item ci
    JOIN comanda c ON c.codigo = ci.comanda_codigo
    LEFT JOIN marca m ON m.item_codigo = ci.item_codigo
    LEFT JOIN area a ON a.codigo = ci.area_codigo
    WHERE COALESCE(ci.produzido, m.pronto_em) IS NOT NULL
      AND COALESCE(ci.entregue, m.entregue_em) IS NULL
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

function agrupar(itens, ordem) {
  const porC = new Map();
  for (const i of itens) {
    if (!porC.has(i.comanda_codigo)) porC.set(i.comanda_codigo, { codigo: i.comanda_codigo, numero: i.numero, origem: i.origem, nome: i.comanda_nome, qtd_pessoas: i.qtd_pessoas, chegada: null, pronta_desde: null, itens: [] });
    const c = porC.get(i.comanda_codigo);
    c.itens.push({ item_codigo: i.item_codigo, nome: i.nome, quantidade: i.quantidade, tipo: i.tipo, detalhes: i.detalhes, area_nome: i.area_nome, criado: i.criado, pronto_em: i.pronto_em, modificado: temMod(i.detalhes) });
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
  let codigos = [];
  if (body.item_codigo != null) {
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
    const s = (await sql`SELECT criado, comanda_codigo, area_codigo, nome FROM comanda_item WHERE item_codigo=${ic} LIMIT 1`)[0] || {};
    await sql`INSERT INTO marca (item_codigo, criado_em, comanda_codigo, area_codigo, nome, ${sql(col)})
              VALUES (${ic}, ${s.criado || null}, ${s.comanda_codigo || null}, ${s.area_codigo || null}, ${s.nome || null}, ${val})
              ON CONFLICT (item_codigo) DO UPDATE SET ${sql(col)}=${val},
                criado_em=COALESCE(marca.criado_em, EXCLUDED.criado_em),
                comanda_codigo=COALESCE(marca.comanda_codigo, EXCLUDED.comanda_codigo),
                area_codigo=COALESCE(marca.area_codigo, EXCLUDED.area_codigo),
                nome=COALESCE(marca.nome, EXCLUDED.nome)`;
  }
  return { ok: true, n: codigos.length };
}

// ---- HTML (uma SPA; rota / = produção, /entrega = entrega) ----
const HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prainha Bar — KDS</title><style>
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
function toggleSom(){SOM=!SOM;localStorage.setItem('kds_som',SOM?'on':'off');if(SOM)apitar();if(VIEW)VIEW()}
function somBtn(){return '<button class="back" onclick="toggleSom()" title="som de pedido novo">'+(SOM?'🔊':'🔇')+'</button>'}
document.addEventListener('pointerdown',function(){try{_ctx=_ctx||new (window.AudioContext||window.webkitAudioContext)();if(_ctx.state==='suspended')_ctx.resume();}catch(e){}},{once:true});
function checaNovos(d){var atuais=new Set();(d.comandas||[]).forEach(function(c){(c.itens||[]).forEach(function(i){if(i.item_codigo!=null)atuais.add(i.item_codigo)})});
  var novo=false;if(_vistos!==null){atuais.forEach(function(k){if(!_vistos.has(k))novo=true})}
  _vistos=atuais;if(novo)apitar()}
function irSelecao(){AREA=null;_vistos=null;history.replaceState(0,'','/');setView(selecao)}
function irArea(cod){AREA={cod:cod};_vistos=null;history.replaceState(0,'','/?area='+cod);setView(kds)}
async function marca(campo,body){
  body.campo=campo;body.on=true;
  try{await fetch('/api/marca',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})}catch(e){}
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
    return '<div class="it"><span class="q">'+(Number(i.quantidade)||1)+'x</span>'+
      '<span class="n">'+esc(i.nome)+tag+pt+(i.modificado?'<div class="mod">'+esc(i.detalhes)+'</div>':'')+'</span>'+btn+'</div>';
  }).join('');
  var badge=c.tipo==='delivery'?'<span class="badge">delivery</span>':'';
  if(modo!=='entrega'&&c.atrasado) badge+='<span class="badge late">atrasado</span>';
  var tchip=modo==='entrega'
    ? (c.aguarda_min!=null?'<span class="tchip">⏱ '+fmtMin(c.aguarda_min)+'</span>':'')
    : (c.espera_min!=null?'<span class="tchip">⏱ '+fmtMin(c.espera_min)+'</span>':'');
  var nome=c.nome?'<div style="font-size:12px;color:var(--mut);padding:0 14px 6px">'+esc(c.nome)+'</div>':'';
  var foot;
  if(modo==='entrega') foot='<div class="cfoot"><button class="b e" onclick="marca(\\'entregue\\',{comanda_codigo:'+c.codigo+'})">✓ Entregar tudo</button></div>';
  else foot='<div class="cfoot"><button class="b p" onclick="marca(\\'pronto\\',{comanda_codigo:'+c.codigo+',area_codigo:'+AREA.cod+'})">✓ Tudo pronto</button></div>';
  return '<div class="c '+c.tipo+(modo!=='entrega'&&c.atrasado?' atrasado':'')+'">'+
    '<div class="chd"><div class="rot"><span class="pos">'+(idx+1)+'º</span>'+esc(c.rotulo)+badge+'</div>'+tchip+'</div>'+
    nome+'<div class="its">'+its+'</div>'+foot+'</div>';
}
async function selecao(){
  var d=await (await fetch('/api/areas',{cache:'no-store'})).json();
  document.getElementById('hd').innerHTML='<h1>Prainha <b>Bar</b> · Produção</h1><span class="grow"></span>'+
    '<a class="linkbtn go" href="/entrega">Entregas <span class="n">'+d.entrega_n+'</span> ▸</a>'+
    '<span class="pill"><span class="dot '+(d.online?'on':'off')+'"></span>'+(d.online?'ao vivo':'offline')+'</span>';
  var app=document.getElementById('app');
  if(!d.areas.length){app.innerHTML='<div class="vazio">nenhum item aberto</div>';return}
  app.innerHTML='<div class="sel"><h2>Escolha a sua área de produção</h2><div class="areas">'+d.areas.map(function(a){
    return '<button class="abtn" onclick="irArea('+a.codigo+')"><div class="an">'+esc(a.nome)+'</div>'+
      '<div class="ap"><b>'+a.a_produzir+'</b> a produzir · '+a.total+' no total</div></button>';
  }).join('')+'</div></div>';
}
async function kds(){
  var d=await (await fetch('/api/kds?area='+AREA.cod,{cache:'no-store'})).json();
  checaNovos(d); // pedido novo na área -> apita
  document.getElementById('hd').innerHTML='<button class="back" onclick="irSelecao()">◂ Áreas</button>'+
    '<h1>'+esc(d.area.nome)+' · <b>Produção</b></h1>'+
    '<span class="pill"><b>'+d.nItens+'</b> a produzir</span><span class="grow"></span>'+somBtn()+
    '<a class="linkbtn go" href="/entrega">Entregas ▸</a>'+
    '<span class="pill"><span class="dot '+(d.online?'on':'off')+'"></span>'+(d.online?'ao vivo':'offline')+'</span>';
  var app=document.getElementById('app');
  if(!d.comandas.length){app.innerHTML='<div class="vazio">tudo produzido nesta área ✅</div>';return}
  app.innerHTML='<div class="grid">'+d.comandas.map(function(c,ix){return comandaHTML(c,'producao',ix)}).join('')+'</div>';
}
async function entrega(){
  var d=await (await fetch('/api/entrega',{cache:'no-store'})).json();
  checaNovos(d); // prato novo pronto -> apita no tablet da entrega também
  document.getElementById('hd').innerHTML='<a class="back" href="/">◂ Produção</a>'+
    '<h1>🛎️ <b>Entregas</b></h1>'+
    '<span class="pill"><b>'+d.nComandas+'</b> comandas</span><span class="pill"><b>'+d.nItens+'</b> prontos</span><span class="grow"></span>'+somBtn()+
    '<span class="pill"><span class="dot '+(d.online?'on':'off')+'"></span>'+(d.online?'ao vivo':'offline')+'</span>';
  var app=document.getElementById('app');
  if(!d.comandas.length){app.innerHTML='<div class="vazio">nada aguardando entrega ✅</div>';return}
  app.innerHTML='<div class="grid">'+d.comandas.map(function(c,ix){return comandaHTML(c,'entrega',ix)}).join('')+'</div>';
}
if(ENTREGA){setView(entrega)}
else{var _p=new URLSearchParams(location.search);var a=_p.get('area');
  if(a!==null&&a!==''){AREA={cod:Number(a)};setView(kds)}else{irSelecao()}}
</script></body></html>`;

// ---- /venda — tela do garçom (mobile) ----
const VENDA_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Prainha Bar — Venda</title><style>
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
<header><h1>Prainha <b>Bar</b> · Venda</h1><span style="flex:1"></span><a class="back" href="/">KDS</a></header>
<div class="wrap" id="app"></div>
<div class="cart" id="cart" style="display:none"><div class="in" id="cartin"></div></div>
<script>
var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')};
var brl=function(n){return 'R$ '+Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2})};
var MESA=null, INFO=null, ALVO=null, CART=[], BUSCA='', debounce=null;
function app(h){document.getElementById('app').innerHTML=h}
async function jget(u){return (await fetch(u,{cache:'no-store'})).json()}
async function jpost(u,b){return (await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)})).json()}

function telaMesa(){
  MESA=null;ALVO=null;CART=[];renderCart();
  app('<div class="tit">Número da mesa</div>'+
    '<input type="number" id="nmesa" inputmode="numeric" placeholder="ex.: 5" autofocus>'+
    '<button class="big" onclick="abrirMesa()">Abrir mesa</button>'+
    '<div class="mut" style="margin-top:14px">Padrão: lança na <b>mesa</b>. Dentro dela dá pra adicionar <b>comandas (300–400)</b> — a comanda é a pessoa, a mesa é o lugar.</div>');
  var el=document.getElementById('nmesa');el.focus();
  el.addEventListener('keydown',function(e){if(e.key==='Enter')abrirMesa()});
}
async function abrirMesa(){
  var n=Number(document.getElementById('nmesa').value);
  if(!(n>=1&&n<300)){alert('Mesa de 1 a 299');return}
  MESA=n;ALVO=n;await carregarMesa();
}
async function carregarMesa(){
  INFO=await jget('/api/venda/mesa?n='+MESA);
  var chips='<button class="chip'+(ALVO===MESA?' on':'')+'" onclick="setAlvo('+MESA+')">Mesa '+MESA+
    infoDe(MESA)+'</button>';
  INFO.comandas.forEach(function(c){chips+='<button class="chip'+(ALVO===c?' on':'')+'" onclick="setAlvo('+c+')">Comanda '+c+infoDe(c)+'</button>'});
  chips+='<button class="chip add" onclick="addComanda()">+ comanda</button>';
  app('<button class="back" onclick="telaMesa()">◂ trocar mesa</button>'+
    '<div class="tit" style="margin-top:12px">Lançar em</div><div class="chips">'+chips+'</div>'+
    '<div class="tit">Produto</div>'+
    '<input type="search" id="busca" placeholder="buscar produto… (ex.: file, caipirinha)" value="'+esc(BUSCA)+'" oninput="buscar(this.value)">'+
    '<div class="res" id="res" style="display:none"></div>'+
    '<div id="msg"></div>');
  var el=document.getElementById('busca');
  if(BUSCA)buscar(BUSCA);
  el.addEventListener('keydown',function(e){if(e.key==='Escape'){this.value='';buscar('')}});
}
function infoDe(n){
  var a=(INFO.abertos||[]).find(function(x){return Number(x.numero)===n});
  return a?'<small>'+a.itens+' itens · '+brl(a.valor_total)+'</small>':'<small>vazia</small>';
}
function setAlvo(n){ALVO=n;carregarMesa()}
async function addComanda(){
  var c=prompt('Número da comanda (300–400):');if(!c)return;
  var r=await jpost('/api/venda/vincular',{mesa:MESA,comanda:Number(c)});
  if(!r.ok){alert(r.erro);return}
  ALVO=Number(c);await carregarMesa();
}
function buscar(v){
  BUSCA=v;clearTimeout(debounce);
  if(!v||v.length<2){document.getElementById('res').style.display='none';return}
  debounce=setTimeout(async function(){
    var d=await jget('/api/venda/busca?q='+encodeURIComponent(v));
    var el=document.getElementById('res');el.style.display='block';
    el.innerHTML=d.produtos.length?d.produtos.map(function(p){
      var nm=esc(p.nome)+(p.tamanho?' <small>['+esc(p.tamanho)+']</small>':'');
      return '<div class="ri" onclick=\\'addItem('+JSON.stringify(p).replace(/'/g,'&#39;')+')\\'><span class="n">'+nm+'</span><span class="p">'+brl(p.preco)+'</span></div>';
    }).join(''):'<div class="ri"><span class="n mut">nada encontrado</span></div>';
  },250);
}
function addItem(p){
  var j=CART.find(function(x){return x.codigo_pdv===p.codigo_pdv&&!x.obs});
  if(j)j.qtd++;else CART.push({codigo_pdv:p.codigo_pdv,nome:p.nome,tamanho:p.tamanho,preco:Number(p.preco),qtd:1,obs:''});
  renderCart();
}
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
  var alvoTxt=ALVO>=300?('Comanda '+ALVO+' · Mesa '+MESA):('Mesa '+MESA);
  document.getElementById('cartin').innerHTML=rows+
    '<div class="tot"><span>'+alvoTxt+'</span><span>'+brl(tot)+'</span></div>'+
    '<button class="big verde" onclick="enviar()">ENVIAR PRA COZINHA ('+CART.reduce(function(s,i){return s+i.qtd},0)+')</button>';
}
function qtd(ix,d){CART[ix].qtd+=d;if(CART[ix].qtd<1)CART.splice(ix,1);renderCart()}
function rm(ix){CART.splice(ix,1);renderCart()}
function editObs(ix){var o=prompt('Observação do prato (ex.: ao ponto, sem cebola):',CART[ix].obs||'');if(o!==null){CART[ix].obs=o.trim();renderCart()}}
async function enviar(){
  if(!CART.length)return;
  var btn=document.querySelector('.big.verde');btn.disabled=true;btn.textContent='Enviando…';
  var r=await jpost('/api/venda/enviar',{numero:ALVO,itens:CART.map(function(i){return {codigo_pdv:i.codigo_pdv,qtd:i.qtd,obs:i.obs}})});
  if(r.ok){
    CART=[];renderCart();
    document.getElementById('msg').innerHTML='<div class="ok"><div class="t">✓ Enviado pra cozinha</div>'+
      '<div class="mut" style="margin-top:6px">'+(r.numero>=300?'Comanda '+r.numero+(r.mesa?' · Mesa '+r.mesa:''):'Mesa '+r.numero)+' · '+r.n_itens+' item(ns) · '+brl(r.total)+' · pedido #'+r.pedido_fb+'</div></div>';
    carregarMesaSoon();
  } else {
    document.getElementById('msg').innerHTML='<div class="err">'+esc(r.erro||'erro')+'</div>';
    btn.disabled=false;btn.textContent='ENVIAR PRA COZINHA';
  }
}
var _t=null;function carregarMesaSoon(){clearTimeout(_t);_t=setTimeout(function(){if(MESA)carregarMesa()},4000)}
telaMesa();
</script></body></html>`;

function readBody(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); }); }

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'POST' && p === '/api/marca') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await marcar(body))); }
    if (req.method === 'POST' && p === '/api/venda/vincular') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaVincular(body))); }
    if (req.method === 'POST' && p === '/api/venda/enviar') { const body = await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaEnviar(body))); }
    if (p === '/' || p === '/entrega') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(HTML); }
    if (p === '/venda') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(VENDA_HTML); }
    if (p === '/api/areas') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiAreas())); }
    if (p === '/api/kds') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiKds(Number(u.searchParams.get('area') || 0)))); }
    if (p === '/api/entrega') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiEntrega())); }
    if (p === '/api/venda/busca') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaBusca(u.searchParams.get('q') || ''))); }
    if (p === '/api/venda/mesa') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await apiVendaMesa(u.searchParams.get('n') || 0))); }
    res.writeHead(404); res.end('not found');
  } catch (e) { res.writeHead(500); res.end('erro: ' + e.message); }
});
async function main() {
  await initSchema(); console.log('[schema] ok');
  server.listen(PORT, () => console.log(`KDS em http://localhost:${PORT}  (/=produção, /entrega=entrega, /venda=garçom)`));
  loopEspelho();
  espelhoCatalogo().catch(() => {});
  setInterval(() => espelhoCatalogo().catch(() => {}), 5 * 60 * 1000);
}
main().catch((e) => { console.error('fatal:', e); process.exit(1); });

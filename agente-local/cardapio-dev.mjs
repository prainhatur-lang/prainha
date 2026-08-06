// Cardápio dev (F1 leitura + F2 pedido) — roda no Mac, lê/escreve o Firebird de
// PRODUÇÃO do Prainha Bar (10.0.0.252). `node cardapio-dev.mjs` -> http://localhost:8788
// UI Golden Hour + produtos por tamanho/sabor (seletor). Escreve PEDIDOS+ITENSPEDIDO+PEDIDOIMPRESSAO. Soft-delete only.
import http from 'node:http';
import Firebird from 'node-firebird';

const FB = { host: '10.0.0.252', port: 3050, database: 'C:\\Users\\Administrator\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\consumer.fdb', user: 'SYSDBA', password: 'masterkey', lowercase_keys: false, pageSize: 4096 };

let pending = null;
process.on('uncaughtException', () => { if (pending) { const r = pending; pending = null; r({ ok: false, err: 'uncaught' }); } });
process.on('unhandledRejection', () => { if (pending) { const r = pending; pending = null; r({ ok: false, err: 'unhandled' }); } });
let chain = Promise.resolve();
function q1(sql) { return new Promise((res) => { pending = res; const fin = (r) => { if (pending) { pending = null; res(r); } }; setTimeout(() => fin({ ok: false, err: 'timeout' }), 18000); try { Firebird.attach(FB, (err, db) => { if (err) return fin({ ok: false, err: String(err.message).slice(0, 100) }); db.query(sql, [], (e, rows) => { try { db.detach(() => {}); } catch {} if (e) return fin({ ok: false, err: String(e.message).slice(0, 160) }); fin({ ok: true, rows }); }); }); } catch (e) { fin({ ok: false, err: String(e.message).slice(0, 100) }); } }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function q(sql, tries = 4) { const run = async () => { for (let i = 0; i < tries; i++) { const r = await q1(sql); if (r.ok) return r; await sleep(400); } return { ok: false, err: 'retry' }; }; const p = chain.then(run); chain = p.catch(() => {}); return p; }
const ret = (r) => (Array.isArray(r.rows) ? r.rows[0] : r.rows);

let menuCache = null, menuAt = 0, prodMap = new Map();
const ETIQ_EXCL = "('Complemento','Condimentos','Embalagens','Limpeza','Souvenir','Verduras','Frios','Leite e derivados','Massas','Guloseimas','Geladinho','Passeio de lancha')";
async function getMenu() {
  if (menuCache && Date.now() - menuAt < 60000) return menuCache;
  const r = await q(`SELECT pd.CODIGO COD, pd.CODIGOPRODUTO PROD, TRIM(p.NOME) PNOME, pd.PRECOVENDA PRECO, TRIM(e.DESCRICAO) ETIQ, COALESCE(e.ORDEM,999) EORD, TRIM(t.DESCRICAO) TAM FROM PRODUTODETALHE pd JOIN PRODUTOS p ON p.CODIGO=pd.CODIGOPRODUTO LEFT JOIN ETIQUETAS e ON e.CODIGO=p.CODIGOETIQUETA AND e.DATADELETE IS NULL LEFT JOIN PRODUTOTAMANHO t ON t.CODIGO=pd.CODIGOPRODUTOTAMANHO WHERE pd.CARDAPIODIGITAL=1 AND pd.DATADELETE IS NULL AND pd.PRECOVENDA>0 AND (p.DESCONTINUADO IS NULL OR p.DESCONTINUADO<>'S') AND (e.DESCRICAO IS NULL OR (e.DESCRICAO NOT LIKE '%Exclu%' AND e.DESCRICAO NOT IN ${ETIQ_EXCL})) ORDER BY COALESCE(e.ORDEM,999), e.DESCRICAO, p.NOME, pd.PRECOVENDA`);
  if (!r.ok) return { erro: r.err };
  const byProd = new Map();
  for (const it of r.rows) { let g = byProd.get(it.PROD); if (!g) { g = { pnome: it.PNOME, cat: it.ETIQ || 'Outros', vs: [] }; byProd.set(it.PROD, g); } g.vs.push({ cod: it.COD, tam: it.TAM || null, preco: Number(it.PRECO) }); }
  const grupos = {}; prodMap = new Map();
  for (const g of byProd.values()) {
    const cat = g.cat;
    let entry;
    if (g.vs.length === 1) { const v = g.vs[0]; const nome = g.pnome + (v.tam ? ' ' + v.tam : ''); entry = { nome, cod: v.cod, preco: v.preco }; prodMap.set(v.cod, { nome, preco: v.preco }); }
    else { const opcoes = g.vs.map((v) => ({ cod: v.cod, label: v.tam || ('R$ ' + v.preco), preco: v.preco })); entry = { nome: g.pnome, precoMin: Math.min(...g.vs.map((v) => v.preco)), opcoes }; for (const v of g.vs) prodMap.set(v.cod, { nome: g.pnome + (v.tam ? ' ' + v.tam : ''), preco: v.preco }); }
    (grupos[cat] = grupos[cat] || []).push(entry);
  }
  menuCache = { grupos, total: byProd.size }; menuAt = Date.now(); return menuCache;
}

async function getComanda(numero) {
  const h = await q(`SELECT FIRST 1 CODIGO, NUMERO, TRIM(NOME) NOME, VALORTOTAL, SUBTOTALPAGO, TOTALSERVICO, QUANTIDADEPESSOAS FROM PEDIDOS WHERE NUMERO=${Number(numero)} AND DATAFECHAMENTO IS NULL AND DATADELETE IS NULL ORDER BY DATAABERTURA DESC`);
  if (!h.ok) return { erro: h.err }; if (!h.rows.length) return { vazia: true };
  const p = h.rows[0];
  const it = await q(`SELECT TRIM(NOMEPRODUTO) NOME, QUANTIDADE QTD, VALORTOTAL VT, CODIGOITEMPEDIDOTIPO TIPO, CODIGOPAI PAI FROM ITENSPEDIDO WHERE CODIGOPEDIDO=${Number(p.CODIGO)} AND DATADELETE IS NULL ORDER BY CODIGO`);
  return { numero: p.NUMERO, nome: p.NOME || null, codigo: p.CODIGO, pessoas: p.QUANTIDADEPESSOAS, total: Number(p.VALORTOTAL), pago: Number(p.SUBTOTALPAGO || 0), servico: Number(p.TOTALSERVICO || 0), itens: it.ok ? it.rows.map((x) => ({ nome: x.NOME, qtd: Number(x.QTD), vt: Number(x.VT), tipo: x.TIPO, pai: x.PAI })) : [] };
}

async function enviarPedido(numero, itens) {
  numero = Number(numero); if (!Number.isInteger(numero) || numero < 0) return { erro: 'número de comanda inválido' };
  if (!menuCache) await getMenu();
  const linhas = [];
  for (const it of (itens || [])) { const p = prodMap.get(Number(it.cod)); const qtd = Math.max(1, Math.min(99, Number(it.qtd) || 1)); if (!p) return { erro: 'item não encontrado: ' + it.cod }; linhas.push({ cod: p.cod, nome: p.nome, preco: p.preco, qtd }); }
  // prodMap entry stored under cod uses {nome,preco}; ensure cod present
  for (let k = 0; k < linhas.length; k++) { const m = prodMap.get(Number((itens[k] || {}).cod)); if (m) { linhas[k].cod = Number(itens[k].cod); linhas[k].nome = m.nome; linhas[k].preco = m.preco; } }
  if (!linhas.length) return { erro: 'carrinho vazio' };
  const soma = linhas.reduce((s, l) => s + l.preco * l.qtd, 0);
  let r = await q(`SELECT FIRST 1 CODIGO, VALORTOTAL FROM PEDIDOS WHERE NUMERO=${numero} AND DATAFECHAMENTO IS NULL AND DATADELETE IS NULL ORDER BY DATAABERTURA DESC`);
  if (!r.ok) return { erro: 'falha lendo comanda: ' + r.err };
  let pedId, totalAntes = 0, criada = false;
  if (r.rows.length) { pedId = r.rows[0].CODIGO; totalAntes = Number(r.rows[0].VALORTOTAL || 0); }
  else { const ins = await q(`INSERT INTO PEDIDOS (NUMERO,DATAABERTURA,CODIGOPEDIDOORIGEM,QUANTIDADEPESSOAS,NOME,VALORTOTAL,VALORTOTALITENS,VALORENTREGA,ICMSDESONDIMINUIVALORNF,TAG,CONTASOLICITADA,IMPRESSAOSOLICITADA) VALUES (${numero},CURRENT_TIMESTAMP,3,1,'',0,0,0,0,'CD','N','N') RETURNING CODIGO`); if (!ins.ok) return { erro: 'falha criando comanda: ' + ins.err }; pedId = ret(ins).CODIGO; criada = true; }
  for (const l of linhas) { const vt = (l.preco * l.qtd); const nome = String(l.nome).replace(/'/g, "''").slice(0, 60); const ii = await q(`INSERT INTO ITENSPEDIDO (CODIGOPEDIDO,CODIGOPRODUTODETALHE,NOMEPRODUTO,QUANTIDADE,VALORUNITARIO,VALORITEM,VALORTOTAL,CODIGOITEMPEDIDOTIPO,IMPRESSO,JUNCAOMESA,IMPRESSOFICHACONSUMO,PRECOCUSTO,DETALHES,CODIGOPEDIDOORIGEM) VALUES (${pedId},${l.cod},'${nome}',${l.qtd},${l.preco},${vt},${vt},1,'N','N','N',0,'',3)`); if (!ii.ok) return { erro: 'falha gravando ' + l.nome + ': ' + ii.err, pedId }; }
  await q(`UPDATE PEDIDOS SET VALORTOTAL=${(totalAntes + soma)}, VALORTOTALITENS=${(totalAntes + soma)} WHERE CODIGO=${pedId}`);
  const job = await q(`INSERT INTO PEDIDOIMPRESSAO (INSERIDOEM,CODIGOPEDIDO,CODIGOTIPOIMPRESSAO,CODIGOORIGEMIMPRESSAO,CODIGOSITUACAOIMPRESSAO,AUTORIZADOEM) VALUES (CURRENT_TIMESTAMP,${pedId},1,0,2,CURRENT_TIMESTAMP)`);
  return { ok: true, pedId, criada, itens: linhas.length, novoTotal: totalAntes + soma, jobCozinha: job.ok };
}

function readBody(req) { return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch { res({}); } }); }); }

const HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<title>Prainha Bar</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
:root{--night2:#0d0916;--cream:#fcefe0;--mut:#caa888;--gold:#ffc572;--gold2:#ff8a3c;--coral:#ff6a4d;--glass:rgba(38,24,38,.55);--line:rgba(255,180,120,.14)}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html,body{margin:0}
body{font-family:'Outfit',-apple-system,system-ui,sans-serif;background:var(--night2);color:var(--cream);min-height:100vh;padding-bottom:96px;overflow-x:hidden}
.hero{position:relative;overflow:hidden;padding:30px 22px 30px;border-radius:0 0 34px 34px;background:linear-gradient(168deg,#241a4d 0%,#5e2a63 22%,#a83552 40%,#d9482e 56%,#ee6f2a 70%,#f8a63c 84%,#ffce82 100%)}
.sun{position:absolute;left:50%;bottom:-46px;width:230px;height:230px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(circle at 50% 45%,#fff6da 0%,#ffd98a 32%,#ffb15f 50%,rgba(255,150,80,0) 70%);opacity:.92}
.waves{position:absolute;left:0;right:0;bottom:0;height:70px;background:linear-gradient(180deg,rgba(20,10,30,0),rgba(20,9,22,.55))}
.brand{position:relative;z-index:2;font-family:'Fraunces',serif;font-weight:600;font-size:46px;line-height:.92;letter-spacing:-.5px;color:#fff7ec;text-shadow:0 2px 30px rgba(255,150,80,.45)}
.brand small{display:block;font-family:'Outfit';font-weight:300;font-size:13px;letter-spacing:.32em;text-transform:uppercase;color:rgba(255,240,225,.85);margin-top:8px;text-shadow:none}
.wrap{max-width:600px;margin:0 auto;padding:0 16px}
.comanda{margin:-22px auto 6px;max-width:600px;padding:0 16px;position:relative;z-index:3}
.comanda .box{display:flex;gap:8px;background:var(--glass);border:1px solid var(--line);backdrop-filter:blur(14px);border-radius:18px;padding:8px;box-shadow:0 18px 40px -20px rgba(0,0,0,.7)}
input{flex:1;height:48px;border:0;background:transparent;color:var(--cream);font-size:16px;font-family:inherit;padding:0 12px;outline:none}input::placeholder{color:var(--mut)}
.chip{height:48px;padding:0 18px;border:0;border-radius:13px;background:rgba(255,197,114,.14);color:var(--gold);font-weight:600;font-size:14px;font-family:inherit}
.contaCard{background:linear-gradient(180deg,rgba(48,30,46,.6),rgba(28,18,30,.55));border:1px solid var(--line);border-radius:20px;padding:16px;margin:12px 0 4px;backdrop-filter:blur(10px)}
.contaCard .lbl{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);margin-bottom:10px}
.crow{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,180,120,.08);font-size:15px}
.crow.sub{padding-left:14px;color:var(--mut);font-size:13px;border:0}.crow .v{font-variant-numeric:tabular-nums;color:var(--gold)}
.ctot{display:flex;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px solid var(--line);font-family:'Fraunces';font-size:19px}.ctot .v{color:var(--gold)}
.cat{font-family:'Fraunces';font-style:italic;font-weight:500;font-size:24px;color:#ffd9a0;margin:30px 4px 12px;display:flex;align-items:center;gap:12px}
.cat::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--line),transparent)}
.item{display:flex;align-items:center;gap:14px;padding:13px 0;border-bottom:1px solid rgba(255,180,120,.07)}
.item.opt{cursor:pointer}.item .nm{flex:1;min-width:0;font-size:16px;line-height:1.25}.item .pr{font-family:'Fraunces';font-size:14px;color:var(--gold);white-space:nowrap;font-variant-numeric:tabular-nums;margin-top:2px}
.plus{flex:0 0 40px;width:40px;height:40px;border:0;border-radius:13px;background:linear-gradient(145deg,rgba(255,197,114,.16),rgba(255,138,60,.12));border:1px solid var(--line);color:var(--gold);font-size:23px;font-weight:500;display:grid;place-items:center;transition:transform .12s}.plus:active{transform:scale(.86)}
.qbadge{flex:0 0 auto;display:flex;align-items:center;gap:10px}.qbadge button{width:34px;height:34px;border-radius:11px;border:1px solid var(--line);background:rgba(255,197,114,.1);color:var(--gold);font-size:20px;display:grid;place-items:center}.qbadge span{min-width:18px;text-align:center;font-family:'Fraunces';font-size:16px}
.cartbar{position:fixed;left:0;right:0;bottom:0;z-index:20;padding:14px 16px calc(14px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(13,9,22,0),rgba(13,9,22,.92) 22%);transform:translateY(130%);transition:transform .32s cubic-bezier(.3,1,.4,1)}.cartbar.show{transform:none}.cartbar .inner{max-width:600px;margin:0 auto}
.cartbar button{width:100%;height:58px;border:0;border-radius:18px;background:linear-gradient(135deg,var(--gold),var(--gold2) 55%,var(--coral));color:#2a1205;font-family:'Outfit';font-weight:600;font-size:16px;display:flex;align-items:center;justify-content:space-between;padding:0 22px;box-shadow:0 14px 34px -10px rgba(255,138,60,.55)}
.cartbar .badge{background:rgba(42,18,5,.22);border-radius:9px;padding:3px 9px;font-size:14px}
.sheet{position:fixed;inset:0;z-index:30;background:rgba(8,5,12,.6);backdrop-filter:blur(3px);display:none;align-items:flex-end}.sheet.show{display:flex}
.panel{width:100%;max-width:600px;margin:0 auto;background:#1a1226;border:1px solid var(--line);border-radius:24px 24px 0 0;max-height:76vh;overflow:auto;padding:18px 18px calc(20px + env(safe-area-inset-bottom))}
.panel h3{font-family:'Fraunces';font-weight:500;font-size:23px;margin:2px 0 4px;color:#ffd9a0}.panel .hint{color:var(--mut);font-size:13px;margin-bottom:12px}
.popt{display:flex;align-items:center;gap:14px;padding:13px 0;border-bottom:1px solid rgba(255,180,120,.08)}.popt .nm{flex:1;font-size:16px}.popt .pr{font-family:'Fraunces';color:var(--gold);font-size:15px}
.toast{position:fixed;left:16px;right:16px;bottom:88px;z-index:40;max-width:568px;margin:0 auto;background:linear-gradient(180deg,#2a3a26,#1c2a1a);border:1px solid rgba(140,210,150,.3);color:#dff3df;border-radius:16px;padding:13px 16px;font-size:15px;box-shadow:0 16px 40px -14px rgba(0,0,0,.7);transform:translateY(180%);transition:transform .3s}.toast.show{transform:none}.toast.err{background:linear-gradient(180deg,#3a2626,#2a1a1a);border-color:rgba(220,140,140,.3);color:#f3dada}
.mut{color:var(--mut)}.loading{padding:40px 0;text-align:center;color:var(--mut)}
</style></head><body>
<header class="hero"><div class="sun"></div><div class="waves"></div><div class="brand">Prainha<small>cardápio · pôr do sol</small></div></header>
<div class="comanda"><div class="box"><input id="num" inputmode="numeric" placeholder="nº da sua comanda"><button class="chip" onclick="verConta()">ver conta</button></div></div>
<div class="wrap"><div id="contaOut"></div><div id="menu"><div class="loading">preparando o cardápio…</div></div></div>
<div class="cartbar" id="cartbar"><div class="inner"><button onclick="enviar()" id="btnEnv"><span style="display:flex;align-items:center;gap:10px"><span class="badge" id="cartN">0</span> enviar pra cozinha</span><span id="cartT">R$ 0,00</span></button></div></div>
<div class="sheet" id="sheet" onclick="if(event.target===this)closeSheet()"><div class="panel" id="panel"></div></div>
<div class="toast" id="toast"></div>
<script>
var brl=function(n){return 'R$ '+Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})};
var cart={};window.MN={};window.OPC={};var _pid=0;
function toast(m,e){var t=document.getElementById('toast');t.textContent=m;t.className='toast show'+(e?' err':'');setTimeout(function(){t.className='toast'+(e?' err':'')},2800)}
function chg(cod,d){var mn=window.MN[cod];if(!mn)return;var c=cart[cod]||(cart[cod]={nome:mn.nome,preco:mn.preco,qtd:0});c.qtd+=d;if(c.qtd<=0)delete cart[cod];render();paint(cod)}
function paint(cod){var el=document.getElementById('it'+cod);if(!el)return;var c=cart[cod];
 if(c)el.outerHTML='<div class="qbadge" id="it'+cod+'"><button onclick="chg('+cod+',-1)">−</button><span>'+c.qtd+'</span><button onclick="chg('+cod+',1)">+</button></div>';
 else el.outerHTML='<button class="plus" id="it'+cod+'" onclick="chg('+cod+',1)">+</button>'}
function render(){var it=Object.values(cart);var n=it.reduce(function(s,x){return s+x.qtd},0);var t=it.reduce(function(s,x){return s+x.qtd*x.preco},0);
 document.getElementById('cartbar').classList.toggle('show',n>0);document.getElementById('cartN').textContent=n;document.getElementById('cartT').textContent=brl(t)}
function openPicker(id){var o=window.OPC[id];var h='<h3>'+o.nome+'</h3><div class="hint">escolha o sabor / tamanho</div>';
 o.opcoes.forEach(function(v){h+='<div class="popt"><span class="nm">'+v.label+'</span><span class="pr">'+brl(v.preco)+'</span><button class="plus" onclick="pick('+v.cod+')">+</button></div>'});
 document.getElementById('panel').innerHTML=h;document.getElementById('sheet').classList.add('show')}
function pick(cod){chg(cod,1);closeSheet();var mn=window.MN[cod];toast('✦ '+(mn?mn.nome:'item')+' adicionado')}
function closeSheet(){document.getElementById('sheet').classList.remove('show')}
function verConta(){var nv=document.getElementById('num').value.trim();var o=document.getElementById('contaOut');if(!nv){o.innerHTML='';return}o.innerHTML='<div class="contaCard mut">buscando…</div>';
 fetch('/api/comanda?numero='+encodeURIComponent(nv)).then(function(r){return r.json()}).then(function(d){
  if(d.vazia){o.innerHTML='<div class="contaCard"><div class="lbl">comanda '+nv+'</div><div class="mut">ainda sem consumo</div></div>';return}
  if(d.erro){o.innerHTML='<div class="contaCard mut">erro: '+d.erro+'</div>';return}
  var h='<div class="contaCard"><div class="lbl">comanda '+d.numero+' · '+d.pessoas+' pessoa(s)</div>';
  d.itens.forEach(function(i){h+='<div class="crow'+(i.tipo===2?' sub':'')+'"><span>'+(i.tipo===2?'+ ':'')+(i.qtd>1?i.qtd+'× ':'')+i.nome+'</span><span class="v">'+(i.vt?brl(i.vt):'')+'</span></div>'});
  if(d.servico)h+='<div class="crow"><span class="mut">serviço</span><span class="v">'+brl(d.servico)+'</span></div>';
  h+='<div class="ctot"><span>total</span><span class="v">'+brl(d.total)+'</span></div></div>';o.innerHTML=h})}
function enviar(){var num=document.getElementById('num').value.trim();if(!num){toast('digite o número da sua comanda no topo',1);document.getElementById('num').focus();return}
 var itens=Object.keys(cart).map(function(cod){return{cod:Number(cod),qtd:cart[cod].qtd}});if(!itens.length)return;
 var b=document.getElementById('btnEnv');b.style.opacity=.6;
 fetch('/api/pedir',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({numero:Number(num),itens:itens})}).then(function(r){return r.json()}).then(function(d){b.style.opacity=1;
  if(d.ok){cart={};render();document.querySelectorAll('.qbadge').forEach(function(e){var c=e.id.slice(2);e.outerHTML='<button class="plus" id="it'+c+'" onclick="chg('+c+',1)">+</button>'});toast('✦ pedido enviado pra comanda '+num+' — já foi pra cozinha');verConta()}
  else toast('não rolou: '+(d.erro||'erro'),1)})}
document.getElementById('num').addEventListener('keydown',function(e){if(e.key==='Enter')verConta()});
fetch('/api/menu').then(function(r){return r.json()}).then(function(d){var m=document.getElementById('menu');if(d.erro){m.innerHTML='<div class="loading">erro: '+d.erro+'</div>';return}
 var h='';Object.keys(d.grupos).forEach(function(cat){h+='<div class="cat">'+cat+'</div>';d.grupos[cat].forEach(function(i){
  if(i.opcoes){var id='p'+(_pid++);window.OPC[id]={nome:i.nome,opcoes:i.opcoes};i.opcoes.forEach(function(o){window.MN[o.cod]={nome:i.nome+' '+o.label,preco:o.preco}});
   h+='<div class="item opt" onclick="openPicker(&quot;'+id+'&quot;)"><div class="nm">'+i.nome+'<div class="pr">a partir de '+brl(i.precoMin)+' · '+i.opcoes.length+' opções</div></div><div class="plus">›</div></div>'}
  else{window.MN[i.cod]={nome:i.nome,preco:i.preco};
   h+='<div class="item"><div class="nm">'+i.nome+'<div class="pr">'+brl(i.preco)+'</div></div><button class="plus" id="it'+i.cod+'" onclick="chg('+i.cod+',1)">+</button></div>'}
 })});m.innerHTML=h})
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const j = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(HTML); }
  if (u.pathname === '/api/menu') return j(await getMenu());
  if (u.pathname === '/api/comanda') return j(await getComanda(u.searchParams.get('numero') || 0));
  if (u.pathname === '/api/pedir' && req.method === 'POST') { const b = await readBody(req); return j(await enviarPedido(b.numero, b.itens)); }
  res.writeHead(404); res.end('not found');
});
server.listen(8788, () => console.log('cardápio dev (Golden Hour + sabor/tamanho) em http://localhost:8788'));

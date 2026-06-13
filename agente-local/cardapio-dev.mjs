// F1 (dev, SOMENTE LEITURA): servidor local do cardápio que roda no Mac e lê o
// Firebird de PRODUÇÃO do Prainha Bar (10.0.0.252). Serve: menu real + consulta
// de comanda por número. Nenhuma escrita. `node cardapio-dev.mjs` -> http://localhost:8788
import http from 'node:http';
import Firebird from 'node-firebird';

const FB = {
  host: '10.0.0.252', port: 3050,
  database: 'C:\\Users\\Administrator\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\consumer.fdb',
  user: 'SYSDBA', password: 'masterkey', lowercase_keys: false, pageSize: 4096,
};

// --- conexão crash-safe FB4: 1 query por attach, serializada (mutex), handler global ---
let pending = null;
process.on('uncaughtException', (e) => { if (pending) { const r = pending; pending = null; r({ ok: false, err: 'uncaught:' + String(e.message).slice(0, 60) }); } });
process.on('unhandledRejection', () => { if (pending) { const r = pending; pending = null; r({ ok: false, err: 'unhandled' }); } });
let chain = Promise.resolve();
function query(sql, params = []) {
  const run = () => new Promise((res) => {
    pending = res;
    const fin = (r) => { if (pending) { pending = null; res(r); } };
    setTimeout(() => fin({ ok: false, err: 'timeout' }), 20000);
    try {
      Firebird.attach(FB, (err, db) => {
        if (err) return fin({ ok: false, err: String(err.message).slice(0, 90) });
        db.query(sql, params, (e, rows) => { try { db.detach(() => {}); } catch {} if (e) return fin({ ok: false, err: String(e.message).slice(0, 110) }); fin({ ok: true, rows }); });
      });
    } catch (e) { fin({ ok: false, err: String(e.message).slice(0, 90) }); }
  });
  const p = chain.then(run);
  chain = p.catch(() => {});
  return p;
}

// --- cache do menu (TTL 60s) ---
let menuCache = null, menuAt = 0, cozCache = null;
async function getMenu() {
  if (menuCache && Date.now() - menuAt < 60000) return menuCache;
  if (!cozCache) {
    const c = await query(`SELECT CODIGO, TRIM(DESCRICAO) D FROM COZINHAS ORDER BY CODIGO`);
    cozCache = {}; if (c.ok) c.rows.forEach((x) => { cozCache[x.CODIGO] = x.D; });
  }
  const r = await query(
    `SELECT pd.CODIGO COD, TRIM(p.NOME) NOME, pd.PRECOVENDA PRECO, p.CODIGOCOZINHA COZ
     FROM PRODUTODETALHE pd JOIN PRODUTOS p ON p.CODIGO=pd.CODIGOPRODUTO
     WHERE pd.CARDAPIODIGITAL=1 AND pd.DATADELETE IS NULL AND pd.PRECOVENDA>0
       AND (p.DESCONTINUADO IS NULL OR p.DESCONTINUADO<>'S')
     ORDER BY p.CODIGOCOZINHA, p.NOME`,
  );
  if (!r.ok) return { erro: r.err };
  const grupos = {};
  for (const it of r.rows) {
    const g = cozCache[it.COZ] || `Cozinha ${it.COZ}`;
    (grupos[g] = grupos[g] || []).push({ cod: it.COD, nome: it.NOME, preco: Number(it.PRECO) });
  }
  menuCache = { grupos, total: r.rows.length }; menuAt = Date.now();
  return menuCache;
}

async function getComanda(numero) {
  const h = await query(
    `SELECT FIRST 1 CODIGO, NUMERO, TRIM(NOME) NOME, VALORTOTAL, SUBTOTALPAGO, TOTALSERVICO, QUANTIDADEPESSOAS
     FROM PEDIDOS WHERE NUMERO=? AND DATAFECHAMENTO IS NULL AND DATADELETE IS NULL ORDER BY DATAABERTURA DESC`, [numero]);
  if (!h.ok) return { erro: h.err };
  if (!h.rows.length) return { vazia: true };
  const p = h.rows[0];
  const it = await query(
    `SELECT TRIM(NOMEPRODUTO) NOME, QUANTIDADE QTD, VALORTOTAL VT, CODIGOITEMPEDIDOTIPO TIPO, CODIGOPAI PAI
     FROM ITENSPEDIDO WHERE CODIGOPEDIDO=${Number(p.CODIGO)} ORDER BY CODIGO`);
  return {
    itensErro: it.ok ? undefined : it.err,
    numero: p.NUMERO, nome: p.NOME || null, codigo: p.CODIGO,
    pessoas: p.QUANTIDADEPESSOAS, total: Number(p.VALORTOTAL), pago: Number(p.SUBTOTALPAGO || 0),
    servico: Number(p.TOTALSERVICO || 0),
    itens: it.ok ? it.rows.map((x) => ({ nome: x.NOME, qtd: Number(x.QTD), vt: Number(x.VT), tipo: x.TIPO, pai: x.PAI })) : [],
  };
}

const HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Prainha Bar — Cardápio</title><style>
:root{--bg:#1a1207;--card:#241a0d;--gold:#f0a84d;--gold2:#e8762b;--txt:#fbe7d2;--mut:#b89b78}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:linear-gradient(180deg,#2a1a08,#140d04);color:var(--txt);min-height:100vh}
header{padding:18px 16px 12px;position:sticky;top:0;background:linear-gradient(180deg,#2a1a08,rgba(20,13,4,.92));backdrop-filter:blur(6px);z-index:5}
h1{margin:0;font-size:22px;font-weight:600;color:var(--gold)}
.sub{font-size:13px;color:var(--mut);margin-top:2px}
.wrap{padding:0 14px 40px;max-width:560px;margin:0 auto}
.conta{background:var(--card);border:1px solid #3a2a14;border-radius:16px;padding:14px;margin:12px 0}
.conta h2{margin:0 0 8px;font-size:15px;color:var(--gold)}
.row{display:flex;gap:8px}
input{flex:1;height:48px;border-radius:12px;border:1px solid #4a3518;background:#160f06;color:var(--txt);font-size:18px;padding:0 14px;outline:none}
button{height:48px;border:0;border-radius:12px;background:linear-gradient(135deg,var(--gold),var(--gold2));color:#2a1505;font-weight:700;font-size:16px;padding:0 18px}
.item{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #2c2010;font-size:15px}
.item.compl{padding-left:14px;color:var(--mut);font-size:13px;border-bottom:0;padding-top:2px;padding-bottom:2px}
.preco{color:var(--gold);white-space:nowrap;font-variant-numeric:tabular-nums}
.tot{display:flex;justify-content:space-between;margin-top:10px;padding-top:10px;border-top:1px solid #4a3518;font-size:18px;font-weight:700}
.tot .preco{color:var(--gold)}
.cat{margin:18px 0 6px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gold2)}
.menulinha{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #241a0d;font-size:15px}
.mut{color:var(--mut);font-size:13px}.hide{display:none}
</style></head><body>
<header><h1>🌅 Prainha Bar</h1><div class="sub" id="sub">cardápio digital · leitura</div></header>
<div class="wrap">
  <div class="conta">
    <h2>Minha conta</h2>
    <div class="row"><input id="num" inputmode="numeric" placeholder="nº da comanda (ex: 15)"><button onclick="verConta()">Ver</button></div>
    <div id="contaOut" class="mut" style="margin-top:10px">Digite o número da sua comanda pra ver o consumo.</div>
  </div>
  <div id="menu"><div class="mut">carregando cardápio…</div></div>
</div>
<script>
const brl=n=>'R$ '+n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
async function verConta(){
  const n=document.getElementById('num').value.trim(); const o=document.getElementById('contaOut');
  if(!n){o.textContent='Informe o número.';return}
  o.textContent='buscando…';
  try{const r=await fetch('/api/comanda?numero='+encodeURIComponent(n));const d=await r.json();
    if(d.erro){o.textContent='erro: '+d.erro;return}
    if(d.vazia){o.innerHTML='<span class="mut">Nenhuma comanda aberta com o número '+n+'.</span>';return}
    let h='<div style="margin-bottom:6px" class="mut">Comanda '+d.numero+(d.nome?' · '+d.nome:'')+' · '+d.pessoas+' pessoa(s)</div>';
    for(const i of d.itens){const c=i.tipo===2?'item compl':'item';
      h+='<div class="'+c+'"><span>'+(i.tipo===2?'+ ':'')+(i.qtd>1?i.qtd+'× ':'')+i.nome+'</span><span class="preco">'+(i.vt?brl(i.vt):'')+'</span></div>';}
    if(d.servico)h+='<div class="item"><span class="mut">Serviço</span><span class="preco">'+brl(d.servico)+'</span></div>';
    h+='<div class="tot"><span>Total</span><span class="preco">'+brl(d.total)+'</span></div>';
    if(d.pago>0)h+='<div class="item"><span class="mut">já pago</span><span class="mut">'+brl(d.pago)+'</span></div>';
    o.innerHTML=h;
  }catch(e){o.textContent='falha: '+e.message}
}
document.getElementById('num').addEventListener('keydown',e=>{if(e.key==='Enter')verConta()});
(async()=>{const m=document.getElementById('menu');
  try{const r=await fetch('/api/menu');const d=await r.json();
    if(d.erro){m.innerHTML='<div class="mut">erro: '+d.erro+'</div>';return}
    document.getElementById('sub').textContent='cardápio digital · '+d.total+' itens';
    let h='';for(const[cat,itens]of Object.entries(d.grupos)){h+='<div class="cat">'+cat+'</div>';
      for(const i of itens)h+='<div class="menulinha"><span>'+i.nome+'</span><span class="preco">'+brl(i.preco)+'</span></div>';}
    m.innerHTML=h;
  }catch(e){m.innerHTML='<div class="mut">falha: '+e.message+'</div>'}
})();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(HTML); }
  if (u.pathname === '/api/menu') { const d = await getMenu(); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(d)); }
  if (u.pathname === '/api/comanda') { const d = await getComanda(Number(u.searchParams.get('numero') || 0)); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(d)); }
  res.writeHead(404); res.end('not found');
});
server.listen(8788, () => console.log('cardápio dev em http://localhost:8788 (lendo prod 10.0.0.252)'));

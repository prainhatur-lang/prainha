// Cardápio imprimível da Tabuará lendo o NOSSO banco (Postgres da nuvem).
// Mesmo layout do agente-local/cardapio-tabuara.mjs, que lia o Firebird do
// Consumer (desligado em 02/11/2026). Mesmos itens do QR da mesa: variante com
// cardápio digital ligado, sem pausa, não excluída, preço > 0, produto não
// descontinuado. Gera 2 HTML A4 em ~/Downloads prontos pra Cmd+P:
//   1) cardapio-tabuara.html      -> comida + bebidas
//   2) carta-vinhos-tabuara.html  -> Vinhos & Espumantes
// Rodar de packages/db:  node scripts/cardapio-tabuara-nuvem.cjs

const postgres = require('postgres');
require('dotenv').config({ path: require('node:path').join(__dirname, '../../../.env') });
const { writeFileSync } = require('node:fs');
const os = require('node:os');

const FILIAL = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7'; // 02 Tabuará
const OUT_DIR = require('node:path').join(os.homedir(), 'Downloads');

// ---- classificação de categorias (ETIQUETAS.DESCRICAO) ----
const VINHOS = ['Vinho', 'Espumante'];
const COMIDA = ['Entrada', 'Saladas', 'Aves', 'Carnes', 'Frutos do Mar', 'Pratos', 'SANDUICHES', 'Porções', 'Sobremesa', 'Sobremesa Inclusiva'];
const BEBIDAS = ['Bebida não alcoolica', 'Cafe', 'Cerveja', 'Chopp', 'Drink', 'Drink - Autorais', 'Drink - Clássicos Contemporâneos', 'Cachaça', 'Conhaque', 'Gin', 'Licor', 'Rum', 'Tequila', 'Vodka', 'Whisky'];
// Títulos "de vitrine" (o resto usa o nome da etiqueta como está)
const TITULO = { 'Entrada': 'Entradas', 'SANDUICHES': 'Sanduíches', 'Cafe': 'Café', 'Bebida não alcoolica': 'Bebidas não alcoólicas', 'Chopp': 'Chopp', 'Drink - Clássicos Contemporâneos': 'Drinks Clássicos', 'Drink - Autorais': 'Drinks Autorais', 'Drink': 'Drinks', 'Sobremesa Inclusiva': 'Sobremesas Inclusivas', 'Sobremesa': 'Sobremesas' };

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const brl = (n) => { n = Number(n); return n % 1 === 0 ? `R$ ${n}` : `R$ ${n.toFixed(2).replace('.', ',')}`; };
const norm = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());

function priceLabel(variants) {
  const parts = variants.slice().sort((a, b) => a.preco - b.preco).map((v) => (v.tam ? `${esc(v.tam)} ${brl(v.preco)}` : brl(v.preco)));
  return [...new Set(parts)].join('  ·  ');
}

function htmlDoc(title, subtitle, sections, dataStamp) {
  const head = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Tabuará</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{ --ink:#1b1b1b; --mut:#6b6b6b; --accent:#d9482e; --line:#e3ddd6; }
  *{ box-sizing:border-box; }
  html,body{ margin:0; }
  body{ font-family:'Outfit',-apple-system,system-ui,sans-serif; color:var(--ink); background:#fff; }
  .sheet{ max-width:780px; margin:0 auto; padding:30px 34px 44px; }
  .head{ text-align:center; padding-bottom:14px; margin-bottom:8px; border-bottom:2px solid var(--accent); }
  .brand{ font-family:'Anton',sans-serif; font-size:46px; letter-spacing:2px; text-transform:uppercase; line-height:1; }
  .brand .a{ color:var(--accent); }
  .sub{ font-size:12px; letter-spacing:.34em; text-transform:uppercase; color:var(--mut); margin-top:8px; }
  .cat{ font-family:'Anton',sans-serif; font-size:26px; letter-spacing:1px; text-transform:uppercase; color:var(--accent); margin:26px 0 4px; break-after:avoid; }
  .cat .n{ color:var(--mut); font-family:'Outfit'; font-size:12px; letter-spacing:.1em; margin-left:8px; }
  .item{ padding:9px 0 8px; border-bottom:1px solid var(--line); break-inside:avoid; }
  .row{ display:flex; align-items:baseline; gap:10px; }
  .nm{ font-weight:600; font-size:15px; flex:1; line-height:1.25; }
  .pr{ font-weight:700; font-size:14px; color:var(--accent); white-space:nowrap; font-variant-numeric:tabular-nums; }
  .ds{ color:var(--mut); font-size:12.5px; line-height:1.35; margin-top:2px; max-width:88%; }
  .foot{ margin-top:26px; text-align:center; color:var(--mut); font-size:11px; letter-spacing:.06em; }
  @page{ size:A4; margin:15mm 14mm 12mm; }
  @media print{ body{ -webkit-print-color-adjust:exact; print-color-adjust:exact; } .sheet{ padding:0; max-width:none; } .cat{ margin-top:18px; } }
</style></head><body><div class="sheet">
<div class="head"><div class="brand">Tabu<span class="a">a</span>rá</div><div class="sub">${esc(subtitle)}</div></div>`;

  const body = sections.map((sec) => {
    const its = sec.items.map((it) => `<div class="item"><div class="row"><span class="nm">${esc(it.name)}</span><span class="pr">${it.price}</span></div>${it.desc ? `<div class="ds">${esc(it.desc)}</div>` : ''}</div>`).join('\n');
    return `<div class="cat">${esc(sec.titulo)}<span class="n">${sec.items.length} ${sec.items.length === 1 ? 'item' : 'itens'}</span></div>\n${its}`;
  }).join('\n');

  const foot = `<div class="foot">Tabuará — Prainha Turismo · gerado do sistema em ${esc(dataStamp)} · preços sujeitos a alteração</div></div></body></html>`;
  return head + body + foot;
}

function montaSecoes(grupos, ordem) {
  const out = [];
  for (const cat of ordem) {
    const itens = grupos[cat];
    if (!itens || !itens.length) continue;
    itens.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    out.push({ titulo: TITULO[cat] || cat, items: itens });
  }
  return out;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });
  const rows = await sql`
    SELECT p.id prod, TRIM(p.nome) pnome, p.descricao descr, v.preco_venda::float preco,
           TRIM(e.nome) cat, TRIM(t.descricao) tam
      FROM produto p
      JOIN produto_variante v ON v.produto_id = p.id AND v.data_delete IS NULL
      LEFT JOIN produto_etiqueta e ON e.filial_id = p.filial_id AND e.codigo_externo::text = p.codigo_etiqueta
      LEFT JOIN produto_tamanho t ON t.id = v.produto_tamanho_id
     WHERE p.filial_id = ${FILIAL}
       AND v.data_pausado IS NULL AND v.preco_venda > 0 AND v.cardapio_digital = true
       AND COALESCE(p.descontinuado, false) = false
     ORDER BY e.nome, p.nome, v.preco_venda`;
  await sql.end();

  const byProd = new Map();
  for (const x of rows) {
    let g = byProd.get(x.prod);
    if (!g) { g = { name: norm(x.pnome), desc: norm(x.descr), cat: norm(x.cat) || '(sem categoria)', variants: [] }; byProd.set(x.prod, g); }
    g.variants.push({ tam: norm(x.tam) || null, preco: Number(x.preco) });
  }

  const setV = new Set(VINHOS), setC = new Set(COMIDA), setB = new Set(BEBIDAS);
  const gMenu = {}, gVinho = {}, excluidas = {};
  for (const g of byProd.values()) {
    const item = { name: g.name, desc: g.desc, price: priceLabel(g.variants) };
    if (setV.has(g.cat)) (gVinho[g.cat] = gVinho[g.cat] || []).push(item);
    else if (setC.has(g.cat) || setB.has(g.cat)) (gMenu[g.cat] = gMenu[g.cat] || []).push(item);
    else excluidas[g.cat] = (excluidas[g.cat] || 0) + 1;
  }

  const stamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const secMenu = montaSecoes(gMenu, [...COMIDA, ...BEBIDAS]);
  const secVinho = montaSecoes(gVinho, VINHOS);
  writeFileSync(`${OUT_DIR}/cardapio-tabuara.html`, htmlDoc('Cardápio', 'Cardápio', secMenu, stamp));
  writeFileSync(`${OUT_DIR}/carta-vinhos-tabuara.html`, htmlDoc('Vinhos & Espumantes', 'Carta de Vinhos & Espumantes', secVinho, stamp));

  const nMenu = secMenu.reduce((s, x) => s + x.items.length, 0);
  const nVinho = secVinho.reduce((s, x) => s + x.items.length, 0);
  console.log(`\n== CARDÁPIO — ${nMenu} itens ==`);
  secMenu.forEach((s) => console.log(`  ${s.titulo.padEnd(26)} ${s.items.length}`));
  console.log(`\n== VINHOS & ESPUMANTES — ${nVinho} itens ==`);
  secVinho.forEach((s) => console.log(`  ${s.titulo.padEnd(26)} ${s.items.length}`));
  const exc = Object.entries(excluidas).sort((a, b) => b[1] - a[1]);
  if (exc.length) { console.log('\n== categorias fora do impresso =='); exc.forEach(([c, n]) => console.log(`  ${String(c).padEnd(30)} ${n}`)); }
  console.log(`\nArquivos:\n  ${OUT_DIR}/cardapio-tabuara.html\n  ${OUT_DIR}/carta-vinhos-tabuara.html`);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

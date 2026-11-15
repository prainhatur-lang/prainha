// Carta de vinhos e drinks da Prainha Mar pra imprimir — pedido do dono 15/11/2026:
// "como o da comida, só que só vinhos (branco, tinto, espumantes, sobremesa) e os
// drinks. Mesmo formato: meio A4 de um lado, A4 no meio, meio A4 do outro."
//
// Usa o cardápio de comida como MOLDE (fontes, azulejo, logo, moldura, QR) e troca
// só o miolo. Itens e preços vêm do banco: cardápio digital ligado, sem pausa,
// preço > 0 — os mesmos do QR da mesa. Só leitura.
//
//   cd packages/db && node scripts/carta-vinhos-mar.cjs [molde.html]
//
// Sai em ~/Downloads/carta-vinhos-drinks-prainha-mar.html (+ .pdf pelo Chrome).
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const postgres = require('postgres');
require('dotenv').config({ path: '../../.env' });

const MAR = 'e899dae2-38bf-4f3f-9149-7effd059fab8';
const OUT_DIR = `${os.homedir()}/Downloads`;
const MOLDE = process.argv[2] || `${OUT_DIR}/cardapio-prainha-mar-2026-10-21.html`;
const SAIDA = `${OUT_DIR}/carta-vinhos-drinks-prainha-mar`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const semAcento = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const brl = (n) => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

// ---- país: campo Nacionalidade do cadastro; sem ele, o produtor (mesmos vinhos
// que na Tabuará têm PT/ARG/FRA no fim do nome). ----
const PAIS_DA_NACIONALIDADE = {
  brasileiro: 'Brasil', argentino: 'Argentina', chileno: 'Chile', uruguaio: 'Uruguai', portugues: 'Portugal',
  italiano: 'Itália', frances: 'França', espanhol: 'Espanha', alemao: 'Alemanha', 'sul-africano': 'África do Sul',
  australiano: 'Austrália', neozelandes: 'Nova Zelândia', americano: 'Estados Unidos',
};
const PAIS_DO_PRODUTOR = [
  [/cartuxa|foral|la rosa|alorna|portas do sol|chaves|vinyle|susana esteban|bacalhoa|chamine|escultor|\bmob\b|mouchao|laureano|noval|sem vergonha|condes de barcelos/, 'Portugal'],
  [/3 terroirs|bourgogne|chateau|pauillac|champagne|moet/, 'França'],
  [/don luciano|izadi|mayor de castilla|pruno|salbide/, 'Espanha'],
  [/barolo|puglia|chianti|primitivo/, 'Itália'],
  [/amadeo/, 'Argentina'],
  [/condor|paya/, 'Chile'],
  [/chandon/, 'Brasil'],
];
const ORDEM_PAIS = ['Portugal', 'Espanha', 'França', 'Itália', 'Argentina', 'Chile', 'Brasil', 'Uruguai'];
const pesoPais = (p) => (ORDEM_PAIS.indexOf(p) === -1 ? 50 : ORDEM_PAIS.indexOf(p));

function paisDe(nome, nacionalidade) {
  const nac = semAcento((nacionalidade || '').trim());
  if (nac) return PAIS_DA_NACIONALIDADE[nac] || PAIS_DA_NACIONALIDADE[nac.replace(/a$/, 'o')] || PAIS_DA_NACIONALIDADE[nac.replace(/a$/, '')] || nacionalidade.trim();
  const n = semAcento(nome);
  for (const [re, pais] of PAIS_DO_PRODUTOR) if (re.test(n)) return pais;
  return '';
}

function tipoDe(nome, etiqueta) {
  const n = semAcento(nome);
  if (/espumante/i.test(etiqueta) || /\b(espumante|prosecco|champagne|cava)\b/.test(n)) return 'espumante';
  if (/\b(porto|moscatel|sobremesa|late harvest|colheita tardia|sauternes|madeira)\b/.test(n)) return 'sobremesa';
  if (/\brose\b/.test(n)) return 'rose';
  if (/\bvinho verde\b/.test(n)) return 'verde';
  if (/\b(branco|bianco|blanc)\b/.test(n)) return 'branco';
  return 'tinto';
}

function nomeVinho(bruto) {
  let n = bruto.replace(/\s+/g, ' ').trim();
  const meia = /375\s*ml/i.test(n);
  n = n
    .replace(/^vinho\s+(tinto|branco|ros[eé]|verde)\s+/i, '')
    .replace(/\s+vinho\s+ros[eé]$/i, '')
    .replace(/\s*-?\s*(tinto\s+)?\d{3}\s*ml/gi, '')
    .replace(/\s+tinto\b/gi, '')
    .replace(/\s+(promo|poromo)(\s+pj)?\b/gi, '')
    .replace(/\s+branco$/i, '')
    .replace(/\s+-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  n = n.replace(/^do Chaves\b/i, 'Tapada do Chaves').replace(/\bChateau\b/g, 'Château').replace(/\breserva\b/g, 'Reserva');
  n = n.replace(/\bEvora\b/g, 'Évora').replace(/\bMoet\b/g, 'Moët').replace(/\bD Or\b/, "d'Or").replace(/\bDoc\b/, 'DOC').replace(/\bClassico\b/g, 'Clássico');
  if (meia) n += ' (375 ml)';
  return n.charAt(0).toUpperCase() + n.slice(1);
}

const item = (nome, preco, desc) =>
  `<div class="it"><div class="ln"><span class="nm">${esc(nome)}</span><span class="dots"></span><span class="pr">${typeof preco === 'string' ? preco : brl(preco)}</span></div>${desc ? `<div class="desc">${esc(desc)}</div>` : ''}</div>`;

/** vinhos de um tipo → blocos por país (rótulo pequeno), preço crescente dentro. */
function blocosPorPais(vinhos) {
  const m = new Map();
  for (const v of vinhos) m.set(v.pais, [...(m.get(v.pais) || []), v]);
  return [...m.entries()]
    .sort((a, b) => pesoPais(a[0]) - pesoPais(b[0]) || a[0].localeCompare(b[0]))
    .map(([pais, lista]) => ({
      pais,
      n: lista.length,
      html: `<div class="bloco">${pais ? `<div class="pais">${esc(pais)}</div>` : ''}${lista
        .sort((a, b) => a.preco - b.preco || a.nome.localeCompare(b.nome))
        .map((v) => item(v.nome, v.preco))
        .join('')}</div>`,
    }));
}

// ---- drinks: o nome decide a seção; descrição do cadastro com a grafia acertada ----
const DESC_DRINK = {
  'aperol prainha': 'Espumante, Aperol e laranja',
  'prainha sunset': 'Vodca, Malibu, abacaxi, laranja e grenadine',
  'prainha mule': 'Gim, sumo de limão e espuma de frutas vermelhas',
  'prainha gt': 'Gim, sumo de limão, xarope de toranja, tônica e espuma de frutas vermelhas',
  negroni: 'Vermute, Campari e gim',
  'moscow mule': 'Vodca, limão e espuma de gengibre',
  mojito: 'Rum Bacardí, hortelã, limão e tônica',
  margarita: 'Tequila, limão e sal',
  'coquetel de frutas com alcool': 'Vodca, frutas vermelhas, leite condensado e calda de chocolate',
  'coquetel de frutas sem alcool': 'Água de coco, frutas vermelhas, leite condensado e calda de chocolate',
  caipirosca: 'De frutas, com vodca',
};
const NOME_DRINK = {
  'caipirosca rum': 'Caipirosca de rum',
  'coquetel de frutas com alcool': 'Coquetel de frutas',
  'coquetel de frutas sem alcool': 'Coquetel de frutas sem álcool',
  'sem alcool': 'Drink sem álcool',
  'tequila (dose)': 'Tequila',
  'campari dose': 'Campari',
  'absolut - destilado': 'Vodca Absolut',
  ciroc: 'Vodca Cîroc',
  'johnnie red label': 'Johnnie Walker Red Label',
};

(async () => {
  if (!existsSync(MOLDE)) throw new Error(`Molde não encontrado: ${MOLDE}`);
  const molde = readFileSync(MOLDE, 'utf8');
  const pega = (re, de = molde) => {
    const m = de.match(re);
    if (!m) throw new Error(`Molde sem ${re}`);
    return m[0];
  };
  const head = molde.slice(0, molde.indexOf('</style>'));
  const azulejo = pega(/<svg class="azulejo"[\s\S]*?<\/svg>/);
  const pLeft = molde.slice(molde.indexOf('id="left"'), molde.indexOf('id="center"'));
  const pCenter = molde.slice(molde.indexOf('id="center"'), molde.indexOf('id="right"'));
  const pRight = molde.slice(molde.indexOf('id="right"'));
  const topoLado = pega(/<div class="top">[\s\S]*?<\/div>/, pLeft);
  const topoCentro = pega(/<div class="top">[\s\S]*?<\/div>/, pCenter);
  const rodape = pega(/<div class="bottom">[\s\S]*?<\/div>/, pLeft);
  const qr = pRight.slice(pRight.indexOf('<div class="qrbox">'), pRight.indexOf('<div class="bottom">'));

  const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });
  const linhas = await sql`
    SELECT e.nome AS etiqueta, p.nome, p.nacionalidade, v.preco_venda::float AS preco
    FROM produto p
    JOIN produto_variante v ON v.produto_id = p.id AND v.data_delete IS NULL
    JOIN produto_etiqueta e ON e.filial_id = p.filial_id AND p.codigo_etiqueta = e.codigo_externo::text
    WHERE p.filial_id = ${MAR}
      AND coalesce(p.descontinuado, false) = false
      AND v.cardapio_digital = true AND v.data_pausado IS NULL AND v.preco_venda > 0
      AND e.nome IN ('Vinho', 'Espumante', 'Drink', 'Cachaça', 'Vodka', 'Whisky')
    ORDER BY p.nome, v.preco_venda`;
  await sql.end();

  // ---------- vinhos ----------
  const porTipo = { espumante: [], branco: [], rose: [], verde: [], sobremesa: [], tinto: [] };
  const semPais = [];
  const deFora = []; // "Promo"/"PJ" é item interno de promoção, sem rótulo definido: não vai pro impresso
  for (const l of linhas.filter((x) => x.etiqueta === 'Vinho' || x.etiqueta === 'Espumante')) {
    if (/\b(promo|pj)\b/i.test(l.nome)) {
      deFora.push(`${l.nome} (${brl(l.preco)})`);
      continue;
    }
    const tipo = tipoDe(l.nome, l.etiqueta);
    const pais = paisDe(l.nome, l.nacionalidade);
    if (!pais) semPais.push(l.nome);
    porTipo[tipo].push({ nome: nomeVinho(l.nome), preco: l.preco, pais });
  }
  const secao = (titulo, vinhos) =>
    vinhos.length ? `<section><h2>${titulo}</h2>${blocosPorPais(vinhos).map((b) => b.html).join('')}</section>` : '';

  const esquerda = [
    secao('Espumantes &amp; Champagnes', porTipo.espumante),
    secao('Vinhos Brancos', porTipo.branco),
    secao('Vinho Verde', porTipo.verde),
    secao('Vinhos Rosés', porTipo.rose),
    secao('Vinhos de Sobremesa', porTipo.sobremesa),
  ].join('\n  ');

  // tintos em 2 colunas: países inteiros, equilibrando a altura (itens + título)
  const blocos = blocosPorPais(porTipo.tinto);
  const total = blocos.reduce((s, b) => s + b.n + 1.6, 0);
  const colunas = [[], []];
  let acc = 0;
  for (const b of blocos) {
    const peso = b.n + 1.6;
    colunas[acc + peso / 2 <= total / 2 || !colunas[0].length ? 0 : 1].push(b.html);
    acc += peso;
  }

  // ---------- drinks ----------
  const bar = linhas.filter((x) => !['Vinho', 'Espumante'].includes(x.etiqueta));
  const grupos = { casa: [], classicos: [], caipis: [], zero: [], doses: [], garrafas: [] };
  const cachacas = [];
  for (const l of bar) {
    const k = semAcento(l.nome.replace(/\s+/g, ' ').trim());
    const nome = NOME_DRINK[k] || l.nome.replace(/\s+/g, ' ').trim();
    const it = { nome, preco: l.preco, desc: DESC_DRINK[k] };
    // 10 itens chamados só "cachaça" (R$ 23 a 29) na etiqueta Drink: sem nome próprio, não dá pra imprimir
    if (k === 'cachaca') cachacas.push(l.preco);
    else if (/sem alcool/.test(k)) grupos.zero.push(it);
    else if (/prainha/.test(k)) grupos.casa.push(it);
    else if (/caipir|coquetel/.test(k)) grupos.caipis.push(it);
    else if (['Vodka', 'Whisky'].includes(l.etiqueta) || /tequila|campari/.test(k)) (l.preco >= 100 ? grupos.garrafas : grupos.doses).push(it);
    else grupos.classicos.push(it);
  }
  const sec = (titulo, lista, ordenar = true) =>
    lista.length
      ? `<section><h2>${titulo}</h2>${(ordenar ? lista.sort((x, y) => (typeof x.preco === 'number' ? x.preco : 0) - (typeof y.preco === 'number' ? y.preco : 0) || x.nome.localeCompare(y.nome)) : lista)
          .map((i) => item(i.nome, i.preco, i.desc))
          .join('')}</section>`
      : '';
  const direita = [
    sec('Drinks da Casa', grupos.casa),
    sec('Clássicos', grupos.classicos),
    sec('Caipirinhas &amp; Coquetéis', grupos.caipis),
    sec('Sem Álcool', grupos.zero),
    sec('Doses', grupos.doses),
    sec('Garrafas', grupos.garrafas),
  ].join('\n  ');

  const css = `
/* carta de vinhos e drinks (15/11/2026) — mesmo molde, miolo de bebida */
.pais{font-family:'Cormorant Garamond',Georgia,serif;font-weight:700;font-style:italic;font-size:10pt;color:var(--ink);letter-spacing:.04em;margin:1.6mm 0 .7mm}
.full .pais{font-size:11.5pt;margin:2.2mm 0 1mm}
.bloco{break-inside:avoid}
h2+.bloco .pais{margin-top:.6mm}
#left .it{margin-bottom:2.6mm}
#left .nm,#left .pr{font-size:11.2pt;line-height:1.2}
#left h2{margin-top:7mm;margin-bottom:1.6mm}
#left .pais{font-size:11pt;margin:2.4mm 0 1.4mm}
#left h1,#right h1{margin-top:2mm;margin-bottom:1mm;font-size:15pt}
.full .it{margin-bottom:2.7mm}
.full .nm,.full .pr{font-size:12.4pt}
.full .pais{font-size:13pt;margin:4mm 0 1.8mm}
h1.center{margin:1.5mm 0 0}
.subcentro{text-align:center;font-style:italic;font-size:13pt;color:#34404F;margin:.5mm 0 3mm}
.cols{gap:9mm}
#right .nm,#right .pr{font-size:9.6pt;line-height:1.2}
#right .desc{font-size:7.9pt;line-height:1.15;padding-right:4mm;margin-top:0}
#right .it{margin-bottom:.9mm}
#right h2{margin-top:2mm;margin-bottom:.8mm;font-size:10pt}
#right .qrbox{margin-top:auto}
`;

  const painel = (id, classe, miolo) =>
    `<div class="panel ${classe}" id="${id}">\n ${azulejo}\n <div class="inner">\n${miolo}\n  ${rodape}\n </div>\n ${azulejo}\n</div>`;

  const html =
    head.replace(/<title>[\s\S]*?<\/title>/, '<title>Carta de Vinhos &amp; Drinks — Prainha Mar</title>') +
    css +
    '</style></head><body>\n' +
    painel('left', 'half', `  ${topoLado}\n  <h1>Espumantes,<br>Brancos &amp; Rosés</h1>\n  ${esquerda}`) +
    '\n' +
    painel(
      'center',
      'full',
      `  ${topoCentro}\n  <h1 class="center">Carta de Vinhos</h1>\n  <div class="subcentro">Tintos</div>\n  <div class="cols"><div class="col">${colunas[0].join('')}</div><div class="col">${colunas[1].join('')}</div></div>\n  <p class="nota-rodape center">Garrafas de 750 ml, salvo indicação. &nbsp;·&nbsp; Pergunte ao garçom sobre safras e disponibilidade.</p>`,
    ) +
    '\n' +
    painel('right', 'half', `  ${topoLado}\n  <h1>Drinks</h1>\n  ${direita}\n  ${qr}`) +
    '\n</body></html>';

  writeFileSync(`${SAIDA}.html`, html);
  console.log(`[ok] ${SAIDA}.html`);
  console.log(
    `vinhos: ${Object.entries(porTipo).map(([k, v]) => `${k} ${v.length}`).join(' · ')} | bar: ${bar.length} linhas`,
  );
  if (deFora.length) console.log(`FORA DO IMPRESSO (promoção sem rótulo): ${deFora.join('; ')}`);
  if (cachacas.length) console.log(`FORA DO IMPRESSO: ${cachacas.length} itens chamados só "cachaça" (R$ ${Math.min(...cachacas)} a ${Math.max(...cachacas)})`);
  if (semPais.length) console.log(`SEM PAÍS (preencha a Nacionalidade no cadastro): ${semPais.join('; ')}`);

  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(chrome)) {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${SAIDA}.pdf`, `file://${SAIDA}.html`], { stdio: 'ignore' });
    console.log(`[ok] ${SAIDA}.pdf`);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

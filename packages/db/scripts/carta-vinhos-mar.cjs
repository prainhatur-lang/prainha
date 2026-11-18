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
// 17/11/2026 (dono): "vinho de meia garrafa separado, num grupo novo, junto dos
// espumantes; do lado direito cerveja, refrigerante, água de coco, água, os drinks,
// Red Bull". Esquerda = espumantes, meia garrafa, brancos, rosés e destilados;
// meio = tintos; direita = cervejas, águas/refrigerantes/energéticos e drinks.
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
  [/chandon|casa perini/, 'Brasil'],
];
const ORDEM_PAIS = ['Portugal', 'Espanha', 'França', 'Itália', 'Chile', 'Argentina', 'Brasil', 'Uruguai'];
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
  const pequena = (n.match(/\b(187|375)\s*ml/i) || [])[1]; // 375 vira grupo próprio; 187 (baby) fica no nome
  n = n
    .replace(/^vinho\s+(tinto|branco|ros[eé]|verde)\s+/i, '')
    .replace(/^espumante\s+/i, '')
    .replace(/\bBrut Rose\b/i, 'Brut Rosé')
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
  if (pequena === '187') n += ' (187 ml)';
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
        .map((v) => item(v.nome, v.preco, v.desc))
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

// ---- cervejas e sem álcool: cabem em meia página juntando sabores/versões de mesmo
// preço numa linha só. O que não casar com nenhum grupo sai sozinho (nada some). ----
const GRUPOS_CERVEJA = [
  ['Chope Brahma · Heineken (caneca 300 ml)', /^chopp/],
  ['Heineken · Heineken Ultimate', /^heineken long neck/],
  ['Corona Extra', /^corona extra long neck$/],
  ['Stella Artois', /^stella artois long neck$/],
  ['Heineken 0.0 · Corona Zero (sem álcool)', /heineken zero|corona.*zero/],
  ['Stella Artois sem glúten', /stella.*gluten/],
  ['Amstel Ultra sem glúten', /amstel/],
  ['Baden Baden Cristal · Witbier', /baden/],
];
const GRUPOS_SEM_ALCOOL = [
  ['Água mineral sem gás', /^agua mineral/],
  ['Água mineral com gás', /^agua com gas/],
  ['H2OH! Limoneto', /h2oh/],
  ['Água de coco — copo', /agua de coco copo/],
  ['Água de coco — jarra', /agua de coco jarra/],
  ['Refrigerante lata', /coca|fanta|guarana|sprite|schweppes citrus/, ''],
  ['Água tônica', /agua tonica/, 'agua tonica'],
  ['Suco da fruta — copo', /^sucos? copo/],
  ['Suco da fruta — jarra', /^sucos? jarra/],
  ['Soda italiana', /soda italiana/, 'soda italiana'],
  ['Red Bull', /red bull/, 'red bull'],
];
const grafia = (t) =>
  t
    .replace(/\blata\b/gi, '')
    .replace(/coca[- ]cola/gi, 'Coca-Cola')
    .replace(/guarana/gi, 'Guaraná')
    .replace(/antartica/gi, 'Antarctica')
    .replace(/zero acucar/gi, 'Zero')
    .replace(/curacau/gi, 'Curaçau')
    .replace(/limao/gi, 'limão')
    .replace(/\s+/g, ' ')
    .trim();
/** linhas do banco → itens da carta, pelos grupos; [rótulo, regex, prefixo a tirar pra listar as versões, descrição fixa]. */
function juntar(linhas, grupos) {
  const usados = new Set();
  const saida = [];
  for (const [rotulo, re, prefixo, descFixa] of grupos) {
    const meus = linhas.filter((l) => !usados.has(l) && re.test(semAcento(l.nome.replace(/\s+/g, ' ').trim())));
    if (!meus.length) continue;
    meus.forEach((l) => usados.add(l));
    const precos = [...new Set(meus.map((l) => l.preco))].sort((a, b) => a - b);
    const preco = precos.length === 1 ? precos[0] : `${brl(precos[0])} a ${precos[precos.length - 1]}`;
    let desc = descFixa;
    if (prefixo !== undefined && prefixo !== null) {
      const versoes = [...new Set(meus.map((l) => {
        const n = l.nome.replace(/\s+/g, ' ').trim();
        const resto = prefixo && semAcento(n).startsWith(prefixo) ? n.slice(prefixo.length) : n;
        return grafia(resto) || 'Tradicional';
      }))];
      desc = versoes.join(', ');
    }
    saida.push({ nome: rotulo, preco, desc });
  }
  for (const l of linhas) if (!usados.has(l)) saida.push({ nome: grafia(l.nome), preco: l.preco });
  return saida;
}

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
    SELECT e.nome AS etiqueta, p.nome, p.nacionalidade, v.preco_venda::float AS preco, v.cardapio_digital AS digital
    FROM produto p
    JOIN produto_variante v ON v.produto_id = p.id AND v.data_delete IS NULL
    JOIN produto_etiqueta e ON e.filial_id = p.filial_id AND p.codigo_etiqueta = e.codigo_externo::text
    WHERE p.filial_id = ${MAR}
      AND coalesce(p.descontinuado, false) = false
      -- espumante entra mesmo fora do cardápio digital (dono 17/11/2026: "Sim, incluir os 4"); pausado segue fora
      AND (v.cardapio_digital = true OR e.nome = 'Espumante') AND v.data_pausado IS NULL AND v.preco_venda > 0
      AND e.nome IN ('Vinho', 'Espumante', 'Drink', 'Cachaça', 'Vodka', 'Whisky', 'Cerveja', 'Bebida não alcoolica')
    ORDER BY p.nome, v.preco_venda`;
  await sql.end();

  // ---------- vinhos ----------
  const porTipo = { espumante: [], meia: [], branco: [], rose: [], verde: [], sobremesa: [], tinto: [] };
  const NOME_TIPO = { branco: 'Branco', rose: 'Rosé', verde: 'Verde', sobremesa: 'Sobremesa', tinto: 'Tinto' };
  const semPais = [];
  // fora do cardápio digital só entram os 4 espumantes que o dono aprovou (17/11/2026); outro que aparecer é avisado
  const ESPUMANTE_APROVADO = /casa perini (brut|aquarela)|chandon brut/;
  const foraDoDigital = [];
  const deFora = []; // "Promo"/"PJ" é item interno de promoção, sem rótulo definido: não vai pro impresso
  for (const l of linhas.filter((x) => x.etiqueta === 'Vinho' || x.etiqueta === 'Espumante')) {
    if (/\b(promo|pj)\b/i.test(l.nome)) {
      deFora.push(`${l.nome} (${brl(l.preco)})`);
      continue;
    }
    if (!l.digital && !ESPUMANTE_APROVADO.test(semAcento(l.nome))) {
      foraDoDigital.push(`${l.nome} (${brl(l.preco)})`);
      continue;
    }
    const tipo = tipoDe(l.nome, l.etiqueta);
    const pais = paisDe(l.nome, l.nacionalidade);
    if (!pais) semPais.push(l.nome);
    // meia garrafa (375 ml) de vinho: grupo próprio, com o tipo embaixo do nome
    if (tipo !== 'espumante' && /\b375\s*ml/i.test(l.nome)) porTipo.meia.push({ nome: nomeVinho(l.nome), preco: l.preco, pais, desc: NOME_TIPO[tipo] });
    else porTipo[tipo].push({ nome: nomeVinho(l.nome), preco: l.preco, pais });
  }
  const secao = (titulo, vinhos) =>
    vinhos.length ? `<section><h2>${titulo}</h2>${blocosPorPais(vinhos).map((b) => b.html).join('')}</section>` : '';

  const esquerda = [
    secao('Espumantes &amp; Champagnes', porTipo.espumante),
    secao('Vinhos — Meia Garrafa (375 ml)', porTipo.meia),
    secao('Vinhos Brancos', porTipo.branco),
    secao('Vinhos de Sobremesa', porTipo.sobremesa),
  ].join('\n  ');
  // rosés e verde descem pro pé da 2ª coluna do meio (sobra espaço lá; a esquerda ficou com os destilados)
  const verde = secao('Vinho Verde', porTipo.verde); // 2ª coluna, logo abaixo dos tintos (dono 18/11/2026), antes dos rosés
  const roses = secao('Vinhos Rosés', porTipo.rose); // pé da 2ª coluna
  const rosesEVerde = verde + roses;

  // tintos em 2 colunas: países inteiros, equilibrando a altura (itens + título)
  const blocos = blocosPorPais(porTipo.tinto);
  // a 2ª coluna ainda leva verde e rosés embaixo dos tintos (a Argentina fecha os tintos: dono 18/11/2026,
  // "o vinho verde deveria ficar embaixo dos tintos da argentina"), então o peso deles entra na conta
  const pesoSecao = (l) => (l.length ? l.length + 4.2 : 0);
  const extra = pesoSecao(porTipo.verde) + pesoSecao(porTipo.rose);
  const total = blocos.reduce((s, b) => s + b.n + 1.6, 0) + extra;
  const colunas = [[], []];
  let acc = 0;
  for (const b of blocos) {
    const peso = b.n + 1.6;
    colunas[acc + peso / 2 <= total / 2 || !colunas[0].length ? 0 : 1].push(b.html);
    acc += peso;
  }

  // ---------- drinks ----------
  const bar = linhas.filter((x) => !['Vinho', 'Espumante', 'Cerveja', 'Bebida não alcoolica'].includes(x.etiqueta));
  const cervejas = juntar(linhas.filter((x) => x.etiqueta === 'Cerveja'), GRUPOS_CERVEJA);
  const semAlcool = juntar(linhas.filter((x) => x.etiqueta === 'Bebida não alcoolica'), GRUPOS_SEM_ALCOOL);
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
    sec('Cervejas &amp; Chopes', cervejas, false),
    sec('Águas, Refrigerantes &amp; Energéticos', semAlcool, false),
    sec('Drinks da Casa', grupos.casa),
    sec('Clássicos', grupos.classicos),
    sec('Caipirinhas &amp; Coquetéis', [...grupos.caipis, ...grupos.zero]),
  ].join('\n  ');
  const destilados = [sec('Destilados — Dose', grupos.doses), sec('Destilados — Garrafa', grupos.garrafas)].join('\n  ');

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
/* 17/11: destilados foram pra esquerda; direita ganhou cerveja e sem álcool */
#left .nm,#left .pr{font-size:10.2pt}
#left .desc{font-size:8.2pt;line-height:1.15;margin-top:0}
#left h2{margin-bottom:1mm}
#left .pais{font-size:10pt;margin:1.4mm 0 .8mm}
#right .nm,#right .pr{font-size:8.5pt;line-height:1.12}
#right .desc{font-size:7pt;line-height:1.1}
#right .it{margin-bottom:.3mm}
#right h2{margin-top:1.1mm;margin-bottom:.5mm;font-size:9.2pt}
#left .it{margin-bottom:1.55mm}
#left h2{margin-top:3.6mm}
#center h2{margin-top:5mm;margin-bottom:1mm}
#center .it{margin-bottom:1.45mm}
#center .nm,#center .pr{font-size:11.8pt}
#center .pais{margin:2.4mm 0 1.2mm}
`;

  const painel = (id, classe, miolo) =>
    `<div class="panel ${classe}" id="${id}">\n ${azulejo}\n <div class="inner">\n${miolo}\n  ${rodape}\n </div>\n ${azulejo}\n</div>`;

  const html =
    head.replace(/<title>[\s\S]*?<\/title>/, '<title>Carta de Vinhos &amp; Drinks — Prainha Mar</title>') +
    css +
    '</style></head><body>\n' +
    painel('left', 'half', `  ${topoLado}\n  <h1>Espumantes,<br>Brancos &amp; Destilados</h1>\n  ${esquerda}\n  ${destilados}`) +
    '\n' +
    painel(
      'center',
      'full',
      `  ${topoCentro}\n  <h1 class="center">Carta de Vinhos</h1>\n  <div class="subcentro">${rosesEVerde ? 'Tintos, Rosés &amp; Verde' : 'Tintos'}</div>\n  <div class="cols"><div class="col">${colunas[0].join('')}</div><div class="col">${colunas[1].join('')}${verde}${roses}</div></div>\n  <p class="nota-rodape center">Garrafas de 750 ml, salvo indicação. &nbsp;·&nbsp; Pergunte ao garçom sobre safras e disponibilidade.</p>`,
    ) +
    '\n' +
    painel('right', 'half', `  ${topoLado}\n  <h1>Bebidas &amp; Drinks</h1>\n  ${direita}\n  ${qr}`) +
    '\n</body></html>';

  writeFileSync(`${SAIDA}.html`, html);
  console.log(`[ok] ${SAIDA}.html`);
  console.log(
    `vinhos: ${Object.entries(porTipo).map(([k, v]) => `${k} ${v.length}`).join(' · ')} | bar: ${bar.length} linhas · cervejas ${cervejas.length} · sem álcool ${semAlcool.length}`,
  );
  if (foraDoDigital.length) console.log(`FORA DO IMPRESSO (espumante fora do cardápio digital, sem aprovação): ${foraDoDigital.join('; ')}`);
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

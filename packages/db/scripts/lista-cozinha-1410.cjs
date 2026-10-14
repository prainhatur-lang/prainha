// Lista da cozinha (Prainha Bar) de 14/10/2026 → lista_compra (sugestão salva),
// pra aparecer em Compras → Sugestão → Lista da semana. NÃO cria cotação nem
// convoca fornecedor. Dry-run por padrão; --commit grava.
const postgres = require('postgres');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });

const F = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const DATA = '2026-10-14';
const COMMIT = process.argv.includes('--commit');
const CONFIRMAR = 'quantidade não informada na lista — confirmar';

const CRIAR = {
  charqueDesf: { nome: 'Charque desfiado', unidade: 'kg', cat: 'Proteína' },
  colorau: { nome: 'Colorau', unidade: 'un', cat: 'Estoque seco' },
  melaco: { nome: 'Melaço de cana', unidade: 'un', cat: 'Estoque seco' },
  gergelimPreto: { nome: 'Gergelim preto', unidade: 'kg', cat: 'Estoque seco' },
  salSache: { nome: 'Sal sachê', unidade: 'un', cat: 'Estoque seco' },
  canudoMex: { nome: 'Canudo com mexedor biodegradável', unidade: 'un', cat: 'Utensílios' },
};
const CATEGORIZAR = {
  '0f0381f0': 'Refrigeração', // Mozarela bufala
  'a691cb0a': 'Estoque seco', // Gergelim branco
  '6c564b20': 'Refrigeração', // MANTEIGA MILK VIDA (balde)
};

// [texto da lista, ref (prefixo do id ou chave de CRIAR), qtd, unidade, obs, grupo]
const ITENS = [
  ['Filé mighon 50kg', '752f1077', 50, 'kg', '', 'PROTEINAS'],
  ['Frango inteiro 1cx', '8ca78bfb', 1, 'cx', 'caixa fechada', 'PROTEINAS'],
  ['Salmão fresco 2 lâminas', '3ac79437', 2, 'lamina', 'salmão fresco', 'PROTEINAS'],
  ['Bacalhau Polaca 10 kg', 'ebef46c8', 10, 'kg', 'polaca', 'PROTEINAS'],
  ['Bolinho de Bacalhau obs tem 84 unidades', '8dce894b', 1, 'cx', `tem 84 unidades em estoque — ${CONFIRMAR}`, 'PROTEINAS'],
  ['Coxa e sobrecoxa 1 cx', 'c3ea4780', 1, 'cx', 'caixa fechada', 'PROTEINAS'],
  ['Charque 10kg', '080c95d9', 10, 'kg', '', 'PROTEINAS'],
  ['Charque desfiado 5kg', 'charqueDesf', 5, 'kg', '', 'PROTEINAS'],
  ['Calabresa 10kg', 'b24c25b3', 10, 'kg', '', 'PROTEINAS'],
  ['Mussarela de búfala 150g', '0f0381f0', 1, 'pct', `embalagem de 150 g — ${CONFIRMAR}`, 'PROTEINAS'],
  ['Presunto de parma fatiado 20 embalagens', 'b6bb98c7', 20, 'pct', 'fatiado — 20 embalagens', 'PROTEINAS'],
  ['Manteiga 1 balde', '6c564b20', 1, 'balde', '', 'MERCEARIA'],
  ['Ovos 1 cx', '7327a58c', 1, 'cx', '', 'MERCEARIA'],
  ['Batata para fritar corte fino ou air friyer 3 cxs', '7e012a19', 3, 'cx', 'corte fino ou para air fryer — caixas fechadas', 'MERCEARIA'],
  ['Tapioca compra 2 kg', 'e01cf3ae', 2, 'kg', '', 'MERCEARIA'],
  ['Farinha de trigo Tradicional 1 fardo', '002ace18', 1, 'fardo', 'tradicional', 'MERCEARIA'],
  ['Farinha de panko Alpha ou Romariz 5 cxs', '0a51f623', 5, 'cx', 'marca Alpha ou Romariz', 'MERCEARIA'],
  ['Macarrão para almoço compra 1 fardo', '807c85d6', 1, 'fardo', 'para o almoço', 'MERCEARIA'],
  ['Feijão compra 1 fardo', '8d532014', 1, 'fardo', '', 'MERCEARIA'],
  ['Vinagre Minhoto 1 cx fechada', '9e831cbc', 1, 'cx', 'marca Minhoto — caixa fechada', 'MERCEARIA'],
  ['Azeite Misto 5litros cx com 4', '9cc3f686', 1, 'cx', 'galão de 5 litros — caixa com 4', 'MERCEARIA'],
  ['Shoyu Mitsua compra 1 de 5 litros', '11182722', 1, 'un', 'Mitsuwa — galão de 5 litros', 'MERCEARIA'],
  ['Pettit gatteau de doce de leite 20 un', '141aabdf', 20, 'un', '', 'MERCEARIA'],
  ['Gordura Vegetal / óleo de algodão (Banha para fritadeira) 02', 'afb852ea', 2, 'balde', 'gordura vegetal ou óleo de algodão — para a fritadeira', 'MERCEARIA'],
  ['Maionese Helmans embalagens food service 3', 'c3e4c0ba', 3, 'balde', "Hellmann's food service", 'MERCEARIA'],
  ['Leite Ninho Integral 2kg', '368561c6', 2, 'kg', 'Ninho integral', 'MERCEARIA'],
  ['Fetuttine Petibom 1 fardo', '145db72a', 1, 'fardo', 'Petybon', 'MERCEARIA'],
  ['Mel de abelha 02 litros', 'b3c994fc', 2, 'l', '', 'MERCEARIA'],
  ['Colorau marata 1 fardo', 'colorau', 1, 'fardo', 'Maratá', 'MERCEARIA'],
  ['Melaço de cana 04', 'melaco', 4, 'un', '', 'MERCEARIA'],
  ['Gergelim branco 1kg', 'a691cb0a', 1, 'kg', '', 'MERCEARIA'],
  ['Gergelim preto 1 kg', 'gergelimPreto', 1, 'kg', '', 'MERCEARIA'],
  ['Sal fino 1 fardo', 'e0ce5f85', 1, 'fardo', '', 'MERCEARIA'],
  ['Sal grosso 3 fardo', 'dc95a7bc', 3, 'fardo', '', 'MERCEARIA'],
  ['Sal sachê', 'salSache', 1, 'cx', CONFIRMAR, 'MERCEARIA'],
  ['Açúcar 1 fardo', '276365f4', 1, 'fardo', '', 'MERCEARIA'],
  ['Calda de chocolate 02', 'a324c3a4', 2, 'un', '', 'MERCEARIA'],
  ['Leite condensado 1 fardo', '60fb28e0', 1, 'fardo', '', 'MERCEARIA'],
  ['Detergente neutro 2cxs', '47b03874', 2, 'cx', '', 'LIMPEZA'],
  ['Bombril 20 un', '6a0404f8', 20, 'un', 'Bombril', 'LIMPEZA'],
  ['Bucha para lavar pratos 50', '5dc3062b', 50, 'un', 'para lavar pratos', 'LIMPEZA'],
  ['Saco de pesar 2 kg', '9982ce60', 2, 'kg', '', 'LIMPEZA'],
  ['Canudo com mexedor biodegradável 1 cx', 'canudoMex', 1, 'cx', 'biodegradável', 'LIMPEZA'],
];

(async () => {
  console.log(COMMIT ? '=== COMMIT ===' : '=== DRY-RUN ===');
  const [ja] = await sql`SELECT id FROM lista_compra WHERE filial_id=${F} AND data=${DATA} AND origem='LISTA_COZINHA'`;
  if (ja) { console.log('Lista de', DATA, 'já existe:', ja.id); await sql.end(); return; }

  const ids = {};
  for (const [k, c] of Object.entries(CRIAR)) {
    const [ex] = await sql`SELECT id FROM produto WHERE filial_id=${F} AND lower(nome)=lower(${c.nome}) AND descontinuado IS NOT TRUE LIMIT 1`;
    if (ex) { ids[k] = ex.id; console.log(`  já existe: ${c.nome}`); continue; }
    if (COMMIT) {
      const [r] = await sql`INSERT INTO produto (filial_id, nome, tipo, unidade_estoque, controla_estoque, categoria_compras, criado_na_nuvem)
        VALUES (${F}, ${c.nome}, 'INSUMO', ${c.unidade}, true, ${c.cat}, true) RETURNING id`;
      ids[k] = r.id; console.log(`  🆕 criado: ${c.nome}`);
    } else { ids[k] = null; console.log(`  🆕 criaria: ${c.nome} (${c.unidade}, ${c.cat})`); }
  }
  for (const [pre, cat] of Object.entries(CATEGORIZAR)) {
    if (COMMIT) await sql`UPDATE produto SET categoria_compras=${cat}, controla_estoque=true WHERE filial_id=${F} AND id::text LIKE ${pre + '%'} AND categoria_compras IS NULL`;
    console.log(`  categoria → ${cat}: ${pre}`);
  }

  const linhas = [];
  for (const [i, [texto, ref, qtd, un, obs, grupo]] of ITENS.entries()) {
    let pid = ids[ref];
    if (pid === undefined) {
      const r = await sql`SELECT id, nome FROM produto WHERE filial_id=${F} AND id::text LIKE ${ref + '%'}`;
      if (r.length !== 1) { console.log('❌ produto', ref, r.length); process.exit(1); }
      pid = r[0].id;
      console.log(`  ${grupo.padEnd(10)} ${String(qtd).padStart(4)} ${un.padEnd(7)} ${r[0].nome.padEnd(34)} ← ${texto}`);
    } else console.log(`  ${grupo.padEnd(10)} ${String(qtd).padStart(4)} ${un.padEnd(7)} ${CRIAR[ref].nome.padEnd(34)} ← ${texto}`);
    linhas.push({ texto, pid, qtd, un, obs: obs || null, grupo, ordem: i + 1 });
  }
  if (!COMMIT) { console.log(`\n${linhas.length} itens. Rode com --commit.`); await sql.end(); return; }

  const [lista] = await sql`INSERT INTO lista_compra (filial_id, data, titulo, origem, status)
    VALUES (${F}, ${DATA}, 'Lista da cozinha de 14/10', 'LISTA_COZINHA', 'ABERTA') RETURNING id`;
  for (const l of linhas) await sql`INSERT INTO lista_compra_item (lista_id, produto_id, texto_original, quantidade, unidade, observacao, grupo, ordem)
    VALUES (${lista.id}, ${l.pid}, ${l.texto}, ${String(l.qtd)}, ${l.un}, ${l.obs}, ${l.grupo}, ${l.ordem})`;
  console.log(`\nlista_compra ${lista.id} — ${linhas.length} itens`);
  await sql.end();
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });

// DRY-RUN: casa os itens da lista da Márcia com produtos da filial 0001.
// Só leitura. Não grava nada.
const postgres = require('postgres');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });
const FILIAL = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';

// [rótulo, qtd, unidade desejada, [palavras-chave ILIKE (todas precisam bater)]]
const ITENS = [
  ['Filé de peixe', 40, 'kg', ['file', 'peixe']],
  ['Peixe Vermelha inteiro', 20, 'un', ['vermelha']],
  ['Lagosta', 40, 'kg', ['lagosta']],
  ['Camarão 16/20 VG', 1, 'cx', ['camar', '16']],
  ['Camarão 41/50 Maris', 1, 'cx', ['camar', '41']],
  ['Camarão 31/40 rosa', 1, 'cx', ['camar', '31']],
  ['Camarão da moqueca', 1, 'cx', ['camar']],
  ['Salmão', 3, 'un', ['salmao']],
  ['Sururu verdadeiro', 5, 'kg', ['sururu']],
  ['Catado de aratu', 5, 'kg', ['aratu']],
  ['Catado de caranguejo', 5, 'kg', ['caranguejo']],
  ['Patinha de caranguejo', 5, 'kg', ['patinha']],
  ['Catado de siri', 5, 'kg', ['siri']],
  ['Filé mignon', 40, 'kg', ['mignon']],
  ['Picanha Cara Preta', 10, 'kg', ['picanha']],
  ['Acém (almoço)', 20, 'kg', ['acem']],
  ['Coxa e sobrecoxa', 1, 'cx', ['sobrecoxa']],
  ['Frango inteiro', 1, 'cx', ['frango', 'inteiro']],
  ['Charque lagarto', 10, 'kg', ['charque']],
  ['Linguiça Cara Preta', 1, 'cx', ['linguica']],
  ['Calabresa', 10, 'kg', ['calabresa']],
  ['Toscana', 10, 'kg', ['toscana']],
  ['Salsicha', 15, 'kg', ['salsicha']],
  ['Presunto de Parma', 1, 'un', ['parma']],
  ['Parmesão Frederic', 1, 'un', ['parmesao']],
  ['Queijo coalho pré-cozido', 4, 'un', ['coalho']],
  ['Burrata', 1, 'un', ['burrata']],
  ['Creme de leite', 3, 'cx', ['creme', 'leite']],
  ['Leite (caixa)', 1, 'cx', ['leite']],
  ['Leite em pó', 2, 'un', ['leite', 'po']],
  ['Manteiga trufada', 1, 'un', ['manteiga']],
  ['Shiitake', 10, 'un', ['sh', 'take']],
  ['Shimeji', 10, 'un', ['shimeji']],
  ['Brócolis', 2, 'un', ['brocolis']],
  ['Farinha de trigo', 1, 'un', ['farinha', 'trigo']],
  ['Flocão de milho', 1, 'un', ['floc']],
  ['Fettuccine', 1, 'un', ['fettuc']],
  ['Shoyu', 1, 'un', ['shoyu']],
  ['Azeite grande 5L', 1, 'cx', ['azeite']],
  ['Vinagre', 1, 'cx', ['vinagre']],
  ['Gordura vegetal/óleo algodão', 7, 'un', ['gordura']],
  ['Noz moscada', 1, 'un', ['noz', 'moscada']],
  ['Detergente neutro', 3, 'cx', ['detergente']],
  ['Saco de lixo 100L', 1, 'un', ['saco', 'lixo']],
  ['Touca descartável', 1, 'un', ['touca']],
  ['Pano de prato', 10, 'un', ['pano']],
];

(async () => {
  const [{ count }] = await sql`SELECT count(*)::int FROM produto WHERE filial_id=${FILIAL}`;
  console.log('produtos na 0001:', count, '\n');
  let ok = 0, amb = 0, none = 0;
  for (const [rotulo, qtd, uni, kws] of ITENS) {
    const conds = kws.map(k => `nome ILIKE '%${k}%'`).join(' AND ');
    const rows = await sql.unsafe(
      `SELECT id, nome, unidade_estoque, descontinuado, estoque_atual, tipo
       FROM produto
       WHERE filial_id='${FILIAL}' AND nome IS NOT NULL AND (${conds})
         AND tipo IN ('INSUMO','VENDA_SIMPLES')
         AND descontinuado IS NOT TRUE
       ORDER BY (tipo='INSUMO') DESC, length(nome) ASC
       LIMIT 4`);
    const ativos = rows.filter(r => r.descontinuado !== true);
    let tag;
    if (rows.length === 0) { tag = '❌ SEM MATCH'; none++; }
    else if (ativos.length === 1 || (rows.length === 1)) { tag = '✅'; ok++; }
    else { tag = '⚠️  vários'; amb++; }
    console.log(`${tag}  ${rotulo}  (${qtd} ${uni})`);
    for (const r of rows.slice(0, 3)) {
      console.log(`       ${(r.tipo || '').padEnd(13)} [${r.unidade_estoque}] ${r.nome}`);
    }
    if (rows.length === 0) console.log(`       (kw: ${kws.join(' + ')})`);
  }
  console.log(`\nresumo: ${ok} ok · ${amb} ambíguos · ${none} sem match · de ${ITENS.length}`);
  await sql.end();
})().catch(e => { console.error(e.message); process.exit(1); });

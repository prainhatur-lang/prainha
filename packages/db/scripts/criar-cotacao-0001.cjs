// Cria a cotação de compras da Prainha 0001 com a lista da Márcia.
// - Cria insumos que faltam (tipo INSUMO, criado_na_nuvem).
// - Casa o resto com produto existente (find exato por nome).
// - Cria cotação ABERTA (senão o link de teste não abre) convocando SÓ o
//   número de teste do dono — nenhum fornecedor real é convocado.
// Roda seco por padrão; passa --commit pra gravar.
const postgres = require('postgres');
const crypto = require('node:crypto');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });

const FILIAL = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const COMMIT = process.argv.includes('--commit');
const TESTE_FONE = '79999724554';
const TESTE_NOME = 'TESTE — meu celular (cotação)';
const DURACAO_H = 24;

// find: casa produto existente por nome exato. create: cria insumo novo.
const P = 'Proteina', R = 'Refrigeracao', H = 'Hortifruti', S = 'Estoque seco', L = 'Limpeza';
const ITENS = [
  // ---- Pescados / proteína ----
  { label: 'Filé de peixe', qty: 40, obs: '2 caixas de 20kg · confirmar espécie', create: { nome: 'Filé de peixe (posta)', unidade: 'kg', cat: P } },
  { label: 'Peixe Vermelha inteiro', qty: 20, obs: '900g a 1,1kg cada', create: { nome: 'Peixe Vermelha inteiro', unidade: 'un', cat: P } },
  { label: 'Lagosta', qty: 40, obs: 'peça não inferior a 350g', find: 'Lagosta' },
  { label: 'Camarão 16/20 VG', qty: 1, obs: '1 caixa · limpo s/ cabeça/casca/tripa · panko', create: { nome: 'Camarão 16/20 VG limpo', unidade: 'cx', cat: P } },
  { label: 'Camarão 41/50 Maris', qty: 1, obs: '1 caixa · pastel', find: 'Camarão pré cozido 41/50' },
  { label: 'Camarão 31/40 rosa', qty: 1, obs: '1 caixa · caldinho', create: { nome: 'Camarão rosa 31/40', unidade: 'cx', cat: P } },
  { label: 'Camarão da moqueca', qty: 1, obs: 'confirmar tamanho', create: { nome: 'Camarão para moqueca', unidade: 'cx', cat: P } },
  { label: 'Salmão', qty: 3, obs: '3 lâminas · fresco', find: 'FILE SALMAO' },
  { label: 'Sururu verdadeiro', qty: 5, obs: 'sem nota · recibo', create: { nome: 'Sururu verdadeiro (catado)', unidade: 'kg', cat: P } },
  { label: 'Catado de aratu', qty: 5, obs: 'sem nota · recibo', find: 'Catado de Aratu' },
  { label: 'Catado de caranguejo', qty: 5, obs: 'sem nota · recibo', find: 'Catado de Caranguejo' },
  { label: 'Patinha de caranguejo', qty: 5, obs: 'sem nota · recibo', create: { nome: 'Patinha de caranguejo', unidade: 'kg', cat: P } },
  { label: 'Catado de siri', qty: 5, obs: 'sem nota · recibo', create: { nome: 'Catado de siri', unidade: 'kg', cat: P } },
  { label: 'Filé mignon', qty: 40, obs: 'em lâmina', find: 'Filé mignon sem cordão' },
  { label: 'Picanha Cara Preta', qty: 10, obs: 'ou Black Angus (Megga)', create: { nome: 'Picanha Cara Preta', unidade: 'kg', cat: P } },
  { label: 'Acém', qty: 20, obs: 'carne p/ almoço', create: { nome: 'Acém', unidade: 'kg', cat: P } },
  { label: 'Coxa e sobrecoxa', qty: 1, obs: '1 caixa', create: { nome: 'Coxa e sobrecoxa', unidade: 'cx', cat: P } },
  { label: 'Frango inteiro', qty: 1, obs: '1 caixa', create: { nome: 'Frango inteiro', unidade: 'cx', cat: P } },
  { label: 'Charque lagarto', qty: 10, obs: 'lagarto · melhor que 2 pelos', find: 'Charque' },
  { label: 'Linguiça Cara Preta', qty: 1, obs: '1 caixinha (Asa Branca)', create: { nome: 'Linguiça Cara Preta', unidade: 'cx', cat: P } },
  { label: 'Calabresa', qty: 10, obs: '10 kg', find: 'Linguica calabresa' },
  { label: 'Toscana', qty: 10, obs: '10 kg', find: 'Linguiça Toscana' },
  { label: 'Salsicha', qty: 15, obs: '15 kg', find: 'salsicha' },
  { label: 'Presunto de Parma', qty: 1, obs: 'confirmar quantidade', find: 'Presunto de parma' },
  // ---- Laticínios ----
  { label: 'Parmesão Frederic', qty: 1, obs: 'marca Frederic · 1 peça', find: 'QUEIJO PARMESAO PECA GRAN MESTRI' },
  { label: 'Queijo coalho pré-cozido', qty: 4, obs: '4 peças', find: 'Queijo coalho pré-cozido' },
  { label: 'Creme de leite', qty: 3, obs: '3 caixas · Leco/Vigor', find: 'Creme de leite Leco' },
  { label: 'Leite (caixa)', qty: 1, obs: '1 caixa fechada · Natville', find: 'Leite' },
  { label: 'Leite em pó', qty: 2, obs: '2 pacotes · La Serenissima', create: { nome: 'Leite em pó', unidade: 'un', cat: R } },
  { label: 'Manteiga trufada', qty: 1, obs: 'confirmar marca', create: { nome: 'Manteiga trufada', unidade: 'kg', cat: R } },
  // ---- Cogumelos / hortifrúti ----
  { label: 'Shiitake', qty: 10, obs: '10 bandejas 200g', find: 'Shitake' },
  { label: 'Shimeji', qty: 10, obs: '10 bandejas 200g', find: 'Shimeji' },
  { label: 'Brócolis', qty: 2, obs: '2 pacotes 2kg', create: { nome: 'Brócolis congelado', unidade: 'un', cat: H } },
  // ---- Mercearia / estoque seco ----
  { label: 'Farinha de trigo', qty: 1, obs: '1 fardo', find: 'Farinha de Trigo' },
  { label: 'Flocão de milho', qty: 1, obs: '1 fardo', create: { nome: 'Flocão de milho', unidade: 'un', cat: S } },
  { label: 'Shoyu', qty: 1, obs: '5L · tem 4 pequenos', find: 'shoyu' },
  { label: 'Azeite grande 5L', qty: 1, obs: '1 caixa · Albero/Viseu · tem 1', create: { nome: 'Azeite 5L (Albero/Viseu)', unidade: 'cx', cat: S } },
  { label: 'Azeite trufado (burrata)', qty: 2, obs: 'finalização da burrata', create: { nome: 'Azeite trufado', unidade: 'un', cat: S } },
  { label: 'Vinagre', qty: 1, obs: '1 caixa · Caricia', create: { nome: 'Vinagre álcool', unidade: 'cx', cat: S } },
  { label: 'Gordura vegetal', qty: 7, obs: 'ou óleo de algodão (mais barato)', find: 'Gordura vegetal' },
  { label: 'Noz moscada', qty: 1, obs: 'confirmar', create: { nome: 'Noz moscada', unidade: 'un', cat: S } },
  // ---- Limpeza / descartáveis ----
  { label: 'Detergente neutro', qty: 3, obs: 'sempre neutro · Polial', create: { nome: 'Detergente neutro', unidade: 'cx', cat: L } },
  { label: 'Saco de lixo 100L', qty: 1, obs: 'confirmar qtd', create: { nome: 'Saco de lixo 100L', unidade: 'un', cat: L } },
  { label: 'Touca descartável', qty: 1, obs: 'confirmar qtd', create: { nome: 'Touca descartável', unidade: 'un', cat: L } },
  { label: 'Pano de prato', qty: 10, obs: '10 un', create: { nome: 'Pano de prato', unidade: 'un', cat: L } },
];

async function findProduto(nome) {
  const rows = await sql`
    SELECT id, unidade_estoque FROM produto
    WHERE filial_id=${FILIAL} AND lower(nome)=lower(${nome})
      AND tipo IN ('INSUMO','VENDA_SIMPLES') AND descontinuado IS NOT TRUE
    ORDER BY (tipo='INSUMO') DESC, length(nome) ASC LIMIT 1`;
  return rows[0] || null;
}

(async () => {
  console.log(COMMIT ? '=== COMMIT ===\n' : '=== DRY-RUN (sem gravar) ===\n');

  // 1) Resolve cada item -> produtoId (find) ou plano de create
  const plano = [];
  let erros = 0, nCreate = 0, nFind = 0;
  for (const it of ITENS) {
    if (it.find) {
      const p = await findProduto(it.find);
      if (!p) { console.log('❌ FIND falhou:', it.label, '->', it.find); erros++; continue; }
      plano.push({ ...it, produtoId: p.id, unidade: p.unidade_estoque, acao: 'usa' });
      nFind++;
    } else {
      plano.push({ ...it, produtoId: null, unidade: it.create.unidade, acao: 'CRIA' });
      nCreate++;
    }
  }
  console.log(`itens: ${plano.length} · usa existente: ${nFind} · cria insumo: ${nCreate} · erros: ${erros}\n`);
  for (const p of plano) {
    console.log(`  ${p.acao === 'CRIA' ? '🆕' : '  '} ${p.label.padEnd(26)} ${String(p.qty).padStart(3)} ${p.unidade.padEnd(3)} ${p.acao === 'CRIA' ? '→ ' + p.create.nome : ''}`);
  }
  if (erros) { console.log('\n⚠️  Corrige os FIND antes de --commit.'); await sql.end(); process.exit(1); }

  if (!COMMIT) {
    console.log(`\n(seco) convocaria SÓ o teste: ${TESTE_NOME} / ${TESTE_FONE}`);
    console.log('rode com --commit pra gravar.');
    await sql.end(); return;
  }

  // 2) Cria insumos que faltam
  for (const p of plano) {
    if (p.acao !== 'CRIA') continue;
    const [row] = await sql`
      INSERT INTO produto (filial_id, nome, tipo, unidade_estoque, controla_estoque, categoria_compras, criado_na_nuvem)
      VALUES (${FILIAL}, ${p.create.nome}, 'INSUMO', ${p.create.unidade}, true, ${p.create.cat}, true)
      RETURNING id`;
    p.produtoId = row.id;
  }
  console.log(`✔ ${nCreate} insumos criados`);

  // 3) Fornecedor de teste (idempotente por nome)
  let [forn] = await sql`SELECT id FROM fornecedor WHERE filial_id=${FILIAL} AND nome=${TESTE_NOME} LIMIT 1`;
  if (!forn) {
    [forn] = await sql`
      INSERT INTO fornecedor (filial_id, nome, fone_principal, ativo_compras, categoria_compras)
      VALUES (${FILIAL}, ${TESTE_NOME}, ${TESTE_FONE}, true, 'Teste')
      RETURNING id`;
    console.log('✔ fornecedor de teste criado');
  } else {
    await sql`UPDATE fornecedor SET fone_principal=${TESTE_FONE}, ativo_compras=true WHERE id=${forn.id}`;
    console.log('✔ fornecedor de teste já existia (fone atualizado)');
  }

  // 4) Cabeçalho da cotação (ABERTA, numero sequencial)
  const [{ ultimo }] = await sql`SELECT max(numero) ultimo FROM cotacao WHERE filial_id=${FILIAL}`;
  const numero = (ultimo ?? 0) + 1;
  const agora = new Date();
  const fechaEm = new Date(agora.getTime() + DURACAO_H * 3600 * 1000);
  const [cot] = await sql`
    INSERT INTO cotacao (filial_id, numero, status, aberta_em, fecha_em, duracao_horas, observacao)
    VALUES (${FILIAL}, ${numero}, 'ABERTA', ${agora}, ${fechaEm}, ${DURACAO_H}, ${'Lista da Márcia — teste de fluxo'})
    RETURNING id, numero`;
  console.log(`✔ cotação #${cot.numero} criada (ABERTA, ${DURACAO_H}h)`);

  // 5) Itens (snapshot de marcas aceitas por produto)
  for (const p of plano) {
    const marcas = await sql`
      SELECT m.nome FROM produto_marca_aceita pma
      JOIN marca m ON m.id = pma.marca_id
      WHERE pma.filial_id=${FILIAL} AND pma.produto_id=${p.produtoId}`;
    const csv = marcas.map(x => x.nome).join('|') || null;
    await sql`
      INSERT INTO cotacao_item (cotacao_id, produto_id, quantidade, unidade, marcas_aceitas, observacao)
      VALUES (${cot.id}, ${p.produtoId}, ${String(p.qty)}, ${p.unidade}, ${csv}, ${p.obs || null})`;
  }
  console.log(`✔ ${plano.length} itens inseridos`);

  // 6) Convoca só o teste
  const token = 'cot_' + crypto.randomBytes(32).toString('base64url');
  await sql`
    INSERT INTO cotacao_fornecedor (cotacao_id, fornecedor_id, token_publico, status)
    VALUES (${cot.id}, ${forn.id}, ${token}, 'PENDENTE')`;
  console.log('✔ teste convocado');

  console.log(`\n🎯 Cotação #${cot.numero}`);
  console.log(`   app:       /cotacao/${cot.id}`);
  console.log(`   preencher: /cotacao/preencher/${token}`);
  await sql.end();
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

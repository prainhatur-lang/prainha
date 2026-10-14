// Junta a cotação 32 (limpeza e descartáveis) na 31 (mercearia) — Prainha Bar, 14/10/2026.
// Pedido do dono: separado, a Saraiva podia ganhar pouca coisa numa e não bater
// o pedido mínimo; "coloca tudo para todos e cada um responde o que tem".
// Os itens da 32 entram na 31, os fornecedores da 32 que não estavam na 31
// entram nela (token novo, convite NÃO enviado) e a 32 é cancelada.
// Aborta se alguém já respondeu a 32. Uso: node scripts/juntar-cotacoes-31-32.cjs [--commit]
const postgres = require('postgres');
const crypto = require('crypto');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });
const F = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const COMMIT = process.argv.includes('--commit');
(async () => {
  const [c31] = await sql`SELECT id, status, observacao FROM cotacao WHERE filial_id=${F} AND numero=31`;
  const [c32] = await sql`SELECT id, status FROM cotacao WHERE filial_id=${F} AND numero=32`;
  if (c31.status !== 'ABERTA' || c32.status !== 'ABERTA') throw new Error('31/32 não estão ABERTAS');
  const [{ resp }] = await sql`SELECT count(*)::int resp FROM cotacao_fornecedor WHERE cotacao_id=${c32.id} AND respondido_em IS NOT NULL`;
  const [{ respostas }] = await sql`SELECT count(*)::int respostas FROM cotacao_resposta WHERE cotacao_id=${c32.id}`.catch(() => [{ respostas: 0 }]);
  if (resp || respostas) throw new Error('alguém já respondeu a 32 — juntar na mão');
  const itens = await sql`SELECT ci.*, p.nome FROM cotacao_item ci JOIN produto p ON p.id=ci.produto_id WHERE ci.cotacao_id=${c32.id}`;
  const ja31 = new Set((await sql`SELECT produto_id FROM cotacao_item WHERE cotacao_id=${c31.id}`).map((r) => r.produto_id));
  const forn = await sql`SELECT cf.fornecedor_id, f.nome FROM cotacao_fornecedor cf JOIN fornecedor f ON f.id=cf.fornecedor_id
    WHERE cf.cotacao_id=${c32.id} AND cf.fornecedor_id NOT IN (SELECT fornecedor_id FROM cotacao_fornecedor WHERE cotacao_id=${c31.id})`;
  console.log('itens que entram na 31:', itens.filter((i) => !ja31.has(i.produto_id)).map((i) => i.nome).join(', '));
  console.log('fornecedores que entram na 31:', forn.map((f) => f.nome).join(', '));
  if (!COMMIT) return console.log('(simulação — rode com --commit)');
  await sql.begin(async (tx) => {
    for (const i of itens) {
      if (ja31.has(i.produto_id)) continue;
      await tx`INSERT INTO cotacao_item (cotacao_id, produto_id, quantidade, unidade, descricao, marcas_aceitas, observacao, embalagem_esperada, classificacao)
        VALUES (${c31.id}, ${i.produto_id}, ${i.quantidade}, ${i.unidade}, ${i.descricao}, ${i.marcas_aceitas}, ${i.observacao}, ${i.embalagem_esperada}, ${i.classificacao})`;
    }
    for (const f of forn)
      await tx`INSERT INTO cotacao_fornecedor (cotacao_id, fornecedor_id, token_publico, status)
        VALUES (${c31.id}, ${f.fornecedor_id}, ${'cot_' + crypto.randomBytes(32).toString('base64url')}, 'PENDENTE')`;
    await tx`UPDATE lista_compra_item SET cotacao_id=${c31.id} WHERE cotacao_id=${c32.id}`;
    await tx`UPDATE cotacao SET observacao=${c31.observacao.replace(/^MERCEARIA, CONGELADOS E CONFEITARIA/, 'MERCEARIA, CONGELADOS, CONFEITARIA, LIMPEZA E DESCARTÁVEIS')} WHERE id=${c31.id}`;
    await tx`UPDATE cotacao SET status='CANCELADA' WHERE id=${c32.id}`;
  });
  console.log('feito: 32 cancelada, tudo na 31');
})().finally(() => sql.end());

// Cria as cotações (1 por grupo) da Lista da semana de 14/10 — Prainha Bar.
// Mesmo que o botão "Gerar cotação deste grupo" da tela /compras/sugestao/semana:
// fornecedores da última cotação do grupo (dedupe por número), itens marcados
// com a cotação, lista vira COTADA. NÃO envia convite. Dry-run; --commit grava.
const postgres = require('postgres');
const crypto = require('crypto');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });
const F = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const LISTA = '10dbd4f7-69a8-416e-90ba-ce8c5e3180a8';
const COMMIT = process.argv.includes('--commit');
const DURACAO_H = 24;
const GRUPOS = {
  PROTEINAS: { ref: 'PROTEÍNAS%', obs: 'PROTEÍNAS, PESCADOS E FRIOS — lista da cozinha de 14/10. Preço FINAL com entrega e impostos.' },
  MERCEARIA: { ref: 'MERCEARIA%', obs: 'MERCEARIA, CONGELADOS E CONFEITARIA — lista da cozinha de 14/10. Preço FINAL com impostos e frete. Respeitar as marcas indicadas em cada item.' },
  LIMPEZA: { ref: 'LIMPEZA%', obs: 'LIMPEZA E DESCARTÁVEIS — lista da cozinha de 14/10. Preço FINAL com entrega.' },
};
const foneSql = (fid) => sql`COALESCE(
  (SELECT v.whatsapp FROM vendedor_fornecedor vf JOIN vendedor v ON v.id=vf.vendedor_id
    WHERE vf.fornecedor_id=${fid} AND v.ativo AND COALESCE(v.whatsapp,'')<>'' ORDER BY vf.principal DESC, v.atualizado_em DESC LIMIT 1),
  NULLIF(f.fone_whatsapp,''), NULLIF(f.fone_principal,''))`;
// Nota interna da lista (estoque, "confirmar") não vai pro fornecedor.
const obsFornecedor = (o) => (o || '').replace(/tem \d+ unidades em estoque — /, '').replace(/ ?—? ?quantidade não informada na lista — confirmar/, '').trim() || null;
const norm = (v) => { if (!v) return null; let d = v.replace(/\D/g, ''); if (d.length < 10) return null; if (d.length <= 11) d = '55' + d; return d; };

(async () => {
  console.log(COMMIT ? '=== COMMIT ===' : '=== DRY-RUN ===');
  const resumo = [];
  for (const [g, C] of Object.entries(GRUPOS)) {
    const itens = await sql`SELECT li.id, li.produto_id, li.quantidade::text q, li.unidade, li.observacao, p.nome, p.descricao_compra
      FROM lista_compra_item li JOIN produto p ON p.id=li.produto_id
      WHERE li.lista_id=${LISTA} AND li.grupo=${g} AND li.cotacao_id IS NULL ORDER BY li.ordem`;
    if (!itens.length) { console.log(`\n${g}: nada a cotar`); continue; }
    const [ult] = await sql`SELECT id, numero FROM cotacao WHERE filial_id=${F} AND observacao ILIKE ${C.ref} AND observacao ILIKE '%lista da cozinha%' ORDER BY aberta_em DESC LIMIT 1`;
    const forns = await sql`SELECT f.id, f.nome, f.ativo_compras, f.data_delete, ${sql`x.fone`} fone FROM cotacao_fornecedor cf JOIN fornecedor f ON f.id=cf.fornecedor_id
      CROSS JOIN LATERAL (SELECT ${foneSql(sql`f.id`)} fone) x WHERE cf.cotacao_id=${ult.id} ORDER BY f.nome`;
    console.log(`\n${g} — ${itens.length} itens · fornecedores da cotação nº ${ult.numero}:`);
    for (const i of itens) console.log(`   ${Number(i.q)} ${i.unidade} ${i.nome}${obsFornecedor(i.observacao) ? ' — ' + obsFornecedor(i.observacao) : ''}`);
    const vistos = new Map(); const conv = [];
    for (const f of forns) {
      if (f.data_delete) { console.log(`  ⏭  ${f.nome} — excluído`); continue; }
      const tel = norm(f.fone);
      if (tel && vistos.has(tel)) { console.log(`  ⏭  ${f.nome} — mesmo número de ${vistos.get(tel)}`); continue; }
      if (tel) vistos.set(tel, f.nome);
      conv.push(f);
      console.log(`     ${f.nome.padEnd(45)} ${tel || '❌ SEM ZAP'}`);
    }
    if (!COMMIT) continue;
    const [{ n }] = await sql`SELECT COALESCE(MAX(numero),0)+1 n FROM cotacao WHERE filial_id=${F}`;
    const agora = new Date(); const fechaEm = new Date(agora.getTime() + DURACAO_H * 3600e3);
    const [cot] = await sql`INSERT INTO cotacao (filial_id, numero, status, aberta_em, fecha_em, duracao_horas, observacao)
      VALUES (${F}, ${n}, 'ABERTA', ${agora}, ${fechaEm}, ${DURACAO_H}, ${C.obs}) RETURNING id, numero`;
    for (const i of itens) {
      const marcas = (await sql`SELECT m.nome FROM produto_marca_aceita pma JOIN marca m ON m.id=pma.marca_id WHERE pma.filial_id=${F} AND pma.produto_id=${i.produto_id}`).map((x) => x.nome).join('|') || null;
      await sql`INSERT INTO cotacao_item (cotacao_id, produto_id, quantidade, unidade, descricao, marcas_aceitas, observacao)
        VALUES (${cot.id}, ${i.produto_id}, ${i.q}, ${i.unidade || 'un'}, ${i.descricao_compra}, ${marcas}, ${obsFornecedor(i.observacao)})`;
      await sql`UPDATE lista_compra_item SET cotacao_id=${cot.id} WHERE id=${i.id}`;
    }
    for (const f of conv) await sql`INSERT INTO cotacao_fornecedor (cotacao_id, fornecedor_id, token_publico, status)
      VALUES (${cot.id}, ${f.id}, ${'cot_' + crypto.randomBytes(32).toString('base64url')}, 'PENDENTE')`;
    resumo.push(`#${cot.numero} ${cot.id} — ${g}: ${itens.length} itens, ${conv.length} fornecedores`);
  }
  if (COMMIT) {
    const [{ faltam }] = await sql`SELECT count(*)::int faltam FROM lista_compra_item WHERE lista_id=${LISTA} AND cotacao_id IS NULL`;
    if (faltam === 0) await sql`UPDATE lista_compra SET status='COTADA' WHERE id=${LISTA}`;
    console.log('\n' + resumo.join('\n'));
  }
  await sql.end();
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });

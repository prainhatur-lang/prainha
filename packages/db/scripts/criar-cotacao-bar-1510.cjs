// Lista do bar de 15/10/2026 → 1 cotação de bebidas na filial 01,
// mesmos fornecedores da cotação 29 (08/10). Dry-run por padrão; --commit grava.
const postgres = require('postgres');
const crypto = require('node:crypto');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });

const F = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const COMMIT = process.argv.includes('--commit');
const FECHA_EM = new Date('2026-10-16T12:00:00-03:00'); // prazo padrão: meio-dia de 16/10

const CRIAR = {};

const OBS = 'BAR — destilados, licores, xaropes, vinhos e espumantes. Lista do bar de 15/10. Retorno até 12h de 16/10. Preço FINAL com impostos e entrega. Preço por garrafa; se o volume ou a safra for diferente, informar.';
const ITENS = [
  ['38c017c6-9ccc-4b2c-a60e-7c8273d30425', 2, 'un', "Buchanan's 12 anos"],
  ['ad95132b-d965-452a-ac6f-a6f42244ea64', 2, 'un', ''],
  ['a48585d0-ac48-46fd-9bf2-20d3ca49e812', 6, 'un', ''],
  ['1d3f4ffc-f765-443d-a7c3-cf908eacc352', 2, 'un', ''],
  ['5aa7bac3-e2c4-4976-9f52-0566a4831007', 6, 'un', ''],
  ['67c1e6ba-631a-493c-b15d-975bd0af3d04', 6, 'un', ''],
  ['e7eebf30', 12, 'un', ''],
  ['6d8e6dbb', 6, 'un', 'garrafa 750 ml'],
  ['1f6e1288-3e3d-4fb0-91d4-7b6fb66ed3c9', 4, 'un', 'xarope SEM álcool'],
  ['495c73e6-5a27-418c-8271-fe86a1a8a068', 6, 'un', ''],
  ['bc1e36bd-124b-488a-ae8e-06c26aaa0ea4', 2, 'un', ''],
  ['0669a300-d89e-4fc1-b87c-52acc177a557', 1, 'un', ''],
  ['f2f85de7', 2, 'un', ''],
  ['c89830d0', 2, 'un', ''],
  ['48a8ab8b', 4, 'un', 'Toro Loco Viura Sauvignon Blanc (branco)'],
  ['d7762bab', 3, 'un', 'Redwood Creek California — lista não diz a uva; cotado o Chardonnay, informar se tiver outro'],
  ['4f0f1228', 2, 'un', 'Angélica Zapata Chardonnay Alta'],
  ['853b7be5', 4, 'un', ''],
  ['067b1712-e772-4f73-bc0c-d1f1e5d71d3e', 24, 'un', ''],
  ['7923d7a0-036c-4fbf-88c8-24ad1610244b', 12, 'un', ''],
  ['9730c6a5', 12, 'un', ''],
  ['b870c3c6', 12, 'un', ''],
];
// set da cotação 19 — sem o Alex da Megga (baaa97ea)
const FORNS = ['d2411dc1-2e55-4883-8443-c57529f913f4','ce521086-a96c-4007-a33b-7cfe9dcfedda','d7cad8eb-022c-42a9-976c-10326f46e07f','1734317f-5b6f-4211-940c-80b85479e8da','b18b77bf-f0fa-40bc-96a6-b9ea93325f6f','d7a8cfec-c6f8-4b26-97d9-513e3d3739cd','7080f915-3f50-4f93-9d2a-27b01fefd582'];

const foneSql = (fid) => sql`COALESCE(
  (SELECT v.whatsapp FROM vendedor_fornecedor vf JOIN vendedor v ON v.id=vf.vendedor_id
    WHERE vf.fornecedor_id=${fid} AND v.ativo AND COALESCE(v.whatsapp,'')<>'' ORDER BY vf.principal DESC, v.atualizado_em DESC LIMIT 1),
  NULLIF(f.fone_whatsapp,''), NULLIF(f.fone_principal,''))`;
const norm = (v) => { if (!v) return null; let d = v.replace(/\D/g,''); if (d.length < 10) return null; if (d.length <= 11) d = '55'+d; return d; };

(async () => {
  console.log(COMMIT ? '=== COMMIT ===' : '=== DRY-RUN ===');
  const criados = {};
  for (const [k, c] of Object.entries(CRIAR)) {
    const [ex] = await sql`SELECT id FROM produto WHERE filial_id=${F} AND lower(nome)=lower(${c.nome}) AND descontinuado IS NOT TRUE LIMIT 1`;
    if (ex) { criados[k] = ex.id; console.log(`  já existe: ${c.nome} ${ex.id}`); continue; }
    if (COMMIT) {
      const [r] = await sql`INSERT INTO produto (filial_id, nome, tipo, unidade_estoque, controla_estoque, categoria_compras, criado_na_nuvem)
        VALUES (${F}, ${c.nome}, 'INSUMO', ${c.unidade}, true, ${c.cat}, true) RETURNING id`;
      criados[k] = r.id; console.log(`  🆕 criado: ${c.nome} ${r.id}`);
    } else { criados[k] = null; console.log(`  🆕 criaria: ${c.nome} (${c.unidade}, ${c.cat})`); }
  }

  const [{ ultimo }] = await sql`SELECT max(numero) ultimo FROM cotacao WHERE filial_id=${F}`;
  const numero = (ultimo ?? 0) + 1;
  const agora = new Date(); const fechaEm = FECHA_EM; const DURACAO_H = Math.max(1, Math.ceil((fechaEm - agora)/3600e3));
  console.log(`\n##### #${numero} ${OBS}`);
  const itens = [];
  for (const [ref, qty, un, obs] of ITENS) {
    let pid = ref.length === 36 ? ref : criados[ref];
    if (pid === undefined) { const r = await sql`SELECT id FROM produto WHERE filial_id=${F} AND id::text LIKE ${ref + '%'}`; if (r.length !== 1) { console.log('❌ prefixo', ref, r.length); process.exit(1); } pid = r[0].id; }
    const [p] = pid ? await sql`SELECT nome, descontinuado FROM produto WHERE id=${pid} AND filial_id=${F}` : [{ nome: CRIAR[ref].nome }];
    if (!p || p.descontinuado) { console.log('❌ produto não achado/descontinuado', ref); process.exit(1); }
    const marcas = pid ? (await sql`SELECT m.nome FROM produto_marca_aceita pma JOIN marca m ON m.id=pma.marca_id WHERE pma.filial_id=${F} AND pma.produto_id=${pid}`).map(x=>x.nome).join('|') || null : null;
    itens.push({ pid, qty, un, obs: obs || null, marcas });
    console.log(`  ${String(qty).padStart(3)} ${un} ${p.nome.padEnd(52)} ${obs}`);
  }
  const vistos = new Map(); const conv = [];
  console.log('  -- fornecedores:');
  for (const fid of FORNS) {
    const [f] = await sql`SELECT f.id, f.nome, ${foneSql(fid)} fone FROM fornecedor f WHERE f.id=${fid}`;
    const tel = norm(f.fone);
    if (tel && vistos.has(tel)) { console.log(`  ⏭  ${f.nome} — mesmo número de ${vistos.get(tel)} (${tel}), pulado`); continue; }
    if (tel) vistos.set(tel, f.nome);
    conv.push(f);
    console.log(`     ${f.nome.padEnd(52)} ${tel || '❌ SEM ZAP'}`);
  }
  if (COMMIT) {
    const [cot] = await sql`INSERT INTO cotacao (filial_id, numero, status, aberta_em, fecha_em, duracao_horas, observacao)
      VALUES (${F}, ${numero}, 'ABERTA', ${agora}, ${fechaEm}, ${DURACAO_H}, ${OBS}) RETURNING id, numero`;
    for (const i of itens) await sql`INSERT INTO cotacao_item (cotacao_id, produto_id, quantidade, unidade, marcas_aceitas, observacao)
      VALUES (${cot.id}, ${i.pid}, ${String(i.qty)}, ${i.un}, ${i.marcas}, ${i.obs})`;
    for (const f of conv) await sql`INSERT INTO cotacao_fornecedor (cotacao_id, fornecedor_id, token_publico, status)
      VALUES (${cot.id}, ${f.id}, ${'cot_' + crypto.randomBytes(32).toString('base64url')}, 'PENDENTE')`;
    console.log(`\n#${cot.numero} ${cot.id} — ${itens.length} itens, ${conv.length} fornecedores`);
  }
  await sql.end();
})().catch(e => { console.error('ERRO:', e); process.exit(1); });

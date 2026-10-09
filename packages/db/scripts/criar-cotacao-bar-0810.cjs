// Lista do bar (Ângela) de 08/10/2026 → 1 cotação de bebidas na filial 01,
// mesmos fornecedores da cotação 19 (10/09). Dry-run por padrão; --commit grava.
const postgres = require('postgres');
const crypto = require('node:crypto');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });

const F = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const COMMIT = process.argv.includes('--commit');
const FECHA_EM = new Date('2026-10-09T10:00:00-03:00'); // prazo do dono: 10h de 09/10

const CRIAR = {
  angostura: { nome: 'Bitter Angostura 200 ml', unidade: 'un', cat: 'Bebidas - Destilados' },
};

const OBS = 'BAR — destilados, licores, xaropes e espumantes. Lista da Ângela de 08/10. Retorno até 10h de HOJE (09/10). Preço FINAL com impostos e entrega. Preço por garrafa; se o volume for diferente do pedido, informar.';
const ITENS = [
  ['38c017c6-9ccc-4b2c-a60e-7c8273d30425', 2, 'un', 'zerado'],
  ['c26f0d8e-b884-4f1f-9f99-45cd43a23bda', 3, 'un', 'zerado'],
  ['ad95132b-d965-452a-ac6f-a6f42244ea64', 3, 'un', 'zerado'],
  ['c75aca7f-ecbb-4bfd-a01b-4f7a750c1af0', 4, 'un', 'tem 2 unidades em estoque'],
  ['a48585d0-ac48-46fd-9bf2-20d3ca49e812', 6, 'un', 'tem 2 unidades em estoque'],
  ['1d3f4ffc-f765-443d-a7c3-cf908eacc352', 6, 'un', 'zerada'],
  ['f9a2b326-6625-465e-bcf6-6c6702cc9d25', 6, 'un', 'tem 1 unidade em estoque'],
  ['5aa7bac3-e2c4-4976-9f52-0566a4831007', 6, 'un', 'zerada'],
  ['1152ea52-f416-4016-9e89-3f10b1ee4100', 2, 'un', 'tem 1 unidade em estoque'],
  ['67c1e6ba-631a-493c-b15d-975bd0af3d04', 6, 'un', 'tem 2 unidades em estoque'],
  ['aaac67c5-56b5-43df-896f-e4ad7d4cb847', 2, 'un', 'zerado'],
  ['1f6e1288-3e3d-4fb0-91d4-7b6fb66ed3c9', 2, 'un', 'xarope SEM álcool — tem 1 unidade em estoque'],
  ['495c73e6-5a27-418c-8271-fe86a1a8a068', 2, 'un', 'zerado'],
  ['24aee0f2-99cb-4c7e-ad6d-4dc60a40a3cd', 2, 'un', 'tem 1 unidade em estoque'],
  ['21b9c0d3-3267-474c-b71a-6434189318c3', 2, 'un', 'tem 1 unidade em estoque'],
  ['f10a6b79-5196-47f8-81d8-07cb5c68a4e9', 2, 'un', 'tem 1 unidade em estoque'],
  ['e0f7518a-7320-4b76-a052-2d4f8e149462', 6, 'un', 'tem 4 unidades em estoque'],
  ['bc1e36bd-124b-488a-ae8e-06c26aaa0ea4', 2, 'un', 'zerada'],
  ['cfffa0a9-3650-4ca8-a012-8a1062880771', 2, 'un', 'tem 1 unidade em estoque'],
  ['facb30b7-97d3-43ff-9400-ac99d1997e73', 2, 'un', 'vermute rosso (Martini ou Cinzano) — tem 2 unidades em estoque'],
  ['0669a300-d89e-4fc1-b87c-52acc177a557', 2, 'un', 'tem 1 unidade em estoque'],
  ['0fdb3048-3b82-4f61-99fd-ba913256d352', 2, 'un', 'tem 2 unidades em estoque'],
  ['angostura', 1, 'un', 'quantidade não informada na lista — confirmar'],
  ['d2c6ecb8-e3b9-4232-8a8c-bdd12839f83b', 6, 'un', 'zerado'],
  ['067b1712-e772-4f73-bc0c-d1f1e5d71d3e', 12, 'un', 'zerado'],
  ['f927237b-6dbf-46ac-9cf5-e71533f8cbfc', 6, 'un', 'tem 2 unidades em estoque'],
  ['7923d7a0-036c-4fbf-88c8-24ad1610244b', 12, 'un', 'tem 3 unidades em estoque'],
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
    const pid = ref.length === 36 ? ref : criados[ref];
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

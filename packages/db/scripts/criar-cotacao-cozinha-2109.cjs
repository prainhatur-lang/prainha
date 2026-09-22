// Lista da cozinha (Marcia) de 21/09/2026 → 4 cotações por categoria na filial 01,
// linkadas nos mesmos produtos/fornecedores das cotações 20–23 (16/09) e 15–18 (08/09).
// Dry-run por padrão; --commit grava.
const postgres = require('postgres');
const crypto = require('node:crypto');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });

const F = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const COMMIT = process.argv.includes('--commit');
const DURACAO_H = 24;
const CONFIRMAR = 'quantidade não informada na lista — confirmar';

// Produtos a criar (id resolvido em runtime) e a categorizar
const CRIAR = {
  bacon: { nome: 'Bacon fatiado', unidade: 'pct', cat: 'Proteína' },
  dedomoca: { nome: 'Pimenta dedo de moça', unidade: 'kg', cat: 'Hortifruti' },
  abobora: { nome: 'Abóbora', unidade: 'un', cat: 'Hortifruti' },
};
const CATEGORIZAR = {
  'ba56bf3f-99a3-4047-843e-222022fc56a7': 'Refrigeração', // QUEIJO PARMESAO PECA GRAN MESTRI
  '855735c4-e993-4358-8fb6-b33c2be801a5': 'Hortifruti',   // Pimentinha de cheiro
  'd2114c95-b274-42dc-8784-81cd8868647d': 'Hortifruti',   // Repolho
  '5e170ff5-45ef-4821-8782-83718a8e4c5b': 'Limpeza',      // Sabao em po
  '9c73668d-3c9c-48b3-9918-26b75029118f': 'Limpeza',      // Agua sanitaria
};

const COTACOES = [
  {
    obs: 'PROTEÍNAS, PESCADOS E FRIOS — lista da cozinha de 21/09. Preço FINAL com entrega e impostos. Algumas quantidades estão acima do normal porque parte vai para a loja do shopping.',
    itens: [
      ['752f1077-9e5a-4145-a5d6-d47813c0a0e0', 40, 'kg', `filé mignon — ${CONFIRMAR} (semana passada foram 40 kg)`],
      ['fdd10dfa-e011-4dc4-a079-38fd93134338', 1, 'cx', 'caixa fechada'],
      ['e6e3ed4e-2f74-4d50-b654-a7cc79ef7c6b', 2, 'cx', 'caixas fechadas — pescada amarela GG ou robalo'],
      ['c3ea4780-dfc0-42fa-b7e7-5e9c9c037902', 1, 'cx', 'caixa fechada'],
      ['45694f08-2d14-4a7f-b4fb-e3b02eac4f79', 30, 'kg', 'carne para o almoço'],
      ['8ca78bfb-7d4d-4a3e-b875-9ecc72fbb419', 1, 'cx', 'caixa fechada'],
      ['116afbbf-b84b-4cad-bee0-43333f4dfd24', 2, 'peca', '2 peças inteiras — para o molho; parte vai para o shopping'],
      ['ea1a5dbf-e631-4702-b7d0-23dd357ea2d5', 4, 'peca', '4 peças de +/- 2,5 kg. Tem 2 peças na casa — o coalho fecha os pastéis, parte vai para o shopping'],
      ['ba56bf3f-99a3-4047-843e-222022fc56a7', 2, 'peca', '2 peças inteiras'],
      ['fbdd0daa-5310-47e1-8842-0ae57e79fa8d', 20, 'un', `para os 2 restaurantes (Prainha Bar + Prainha Mar) — ${CONFIRMAR} (semana passada foram 10)`],
      ['bacon', 3, 'pct', '3 pacotes de bacon fatiado'],
      ['b24c25b3-bfc2-4d32-b582-16c300bbd9ba', 2, 'fardo', '2 fardos'],
      ['9bf6e010-3b2d-43ad-9632-78d2eabaee49', 1, 'kg', CONFIRMAR],
    ],
    // cotação 20 + Queijos Finos (gorgonzola/parmesão, veio na 15)
    forns: ['84e19ee0-d364-4f49-b7fe-f86f7ce933a6','8cd5ddbb-380d-4c22-a5e7-966c96074b88','d70c25a4-86a1-41bf-a198-6023e004f410','92b83060-c5ef-4b77-82dd-49e684090ef3','49894842-1474-44cd-ac6c-78c345dbe7c7','415b0404-925c-400c-adcb-74107676f966','51b3ff2d-b14e-47f2-bd87-0d8e2650a4d3','0c0b7b25-d88b-49b8-86d4-49f4dc2a1b9e','d661a01f-d779-4774-97be-d8b83926a04a','9873a0fe-d5f1-4ba4-af7b-2b16df62028b','de1b1acb-5bca-48ce-b46a-f26da0e6ed66','baaa97ea-e09d-43bb-a679-48e397e804b8','c98a766b-2783-4b7e-b00f-840ec9d68859','8d8a61fc-8713-443f-ab9f-a2ae626c4744','3f8c439a-8598-4477-a0c6-386d9a623ac5','1cad7aad-e6a9-4b5a-b339-4c949669b557','72ccceeb-7093-4952-9cf1-8bafcacb5640','99e0bb24-c204-407a-9ed8-fcd9668f9729'],
  },
  {
    obs: 'MERCEARIA, CONGELADOS E CONFEITARIA — lista da cozinha de 21/09. Preço FINAL com impostos e frete. A farinha para farofa (15 kg) NÃO entra nesta cotação: vai ser comprada no mercado.',
    itens: [
      ['7e012a19-a951-4373-9b6f-cf79998f6b2c', 5, 'cx', 'batata para fritar corte fino, preferência para air fryer — caixas fechadas'],
      ['766f13ab-7c34-4488-a124-7b5662305668', 2, 'pct', '2 pacotes'],
      ['2abcc1b1-84e3-4991-802c-7a2323967250', 2, 'fardo', 'tem 5 kg em estoque'],
      ['368561c6-3386-4435-a43c-c39ee2aa8078', 2, 'pct', `pacotes — ${CONFIRMAR}`],
      ['7303f92f-7a2e-4df2-a81e-a06bb45fad74', 1, 'cx', 'caixa fechada'],
      ['f92736da-53d5-49d8-8150-2db0493868db', 3, 'cx', 'creme de leite de 1 litro — caixa fechada com 12 unidades; 3 caixas (fardos)'],
      ['8e2cf3a1-8036-407d-895d-0182175e3bf1', 1, 'un', `comprar no Giro Rápido — ${CONFIRMAR}`],
      ['002ace18-d413-4c03-b8cb-387de828d0ff', 2, 'fardo', 'SEM fermento — 2 fardos'],
      ['60fb28e0-e358-4d6c-82f7-58196099c83d', 1, 'cx', 'caixa fechada com 12 unidades'],
      ['c3e4c0ba-99b4-4a28-8830-d9bd50339bcc', 2, 'balde', `para o molho rosé — tem 1 balde em estoque (Hellmann's). ${CONFIRMAR}`],
      ['afb852ea-600c-4f69-9886-b6f59abb9b70', 8, 'balde', '8 baldes'],
      ['b14c638f-2ab4-48fd-b271-84843213d1ae', 2, 'pct', 'marca Grano Duro — 2 pacotes'],
      ['145db72a-7cf6-4abb-acf4-84c22a5822a8', 1, 'pct', `tem 12 unidades em estoque (Petybon) — ${CONFIRMAR}`],
      ['1e03226e-a93e-4e65-81bf-128d67f93332', 30, 'un', '30 unidades'],
    ],
    forns: ['8cd5ddbb-380d-4c22-a5e7-966c96074b88','bc997c38-3c5e-4c45-b2af-b12427a0f414','50945e3c-27a4-40ac-aa81-23936c1413ca','e918ec75-43e0-473c-9121-55e53d182a09','1161e58b-6c4c-4cce-aa74-8b5e1a59654e','0c0b7b25-d88b-49b8-86d4-49f4dc2a1b9e','d7cad8eb-022c-42a9-976c-10326f46e07f','baaa97ea-e09d-43bb-a679-48e397e804b8','1cad7aad-e6a9-4b5a-b339-4c949669b557','b0777214-8a61-4064-af06-013b7414a157'],
  },
  {
    obs: 'HORTIFRUTI — lista da cozinha de 21/09. Qualidade: sem manchas, sem murchar. Mercadoria para ser entregue na quarta-feira (23/09), por favor.',
    itens: [
      ['62bdc888-da56-45f5-8e8d-b184d13bb387', 10, 'bandeja', '10 bandejas'],
      ['ec4afe48-53d1-41b6-9858-2556e5cb430c', 2, 'cx', ''],
      ['2f6d2a93-a4e8-4571-9acb-594e32e82fa0', 1, 'cx', 'batatinha — 1 caixa'],
      ['35b3168e-1d3e-4c32-a362-369912f3fe41', 8, 'kg', ''],
      ['01ba7c0f-b52c-47ea-94e4-bec5b2616957', 15, 'un', ''],
      ['b6ea0b4d-c072-4516-801e-87969b9127fc', 15, 'un', ''],
      ['5afcb88b-73d6-4e47-b081-8bf78791a835', 10, 'un', ''],
      ['6c6bd6fc-6753-498e-99ef-8e081726681d', 5, 'un', ''],
      ['212af670-9273-44be-9aff-f3cbfa82a65a', 3, 'un', ''],
      ['a24097fa-2acc-4e4a-b9ec-0d8c78478a56', 1, 'un', ''],
      ['a595511a-f064-4885-bb13-e624adc44f04', 5, 'un', ''],
      ['e51a1257-1cdd-4105-8cdc-c4c18a97bbda', 2, 'un', ''],
      ['dedomoca', 0.3, 'kg', '300 g'],
      ['855735c4-e993-4358-8fb6-b33c2be801a5', 1, 'un', CONFIRMAR],
      ['623af965-9a2b-47f3-98e2-2c84f98f4ed0', 100, 'un', '1 cento'],
      ['b9de5cbe-8b0f-41ec-a23e-30138e294c10', 5, 'un', ''],
      ['abobora', 0.5, 'un', 'meia abóbora'],
      ['d2114c95-b274-42dc-8784-81cd8868647d', 1, 'un', ''],
    ],
    forns: ['dc276fec-b251-441b-a670-8f1c3e5de644','49894842-1474-44cd-ac6c-78c345dbe7c7','b0777214-8a61-4064-af06-013b7414a157','4de13c83-23c9-4aea-86a6-9cf95ce205b4','f1e0caf3-7602-4b74-adc6-d64337258e7a'],
  },
  {
    obs: 'LIMPEZA E DESCARTÁVEIS — lista da cozinha de 21/09. Preço FINAL com entrega.',
    itens: [
      ['5e170ff5-45ef-4821-8782-83718a8e4c5b', 1, 'un', `o mais barato — ${CONFIRMAR}`],
      ['9c73668d-3c9c-48b3-9918-26b75029118f', 2, 'cx', '2 caixas'],
      ['afe38c8e-20e9-461a-90ce-004e8b0f54ba', 1, 'cx', 'vasilha para delivery — quantidade e modelo a confirmar'],
    ],
    forns: ['b00fb407-cc1e-4315-821b-37797e15992f','0c0b7b25-d88b-49b8-86d4-49f4dc2a1b9e','d7cad8eb-022c-42a9-976c-10326f46e07f','fc8916a0-fb9e-4125-bde3-7383fef4aade'],
  },
];

const foneSql = (fid) => sql`COALESCE(
  (SELECT v.whatsapp FROM vendedor_fornecedor vf JOIN vendedor v ON v.id=vf.vendedor_id
    WHERE vf.fornecedor_id=${fid} AND v.ativo AND COALESCE(v.whatsapp,'')<>'' ORDER BY vf.principal DESC, v.atualizado_em DESC LIMIT 1),
  NULLIF(f.fone_whatsapp,''), NULLIF(f.fone_principal,''))`;
const norm = (v) => { if (!v) return null; let d = v.replace(/\D/g,''); if (d.length < 10) return null; if (d.length <= 11) d = '55'+d; return d; };

(async () => {
  console.log(COMMIT ? '=== COMMIT ===' : '=== DRY-RUN ===');
  // 1) criar / categorizar
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
  for (const [id, cat] of Object.entries(CATEGORIZAR)) {
    if (COMMIT) await sql`UPDATE produto SET categoria_compras=${cat}, controla_estoque=true WHERE id=${id} AND categoria_compras IS NULL`;
    console.log(`  categoria → ${cat}: ${id}`);
  }

  // 2) cotações
  const [{ ultimo }] = await sql`SELECT max(numero) ultimo FROM cotacao WHERE filial_id=${F}`;
  let numero = (ultimo ?? 0);
  const agora = new Date(); const fechaEm = new Date(agora.getTime() + DURACAO_H*3600e3);
  const resumo = [];
  for (const C of COTACOES) {
    numero++;
    console.log(`\n##### #${numero} ${C.obs}`);
    // itens
    const itens = [];
    for (const [ref, qty, un, obs] of C.itens) {
      const pid = ref.length === 36 ? ref : criados[ref];
      const [p] = pid ? await sql`SELECT nome, categoria_compras, controla_estoque FROM produto WHERE id=${pid}` : [{ nome: CRIAR[ref].nome, categoria_compras: CRIAR[ref].cat, controla_estoque: true }];
      if (!p) { console.log('❌ produto não achado', ref); process.exit(1); }
      const marcas = pid ? (await sql`SELECT m.nome FROM produto_marca_aceita pma JOIN marca m ON m.id=pma.marca_id WHERE pma.filial_id=${F} AND pma.produto_id=${pid}`).map(x=>x.nome).join('|') || null : null;
      itens.push({ pid, qty, un, obs: obs || null, marcas });
      console.log(`  ${String(qty).padStart(5)} ${un.padEnd(7)} ${p.nome.padEnd(36)} ${obs}${p.categoria_compras && p.controla_estoque ? '' : '  ⚠ sem categoria/estoque'}`);
    }
    // fornecedores (dedupe por número)
    const vistos = new Map(); const conv = [];
    console.log('  -- fornecedores:');
    for (const fid of C.forns) {
      const [f] = await sql`SELECT f.id, f.nome, ${foneSql(fid)} fone FROM fornecedor f WHERE f.id=${fid}`;
      const tel = norm(f.fone);
      if (tel && vistos.has(tel)) { console.log(`  ⏭  ${f.nome} — mesmo número de ${vistos.get(tel)} (${tel}), pulado`); continue; }
      if (tel) vistos.set(tel, f.nome);
      conv.push(f);
      console.log(`     ${f.nome.padEnd(45)} ${tel || '❌ SEM ZAP'}`);
    }
    if (!COMMIT) continue;
    const [cot] = await sql`INSERT INTO cotacao (filial_id, numero, status, aberta_em, fecha_em, duracao_horas, observacao)
      VALUES (${F}, ${numero}, 'ABERTA', ${agora}, ${fechaEm}, ${DURACAO_H}, ${C.obs}) RETURNING id, numero`;
    for (const i of itens) await sql`INSERT INTO cotacao_item (cotacao_id, produto_id, quantidade, unidade, marcas_aceitas, observacao)
      VALUES (${cot.id}, ${i.pid}, ${String(i.qty)}, ${i.un}, ${i.marcas}, ${i.obs})`;
    for (const f of conv) await sql`INSERT INTO cotacao_fornecedor (cotacao_id, fornecedor_id, token_publico, status)
      VALUES (${cot.id}, ${f.id}, ${'cot_' + crypto.randomBytes(32).toString('base64url')}, 'PENDENTE')`;
    resumo.push(`#${cot.numero} ${cot.id} — ${itens.length} itens, ${conv.length} fornecedores`);
  }
  console.log('\n' + resumo.join('\n'));
  await sql.end();
})().catch(e => { console.error('ERRO:', e); process.exit(1); });

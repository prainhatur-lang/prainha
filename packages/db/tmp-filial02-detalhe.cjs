// Detalhes de config por filial pro go-live da Tabuará — temporário
const postgres = require('postgres');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });
const P = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9', T = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';
(async () => {
  const j = (x) => JSON.stringify(x, null, 1);

  console.log('== nfce_numeracao ==');
  console.log(j(await sql`SELECT n.*, f.nome FROM nfce_numeracao n JOIN filial f ON f.id=n.filial_id`));

  console.log('\n== nf_venda Tabuará por série (emissão do Consumer, espelho) ==');
  const cols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_name='nf_venda' AND table_schema='public'`).map(r => r.column_name);
  console.log('cols nf_venda:', cols.join(','));
  const numc = cols.find(c => /numero/.test(c)), serc = cols.find(c => /serie/.test(c)), datc = cols.find(c => /(emissao|data)/.test(c));
  if (numc && serc) {
    console.log(j(await sql.unsafe(`SELECT "${serc}" serie, max(("${numc}")::bigint) max_numero, count(*) qtd, max("${datc}")::text ultima
      FROM nf_venda WHERE filial_id='${T}' GROUP BY 1 ORDER BY 1`)));
    console.log('Prainha ref:', j(await sql.unsafe(`SELECT "${serc}" serie, max(("${numc}")::bigint) max_numero, max("${datc}")::text ultima
      FROM nf_venda WHERE filial_id='${P}' GROUP BY 1 ORDER BY 1`)));
  }

  console.log('\n== usuários com acesso à Tabuará ==');
  console.log(j(await sql`SELECT u.nome, u.email, uf.criado_em::text FROM usuario_filial uf JOIN usuario u ON u.id=uf.usuario_id WHERE uf.filial_id=${T}`));

  console.log('\n== reserva_config Tabuará (completo) ==');
  console.log(j(await sql`SELECT reserva_config FROM filial WHERE id=${T}`));

  console.log('\n== taxas Tabuará (ECs) ==');
  console.log(j(await sql`SELECT taxas FROM filial WHERE id=${T}`));

  console.log('\n== fiscal_config Tabuará (completo) ==');
  console.log(j(await sql`SELECT fiscal_config FROM filial WHERE id=${T}`));

  console.log('\n== whatsapp_numero (todos) ==');
  console.log(j(await sql`SELECT * FROM whatsapp_numero`));

  console.log('\n== atendimento_config (resumo) ==');
  try {
    const ac = await sql`SELECT * FROM atendimento_config`;
    for (const r of ac) console.log(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'object' && v ? Object.keys(v).join('|').slice(0, 120) : String(v).slice(0, 80)])));
  } catch (e) { console.log('ERRO', e.message); }

  console.log('\n== certificado_filial (sem dados sensíveis) ==');
  const cc = (await sql`SELECT column_name FROM information_schema.columns WHERE table_name='certificado_filial'`).map(r => r.column_name);
  console.log('cols:', cc.join(','));
  const safe = cc.filter(c => !/(senha|pfx|chave|key|cert)/i.test(c));
  console.log(j(await sql.unsafe(`SELECT ${safe.map(c => `"${c}"`).join(',')} FROM certificado_filial`)));

  console.log('\n== sincronizacao ==');
  const sc = await sql`SELECT s.*, f.nome FROM sincronizacao s JOIN filial f ON f.id=s.filial_id`;
  for (const r of sc) console.log(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(typeof v === 'object' && v ? JSON.stringify(v) : v).slice(0, 100)])));

  console.log('\n== agente_comando Tabuará (últimos 6) ==');
  const acc = (await sql`SELECT column_name FROM information_schema.columns WHERE table_name='agente_comando'`).map(r => r.column_name);
  console.log(j(await sql.unsafe(`SELECT ${acc.filter(c => !/payload|resultado/.test(c)).map(c => `"${c}"`).join(',')} FROM agente_comando WHERE filial_id='${T}' ORDER BY criado_em DESC LIMIT 6`)));

  console.log('\n== forma_pagamento_canal Tabuará ==');
  console.log(j(await sql`SELECT * FROM forma_pagamento_canal WHERE filial_id=${T}`));

  await sql.end();
})().catch(e => { console.error('FALHA:', e.message); process.exit(1); });

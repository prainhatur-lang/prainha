// Grava telefone do Gilson/Marcelino/Warley e convoca os fornecedores reais
// na cotação #4 da 0001. Convocar NÃO envia nada — só cria os links.
// Seco por padrão; --commit grava.
const postgres = require('postgres');
const crypto = require('node:crypto');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });

const FILIAL = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const COMMIT = process.argv.includes('--commit');

// Telefones novos a gravar (match por nome, ignorando *Excluído*)
const NOVOS_FONE = [
  { like: '%Mar Azul%Rio Mar%', fone: '79998255737', apelido: 'Gilson (Mar Azul/Rio Mar)' },
  { like: 'MARCELINO PESCADOS%',  fone: '71986106939', apelido: 'Marcelino' },
  { like: 'WASLEY PESCADOS%',     fone: '79998841009', apelido: 'Warley' },
];

// Reais a convocar — casa pelo fim do telefone (últimos 8 dígitos)
const ALVOS8 = [
  '99088400', // Brunior
  '98214841', // Cassio Paraíba
  '99105352', // Central de Pescados
  '81311365', // Asa Branca / Priscila
  '99871286', // Mega / Alex
  '98497536', // Rocha
  '96344044', // Amanda Mafrios
  '99573063', // Vitor
  '99147414', // Crustáceos Nordeste
  '81352123', // JLQO
  '88302001', // Genio
  '99111474', // Império
  '91595621', // Aldry
  '99501650', // JPJS
  '98355484', // Fasouto
  '98255737', // Gilson
  '86106939', // Marcelino
  '98841009', // Warley
];
const norm = s => (s || '').replace(/\D/g, '');
const last8 = s => norm(s).slice(-8);

(async () => {
  console.log(COMMIT ? '=== COMMIT ===\n' : '=== DRY-RUN ===\n');

  // cotação #4
  const [cot] = await sql`SELECT id, numero, status FROM cotacao WHERE filial_id=${FILIAL} AND numero=4`;
  if (!cot) { console.log('cotação #4 não encontrada'); await sql.end(); process.exit(1); }
  console.log(`cotação #${cot.numero} (${cot.status})  ${cot.id}\n`);

  // 1) Resolve os 3 novos por nome
  const novosIds = [];
  for (const n of NOVOS_FONE) {
    const [f] = await sql`
      SELECT id, nome, fone_principal FROM fornecedor
      WHERE filial_id=${FILIAL} AND nome ILIKE ${n.like} AND nome NOT ILIKE '%Excluído%' AND nome NOT ILIKE '%Excluido%'
      ORDER BY length(nome) ASC LIMIT 1`;
    if (!f) { console.log(`⚠️  não achei cadastro pra ${n.apelido} (${n.like})`); continue; }
    console.log(`fone → ${n.apelido}: ${f.nome}  [${f.fone_principal || 'vazio'} ⇒ ${n.fone}]`);
    if (COMMIT) await sql`UPDATE fornecedor SET fone_principal=${n.fone}, ativo_compras=true WHERE id=${f.id}`;
    novosIds.push(f.id);
  }

  // 2) Candidatos por fim de telefone + os 3 por id, dedup por id e por telefone
  const comFone = await sql`
    SELECT id, nome, fone_principal, ativo_compras FROM fornecedor
    WHERE filial_id=${FILIAL} AND fone_principal IS NOT NULL
      AND nome NOT ILIKE '%Excluído%' AND nome NOT ILIKE '%Excluido%'`;
  const cand = new Map(); // id -> {nome, fone}
  for (const f of comFone) if (ALVOS8.includes(last8(f.fone_principal))) cand.set(f.id, f);
  for (const id of novosIds) if (!cand.has(id)) {
    const [f] = await sql`SELECT id, nome, fone_principal FROM fornecedor WHERE id=${id}`;
    cand.set(id, f);
  }
  // dedup por telefone (mesmo número em 2 cadastros → 1 só)
  const porFone = new Map();
  for (const f of cand.values()) {
    const k = last8(f.fone_principal) || f.id;
    if (!porFone.has(k)) porFone.set(k, f);
  }
  const finais = [...porFone.values()];

  // já convocados?
  const jaConv = new Set(
    (await sql`SELECT fornecedor_id FROM cotacao_fornecedor WHERE cotacao_id=${cot.id}`)
      .map(r => r.fornecedor_id));

  console.log(`\nconvocaria ${finais.filter(f => !jaConv.has(f.id)).length} (de ${finais.length} candidatos):`);
  for (const f of finais) {
    const tag = jaConv.has(f.id) ? '· já convocado' : '';
    console.log(`   ${(f.fone_principal || '—').padEnd(16)} ${f.nome}  ${tag}`);
  }

  if (!COMMIT) { console.log('\nrode com --commit pra gravar.'); await sql.end(); return; }

  let n = 0;
  for (const f of finais) {
    if (jaConv.has(f.id)) continue;
    const token = 'cot_' + crypto.randomBytes(32).toString('base64url');
    await sql`INSERT INTO cotacao_fornecedor (cotacao_id, fornecedor_id, token_publico, status)
      VALUES (${cot.id}, ${f.id}, ${token}, 'PENDENTE')
      ON CONFLICT (cotacao_id, fornecedor_id) DO NOTHING`;
    n++;
  }
  console.log(`\n✔ ${n} fornecedores convocados na #${cot.numero}`);
  console.log(`   abra: /cotacao/${cot.id} e toque "Enviar pra todos no WhatsApp"`);
  await sql.end();
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

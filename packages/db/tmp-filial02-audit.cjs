// Auditoria: o que a filial 01 (Prainha Bar) tem × filial 02 (Tabuará) — temporário
const postgres = require('postgres');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });
const F = {
  p: '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9', // 01 Prainha Bar
  t: 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7', // 02 Tabuará
  m: 'e899dae2-38bf-4f3f-9149-7effd059fab8', // 03 Prainha Mar
};
(async () => {
  const fil = await sql`SELECT * FROM filial ORDER BY nome`;
  for (const f of fil) {
    console.log(`\n=== FILIAL ${f.nome} (${String(f.id).slice(0, 8)}) ===`);
    for (const [k, v] of Object.entries(f)) {
      if (v == null || k === 'id') continue;
      let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (s.length > 160) s = s.slice(0, 160) + `…(len ${s.length})`;
      console.log(`  ${k}: ${s}`);
    }
  }

  const tabs = await sql`SELECT table_schema, table_name FROM information_schema.columns
    WHERE column_name='filial_id' AND table_schema NOT IN ('pg_catalog','information_schema')
    ORDER BY 1,2`;
  console.log(`\n=== CONTAGEM POR FILIAL (${tabs.length} tabelas) — tabela | 01 Prainha | 02 Tabuará | 03 Mar | max data (01|02) ===`);
  for (const { table_schema: ts, table_name: tn } of tabs) {
    try {
      const colr = await sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema=${ts} AND table_name=${tn}
        AND column_name IN ('atualizado_em','updated_at','criado_em','created_at','data')`;
      const dcol = ['atualizado_em', 'updated_at', 'criado_em', 'created_at', 'data']
        .find(c => colr.some(r => r.column_name === c));
      const dexpr = dcol
        ? `, max(CASE WHEN filial_id='${F.p}' THEN "${dcol}" END)::text AS dp, max(CASE WHEN filial_id='${F.t}' THEN "${dcol}" END)::text AS dt`
        : `, NULL AS dp, NULL AS dt`;
      const r = await sql.unsafe(`SELECT
        count(*) FILTER (WHERE filial_id='${F.p}') AS p,
        count(*) FILTER (WHERE filial_id='${F.t}') AS t,
        count(*) FILTER (WHERE filial_id='${F.m}') AS m ${dexpr}
        FROM "${ts}"."${tn}"`);
      const { p, t, m, dp, dt } = r[0];
      const d = (x) => (x ? String(x).slice(0, 16) : '-');
      console.log(`${ts === 'public' ? '' : ts + '.'}${tn} | ${p} | ${t} | ${m} | ${d(dp)} | ${d(dt)}`);
    } catch (e) {
      console.log(`${tn} | ERRO: ${e.message.slice(0, 70)}`);
    }
  }
  await sql.end();
})().catch(e => { console.error('FALHA:', e.message); process.exit(1); });

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false });
console.log('=== TODAS as tabelas public ===');
const t = await sql<any[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
console.log(t.map(x=>x.table_name).join(', '));
// procura colunas que possam ter nome de categoria/etiqueta/grupo
console.log('\n=== colunas com etiqueta/categoria/grupo/secao no nome ===');
const c = await sql<any[]>`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND (column_name ILIKE '%etiqueta%' OR column_name ILIKE '%categoria%' OR column_name ILIKE '%grupo%' OR column_name ILIKE '%secao%' OR column_name ILIKE '%setor%') ORDER BY table_name`;
console.log(c);
await sql.end();

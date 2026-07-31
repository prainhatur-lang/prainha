import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false });
const PRAINHA='7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
// tabelas que parecem etiqueta/categoria
const t = await sql<any[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%etiqueta%' OR table_name LIKE '%categoria%') ORDER BY table_name`;
console.log('tabelas etiqueta/categoria:', t.map(x=>x.table_name));
// produtos ativos do Prainha agrupados por codigo_etiqueta
const g = await sql<any[]>`
  SELECT codigo_etiqueta, COUNT(*)::int n
  FROM produto WHERE filial_id=${PRAINHA} AND preco_venda::numeric>0
    AND descontinuado=false AND data_pausado IS NULL AND nome NOT LIKE '%Exclu%'
  GROUP BY codigo_etiqueta ORDER BY n DESC LIMIT 20`;
console.log('top codigo_etiqueta (Prainha ativos):', g);
await sql.end();

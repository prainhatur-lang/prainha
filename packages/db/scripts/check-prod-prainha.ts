import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false });

console.log('=== filiais ===');
const fl = await sql<any[]>`SELECT id, nome FROM filial ORDER BY nome`;
console.log(fl);

console.log('\n=== contagem de produtos por filial (com preco>0) ===');
const cnt = await sql<any[]>`
  SELECT f.nome, COUNT(*)::int AS n
  FROM produto p JOIN filial f ON f.id = p.filial_id
  GROUP BY f.nome ORDER BY f.nome`;
console.log(cnt);

console.log('\n=== amostra de colunas de produto (1 linha do Prainha) ===');
const prainha = fl.find((f:any)=>/prainha bar|0001/i.test(f.nome));
if (prainha) {
  const cols = await sql<any[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='produto' ORDER BY ordinal_position`;
  console.log('colunas:', cols.map((c:any)=>c.column_name).join(', '));
  const amostra = await sql<any[]>`SELECT * FROM produto WHERE filial_id=${prainha.id} LIMIT 2`;
  console.log(amostra);
}
await sql.end();

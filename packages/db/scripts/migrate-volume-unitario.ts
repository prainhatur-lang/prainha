// produto.volume_unitario_ml: ml de 1 unidade (garrafa) pra ficha em ml baixar
// fração da garrafa. Preenche pelo nome ("750 ml", "1L", "965ml") nos insumos
// em `un` que ainda não têm. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:volume-unitario

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

/** Mesma regra de apps/web/src/lib/volume-unitario.ts */
function volumeDoNome(nome: string): number | null {
  const m = nome.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|lt|litros?)(?![a-z])/i);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const ml = m[2]!.toLowerCase() === 'ml' ? n : n * 1000;
  return ml >= 10 && ml <= 20000 ? ml : null;
}

async function main() {
  await sql`ALTER TABLE produto ADD COLUMN IF NOT EXISTS volume_unitario_ml numeric(14,4)`;
  const rows = await sql<{ id: string; nome: string }[]>`
    SELECT id, nome FROM produto
    WHERE volume_unitario_ml IS NULL AND lower(coalesce(unidade_estoque,'un')) = 'un'`;
  let n = 0;
  for (const r of rows) {
    const ml = volumeDoNome(r.nome ?? '');
    if (ml == null) continue;
    await sql`UPDATE produto SET volume_unitario_ml = ${ml} WHERE id = ${r.id}`;
    n++;
  }
  console.log(`Pronto. ${n} produtos com volume pelo nome.`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

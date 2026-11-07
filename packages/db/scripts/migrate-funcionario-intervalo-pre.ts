/**
 * funcionario.intervalo_pre_assinalado — quem não precisa bater o intervalo
 * (CCT SINDHOTRE 2026/2028 cl.15/17: intervalo de 30 min pré-assinalado).
 * Dono 07/11/2026: vale pra cozinha do Prainha Bar. Dia > 6h sem intervalo
 * batido desconta 30 min em vez de ficar pendente.
 * Aditiva e idempotente. Marca quem está ativo no setor COZINHA do Bar.
 *
 * Uso: pnpm --filter @concilia/db migrate:funcionario-intervalo-pre
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

const PRAINHA_BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';

async function main() {
  await sql.unsafe(
    `ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS intervalo_pre_assinalado boolean NOT NULL DEFAULT false`,
  );
  const marcados = await sql`
    UPDATE funcionario SET intervalo_pre_assinalado = true
     WHERE filial_id = ${PRAINHA_BAR} AND setor = 'COZINHA' AND ativo
       AND data_desligamento IS NULL AND NOT intervalo_pre_assinalado
    RETURNING nome`;
  for (const m of marcados) console.log(`  marcado: ${m.nome}`);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM funcionario WHERE intervalo_pre_assinalado`;
  console.log(`[ok] funcionario.intervalo_pre_assinalado pronta (${n} marcado(s))`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * funcionario.ponto_hora_saida — hora de saída combinada na escala (pedido do
 * dono 19/11/2026: "tem só a entrada, falta a saída"). Fica ao lado da hora de
 * entrada em /rh/escala-mensal. Só informa: NÃO trava o ponto (a trava continua
 * sendo só a da entrada). Nulo = sem hora marcada. Aditiva e idempotente.
 *
 * Uso: pnpm --filter @concilia/db migrate:funcionario-hora-saida
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS ponto_hora_saida varchar(5)`);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM funcionario WHERE ponto_hora_saida IS NOT NULL`;
  console.log(`[ok] funcionario.ponto_hora_saida pronta (${n} com hora)`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

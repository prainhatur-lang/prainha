/**
 * funcionario.ponto_hora_entrada + ponto_cedo_liberado_dia — trava de ponto
 * antes da hora (pedido do dono 24/10/2026: "não permitir bater o ponto antes
 * da hora sem autorização"). Com hora marcada ("11:00"), o tablet da loja
 * recusa a PRIMEIRA entrada do dia antes da hora menos a tolerância (10 min).
 * ponto_cedo_liberado_dia = o gerente autorizou aquele dia (vale só ele).
 * Nulo = sem trava (todo mundo hoje). Aditiva e idempotente.
 *
 * Uso: pnpm --filter @concilia/db migrate:funcionario-hora-entrada
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS ponto_hora_entrada varchar(5)`);
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS ponto_cedo_liberado_dia date`);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM funcionario WHERE ponto_hora_entrada IS NOT NULL`;
  console.log(`[ok] funcionario.ponto_hora_entrada pronta (${n} com hora)`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

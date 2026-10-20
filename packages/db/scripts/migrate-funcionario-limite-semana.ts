/**
 * funcionario.limite_dias_semana + limite_liberado_dia — trava de dias por
 * semana no ponto facial (pedido do dono 20/10/2026: quem trabalha SEM
 * REGISTRO só pode trabalhar 2 vezes na semana). O tablet da loja recusa a
 * ENTRADA de um dia novo quando a pessoa já bateu ponto em N dias operacionais
 * da semana (seg–dom, somando as casas). limite_liberado_dia = o gerente
 * liberou aquele dia por fora da trava (vale só pro dia gravado).
 * Nulo = sem limite (todo mundo hoje). Aditiva e idempotente.
 *
 * Uso: pnpm --filter @concilia/db migrate:funcionario-limite-semana
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS limite_dias_semana smallint`);
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS limite_liberado_dia date`);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM funcionario WHERE limite_dias_semana IS NOT NULL`;
  console.log(`[ok] funcionario.limite_dias_semana pronta (${n} com limite)`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

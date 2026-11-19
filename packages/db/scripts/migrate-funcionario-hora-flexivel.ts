/**
 * funcionario.ponto_hora_flexivel — entrada flexível (pedido do dono
 * 19/11/2026: "têm a hora de entrada meio que flexível, mas a gente precisa ter
 * uma previsibilidade do horário ... pode chegar antes ou depois, e aí vai para
 * banco de horas"). Com a marca, a hora de entrada vira só a PREVISTA: o ponto
 * não trava antes da hora e o relatório não conta atraso. Falso (padrão) = a
 * trava de sempre. Aditiva e idempotente.
 *
 * Uso: pnpm --filter @concilia/db migrate:funcionario-hora-flexivel
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS ponto_hora_flexivel boolean NOT NULL DEFAULT false`);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM funcionario WHERE ponto_hora_flexivel`;
  console.log(`[ok] funcionario.ponto_hora_flexivel pronta (${n} com entrada flexível)`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

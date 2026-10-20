/**
 * funcionario_regime_agenda — mudança de regime/salário com data marcada
 * (dono 20/10/2026: intermitentes da escala base da Tabuará viram CLT em
 * 01/11). O cron /api/cron/regime-agendado aplica no dia. Aditiva e
 * idempotente; RLS ligado (ENABLE).
 *
 * Uso: pnpm --filter @concilia/db migrate:funcionario-regime-agenda
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS funcionario_regime_agenda (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      funcionario_id uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      a_partir date NOT NULL,
      regime_salarial varchar(20) NOT NULL,
      salario_base numeric(10,2),
      regime_anterior varchar(20),
      salario_anterior numeric(10,2),
      motivo varchar(200),
      criado_em timestamptz NOT NULL DEFAULT now(),
      criado_por varchar(120),
      aplicado_em timestamptz,
      cancelado_em timestamptz
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_funcionario_regime_agenda_func ON funcionario_regime_agenda(funcionario_id)`);
  await sql.unsafe(`ALTER TABLE funcionario_regime_agenda ENABLE ROW LEVEL SECURITY`);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM funcionario_regime_agenda`;
  console.log(`[ok] funcionario_regime_agenda pronta (${n} linhas)`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

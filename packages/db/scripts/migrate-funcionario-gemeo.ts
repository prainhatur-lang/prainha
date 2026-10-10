/**
 * funcionario.gemeo_de_id — gêmeo(a) que trabalha na casa. A câmera do ponto
 * não separa gêmeos idênticos (10/10/2026, Prainha Bar: uma batia o ponto da
 * outra); com o par marcado em /rh/ponto, o tablet pergunta "Quem é você?" em
 * vez de bater direto. Coluna nula pra todo mundo que não tem gêmeo.
 * Aditiva e idempotente.
 *
 * Uso: pnpm --filter @concilia/db migrate:funcionario-gemeo
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS gemeo_de_id uuid`);
  // apagar o cadastro de um dos dois solta o outro, em vez de travar o DELETE
  await sql.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_funcionario_gemeo') THEN
        ALTER TABLE funcionario ADD CONSTRAINT fk_funcionario_gemeo
          FOREIGN KEY (gemeo_de_id) REFERENCES funcionario(id) ON DELETE SET NULL;
      END IF;
    END $$`);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM funcionario WHERE gemeo_de_id IS NOT NULL`;
  console.log(`[ok] funcionario.gemeo_de_id pronta (${n} marcado(s))`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

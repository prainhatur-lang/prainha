// Recebimento com conferência da transferência entre casas: a mercadoria sai
// da origem (status ENVIADA) e só entra no estoque do destino quando a casa
// que recebe confere. Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

async function main() {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_DIRECT/DATABASE_URL ausente');
  const sql = postgres(url, { prepare: false, ssl: 'require' });
  const run = async (name: string, fn: () => Promise<unknown>) => {
    process.stdout.write(`${name}... `);
    await fn();
    console.log('ok');
  };

  await run('transferencia_filial: recebimento', () => sql`
    ALTER TABLE transferencia_filial
      ADD COLUMN IF NOT EXISTS recebida_em timestamptz,
      ADD COLUMN IF NOT EXISTS recebida_por uuid,
      ADD COLUMN IF NOT EXISTS observacao_recebimento text
  `);
  await run('transferencia_filial_item: quantidade_recebida + custo_estimado', () => sql`
    ALTER TABLE transferencia_filial_item
      ADD COLUMN IF NOT EXISTS quantidade_recebida numeric(14,4),
      ADD COLUMN IF NOT EXISTS custo_estimado boolean NOT NULL DEFAULT false
  `);
  await run('idx em trânsito por destino', () => sql`
    CREATE INDEX IF NOT EXISTS idx_transf_destino_status ON transferencia_filial (filial_destino_id, status)
  `);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

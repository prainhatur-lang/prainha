// Um Pix do extrato do Inter pagando várias contas (/financeiro/pix-inter):
// tabela pix_conta_vinculo, uma linha por baixa ligada ao Pix. Idempotente.
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

  await run('pix_conta_vinculo', () => sql`
    CREATE TABLE IF NOT EXISTS pix_conta_vinculo (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      lancamento_banco_id uuid NOT NULL,
      conta_pagar_baixa_id uuid NOT NULL REFERENCES conta_pagar_baixa(id) ON DELETE CASCADE,
      conta_pagar_id uuid NOT NULL,
      criou_baixa boolean NOT NULL DEFAULT false,
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await run('idx_pix_conta_vinculo_lanc', () => sql`
    CREATE INDEX IF NOT EXISTS idx_pix_conta_vinculo_lanc ON pix_conta_vinculo (lancamento_banco_id)
  `);
  await run('uq_pix_conta_vinculo_baixa', () => sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pix_conta_vinculo_baixa ON pix_conta_vinculo (conta_pagar_baixa_id)
  `);
  await run('RLS', () => sql`ALTER TABLE pix_conta_vinculo ENABLE ROW LEVEL SECURITY`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

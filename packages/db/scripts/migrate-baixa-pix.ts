// Baixa de conta a pagar pelo Pix do extrato do Inter (/financeiro/pix-inter):
// a baixa guarda qual lançamento do extrato pagou, e o mesmo Pix não baixa duas
// contas. Só acrescenta coluna e índice. Idempotente.
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

  await run('conta_pagar_baixa.lancamento_banco_id', () => sql`
    ALTER TABLE conta_pagar_baixa ADD COLUMN IF NOT EXISTS lancamento_banco_id uuid
  `);
  await run('uq_cp_baixa_lancamento', () => sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_baixa_lancamento
      ON conta_pagar_baixa (lancamento_banco_id) WHERE lancamento_banco_id IS NOT NULL
  `);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

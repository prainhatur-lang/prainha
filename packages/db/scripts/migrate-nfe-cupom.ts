// NF-e (modelo 55) emitida a partir de um cupom (NFC-e): a nota guarda o cupom
// de origem, a chave referenciada e o cliente destinatário. Só colunas novas
// em nfe_emitida (que já tem RLS). Idempotente.
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

  await run('nfe_emitida.nfce_origem_id', () => sql`
    ALTER TABLE nfe_emitida
      ADD COLUMN IF NOT EXISTS nfce_origem_id uuid REFERENCES nfce_emitida(id) ON DELETE SET NULL
  `);
  await run('nfe_emitida.chave_referenciada', () => sql`
    ALTER TABLE nfe_emitida ADD COLUMN IF NOT EXISTS chave_referenciada varchar(44)
  `);
  await run('nfe_emitida.dest', () => sql`ALTER TABLE nfe_emitida ADD COLUMN IF NOT EXISTS dest jsonb`);
  await run('nfe_cupom_viva_uq', () => sql`
    CREATE UNIQUE INDEX IF NOT EXISTS nfe_cupom_viva_uq ON nfe_emitida (nfce_origem_id, ambiente)
      WHERE status IN ('PENDENTE', 'AUTORIZADA') AND nfce_origem_id IS NOT NULL
  `);
  await run('nfe_cupom_idx', () => sql`CREATE INDEX IF NOT EXISTS nfe_cupom_idx ON nfe_emitida (nfce_origem_id)`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Cadastro fiscal do cliente da NF-e (cupom → nota), por empresa: guarda o que
// foi conferido/corrigido na tela pra próxima busca do CPF/CNPJ já vir certo.
// Tabela nova, com RLS. Idempotente.
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

  await run('nfe_destinatario', () => sql`
    CREATE TABLE IF NOT EXISTS nfe_destinatario (
      organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
      documento varchar(14) NOT NULL,
      dados jsonb NOT NULL,
      atualizado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organizacao_id, documento)
    )
  `);
  await run('nfe_destinatario RLS', () => sql`ALTER TABLE nfe_destinatario ENABLE ROW LEVEL SECURITY`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

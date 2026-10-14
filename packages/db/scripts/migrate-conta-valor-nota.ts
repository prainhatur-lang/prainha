// Conta a pagar de NF-e com boleto de valor diferente da nota (acréscimo
// financeiro / tarifa bancária embutida no boleto): o valor da conta passa a
// ser o do boleto e `valor_nota` guarda o que a nota mandou. Acréscimo =
// valor - valor_nota. Coluna nova, sem tabela nova. Idempotente.
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

  await run('conta_pagar.valor_nota', () => sql`
    ALTER TABLE conta_pagar ADD COLUMN IF NOT EXISTS valor_nota numeric(14,2)
  `);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

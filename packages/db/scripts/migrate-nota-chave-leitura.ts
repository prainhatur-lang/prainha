// Entrada de notas pelo celular: cada chave que a câmera leu fica registrada
// com o link do QR (link_e), pro computador que mostrou o QR abrir a nota
// sozinho — inclusive quando ela já estava no sistema. Tabela nova + RLS.
// Idempotente.
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

  await run('nota_chave_leitura', () => sql`
    CREATE TABLE IF NOT EXISTS nota_chave_leitura (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      link_e integer NOT NULL,
      chave varchar(44) NOT NULL,
      nota_compra_id uuid REFERENCES nota_compra(id) ON DELETE SET NULL,
      status varchar(20),
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await run('idx_nota_chave_leitura_link', () => sql`
    CREATE INDEX IF NOT EXISTS idx_nota_chave_leitura_link ON nota_chave_leitura (filial_id, link_e)
  `);
  await run('RLS', () => sql`ALTER TABLE nota_chave_leitura ENABLE ROW LEVEL SECURITY`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

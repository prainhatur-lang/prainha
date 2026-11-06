// Conta do Inter de cada pessoa pro arquivo "Folha de pagamento" do Inter.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL ausente');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS conta_inter_folha (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa varchar(20) NOT NULL,
      cpf varchar(11) NOT NULL,
      nome text NOT NULL,
      conta varchar(20) NOT NULL,
      fonte text,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_conta_inter_folha UNIQUE (empresa, cpf)
    )`);
  await sql.unsafe(`ALTER TABLE conta_inter_folha ENABLE ROW LEVEL SECURITY`);
  console.log('ok conta_inter_folha');
}
main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });

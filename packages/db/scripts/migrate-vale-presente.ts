// Vale-presente pré-pago (jantar de presente pago por Pix, voucher com código).
// Uso: pnpm --filter @concilia/db migrate:vale-presente

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS vale_presente (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      numero serial,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      codigo varchar(12) NOT NULL UNIQUE,
      token text NOT NULL UNIQUE,
      comprador_nome varchar(200) NOT NULL,
      comprador_telefone varchar(30),
      presenteados varchar(200),
      mensagem text,
      data_uso date,
      pessoas integer NOT NULL DEFAULT 2,
      itens jsonb NOT NULL DEFAULT '[]'::jsonb,
      subtotal numeric(10,2) NOT NULL,
      servico numeric(10,2) NOT NULL,
      total numeric(10,2) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'aguardando',
      pagamento_id varchar(50),
      pagamento_qrcode text,
      pagamento_qrcode_img text,
      pago_em timestamptz,
      usado_em timestamptz,
      usado_por varchar(160),
      observacao text,
      criado_por varchar(160),
      criado_em timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS vale_presente_filial_criado_idx ON vale_presente (filial_id, criado_em)`;
  await sql`ALTER TABLE vale_presente ENABLE ROW LEVEL SECURITY`;
  await sql.end();
  console.log('vale_presente OK');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

// Link de pagamento avulso por cartão (uso único, 3DS obrigatório).
// Uso: pnpm --filter @concilia/db migrate:link-pagamento

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS link_pagamento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      numero serial,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      token text NOT NULL UNIQUE,
      descricao varchar(300) NOT NULL,
      cliente_nome varchar(200),
      cliente_telefone varchar(30),
      valor numeric(12,2) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'aberto',
      expira_em timestamptz NOT NULL,
      tentativas integer NOT NULL DEFAULT 0,
      processando_em timestamptz,
      payment_id varchar(60),
      tipo_pagamento varchar(20),
      bandeira varchar(30),
      eci varchar(4),
      cartao_final varchar(4),
      erro text,
      pago_em timestamptz,
      criado_por varchar(160),
      criado_em timestamptz NOT NULL DEFAULT now(),
      cancelado_em timestamptz,
      cancelado_por varchar(160)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS link_pagamento_filial_criado_idx ON link_pagamento (filial_id, criado_em)`;
  await sql`ALTER TABLE link_pagamento ADD COLUMN IF NOT EXISTS reserva_id uuid`;
  await sql`CREATE INDEX IF NOT EXISTS link_pagamento_reserva_idx ON link_pagamento (reserva_id)`;
  await sql`ALTER TABLE link_pagamento ADD COLUMN IF NOT EXISTS orcamento_id uuid`;
  await sql`CREATE INDEX IF NOT EXISTS link_pagamento_orcamento_idx ON link_pagamento (orcamento_id)`;
  await sql`ALTER TABLE link_pagamento ENABLE ROW LEVEL SECURITY`;
  await sql.end();
  console.log('link_pagamento OK');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

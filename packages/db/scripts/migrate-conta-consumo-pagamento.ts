// Conta de consumo (energia, água, gás…) e boleto fora do DDA pagos pelo
// sistema via API do Inter — tela /financeiro/pagar-conta. Pelo código de
// barras (pagamento de boleto/convênio) ou pelo Pix copia-e-cola do QR.
// A linha nasce ENVIANDO antes de chamar o banco. Pedido do dono 23/11/2026.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:conta-consumo-pagamento

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS conta_consumo_pagamento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL,
      tipo varchar(10) NOT NULL,
      codigo text NOT NULL,
      codigo_barras varchar(44),
      favorecido text,
      cpf_cnpj_beneficiario varchar(20),
      valor numeric(14,2) NOT NULL,
      data_vencimento date,
      data_pagamento date,
      conta_pagar_id uuid,
      descricao text,
      status varchar(20) NOT NULL DEFAULT 'ENVIANDO',
      status_inter varchar(40),
      codigo_inter varchar(80),
      end_to_end_id varchar(80),
      retorno jsonb,
      erro text,
      usuario_id uuid,
      usuario_email text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      baixado_em timestamptz
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_conta_consumo_pag_filial ON conta_consumo_pagamento (filial_id, criado_em)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_conta_consumo_pag_barras ON conta_consumo_pagamento (codigo_barras)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_conta_consumo_pag_status ON conta_consumo_pagamento (status)`);
  await sql.unsafe(`ALTER TABLE conta_consumo_pagamento ENABLE ROW LEVEL SECURITY`);
  console.log('ok: conta_consumo_pagamento (RLS ligado)');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

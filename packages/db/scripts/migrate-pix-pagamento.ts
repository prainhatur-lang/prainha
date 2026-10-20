// Pix pago pelo sistema (tela Pedidos a pagar por Pix → "Pagar Pix agora").
// Cada envio ao Inter vira uma linha: quem mandou, chave, valor, contas que
// o Pix quita, código da solicitação no Inter e o status. A linha nasce
// ENVIANDO antes de chamar o banco — se a resposta se perder, a conta fica
// travada pra não pagar duas vezes. Pedido do dono em 20/10/2026.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:pix-pagamento

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS pix_pagamento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL,
      fornecedor_id uuid,
      favorecido text,
      conta_ids jsonb NOT NULL,
      chave text NOT NULL,
      valor numeric(14,2) NOT NULL,
      descricao text,
      status varchar(20) NOT NULL DEFAULT 'ENVIANDO',
      status_inter varchar(40),
      codigo_solicitacao varchar(80),
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
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_pix_pagamento_filial ON pix_pagamento (filial_id, criado_em)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_pix_pagamento_status ON pix_pagamento (status)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_pix_pagamento_contas ON pix_pagamento USING gin (conta_ids)`);
  await sql.unsafe(`ALTER TABLE pix_pagamento ENABLE ROW LEVEL SECURITY`);
  console.log('ok: pix_pagamento (RLS ligado)');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

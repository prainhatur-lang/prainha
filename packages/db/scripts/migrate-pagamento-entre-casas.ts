// Boleto pago por uma casa pra conta lançada em outra (Inter do Bar pagou a
// tinta da Mar): a casa da conta fica devendo pra quem pagou e isso entra no
// encontro de contas do mês, junto com as transferências. Idempotente.
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

  await run('pagamento_entre_casas', () => sql`
    CREATE TABLE IF NOT EXISTS pagamento_entre_casas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_pagadora_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      filial_devedora_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      conta_pagar_id uuid,
      origem varchar(20) NOT NULL DEFAULT 'INTER_BOLETO',
      codigo_externo text,
      data date NOT NULL,
      competencia varchar(7) NOT NULL,
      valor numeric(14,2) NOT NULL,
      descricao text,
      status varchar(12) NOT NULL DEFAULT 'ABERTO',
      encontro_id uuid,
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      cancelado_por uuid,
      cancelado_em timestamptz,
      CONSTRAINT uq_pag_casas_codigo UNIQUE (filial_pagadora_id, codigo_externo)
    )
  `);
  await run('idx competência/status', () => sql`
    CREATE INDEX IF NOT EXISTS idx_pag_casas_comp ON pagamento_entre_casas (competencia, status)
  `);
  await run('RLS', () => sql`ALTER TABLE pagamento_entre_casas ENABLE ROW LEVEL SECURITY`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

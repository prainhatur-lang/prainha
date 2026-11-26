// Cartão de DÉBITO da empresa (dono, 26/11/2026): cadastro do cartão que não
// tem fatura — a compra sai da conta na hora. Tabela cartao_debito diz de qual
// conta_bancaria o cartão debita, pra nota de entrada paga nele se ligar ao
// débito do extrato (lancamento_banco COMPRA_DEBITO).
//
// Semeia o primeiro: Inter final 3196, conta Inter da Tabuará (o cupom da
// Copyart de 25/11/2026, R$ 53,00, saiu dessa conta).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:cartao-debito

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const TABUARA = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS cartao_debito (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
      banco varchar(60) NOT NULL,
      cartao_final varchar(8) NOT NULL,
      conta_bancaria_id uuid NOT NULL REFERENCES conta_bancaria(id),
      apelido varchar(100),
      criado_em timestamptz NOT NULL DEFAULT now(),
      excluido_em timestamptz
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_cartao_debito_org ON cartao_debito (organizacao_id)`);
  await sql.unsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_cartao_debito ON cartao_debito (organizacao_id, banco, cartao_final)`,
  );
  await sql.unsafe(`ALTER TABLE cartao_debito ENABLE ROW LEVEL SECURITY`);

  const r = await sql`
    INSERT INTO cartao_debito (organizacao_id, banco, cartao_final, conta_bancaria_id, apelido)
    SELECT f.organizacao_id, 'Inter', '3196', c.id, 'Débito Inter Tabuará'
    FROM filial f
    JOIN conta_bancaria c ON c.filial_id = f.id AND c.banco = 'Banco Inter'
    WHERE f.id = ${TABUARA}
    ON CONFLICT (organizacao_id, banco, cartao_final) DO NOTHING
    RETURNING id`;
  console.log(`ok: cartao_debito (RLS ligado); 3196 ${r.length ? 'cadastrado' : 'já existia'}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Cartão fidelidade POR CASA ("Cliente VIP Prainha Bar", "Cliente VIP Tabuará",
// "Cliente VIP Prainha Mar" são programas separados) + código sob demanda:
//   · fidelidade_programa: chave vira filial_id (uma regra por casa). Casa sem
//     linha = programa desligado. Liga só o Prainha Bar.
//   · fidelidade_cartao: filial_id (a casa do cartão); telefone e código únicos
//     por casa; codigo_expira_em (o código só vale até aqui — nasce quando o
//     cliente toca "Vou pagar agora"); aparelhos (hash dos celulares
//     confirmados por SMS/WhatsApp — só eles geram código); otp_* (código de
//     confirmação quando o SMS sai pelo WhatsApp da Meta e não pelo Twilio).
// As duas tabelas estavam vazias quando isso rodou (27/09/2026). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:fidelidade-por-casa

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const PRAINHA_BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';

async function main() {
  const [{ n: nc }] = await sql`SELECT count(*)::int AS n FROM fidelidade_cartao`;
  const [{ n: np }] = await sql`SELECT count(*)::int AS n FROM fidelidade_programa`;
  console.log(`  cartões: ${nc} · programas: ${np}`);

  // ---- programa por casa
  await sql`ALTER TABLE fidelidade_programa ADD COLUMN IF NOT EXISTS filial_id uuid REFERENCES filial(id) ON DELETE CASCADE`;
  // linha antiga (por organização) vira do Prainha Bar
  await sql`UPDATE fidelidade_programa p SET filial_id = ${PRAINHA_BAR}::uuid WHERE filial_id IS NULL`;
  await sql`ALTER TABLE fidelidade_programa DROP CONSTRAINT IF EXISTS fidelidade_programa_pkey`;
  await sql`ALTER TABLE fidelidade_programa ALTER COLUMN filial_id SET NOT NULL`;
  const [pk] = await sql`SELECT 1 FROM pg_constraint WHERE conname = 'fidelidade_programa_filial_pkey'`;
  if (!pk) await sql`ALTER TABLE fidelidade_programa ADD CONSTRAINT fidelidade_programa_filial_pkey PRIMARY KEY (filial_id)`;
  await sql`
    INSERT INTO fidelidade_programa (filial_id, organizacao_id, ativo, config)
    SELECT f.id, f.organizacao_id, true, '{}'::jsonb FROM filial f WHERE f.id = ${PRAINHA_BAR}::uuid
    ON CONFLICT (filial_id) DO NOTHING`;

  // ---- cartão por casa
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS filial_id uuid REFERENCES filial(id) ON DELETE CASCADE`;
  await sql`UPDATE fidelidade_cartao SET filial_id = COALESCE(filial_origem_id, ${PRAINHA_BAR}::uuid) WHERE filial_id IS NULL`;
  await sql`ALTER TABLE fidelidade_cartao ALTER COLUMN filial_id SET NOT NULL`;
  await sql`ALTER TABLE fidelidade_cartao DROP CONSTRAINT IF EXISTS uq_fidelidade_cartao_telefone`;
  const [uq] = await sql`SELECT 1 FROM pg_constraint WHERE conname = 'uq_fidelidade_cartao_filial_telefone'`;
  if (!uq) await sql`ALTER TABLE fidelidade_cartao ADD CONSTRAINT uq_fidelidade_cartao_filial_telefone UNIQUE (filial_id, telefone)`;
  await sql`DROP INDEX IF EXISTS uq_fidelidade_cartao_codigo_ativo`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_fidelidade_cartao_filial_codigo ON fidelidade_cartao (filial_id, codigo) WHERE status = 'ativo'`;

  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS codigo_expira_em timestamptz`;
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS codigo_aparelho varchar(16)`;
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS aparelhos jsonb NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS otp_hash varchar(64)`;
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS otp_expira_em timestamptz`;
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS otp_tentativas integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS otp_enviado_em timestamptz`;

  // uso guarda de qual aparelho saiu o código (auditoria de uso por terceiro)
  await sql`ALTER TABLE fidelidade_uso ADD COLUMN IF NOT EXISTS aparelho varchar(16)`;

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});

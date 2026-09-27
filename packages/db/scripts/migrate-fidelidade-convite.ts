// Cartão fidelidade — convite por região + benefícios:
//   · fidelidade_cartao: aderido_em, recusado_em, convite_erro, cidade, bairro
//     (cartão já criado antes disso conta como aderido — foi dado em mãos)
//   · orcamento_evento: desconto_espaco, desconto_espaco_motivo
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fidelidade-convite

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS aderido_em timestamptz`;
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS recusado_em timestamptz`;
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS convite_erro text`;
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS cidade varchar(100)`;
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS bairro varchar(100)`;
  const r = await sql`UPDATE fidelidade_cartao SET aderido_em = criado_em WHERE aderido_em IS NULL AND origem = 'manual' RETURNING id`;
  console.log(`  ${r.length} cartão(ões) manual(is) marcados como aderidos`);
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS desconto_espaco numeric(10,2)`;
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS desconto_espaco_motivo varchar(120)`;
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});

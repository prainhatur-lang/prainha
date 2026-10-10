// Cliente VIP: código na FRENTE do cartão da carteira (Apple/Google Wallet).
//
// O dono achou complicado abrir os detalhes do cartão pra gerar o código e
// pediu algo "como cartão de embarque": o código já aparece no cartão e troca
// sozinho. `codigo_carteira` guarda esse código (4 letras, sem prazo, vale até
// ser usado uma vez). Nasce vazio: só ganha código o cartão que vai pra
// carteira — por isso aqui não se preenche nada.
//
// Idempotente. Rodar: pnpm --filter @concilia/db migrate:fidelidade-codigo-carteira

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS codigo_carteira varchar(4)`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_fidelidade_cartao_codigo_carteira
      ON fidelidade_cartao (codigo_carteira)
      WHERE codigo_carteira IS NOT NULL
  `;
  const [r] = await sql`SELECT count(*)::int AS cartoes, count(codigo_carteira)::int AS com_codigo FROM fidelidade_cartao`;
  await sql.end();
  console.log('Pronto.', r);
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});

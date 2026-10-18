// avaliacao.convite_destino / convite_em: o que a tela do QR fez depois da
// nota alta — 'google' ou 'tripadvisor' (abriu o site, sozinha ou no botão) ou
// 'agora_nao' (a pessoa cancelou). Nulo = nada registrado (antigas, ou saiu da
// tela antes). Abrir o site não quer dizer que publicou. Pedido do dono
// 18/10/2026. Idempotente. Uso: pnpm --filter @concilia/db migrate:avaliacao-convite
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

  await run('avaliacao.convite_destino', () => sql`
    ALTER TABLE avaliacao ADD COLUMN IF NOT EXISTS convite_destino varchar(20)
  `);
  await run('avaliacao.convite_em', () => sql`
    ALTER TABLE avaliacao ADD COLUMN IF NOT EXISTS convite_em timestamptz
  `);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

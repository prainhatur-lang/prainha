// Consulta SEFAZ DF-e + manifestacao em TODAS as filiais ativas
// (chama o mesmo flow do cron). Util pra disparo manual.
//
// Uso: pnpm --filter @concilia/db consultar:todas-filiais

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

const url = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.prainhabar.com'}/api/cron/distribuicao-dfe`;
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error('CRON_SECRET nao definida no .env');

console.log(`Chamando ${url}...`);
const r = await fetch(url, {
  method: 'GET',
  headers: { authorization: `Bearer ${secret}` },
});
const body = await r.text();
console.log(`HTTP ${r.status}`);
try {
  const json = JSON.parse(body);
  console.log(JSON.stringify(json, null, 2));
} catch {
  console.log(body);
}

// Lelis Atacadista no Concilia (31/10/2026): organização + filial próprias.
// A distribuidora passa a operar: compra as bebidas e vende pras casas
// (a partir de ~15/11) e pra outras empresas.
//
// Igual à E.B. (migrate-eb-faturas): a filial da Lelis NÃO ganha
// usuario_filial — fica fora do seletor do menu e dos totais das casas.
// Só pessoas autorizadas (grupo Admin) enxergam, pelas telas que liberam.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:lelis-filial

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const LELIS_CNPJ = '54228128000136';

async function main() {
  await sql`
    INSERT INTO organizacao (nome, cnpj_raiz, codigo)
    VALUES ('Lelis Atacadista e Varejista de Alimentos e Bebidas Ltda', ${LELIS_CNPJ.slice(0, 8)}, 'lelis')
    ON CONFLICT (codigo) DO NOTHING
  `;
  const [org] = await sql<{ id: string }[]>`SELECT id FROM organizacao WHERE codigo = 'lelis'`;
  let [fil] = await sql<{ id: string }[]>`SELECT id FROM filial WHERE cnpj = ${LELIS_CNPJ}`;
  if (!fil) {
    const token = 'agt_' + randomBytes(24).toString('base64url');
    [fil] = await sql<{ id: string }[]>`
      INSERT INTO filial (organizacao_id, nome, cnpj, agente_token)
      VALUES (${org!.id}, 'Lelis Distribuidora', ${LELIS_CNPJ}, ${token})
      RETURNING id
    `;
  }
  console.log('[ok] organizacao Lelis', org!.id);
  console.log('[ok] filial Lelis', fil!.id);

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});

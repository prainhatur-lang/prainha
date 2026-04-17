// Bootstrap inicial: cria a primeira organizacao + filiais + linka o usuario admin.
// Idempotente: pode rodar varias vezes sem duplicar.
//
// Uso: pnpm --filter @concilia/db tsx scripts/bootstrap.ts

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const ADMIN_EMAIL = 'prainhatur@gmail.com';
const ORG = { nome: 'Prainha Turismo LTDA', cnpjRaiz: '33159574' };
const FILIAIS = [
  { nome: 'Prainha Turismo - Filial 0002-47', cnpj: '33159574000247' },
  { nome: 'Prainha Turismo - Filial 0001-66', cnpj: '33159574000166' },
];

function genToken(): string {
  return 'agt_' + randomBytes(32).toString('base64url');
}

async function getAuthUserId(email: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const data = (await r.json()) as { users?: { id: string; email: string }[] };
  return data.users?.find((u) => u.email === email)?.id ?? null;
}

async function main() {
  console.log('[1] Garantindo usuario auth confirmado...');
  let authId = await getAuthUserId(ADMIN_EMAIL);
  if (!authId) {
    console.log('  -> criando usuario via Supabase Admin API');
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: 'concilia123',
        email_confirm: true,
      }),
    });
    if (!r.ok) throw new Error(`Erro criando usuario: ${await r.text()}`);
    authId = ((await r.json()) as { id: string }).id;
  }
  console.log(`  auth user id: ${authId}`);

  console.log('[2] Upsert do usuario na tabela publica...');
  await sql`
    INSERT INTO usuario (id, email, nome)
    VALUES (${authId}, ${ADMIN_EMAIL}, 'Admin Prainha')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
  `;

  console.log('[3] Upsert da organizacao...');
  let [org] = await sql<{ id: string }[]>`
    SELECT id FROM organizacao WHERE cnpj_raiz = ${ORG.cnpjRaiz} LIMIT 1
  `;
  if (!org) {
    [org] = await sql<{ id: string }[]>`
      INSERT INTO organizacao (nome, cnpj_raiz) VALUES (${ORG.nome}, ${ORG.cnpjRaiz})
      RETURNING id
    `;
    console.log(`  -> criada org id ${org.id}`);
  } else {
    console.log(`  -> org existente id ${org.id}`);
  }

  console.log('[4] Upsert das filiais...');
  for (const f of FILIAIS) {
    let [fil] = await sql<{ id: string; agente_token: string }[]>`
      SELECT id, agente_token FROM filial WHERE cnpj = ${f.cnpj} LIMIT 1
    `;
    if (!fil) {
      const token = genToken();
      [fil] = await sql<{ id: string; agente_token: string }[]>`
        INSERT INTO filial (organizacao_id, nome, cnpj, agente_token)
        VALUES (${org.id}, ${f.nome}, ${f.cnpj}, ${token})
        RETURNING id, agente_token
      `;
      console.log(`  -> criada filial ${f.cnpj}`);
      console.log(`     id:    ${fil.id}`);
      console.log(`     token: ${fil.agente_token}`);
    } else {
      console.log(`  -> filial ${f.cnpj} existente (id ${fil.id})`);
      console.log(`     token: ${fil.agente_token}`);
    }

    // Linka usuario admin como DONO em todas as filiais
    await sql`
      INSERT INTO usuario_filial (usuario_id, filial_id, role)
      VALUES (${authId}, ${fil.id}, 'DONO')
      ON CONFLICT (usuario_id, filial_id) DO NOTHING
    `;

    // Cria sincronizacao stub
    await sql`
      INSERT INTO sincronizacao (filial_id) VALUES (${fil.id})
      ON CONFLICT (filial_id) DO NOTHING
    `;
  }

  console.log('\n[5] Resumo final:');
  const filiais = await sql`
    SELECT f.id, f.nome, f.cnpj, f.agente_token, o.nome AS org
    FROM filial f
    JOIN organizacao o ON o.id = f.organizacao_id
    ORDER BY f.cnpj
  `;
  console.table(filiais.map((f) => ({ ...f, agente_token: f.agente_token.slice(0, 20) + '...' })));

  await sql.end();
  console.log('\nBootstrap OK.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

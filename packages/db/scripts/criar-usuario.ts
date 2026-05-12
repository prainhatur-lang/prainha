// Cria usuario no Supabase Auth + entradas em usuario e usuario_filial.
//
// Uso (env vars antes ou inline):
//   EMAIL=financeiro@prainhabar.com SENHA=xxx ROLE=FINANCEIRO FILIAL='Prainha Bar 0001' \
//     pnpm --filter @concilia/db criar:usuario
//
// Idempotente: se ja existe no Auth, pega o ID existente. Se ja tem
// usuario/usuario_filial, ignora ON CONFLICT.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const EMAIL = process.env.EMAIL;
const SENHA = process.env.SENHA;
const ROLE = process.env.ROLE ?? 'GERENTE';
const FILIAL_NOME = process.env.FILIAL;

if (!EMAIL || !SENHA || !FILIAL_NOME) {
  console.error('Faltam env vars: EMAIL, SENHA, FILIAL');
  console.error('Uso: EMAIL=... SENHA=... ROLE=COMPRAS FILIAL="Prainha Bar 0001" pnpm ... criar:usuario');
  process.exit(1);
}
if (!['DONO', 'GERENTE', 'COMPRAS', 'FINANCEIRO'].includes(ROLE)) {
  console.error('ROLE invalido. Use DONO | GERENTE | COMPRAS | FINANCEIRO');
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltam env: NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function getOrCreateAuthUser(): Promise<string> {
  // Tenta achar usuario existente pelo email
  const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (list.ok) {
    const data = (await list.json()) as { users?: { id: string; email: string }[] };
    const existente = data.users?.find((u) => u.email?.toLowerCase() === EMAIL!.toLowerCase());
    if (existente) {
      console.log(`  User ja existia no Auth: ${existente.id}`);
      return existente.id;
    }
  }

  // Cria
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: EMAIL, password: SENHA, email_confirm: true }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Falha criar Auth user: ${r.status} ${body}`);
  }
  const d = (await r.json()) as { id: string; email: string };
  console.log(`  User criado no Auth: ${d.id}`);
  return d.id;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL!, {
    prepare: false,
  });

  console.log(`Criando/garantindo usuario:`);
  console.log(`  Email: ${EMAIL}`);
  console.log(`  Role:  ${ROLE}`);
  console.log(`  Filial: ${FILIAL_NOME}`);

  // 1. Auth user
  const userId = await getOrCreateAuthUser();

  // 2. usuario (tabela do app)
  await sql`
    INSERT INTO usuario (id, email, criado_em)
    VALUES (${userId}, ${EMAIL}, now())
    ON CONFLICT (id) DO NOTHING
  `;
  console.log('  Linha em usuario OK');

  // 3. filial
  const [filial] = await sql<Array<{ id: string }>>`
    SELECT id FROM filial WHERE nome = ${FILIAL_NOME} LIMIT 1
  `;
  if (!filial) throw new Error(`Filial "${FILIAL_NOME}" nao encontrada`);

  // 4. usuario_filial
  await sql`
    INSERT INTO usuario_filial (usuario_id, filial_id, role)
    VALUES (${userId}, ${filial.id}, ${ROLE})
    ON CONFLICT (usuario_id, filial_id) DO UPDATE SET role = EXCLUDED.role
  `;
  console.log('  Vinculo usuario_filial OK');

  console.log(`\n✓ Usuario ${EMAIL} pronto pra login com role ${ROLE} na filial ${FILIAL_NOME}.`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});

// Puxador único do iFood na nuvem: fila de eventos + pedido baixado + trava.
//
// A fila do polling é por credencial (device), não por loja — ver a memória
// ifood-fila-por-clientid. Com as três casas no mesmo app homologado, quem
// puxa passa a ser a nuvem, e cada evento é roteado pra filial dona do
// merchant. Estas tabelas são o correio entre o puxador e as lojas.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:ifood-nuvem

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function run(label: string, fn: () => Promise<unknown>) {
  process.stdout.write(`  ${label}... `);
  await fn();
  console.log('OK');
}

async function main() {
  console.log('[1] ifood_nuvem_evento');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS ifood_nuvem_evento (
      id          varchar(80) PRIMARY KEY,
      filial_id   uuid REFERENCES filial(id) ON DELETE CASCADE,
      merchant_id varchar(80) NOT NULL,
      order_id    varchar(80) NOT NULL,
      codigo      varchar(40) NOT NULL,
      full_code   varchar(60),
      ocorrido_em timestamptz,
      criado_em   timestamptz NOT NULL DEFAULT now(),
      ack_em      timestamptz,
      entregue_em timestamptz
    )
  `);
  await run('index fila', () => sql`
    CREATE INDEX IF NOT EXISTS idx_ifood_nuvem_evento_fila
      ON ifood_nuvem_evento (filial_id, entregue_em)
  `);
  await run('index pedido', () => sql`
    CREATE INDEX IF NOT EXISTS idx_ifood_nuvem_evento_pedido
      ON ifood_nuvem_evento (order_id)
  `);

  console.log('[2] ifood_nuvem_pedido');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS ifood_nuvem_pedido (
      order_id    varchar(80) PRIMARY KEY,
      filial_id   uuid REFERENCES filial(id) ON DELETE CASCADE,
      merchant_id varchar(80) NOT NULL,
      display_id  varchar(20),
      payload     jsonb NOT NULL,
      baixado_em  timestamptz NOT NULL DEFAULT now()
    )
  `);
  await run('index filial', () => sql`
    CREATE INDEX IF NOT EXISTS idx_ifood_nuvem_pedido_filial
      ON ifood_nuvem_pedido (filial_id)
  `);

  console.log('[3] ifood_nuvem_lease');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS ifood_nuvem_lease (
      chave       varchar(80) PRIMARY KEY,
      dono        varchar(60) NOT NULL,
      expira_em   timestamptz NOT NULL,
      ultimo_ok   timestamptz,
      ultimo_erro text,
      eventos     integer NOT NULL DEFAULT 0
    )
  `);

  // Tabela nova SEMPRE com RLS (ENABLE, nunca FORCE): sem isso a anon key do
  // Supabase lê/escreve via PostgREST. Aqui tem nome, telefone e endereço de
  // cliente do delivery dentro do payload.
  console.log('[4] RLS');
  for (const t of ['ifood_nuvem_evento', 'ifood_nuvem_pedido', 'ifood_nuvem_lease']) {
    await run(`enable row level security ${t}`, () =>
      sql`ALTER TABLE ${sql(t)} ENABLE ROW LEVEL SECURITY`,
    );
  }

  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});

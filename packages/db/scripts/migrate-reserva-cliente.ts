// CADASTRO ÚNICO — passo 3: a reserva aponta pro cliente.
//
// A reserva guardava nome+telefone soltos, sem apontar pra ninguém. Resultado:
// quem reservava mesa devendo R$ 3 mil chegava e a casa não sabia. Agora a
// reserva carrega o cliente (resolvido pelo telefone/CPF na hora de criar).
//
// Idempotente. Roda: pnpm --filter @concilia/db migrate:reserva-cliente

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, max: 1 });

async function main() {
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES cliente(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS cliente_ligado_por varchar(12)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_reserva_cliente ON reserva (cliente_id) WHERE cliente_id IS NOT NULL`;
  // usado pra resolver o cliente pelo telefone na hora de criar a reserva
  await sql`CREATE INDEX IF NOT EXISTS idx_cliente_fone10 ON cliente (filial_id, right(regexp_replace(coalesce(telefone,''), '[^0-9]', '', 'g'), 10))`;

  // backfill: liga só quando o telefone identifica UM cliente na filial.
  // Várias reservas apontando pro mesmo cliente é normal (é a mesma pessoa
  // voltando); o que não pode é um telefone que serve a dois clientes.
  const r = await sql`
    WITH res AS (
      SELECT id, filial_id, right(regexp_replace(coalesce(cliente_telefone,''),'[^0-9]','','g'),10) k
        FROM reserva
       WHERE cliente_id IS NULL
         AND length(regexp_replace(coalesce(cliente_telefone,''),'[^0-9]','','g')) >= 10
    ), cli AS (
      SELECT filial_id, right(regexp_replace(coalesce(telefone,''),'[^0-9]','','g'),10) k,
             min(id::text) id, count(*) n
        FROM cliente
       WHERE length(regexp_replace(coalesce(telefone,''),'[^0-9]','','g')) >= 10
       GROUP BY 1,2
    )
    UPDATE reserva SET cliente_id = cli.id::uuid, cliente_ligado_por = 'telefone'
      FROM res JOIN cli ON cli.filial_id = res.filial_id AND cli.k = res.k AND cli.n = 1
     WHERE reserva.id = res.id
    RETURNING reserva.id`;

  const [s] = await sql<Array<{ n: number; ligadas: number; devendo: number }>>`
    SELECT count(*)::int n, count(cliente_id)::int ligadas,
      count(*) FILTER (WHERE cliente_id IN (
        SELECT id FROM cliente WHERE COALESCE(saldo_atual_conta_corrente,0) > 0))::int devendo
      FROM reserva`;
  console.log(`[ok] ${r.length} reservas ligadas agora`);
  console.log(`     reservas: ${s.n} · com cliente: ${s.ligadas} · de gente devendo hoje: ${s.devendo}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

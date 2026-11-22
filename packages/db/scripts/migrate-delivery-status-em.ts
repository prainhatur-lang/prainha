// Hora de cada etapa do pedido do delivery (dono 22/11/2026: "seria
// interessante ter os horários ... informar o cliente o tempo"). Idempotente.
//
// delivery_pedido.status_em = { "<status>": "<timestamptz ISO>" } com a
// PRIMEIRA vez que o pedido entrou em cada status. Quem grava é um trigger no
// banco, porque o status muda por vários caminhos (painel, caixa da loja,
// despacho do boy, iFood, expiração) — nenhum deles precisa mudar.
//
// Uso: pnpm --filter @concilia/db migrate:delivery-status-em

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  ${name}... `);
  const r = await fn();
  console.log('OK');
  return r;
}

async function main() {
  await run('delivery_pedido.status_em', () =>
    sql`ALTER TABLE delivery_pedido ADD COLUMN IF NOT EXISTS status_em jsonb NOT NULL DEFAULT '{}'::jsonb`,
  );
  await run('função delivery_pedido_status_em()', () =>
    sql.unsafe(`
      CREATE OR REPLACE FUNCTION delivery_pedido_status_em() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status IS NOT NULL
           AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status)
           AND NOT (COALESCE(NEW.status_em, '{}'::jsonb) ? NEW.status) THEN
          NEW.status_em := COALESCE(NEW.status_em, '{}'::jsonb)
            || jsonb_build_object(NEW.status, to_jsonb(now()));
        END IF;
        RETURN NEW;
      END $$;
    `),
  );
  await run('trigger', () =>
    sql.unsafe(`
      DROP TRIGGER IF EXISTS delivery_pedido_status_em_trg ON delivery_pedido;
      CREATE TRIGGER delivery_pedido_status_em_trg
        BEFORE INSERT OR UPDATE OF status ON delivery_pedido
        FOR EACH ROW EXECUTE FUNCTION delivery_pedido_status_em();
    `),
  );
  // Pedidos antigos: o que dá pra saber.
  await run('backfill pago', () =>
    sql`UPDATE delivery_pedido SET status_em = status_em || jsonb_build_object('pago', to_jsonb(pago_em))
        WHERE pago_em IS NOT NULL AND NOT (status_em ? 'pago')`,
  );
  await run('backfill saiu/entregue (despacho)', () =>
    sql`UPDATE delivery_pedido p SET status_em = p.status_em
          || CASE WHEN p.status_em ? 'saiu_entrega' THEN '{}'::jsonb
                  ELSE jsonb_build_object('saiu_entrega', to_jsonb(d.saiu_em)) END
          || CASE WHEN d.entregue_em IS NULL OR p.status_em ? 'concluido' THEN '{}'::jsonb
                  ELSE jsonb_build_object('concluido', to_jsonb(d.entregue_em)) END
        FROM delivery_despacho d WHERE d.pedido_id = p.id`,
  );
  await run('backfill status atual', () =>
    sql`UPDATE delivery_pedido SET status_em = status_em || jsonb_build_object(status, to_jsonb(atualizado_em))
        WHERE NOT (status_em ? status)`,
  );
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

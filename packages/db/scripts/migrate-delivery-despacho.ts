// Despacho do delivery com boy + Pix automático (dono 22/11/2026). Idempotente.
//
// Uso: pnpm --filter @concilia/db migrate:delivery-despacho

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
  await run('delivery_pedido.taxa_entrega_cheia', () =>
    sql`ALTER TABLE delivery_pedido ADD COLUMN IF NOT EXISTS taxa_entrega_cheia numeric(10,2)`,
  );
  await run('delivery_entregador', () =>
    sql`
      CREATE TABLE IF NOT EXISTS delivery_entregador (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        telefone varchar(20) NOT NULL UNIQUE,
        nome varchar(120),
        cpf varchar(11),
        pix_chave varchar(140),
        telefone_verificado_em timestamptz,
        otp_hash text,
        otp_expira timestamptz,
        otp_tentativas integer NOT NULL DEFAULT 0,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );
  await run('RLS delivery_entregador', () => sql`ALTER TABLE delivery_entregador ENABLE ROW LEVEL SECURITY`);
  await run('delivery_despacho', () =>
    sql`
      CREATE TABLE IF NOT EXISTS delivery_despacho (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        pedido_id uuid NOT NULL UNIQUE REFERENCES delivery_pedido(id) ON DELETE CASCADE,
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        entregador_id uuid NOT NULL REFERENCES delivery_entregador(id),
        token text NOT NULL UNIQUE,
        valor numeric(10,2) NOT NULL,
        codigo_cliente varchar(6) NOT NULL,
        tentativas integer NOT NULL DEFAULT 0,
        saiu_em timestamptz NOT NULL DEFAULT now(),
        entregue_em timestamptz,
        pix_pagamento_id uuid,
        pix_status varchar(20),
        pix_erro text,
        usuario_id uuid,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );
  await run('idx entregador', () =>
    sql`CREATE INDEX IF NOT EXISTS delivery_despacho_entregador_idx ON delivery_despacho (entregador_id, saiu_em)`,
  );
  await run('RLS delivery_despacho', () => sql`ALTER TABLE delivery_despacho ENABLE ROW LEVEL SECURITY`);

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

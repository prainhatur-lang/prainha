// Gatilho de alarme -> Tuya (ex: alarme do UniFi Protect liga as luzes via
// webhook). Tabela alarme_gatilho. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:alarme-gatilho

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  ${name}... `);
  try {
    const r = await fn();
    console.log('OK');
    return r;
  } catch (e) {
    console.log('ERRO');
    throw e;
  }
}

async function main() {
  await run('alarme_gatilho', () =>
    sql`
      CREATE TABLE IF NOT EXISTS alarme_gatilho (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        nome varchar(120) NOT NULL,
        token varchar(64) NOT NULL UNIQUE,
        dispositivo_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
        acao varchar(10) NOT NULL DEFAULT 'ligar',
        desligar_apos_min integer,
        ativo boolean NOT NULL DEFAULT true,
        disparos integer NOT NULL DEFAULT 0,
        ultimo_disparo_em timestamptz,
        ultimo_resultado text,
        ultimo_payload jsonb,
        reverter_em timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );
  await run('idx alarme_gatilho filial', () =>
    sql`CREATE INDEX IF NOT EXISTS alarme_gatilho_filial_idx ON alarme_gatilho (filial_id)`,
  );
  await run('idx alarme_gatilho reverter', () =>
    sql`CREATE INDEX IF NOT EXISTS alarme_gatilho_reverter_idx ON alarme_gatilho (reverter_em) WHERE reverter_em IS NOT NULL`,
  );
  await run('RLS alarme_gatilho', () => sql.unsafe(`ALTER TABLE alarme_gatilho ENABLE ROW LEVEL SECURITY`));

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

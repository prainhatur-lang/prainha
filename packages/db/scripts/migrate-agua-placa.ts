// Água do Prainha: placa de controle dos filtros (CLP ESP32, firmware
// prainha_agua_v3) — estado real da instalação em 28/11/2026.
// A placa só responde na rede da loja; quem fala com ela é o Concilia Loja.
// A nuvem guarda a CÓPIA do que a loja leu e uma FILA de pedidos que a loja
// busca a cada minuto (a nuvem não alcança a placa). Aqui muda:
//   - agua_placa (1 linha): último estado que a placa respondeu;
//   - agua_comandos: entregue_em (a loja buscou), solicitado_nome, ok, e o
//     CHECK do tipo ganha retro_parar e filtrar;
//   - agua_retrolavagens: id_local (id na loja), teste, origem, pedido_por.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:agua-placa

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
  await run('agua_placa', () =>
    sql.unsafe(`
      CREATE TABLE IF NOT EXISTS agua_placa (
        id smallint PRIMARY KEY,
        estado jsonb,
        lido_em timestamptz,
        erro text,
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `),
  );
  await run('RLS agua_placa', () => sql.unsafe(`ALTER TABLE agua_placa ENABLE ROW LEVEL SECURITY`));

  await run('agua_comandos (entregue_em, solicitado_nome, ok)', () =>
    sql.unsafe(`
      ALTER TABLE agua_comandos
        ADD COLUMN IF NOT EXISTS entregue_em timestamptz,
        ADD COLUMN IF NOT EXISTS solicitado_nome text,
        ADD COLUMN IF NOT EXISTS ok boolean
    `),
  );
  await run('agua_comandos.tipo (+ retro_parar, filtrar)', () =>
    sql.unsafe(`
      DO $do$
      DECLARE c record;
      BEGIN
        FOR c IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'agua_comandos'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%tipo%'
        LOOP
          EXECUTE format('ALTER TABLE agua_comandos DROP CONSTRAINT %I', c.conname);
        END LOOP;
        ALTER TABLE agua_comandos ADD CONSTRAINT agua_comandos_tipo_check
          CHECK (tipo IN ('liberar','bloquear','rearmar','retrolavar','abrir_v1','abrir_v2','retro_parar','filtrar'));
      END $do$
    `),
  );
  await run('idx agua_comandos (pendentes)', () =>
    sql.unsafe(`CREATE INDEX IF NOT EXISTS agua_comandos_pendentes ON agua_comandos (id) WHERE executado_em IS NULL`),
  );

  await run('agua_retrolavagens (id_local, teste, origem, pedido_por)', () =>
    sql.unsafe(`
      ALTER TABLE agua_retrolavagens
        ADD COLUMN IF NOT EXISTS id_local bigint,
        ADD COLUMN IF NOT EXISTS teste boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS origem text,
        ADD COLUMN IF NOT EXISTS pedido_por text
    `),
  );
  await run('idx agua_retrolavagens (id_local único)', () =>
    sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS agua_retrolavagens_id_local ON agua_retrolavagens (id_local)`),
  );

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

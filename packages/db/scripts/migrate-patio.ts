// Cria as tabelas do modulo Patio (estacionamento): patio_sessao + patio_evento.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:patio

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  CREATE TABLE patio_sessao... ');
  await sql`
    CREATE TABLE IF NOT EXISTS patio_sessao (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      codigo varchar(24) NOT NULL,
      placa varchar(10),
      placa_confianca integer,
      status varchar(20) NOT NULL DEFAULT 'aberta',
      entrada_em timestamptz NOT NULL DEFAULT now(),
      entrada_camera_id varchar(40),
      entrada_foto_url text,
      ticket_impresso boolean NOT NULL DEFAULT false,
      validada_em timestamptz,
      validacao_tipo varchar(20),
      consumo_centavos integer,
      valor_cobrado_centavos integer,
      comanda_ref varchar(40),
      tolerancia_saida_ate timestamptz,
      saida_em timestamptz,
      saida_camera_id varchar(40),
      saida_metodo varchar(20),
      observacao text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log('OK');

  process.stdout.write('  indexes patio_sessao... ');
  await sql`CREATE INDEX IF NOT EXISTS patio_sessao_filial_placa_status_idx ON patio_sessao (filial_id, placa, status)`;
  await sql`CREATE INDEX IF NOT EXISTS patio_sessao_filial_codigo_idx ON patio_sessao (filial_id, codigo)`;
  await sql`CREATE INDEX IF NOT EXISTS patio_sessao_filial_status_entrada_idx ON patio_sessao (filial_id, status, entrada_em)`;
  console.log('OK');

  process.stdout.write('  CREATE TABLE patio_evento... ');
  await sql`
    CREATE TABLE IF NOT EXISTS patio_evento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      sessao_id uuid REFERENCES patio_sessao(id) ON DELETE SET NULL,
      cancela varchar(10),
      tipo varchar(24) NOT NULL,
      placa varchar(10),
      detalhe text,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log('OK');

  process.stdout.write('  indexes patio_evento... ');
  await sql`CREATE INDEX IF NOT EXISTS patio_evento_filial_criado_idx ON patio_evento (filial_id, criado_em)`;
  await sql`CREATE INDEX IF NOT EXISTS patio_evento_sessao_idx ON patio_evento (sessao_id)`;
  console.log('OK');

  await sql.end();
  console.log('Migration patio concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

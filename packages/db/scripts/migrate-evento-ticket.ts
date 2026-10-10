// Evento com prato "de ticket": evento_ticket guarda o cadastro (casa, dia,
// nome, quem paga, valor do ticket, pratos que contam), a foto do encerramento
// e os recebimentos — é o "a receber" dos tickets.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:evento-ticket

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS evento_ticket (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      dia date NOT NULL,
      nome varchar(120) NOT NULL,
      pagador varchar(160),
      valor_ticket numeric(12,2) NOT NULL,
      produtos jsonb NOT NULL DEFAULT '[]'::jsonb,
      observacao text,
      status varchar(12) NOT NULL DEFAULT 'ABERTO',
      pratos numeric(12,3),
      valor_tickets numeric(14,2),
      valor_pdv numeric(14,2),
      encerrado_em timestamptz,
      encerrado_por uuid,
      recebimentos jsonb NOT NULL DEFAULT '[]'::jsonb,
      valor_recebido numeric(14,2) NOT NULL DEFAULT 0,
      criado_em timestamptz NOT NULL DEFAULT now(),
      criado_por uuid,
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`ALTER TABLE evento_ticket ADD COLUMN IF NOT EXISTS convidados integer`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS evento_ticket_filial_dia_idx ON evento_ticket (filial_id, dia)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS evento_ticket_status_idx ON evento_ticket (status)`);
  await sql.unsafe(`ALTER TABLE evento_ticket ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] evento_ticket pronta');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});

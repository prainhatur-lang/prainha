// Infra da reserva publica (tela do cliente): valor na reserva, tabela de OTP,
// e preco (valorCheio 30 / valorAtual 0) na config de cada filial. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:reservar-publico
//
// O token publico da filial pra /reservar reusa o avaliacao_token ja existente.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { prepare: false });

async function main() {
  process.stdout.write('  ALTER reserva ADD valor... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS valor numeric(10,2)`;
  console.log('OK');

  process.stdout.write('  CREATE TABLE reserva_otp... ');
  await sql`
    CREATE TABLE IF NOT EXISTS reserva_otp (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      telefone varchar(20) NOT NULL,
      codigo varchar(8) NOT NULL,
      expira_em timestamp with time zone NOT NULL,
      verificado_em timestamp with time zone,
      tentativas integer NOT NULL DEFAULT 0,
      criado_em timestamp with time zone NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS reserva_otp_fil_tel_idx ON reserva_otp (filial_id, telefone)`;
  console.log('OK');

  // Adiciona preco (30 -> 0) na config das filiais que ja tem reserva_config,
  // sem mexer nos espacos existentes.
  process.stdout.write('  Seed preco 30/0 nas filiais... ');
  const r = await sql<Array<{ nome: string }>>`
    UPDATE filial
    SET reserva_config = reserva_config
      || jsonb_build_object('valorCheio', 30, 'valorAtual', 0)
    WHERE reserva_config IS NOT NULL
      AND NOT (reserva_config ? 'valorCheio')
    RETURNING nome
  `;
  console.log(r.length ? `OK — ${r.map((x) => x.nome).join(', ')}` : 'ja tinha preco (mantido)');

  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });

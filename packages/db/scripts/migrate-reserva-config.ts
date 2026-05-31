// Adiciona filial.reserva_config (espacos + hora limite) e seeda o Prainha Bar.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:reserva-config

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { prepare: false });

const PRAINHA_BAR = {
  areas: [
    { nome: 'Areia', ativo: true, horaLimite: '18:00' },
    { nome: 'Deck Superior', ativo: true, horaLimite: '18:00' },
    { nome: 'Lounges', ativo: true, horaLimite: '18:00' },
    { nome: "Terra'xo", ativo: false, somenteEventos: true },
  ],
};

async function main() {
  process.stdout.write('  ALTER filial ADD reserva_config... ');
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS reserva_config jsonb`;
  console.log('OK');

  process.stdout.write('  Seed espacos do Prainha Bar (so se ainda nao tiver)... ');
  const r = await sql<Array<{ nome: string }>>`
    UPDATE filial
    SET reserva_config = ${sql.json(PRAINHA_BAR)}
    WHERE nome ILIKE '%Prainha Bar%' AND reserva_config IS NULL
    RETURNING nome
  `;
  console.log(r.length ? `OK — ${r.map((x) => x.nome).join(', ')}` : 'ja configurado (mantido)');

  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });

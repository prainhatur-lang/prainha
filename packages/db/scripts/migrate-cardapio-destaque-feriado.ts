// cardapio_destaque: "exceto feriados" + horários que o dono passou (26/10/2026):
//   almoço executivo 11h30 às 15h; happy hour seg a sex, 12h às 20h; exceto feriados.
// A coluna nasce ligada (true): destaque não vale em feriado (nacional, de
// Sergipe e de Aracaju — mesma lista das reservas). Os UPDATEs só mexem em
// quem ainda está no horário da semente, pra não desfazer o que alguém salvou
// na tela depois.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:cardapio-destaque-feriado

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE cardapio_destaque ADD COLUMN IF NOT EXISTS exceto_feriados boolean NOT NULL DEFAULT true`);
  console.log('[ok] coluna exceto_feriados');

  const a = await sql`
    UPDATE cardapio_destaque SET hora_inicio = '11:30', hora_fim = '15:00', atualizado_por = 'migracao 26/10', atualizado_em = now()
     WHERE titulo IN ('Almoço executivo', 'Almoço convidativo') AND hora_inicio = '11:00' AND hora_fim = '15:00'
     RETURNING filial_id, titulo`;
  console.log('[ok] almoço 11h30–15h:', a.length);
  const h = await sql`
    UPDATE cardapio_destaque SET dias_semana = '{1,2,3,4,5}', hora_inicio = '12:00', hora_fim = '20:00',
           atualizado_por = 'migracao 26/10', atualizado_em = now()
     WHERE titulo = 'Happy hour' AND hora_inicio = '17:00' AND hora_fim = '19:00'
     RETURNING filial_id, titulo`;
  console.log('[ok] happy hour seg–sex 12h–20h:', h.length);
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });

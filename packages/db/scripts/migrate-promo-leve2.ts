// promo_leve2_horario: "paga 1 leva 2" (chope dobrado) só num horário — happy
// hour. Pedido do dono 31/10/2026 (aba Promoções, igual à do Consumer).
//
// Na virada o cron /api/cron/combo-horario liga/desliga produto.dobrado_vale;
// a loja puxa a marca pelo /api/loja/catalogo-nuvem (5 min). Só age na virada
// (estado_aplicado 'dentro' | 'fora').
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:promo-leve2

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS promo_leve2_horario (
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
      ativa boolean NOT NULL DEFAULT true,
      dias_semana smallint[] NOT NULL DEFAULT '{}',
      hora_inicio time,
      hora_fim time,
      exceto_feriados boolean NOT NULL DEFAULT true,
      estado_aplicado text,
      aplicado_em timestamptz,
      atualizado_por text,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (filial_id, produto_id)
    )`);
  await sql.unsafe(`ALTER TABLE promo_leve2_horario ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] promo_leve2_horario (+ RLS)');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });

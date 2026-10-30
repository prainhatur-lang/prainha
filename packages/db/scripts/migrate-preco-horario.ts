// preco_horario: o MESMO produto muda de preço por horário (happy hour:
// isca de R$ 60 vira R$ 49 de seg a sex, 12h–20h). Pedido do dono 30/10/2026.
//
// Na virada o cron /api/cron/combo-horario enfileira preco_venda na fila
// produto_alteracao (a loja aplica no PDV): dentro = preco_horario, fora =
// preco_normal. Só age na virada (estado_aplicado 'dentro' | 'fora').
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:preco-horario

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS preco_horario (
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      codigo_variante_externo integer NOT NULL,
      ativa boolean NOT NULL DEFAULT true,
      preco_normal numeric(12,2) NOT NULL,
      preco_horario numeric(12,2) NOT NULL,
      dias_semana smallint[] NOT NULL DEFAULT '{}',
      hora_inicio time,
      hora_fim time,
      exceto_feriados boolean NOT NULL DEFAULT true,
      estado_aplicado text,
      aplicado_em timestamptz,
      atualizado_por text,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (filial_id, codigo_variante_externo)
    )`);
  await sql.unsafe(`ALTER TABLE preco_horario ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] preco_horario (+ RLS)');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });

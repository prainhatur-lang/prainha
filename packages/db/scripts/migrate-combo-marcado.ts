// combo_marcado: quais produtos são COMBO de verdade na tela
// /cadastros/produtos/combos. Pelos dados não dá pra separar — prato com
// acompanhamento, cachaça, café e vinho também têm etapa que lança produto —
// então a marcação é explícita. "Montar combo" marca o que cria; o resto se
// marca pela lista completa ("mostrar todos").
//
// Semeia o Almoço executivo do Prainha Bar (2757) e da Prainha Mar (1722).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:combo-marcado

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS combo_marcado (
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      codigo_variante_externo integer NOT NULL,
      criado_por text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (filial_id, codigo_variante_externo)
    )
  `);
  await sql.unsafe(`ALTER TABLE combo_marcado ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] combo_marcado pronta');

  const semente: Array<[string, number]> = [
    ['7c5c66ce-cceb-4e89-9c6d-d0785255c4f9', 2757], // 01 Prainha Bar — Almoço executivo
    ['e899dae2-38bf-4f3f-9149-7effd059fab8', 1722], // 03 Prainha Mar — Almoço executivo
  ];
  for (const [filial, codigo] of semente) {
    await sql`
      INSERT INTO combo_marcado (filial_id, codigo_variante_externo, criado_por)
      VALUES (${filial}, ${codigo}, 'migrate-combo-marcado')
      ON CONFLICT DO NOTHING`;
  }
  console.log('[ok] Almoço executivo marcado no Bar e na Mar');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});

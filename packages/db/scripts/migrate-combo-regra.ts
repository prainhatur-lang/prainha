// combo_regra: QUANDO o combo vale — dias da semana, faixa de hora e calendário
// (vigência de/até, dias fora e dias extras). É o que separa o combo do prato
// com perguntas: o combo tem horário.
//
// Fora da regra o combo é PAUSADO pela fila produto_alteracao (o mesmo
// caminho do botão pausar) e some do garçom, do caixa e da LIO; dentro, volta.
// Quem aplica é o cron /api/cron/combo-horario, e só na VIRADA (estado_aplicado
// muda) — pausa manual no meio da janela não é desfeita a cada 5 min.
// Combo sem regra = vale sempre (como era antes).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:combo-regra

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS combo_regra (
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      codigo_variante_externo integer NOT NULL,
      ativa boolean NOT NULL DEFAULT true,
      dias_semana smallint[] NOT NULL DEFAULT '{}',
      hora_inicio time,
      hora_fim time,
      data_inicio date,
      data_fim date,
      datas_fora date[] NOT NULL DEFAULT '{}',
      datas_extra date[] NOT NULL DEFAULT '{}',
      estado_aplicado text,
      aplicado_em timestamptz,
      atualizado_por text,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (filial_id, codigo_variante_externo)
    )
  `);
  await sql.unsafe(`ALTER TABLE combo_regra ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] combo_regra pronta');
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});

// Portadores do dinheiro em espécie (/financeiro/portadores): portador (Cofre,
// Elison, Marta… por casa) e portador_movimento (sangria que sobe da loja,
// entrega entre portadores, depósito, pagamento, ajuste). Ver
// packages/db/src/schema/portador.ts.
//
// Já cadastra Cofre, Elison e Marta nas 3 casas (pedido do dono, 15/10/2026).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:portador

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const CASAS = [
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9', // 01 Prainha Bar
  'fde37b95-7c7e-4b41-a618-2aba1fbc0de7', // 02 Tabuará
  'e899dae2-38bf-4f3f-9149-7effd059fab8', // 03 Prainha Mar
];
const INICIAIS: Array<[string, string]> = [
  ['Cofre', 'COFRE'],
  ['Elison', 'PESSOA'],
  ['Marta', 'PESSOA'],
];

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS portador (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      nome varchar(80) NOT NULL,
      tipo varchar(10) NOT NULL DEFAULT 'PESSOA',
      ativo boolean NOT NULL DEFAULT true,
      criado_por uuid REFERENCES usuario(id),
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_portador_filial_nome ON portador (filial_id, nome)`);
  await sql.unsafe(`ALTER TABLE portador ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] portador pronta (RLS ligado)');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS portador_movimento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      portador_id uuid REFERENCES portador(id),
      data date NOT NULL,
      tipo varchar(12) NOT NULL,
      valor numeric(14,2) NOT NULL,
      descricao text,
      quem_levou varchar(120),
      codigo_referencia varchar(60),
      par_id uuid,
      criado_por uuid REFERENCES usuario(id),
      criado_em timestamptz NOT NULL DEFAULT now(),
      excluido_em timestamptz,
      excluido_por uuid REFERENCES usuario(id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_portador_mov_filial_data ON portador_movimento (filial_id, data)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_portador_mov_portador ON portador_movimento (portador_id)`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_portador_mov_ref ON portador_movimento (filial_id, codigo_referencia)`);
  await sql.unsafe(`ALTER TABLE portador_movimento ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] portador_movimento pronta (RLS ligado)');

  for (const casa of CASAS) {
    for (const [nome, tipo] of INICIAIS) {
      await sql`INSERT INTO portador (filial_id, nome, tipo) VALUES (${casa}, ${nome}, ${tipo})
        ON CONFLICT (filial_id, nome) DO NOTHING`;
    }
  }
  console.log('[ok] Cofre, Elison e Marta nas 3 casas');

  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });

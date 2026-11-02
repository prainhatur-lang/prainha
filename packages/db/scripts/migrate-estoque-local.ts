// Setores de estoque + transferência entre setores (02/11/2026).
// Tabelas estoque_local e estoque_transferencia_local (com RLS).
// Os setores iniciais (Depósito, Recepção, Bar, Cozinha) são criados pela
// tela /estoque/locais na primeira vez que a casa abre.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:estoque-local

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS estoque_local (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      nome varchar(60) NOT NULL,
      ordem integer NOT NULL DEFAULT 0,
      principal boolean NOT NULL DEFAULT false,
      ativo boolean NOT NULL DEFAULT true,
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_estoque_local_nome UNIQUE (filial_id, nome)
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_estoque_local_filial ON estoque_local (filial_id, ordem)`);
  // um principal por casa
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_local_principal ON estoque_local (filial_id) WHERE principal`);
  await sql.unsafe(`ALTER TABLE estoque_local ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] estoque_local (+ RLS)');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS estoque_transferencia_local (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
      quantidade numeric(14,4) NOT NULL,
      unidade varchar(10),
      local_origem_id uuid NOT NULL REFERENCES estoque_local(id) ON DELETE RESTRICT,
      local_destino_id uuid NOT NULL REFERENCES estoque_local(id) ON DELETE RESTRICT,
      funcionario_id uuid REFERENCES funcionario(id) ON DELETE SET NULL,
      pessoa_nome varchar(200) NOT NULL,
      foto_path text,
      observacao text,
      data_hora timestamptz NOT NULL DEFAULT now(),
      criado_por uuid,
      criado_por_email text,
      cancelada_em timestamptz,
      cancelada_por text,
      motivo_cancelamento text
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_estoque_transf_local_data ON estoque_transferencia_local (filial_id, data_hora)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_estoque_transf_local_produto ON estoque_transferencia_local (filial_id, produto_id)`);
  await sql.unsafe(`ALTER TABLE estoque_transferencia_local ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] estoque_transferencia_local (+ RLS)');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});

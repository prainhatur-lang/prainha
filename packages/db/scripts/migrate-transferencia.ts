// Transferência entre casas + encontro de contas mensal:
// tabelas transferencia_filial, transferencia_filial_item, encontro_contas.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:transferencia

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  ${name}... `);
  try {
    const r = await fn();
    console.log('OK');
    return r;
  } catch (e) {
    console.log('ERRO');
    throw e;
  }
}

async function main() {
  console.log('[1] Tabelas');
  await run('transferencia_filial', () =>
    sql`
      CREATE TABLE IF NOT EXISTS transferencia_filial (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        numero serial NOT NULL,
        filial_origem_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        filial_destino_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        data date NOT NULL,
        competencia varchar(7) NOT NULL,
        valor_total numeric(14,2) NOT NULL,
        nota_compra_id uuid REFERENCES nota_compra(id) ON DELETE SET NULL,
        conta_pagar_id uuid,
        status varchar(12) NOT NULL DEFAULT 'ABERTA',
        encontro_id uuid,
        observacao text,
        criado_por uuid,
        criado_em timestamptz NOT NULL DEFAULT now(),
        cancelado_por uuid,
        cancelado_em timestamptz
      )
    `,
  );
  await run('idx_transf_origem', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_transf_origem ON transferencia_filial (filial_origem_id, competencia)`,
  );
  await run('idx_transf_destino', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_transf_destino ON transferencia_filial (filial_destino_id, competencia)`,
  );
  await run('idx_transf_nota', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_transf_nota ON transferencia_filial (nota_compra_id)`,
  );

  await run('transferencia_filial_item', () =>
    sql`
      CREATE TABLE IF NOT EXISTS transferencia_filial_item (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        transferencia_id uuid NOT NULL REFERENCES transferencia_filial(id) ON DELETE CASCADE,
        produto_origem_id uuid NOT NULL REFERENCES produto(id) ON DELETE RESTRICT,
        produto_destino_id uuid NOT NULL REFERENCES produto(id) ON DELETE RESTRICT,
        descricao text,
        quantidade numeric(14,4) NOT NULL,
        custo_unitario numeric(14,6) NOT NULL,
        valor_total numeric(14,2) NOT NULL,
        mov_saida_id uuid,
        mov_entrada_id uuid
      )
    `,
  );
  await run('idx_transf_item_transf', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_transf_item_transf ON transferencia_filial_item (transferencia_id)`,
  );

  await run('encontro_contas', () =>
    sql`
      CREATE TABLE IF NOT EXISTS encontro_contas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        competencia varchar(7) NOT NULL,
        filial_devedora_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        filial_credora_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        valor_devedora numeric(14,2) NOT NULL,
        valor_credora numeric(14,2) NOT NULL,
        valor_liquido numeric(14,2) NOT NULL,
        conta_pagar_id uuid,
        data date NOT NULL,
        criado_por uuid,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );
  await run('idx_encontro_comp', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_encontro_comp ON encontro_contas (competencia)`,
  );

  console.log('[2] RLS (deny-all pro PostgREST; app acessa via role postgres)');
  for (const t of ['transferencia_filial', 'transferencia_filial_item', 'encontro_contas']) {
    await run(`RLS ${t}`, () => sql.unsafe(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`));
  }

  console.log('Pronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

// NF-e (modelo 55) de transferência entre casas: nota emitida + numeração.
// Idempotente. Tabela nova → termina com ENABLE ROW LEVEL SECURITY.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

async function main() {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_DIRECT/DATABASE_URL ausente');
  const sql = postgres(url, { prepare: false, ssl: 'require' });
  const run = async (name: string, fn: () => Promise<unknown>) => {
    process.stdout.write(`${name}... `);
    await fn();
    console.log('ok');
  };

  await run('nfe_emitida', () => sql`
    CREATE TABLE IF NOT EXISTS nfe_emitida (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      ambiente integer NOT NULL,
      serie integer NOT NULL,
      numero integer NOT NULL,
      chave varchar(44) NOT NULL,
      cnf varchar(8) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'PENDENTE',
      cstat varchar(8),
      xmotivo text,
      protocolo varchar(20),
      autorizada_em timestamptz,
      cancelada_em timestamptz,
      protocolo_cancelamento varchar(20),
      justificativa_cancelamento text,
      transferencia_id uuid REFERENCES transferencia_filial(id) ON DELETE SET NULL,
      filial_destino_id uuid REFERENCES filial(id) ON DELETE SET NULL,
      dest_cnpj varchar(14),
      natureza_operacao varchar(60) NOT NULL,
      valor_total numeric(14,2) NOT NULL,
      itens jsonb NOT NULL,
      info_extra text,
      xml text,
      erro text,
      solicitado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await run('nfe_chave_uq', () => sql`CREATE UNIQUE INDEX IF NOT EXISTS nfe_chave_uq ON nfe_emitida (chave)`);
  await run('nfe_filial_serie_numero_uq', () => sql`
    CREATE UNIQUE INDEX IF NOT EXISTS nfe_filial_serie_numero_uq ON nfe_emitida (filial_id, ambiente, serie, numero)
  `);
  await run('nfe_transf_viva_uq', () => sql`
    CREATE UNIQUE INDEX IF NOT EXISTS nfe_transf_viva_uq ON nfe_emitida (transferencia_id, ambiente)
      WHERE status IN ('PENDENTE', 'AUTORIZADA') AND transferencia_id IS NOT NULL
  `);
  await run('nfe_transf_idx', () => sql`CREATE INDEX IF NOT EXISTS nfe_transf_idx ON nfe_emitida (transferencia_id)`);
  await run('nfe_filial_idx', () => sql`CREATE INDEX IF NOT EXISTS nfe_filial_idx ON nfe_emitida (filial_id, criado_em)`);
  await run('nfe_emitida RLS', () => sql`ALTER TABLE nfe_emitida ENABLE ROW LEVEL SECURITY`);

  await run('nfe_numeracao', () => sql`
    CREATE TABLE IF NOT EXISTS nfe_numeracao (
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      serie integer NOT NULL,
      ambiente integer NOT NULL,
      ultimo_numero integer NOT NULL DEFAULT 0,
      PRIMARY KEY (filial_id, serie, ambiente)
    )
  `);
  await run('nfe_numeracao RLS', () => sql`ALTER TABLE nfe_numeracao ENABLE ROW LEVEL SECURITY`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

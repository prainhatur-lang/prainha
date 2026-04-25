// Cria tabela colaborador (cozinheiros, garçons, etc) + popula a partir
// dos responsavel livres já existentes nas OPs.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('Criando tabela colaborador...');
  await sql`
    CREATE TABLE IF NOT EXISTS colaborador (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      nome varchar(100) NOT NULL,
      tipo varchar(20) NOT NULL DEFAULT 'COZINHA',
      ativo boolean NOT NULL DEFAULT true,
      ultima_atividade_em timestamptz,
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_colab_filial_nome UNIQUE (filial_id, nome)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_colab_tipo ON colaborador (filial_id, tipo)`;
  console.log('  OK');

  // Popula com nomes únicos já em uso nas OPs
  console.log('Populando a partir dos responsavel das OPs existentes...');
  const inseridos = await sql`
    INSERT INTO colaborador (filial_id, nome, tipo, ultima_atividade_em)
    SELECT
      filial_id,
      TRIM(responsavel) AS nome,
      'COZINHA',
      MAX(COALESCE(concluida_em, data_hora))
    FROM ordem_producao
    WHERE responsavel IS NOT NULL
      AND TRIM(responsavel) <> ''
    GROUP BY filial_id, TRIM(responsavel)
    ON CONFLICT (filial_id, nome) DO NOTHING
    RETURNING id
  `;
  console.log(`  ${inseridos.length} colaborador(es) populados`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

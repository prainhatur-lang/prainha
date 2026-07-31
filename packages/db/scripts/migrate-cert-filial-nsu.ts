// Cria tabela cert_filial_nsu — checkpoint NSU separado por (certificado, filial).
// Necessario quando cert e compartilhado pra varias filiais (cada filial tem
// sequencia NSU propria na SEFAZ).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:cert-filial-nsu

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  CREATE TABLE cert_filial_nsu... ');
  await sql`
    CREATE TABLE IF NOT EXISTS cert_filial_nsu (
      cert_id uuid NOT NULL REFERENCES certificado_filial(id) ON DELETE CASCADE,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      ultimo_nsu varchar(15) NOT NULL DEFAULT '000000000000000',
      ultima_consulta_em timestamp with time zone,
      PRIMARY KEY (cert_id, filial_id)
    )
  `;
  console.log('OK');

  process.stdout.write('  Migrando NSU existente do certificado_filial pro novo modelo... ');
  // Pra cada cert ativo, copia o ultimoNsu pro par (cert, sua_propria_filial).
  // Filiais "compartilhadas" comecam do zero (porque o NSU do cert se referia
  // ao CNPJ original, nao serve pras outras filiais).
  await sql`
    INSERT INTO cert_filial_nsu (cert_id, filial_id, ultimo_nsu, ultima_consulta_em)
    SELECT id, filial_id, COALESCE(ultimo_nsu, '000000000000000'), ultima_consulta_sefaz
    FROM certificado_filial
    WHERE ativo = true
    ON CONFLICT (cert_id, filial_id) DO NOTHING
  `;
  console.log('OK');

  console.log('\nMigration concluida.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

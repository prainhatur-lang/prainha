// Várias chaves Pix por empresa, cada uma com o banco (empresa_pix_chave).
// Dono, 11/11/2026: "tem mais de um Pix. Tem um que é o CNPJ, de um banco; tem
// a chave aleatória, que é de outro banco." Ver schema/empresa-pix.ts.
//
// Semeia só o que o dono já passou:
//  - a chave que já está no cadastro único (filial.pix_transf_chave) entra como principal;
//  - as chaves da Sicredi que ele informou (Bar = CNPJ, print de 10/11; Tabuará e
//    Mar = aleatórias, 11/11) entram com o banco "Sicredi".
// Não deduz chave nenhuma e não troca a principal de ninguém.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:empresa-pix-chaves

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const SICREDI: Array<{ filialId: string; chave: string }> = [
  { filialId: '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9', chave: '33159574000166' }, // Prainha Bar
  { filialId: 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7', chave: 'c2f667b4-1087-456d-9a77-7aafd17f22c2' }, // Tabuará
  { filialId: 'e899dae2-38bf-4f3f-9149-7effd059fab8', chave: 'a7e20858-4d74-4935-beae-baa32bee59a4' }, // Prainha Mar
];

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS empresa_pix_chave (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      chave varchar(100) NOT NULL,
      banco varchar(60),
      favorecido varchar(200),
      principal boolean NOT NULL DEFAULT false,
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      removido_por uuid,
      removido_em timestamptz
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_empresa_pix_chave_filial ON empresa_pix_chave (filial_id)`);
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_empresa_pix_chave_ativa
      ON empresa_pix_chave (filial_id, chave) WHERE removido_em IS NULL
  `);
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_empresa_pix_chave_principal
      ON empresa_pix_chave (filial_id) WHERE principal AND removido_em IS NULL
  `);
  await sql.unsafe(`ALTER TABLE empresa_pix_chave ENABLE ROW LEVEL SECURITY`);

  // a chave do cadastro único vira a principal
  const p = await sql`
    INSERT INTO empresa_pix_chave (filial_id, chave, favorecido, principal, criado_por)
    SELECT f.id, btrim(f.pix_transf_chave), f.pix_transf_favorecido, true, f.pix_transf_por
      FROM filial f
     WHERE nullif(btrim(f.pix_transf_chave), '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM empresa_pix_chave c WHERE c.filial_id = f.id AND c.removido_em IS NULL AND (c.principal OR c.chave = btrim(f.pix_transf_chave)))
    RETURNING id
  `;
  console.log(`[ok] ${p.length} chave(s) principal(is) trazida(s) do cadastro único`);

  for (const s of SICREDI) {
    const novo = await sql`
      INSERT INTO empresa_pix_chave (filial_id, chave, banco)
      SELECT ${s.filialId}::uuid, ${s.chave}, 'Sicredi'
       WHERE EXISTS (SELECT 1 FROM filial WHERE id = ${s.filialId}::uuid)
         AND NOT EXISTS (SELECT 1 FROM empresa_pix_chave c WHERE c.filial_id = ${s.filialId}::uuid AND c.chave = ${s.chave} AND c.removido_em IS NULL)
      RETURNING id
    `;
    const banco = await sql`
      UPDATE empresa_pix_chave SET banco = 'Sicredi'
       WHERE filial_id = ${s.filialId}::uuid AND chave = ${s.chave} AND removido_em IS NULL AND banco IS NULL
      RETURNING id
    `;
    if (novo.length || banco.length) console.log(`[ok] Sicredi ${s.chave}: ${novo.length ? 'incluída' : 'banco anotado'}`);
  }
  console.log('[ok] empresa_pix_chave pronta (RLS ligado)');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

// Cadastro único do Pix de cada empresa (filial.pix_transf_*): a chave em que a
// empresa RECEBE das outras empresas do sistema (empréstimo/mútuo, repasse).
// Pedido do dono 11/11/2026: "faz um cadastro único de Pix de cada empresa pra
// a gente não ficar perguntando toda hora qual é o Pix".
//
// Além das colunas, aproveita o que o dono JÁ autorizou: se a empresa está
// cadastrada como fornecedor em alguma casa (mesmo CNPJ) com UMA chave só,
// essa chave vira a do cadastro único e é copiada pros cadastros dela que
// estão sem chave. Não deduz chave de CNPJ nem troca chave que já existe.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:empresa-pix

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE filial
      ADD COLUMN IF NOT EXISTS pix_transf_chave varchar(100),
      ADD COLUMN IF NOT EXISTS pix_transf_favorecido varchar(200),
      ADD COLUMN IF NOT EXISTS pix_transf_por uuid,
      ADD COLUMN IF NOT EXISTS pix_transf_em timestamptz
  `);

  const empresas = await sql<{ id: string; nome: string; doc: string; chave: string | null }[]>`
    SELECT id, nome, regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') AS doc, pix_transf_chave AS chave
      FROM filial
     WHERE length(regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g')) = 14
       AND cnpj !~ '^0+$'
  `;
  for (const e of empresas) {
    let chave = e.chave;
    let favorecido: string | null = null;
    if (!chave) {
      const achadas = await sql<{ chave: string; fav: string | null }[]>`
        SELECT DISTINCT btrim(chave_pix) AS chave, max(nullif(btrim(pix_favorecido), '')) AS fav
          FROM fornecedor
         WHERE data_delete IS NULL
           AND regexp_replace(coalesce(cnpj_ou_cpf, ''), '\\D', '', 'g') = ${e.doc}
           AND nullif(btrim(chave_pix), '') IS NOT NULL
         GROUP BY 1
      `;
      if (achadas.length !== 1) {
        console.log(`[--] ${e.nome}: ${achadas.length === 0 ? 'nenhuma chave cadastrada — o dono informa na tela' : 'mais de uma chave — o dono escolhe na tela'}`);
        continue;
      }
      chave = achadas[0].chave;
      favorecido = achadas[0].fav;
      await sql`
        UPDATE filial SET pix_transf_chave = ${chave}, pix_transf_favorecido = ${favorecido}, pix_transf_em = now()
         WHERE id = ${e.id}::uuid AND pix_transf_chave IS NULL
      `;
      console.log(`[ok] ${e.nome}: cadastro único = ${chave}`);
    } else {
      const [f] = await sql<{ fav: string | null }[]>`SELECT pix_transf_favorecido AS fav FROM filial WHERE id = ${e.id}::uuid`;
      favorecido = f?.fav ?? null;
    }
    const cop = await sql`
      UPDATE fornecedor
         SET chave_pix = ${chave}, pix_favorecido = coalesce(nullif(btrim(pix_favorecido), ''), ${favorecido})
       WHERE data_delete IS NULL
         AND regexp_replace(coalesce(cnpj_ou_cpf, ''), '\\D', '', 'g') = ${e.doc}
         AND nullif(btrim(chave_pix), '') IS NULL
      RETURNING id
    `;
    if (cop.length) console.log(`     copiada pra ${cop.length} cadastro(s) de fornecedor sem chave`);
  }
  console.log('[ok] empresa-pix pronta');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

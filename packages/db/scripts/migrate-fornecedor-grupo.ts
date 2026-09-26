// CADASTRO ÚNICO DE FORNECEDOR — liga as linhas da mesma empresa nas 3 casas
// pelo grupo_economico (a tabela já existia no banco, sem uso no código).
//
// Idempotente. Liga:
//   1. quem tem CNPJ/CPF e ainda não tem grupo, quando outra linha da mesma
//      empresa (raiz do CNPJ / CPF) já tem → herda o grupo;
//   2. empresas (mesmo documento) sem grupo que estão em mais de uma casa ou
//      são de compras → grupo novo;
//   3. sem documento: mesmo nome exato em mais de uma casa, sendo de compras
//      em alguma → grupo novo.
// Linhas "*Excluído*" e deletadas ficam de fora.
//
// Uso: pnpm --filter @concilia/db migrate:fornecedor-grupo

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function run<T>(n: string, f: () => Promise<T>) {
  process.stdout.write(`  ${n}... `);
  const r = await f();
  console.log('OK');
  return r;
}

const BASE = `
  SELECT fo.id, fo.filial_id, fi.organizacao_id AS org, fo.grupo_economico_id AS g,
         fo.nome, fo.ativo_compras,
         CASE
           WHEN length(regexp_replace(coalesce(fo.cnpj_ou_cpf, ''), '\\D', '', 'g')) = 14
             THEN 'c' || left(regexp_replace(fo.cnpj_ou_cpf, '\\D', '', 'g'), 8)
           WHEN length(regexp_replace(coalesce(fo.cnpj_ou_cpf, ''), '\\D', '', 'g')) = 11
             THEN 'p' || regexp_replace(fo.cnpj_ou_cpf, '\\D', '', 'g')
         END AS c
    FROM fornecedor fo JOIN filial fi ON fi.id = fo.filial_id
   WHERE fo.data_delete IS NULL
     AND coalesce(fo.nome, '') NOT ILIKE '%excluído%'
     AND coalesce(fo.nome, '') NOT ILIKE '%excluido%'`;

async function main() {
  await run('grupo_economico', () =>
    sql`
      CREATE TABLE IF NOT EXISTS grupo_economico (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
        nome varchar(200) NOT NULL,
        cnpj_raiz varchar(8),
        fone_principal varchar(50),
        email varchar(200),
        valor_pedido_minimo numeric(14,2),
        observacao text,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_grupo_economico_nome UNIQUE (organizacao_id, nome)
      )`,
  );
  await run('RLS grupo_economico', () => sql`ALTER TABLE grupo_economico ENABLE ROW LEVEL SECURITY`);
  await run('fornecedor.grupo_economico_id', () =>
    sql`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS grupo_economico_id uuid REFERENCES grupo_economico(id) ON DELETE SET NULL`,
  );
  await run('fornecedor.contato_travado', () =>
    sql`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS contato_travado boolean NOT NULL DEFAULT false`,
  );
  await run('idx fornecedor grupo', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_fornecedor_grupo ON fornecedor (grupo_economico_id)`,
  );

  await sql.begin(async (tx) => {
    const herdou = await tx.unsafe(`
      WITH k AS (${BASE})
      UPDATE fornecedor f SET grupo_economico_id = x.g
        FROM (SELECT DISTINCT ON (a.id) a.id, b.g
                FROM k a JOIN k b ON b.org = a.org AND b.c = a.c AND b.g IS NOT NULL
               WHERE a.g IS NULL AND a.c IS NOT NULL
               ORDER BY a.id, b.g) x
       WHERE f.id = x.id
      RETURNING f.id`);
    console.log(`  1. herdaram grupo pelo documento: ${herdou.length}`);

    const porDoc = await tx.unsafe(`
      WITH k AS (${BASE})
      SELECT org, c AS chave,
             (array_agg(nome ORDER BY ativo_compras DESC, nome))[1] AS nome,
             array_agg(id) AS ids
        FROM k WHERE g IS NULL AND c IS NOT NULL
       GROUP BY org, c
      HAVING count(DISTINCT filial_id) > 1 OR bool_or(ativo_compras)`);
    const porNome = await tx.unsafe(`
      WITH k AS (${BASE})
      SELECT org, upper(trim(nome)) AS chave, min(nome) AS nome, array_agg(id) AS ids
        FROM k WHERE g IS NULL AND c IS NULL AND coalesce(trim(nome), '') <> ''
       GROUP BY org, upper(trim(nome))
      HAVING count(DISTINCT filial_id) > 1 AND bool_or(ativo_compras)`);

    let novos = 0;
    let ligados = 0;
    for (const r of [...porDoc, ...porNome]) {
      const chave = String(r.chave);
      const [g] = await tx`
        INSERT INTO grupo_economico (organizacao_id, nome, cnpj_raiz)
        VALUES (${r.org}, ${String(r.nome ?? '(sem nome)').slice(0, 200)},
                ${chave.startsWith('c') && chave.length === 9 ? chave.slice(1) : null})
        ON CONFLICT (organizacao_id, nome) DO UPDATE SET atualizado_em = now()
        RETURNING id`;
      const u = await tx`
        UPDATE fornecedor SET grupo_economico_id = ${g.id}
         WHERE id = ANY(${r.ids}::uuid[]) AND grupo_economico_id IS NULL
        RETURNING id`;
      novos++;
      ligados += u.length;
    }
    console.log(`  2/3. grupos novos: ${novos} (por documento ${porDoc.length}, por nome ${porNome.length}), linhas ligadas: ${ligados}`);
  });

  const [t] = await sql`
    SELECT count(*) FILTER (WHERE grupo_economico_id IS NOT NULL) AS com_grupo, count(*) AS total
      FROM fornecedor WHERE data_delete IS NULL`;
  console.log(`  fornecedores com grupo: ${t.com_grupo}/${t.total}`);
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

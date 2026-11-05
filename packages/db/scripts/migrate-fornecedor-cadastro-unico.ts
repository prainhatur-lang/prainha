// CADASTRO ÚNICO DE FORNECEDOR, de verdade (05/11/2026). O dono: "é o mesmo, já
// falei 20 vezes em unificar fornecedores, pra que 2 cadastros?" — a Vidromax
// do Bar e a da Mar (sem CNPJ) estavam soltas: a chave Pix de uma não valia na
// outra. O migrate:fornecedor-grupo só ligava por nome quem era "de compras".
//
// Agora, no banco (vale pra TODA tela, sync e importação):
//   · trigger: fornecedor novo (ou que mudou nome/documento) sem grupo entra no
//     grupo da mesma empresa nas casas da organização — mesmo CNPJ raiz/CPF, ou
//     mesmo nome (sem acento/caixa/espaço) quando os documentos não brigam;
//   · fornecedor novo herda o que estiver vazio (Pix, banco, documento, contato)
//     da linha irmã — cadastrou numa casa, já está pronto nas outras;
//   · backfill: liga as linhas soltas de hoje e completa a chave Pix vazia
//     quando o grupo tem UMA chave só.
// Cada casa continua com a sua linha (código do PDV é por loja); a edição numa
// casa já é replicada nas irmãs pelo PATCH (propagarParaIrmaos).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fornecedor-cadastro-unico

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

async function main() {
  await run('função nome normalizado', () => sql.unsafe(`
    CREATE OR REPLACE FUNCTION fornecedor_nome_norm(t text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
      SELECT lower(regexp_replace(trim(translate(coalesce(t, ''),
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
        'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '\\s+', ' ', 'g'))
    $$`));

  await run('função chave do documento', () => sql.unsafe(`
    CREATE OR REPLACE FUNCTION fornecedor_chave_doc(d text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
      SELECT CASE
        WHEN length(regexp_replace(coalesce(d, ''), '\\D', '', 'g')) = 14
          THEN 'c' || left(regexp_replace(d, '\\D', '', 'g'), 8)
        WHEN length(regexp_replace(coalesce(d, ''), '\\D', '', 'g')) = 11
          THEN 'p' || regexp_replace(d, '\\D', '', 'g')
      END
    $$`));

  await run('função do trigger', () => sql.unsafe(`
    CREATE OR REPLACE FUNCTION fornecedor_ligar_grupo() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      v_org uuid;
      v_chave text := fornecedor_chave_doc(NEW.cnpj_ou_cpf);
      v_nome text := fornecedor_nome_norm(NEW.nome);
      v_grupo uuid;
      v_achou boolean;
      s record;
    BEGIN
      IF NEW.data_delete IS NOT NULL OR NEW.grupo_economico_id IS NOT NULL THEN
        RETURN NEW;
      END IF;
      IF v_chave IS NULL AND (length(v_nome) < 3 OR v_nome LIKE '%exclu%') THEN
        RETURN NEW;
      END IF;
      SELECT organizacao_id INTO v_org FROM filial WHERE id = NEW.filial_id;
      IF v_org IS NULL THEN RETURN NEW; END IF;

      -- Irmã da mesma empresa: documento igual, ou nome igual sem documento
      -- que brigue. Prefere a que já tem grupo e a que tem chave Pix.
      SELECT f.* INTO s
        FROM fornecedor f JOIN filial fi ON fi.id = f.filial_id
       WHERE fi.organizacao_id = v_org
         AND f.id IS DISTINCT FROM NEW.id
         AND f.data_delete IS NULL
         AND ((v_chave IS NOT NULL AND fornecedor_chave_doc(f.cnpj_ou_cpf) = v_chave)
           OR (fornecedor_nome_norm(f.nome) = v_nome
               AND (v_chave IS NULL OR fornecedor_chave_doc(f.cnpj_ou_cpf) IS NULL)))
       ORDER BY (f.grupo_economico_id IS NOT NULL) DESC,
                (nullif(trim(f.chave_pix), '') IS NOT NULL) DESC
       LIMIT 1;
      v_achou := FOUND;
      IF NOT v_achou THEN RETURN NEW; END IF;

      v_grupo := s.grupo_economico_id;
      IF v_grupo IS NULL THEN
        INSERT INTO grupo_economico (organizacao_id, nome, cnpj_raiz)
        VALUES (v_org, left(coalesce(nullif(trim(s.nome), ''), '(sem nome)'), 200),
                CASE WHEN v_chave LIKE 'c%' THEN substr(v_chave, 2) END)
        ON CONFLICT (organizacao_id, nome) DO UPDATE SET atualizado_em = now()
        RETURNING id INTO v_grupo;
        UPDATE fornecedor f SET grupo_economico_id = v_grupo
          FROM filial fi
         WHERE fi.id = f.filial_id AND fi.organizacao_id = v_org
           AND f.id IS DISTINCT FROM NEW.id
           AND f.grupo_economico_id IS NULL AND f.data_delete IS NULL
           AND ((v_chave IS NOT NULL AND fornecedor_chave_doc(f.cnpj_ou_cpf) = v_chave)
             OR (fornecedor_nome_norm(f.nome) = v_nome
                 AND (v_chave IS NULL OR fornecedor_chave_doc(f.cnpj_ou_cpf) IS NULL)));
      END IF;
      NEW.grupo_economico_id := v_grupo;

      -- Cadastro novo já nasce pronto: o que estiver vazio vem da irmã.
      IF TG_OP = 'INSERT' THEN
        IF nullif(trim(NEW.chave_pix), '') IS NULL AND nullif(trim(s.chave_pix), '') IS NOT NULL THEN
          NEW.chave_pix := s.chave_pix;
          NEW.pix_favorecido := coalesce(nullif(trim(NEW.pix_favorecido), ''), s.pix_favorecido);
        END IF;
        IF nullif(trim(NEW.banco_conta), '') IS NULL AND nullif(trim(s.banco_conta), '') IS NOT NULL THEN
          NEW.banco_nome := s.banco_nome;
          NEW.banco_agencia := s.banco_agencia;
          NEW.banco_conta := s.banco_conta;
        END IF;
        NEW.cnpj_ou_cpf := coalesce(nullif(trim(NEW.cnpj_ou_cpf), ''), s.cnpj_ou_cpf);
        NEW.razao_social := coalesce(nullif(trim(NEW.razao_social), ''), s.razao_social);
        NEW.email := coalesce(nullif(trim(NEW.email), ''), s.email);
        NEW.fone_whatsapp := coalesce(nullif(trim(NEW.fone_whatsapp), ''), s.fone_whatsapp);
        NEW.categoria_compras := coalesce(NEW.categoria_compras, s.categoria_compras);
      END IF;
      RETURN NEW;
    END $$`));

  await run('trigger', () => sql.unsafe(`
    DROP TRIGGER IF EXISTS trg_fornecedor_ligar_grupo ON fornecedor;
    CREATE TRIGGER trg_fornecedor_ligar_grupo
      BEFORE INSERT OR UPDATE OF nome, cnpj_ou_cpf ON fornecedor
      FOR EACH ROW EXECUTE FUNCTION fornecedor_ligar_grupo()`));

  // Backfill: uma linha por vez (o trigger mexe nas irmãs; num UPDATE só o
  // Postgres reclamaria de linha alterada duas vezes).
  const soltos = await sql<{ id: string }[]>`
    SELECT id FROM fornecedor WHERE grupo_economico_id IS NULL AND data_delete IS NULL ORDER BY id`;
  let ligados = 0;
  for (const { id } of soltos) {
    const r = await sql`
      UPDATE fornecedor SET nome = nome
       WHERE id = ${id} AND grupo_economico_id IS NULL
      RETURNING grupo_economico_id`;
    if (r[0]?.grupo_economico_id) ligados++;
  }
  console.log(`  ligados agora: ${ligados} de ${soltos.length} soltos`);

  // Chave Pix vazia numa casa: completa quando o grupo tem UMA chave só.
  const pix = await sql`
    WITH unica AS (
      SELECT grupo_economico_id g, min(chave_pix) chave, min(pix_favorecido) fav
        FROM fornecedor
       WHERE grupo_economico_id IS NOT NULL AND data_delete IS NULL
         AND nullif(trim(chave_pix), '') IS NOT NULL
       GROUP BY grupo_economico_id
      HAVING count(DISTINCT trim(chave_pix)) = 1
    )
    UPDATE fornecedor f SET chave_pix = u.chave,
           pix_favorecido = coalesce(nullif(trim(f.pix_favorecido), ''), u.fav)
      FROM unica u
     WHERE f.grupo_economico_id = u.g AND f.data_delete IS NULL
       AND nullif(trim(f.chave_pix), '') IS NULL
    RETURNING f.id`;
  console.log(`  chave Pix completada em: ${pix.length}`);

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

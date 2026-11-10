// CADASTRO ÚNICO TAMBÉM PELA CHAVE PIX (10/11/2026). O dono: "se for CPF igual,
// CNPJ igual, chave Pix igual, tem que ter tudo unificado". Caso: Sergio Santos
// de Oliveira (frutas) tinha 7 linhas nas 3 casas, em 3 grupos — "SERGIO SANTOS
// DE OLIVEIRA", "...( FRUTAS)" e "NEGAO DO ACABAXI(...)" com CNPJ MEI e CPFs
// diferentes. Só a chave Pix (79998541716) era a mesma; a da Mar ficou sem chave.
//
// O que muda (aditivo — o trigger de 05/11 continua fazendo tudo que fazia):
//   · função fornecedor_pix_norm: chave sem espaço/pontuação, minúscula, celular
//     com ou sem +55 vira a mesma coisa;
//   · trigger: além de documento e nome, liga pela chave Pix; e quando a linha
//     JÁ tem grupo e o documento/Pix bate com outra linha de OUTRO grupo, os dois
//     grupos viram um só (antes isso nunca acontecia);
//   · backfill: junta os grupos de hoje que têm mesmo documento (CNPJ raiz/CPF)
//     ou mesma chave Pix, e completa a chave vazia quando o grupo tem UMA só.
// Cada casa continua com a sua linha. Repetido na MESMA casa se unifica pela tela
// /cadastros/fornecedores/repetidos (escolhe o que fica).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fornecedor-grupo-pix
//   SIMULAR=1 pnpm --filter @concilia/db migrate:fornecedor-grupo-pix  (não grava)

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });
const SIMULAR = process.env.SIMULAR === '1';

async function run<T>(n: string, f: () => Promise<T>) {
  process.stdout.write(`  ${n}... `);
  const r = await f();
  console.log('OK');
  return r;
}

async function main() {
  if (SIMULAR) console.log('*** SIMULAÇÃO — nada é gravado ***');

  if (!SIMULAR) {
    await run('função chave Pix normalizada', () => sql.unsafe(`
      CREATE OR REPLACE FUNCTION fornecedor_pix_norm(t text) RETURNS text
      LANGUAGE sql IMMUTABLE AS $$
        SELECT CASE
          WHEN k = '' THEN NULL
          WHEN k ~ '^55[0-9]{10,11}$' THEN substr(k, 3)
          ELSE k
        END
        FROM (SELECT regexp_replace(lower(trim(coalesce(t, ''))), '[^a-z0-9@.]', '', 'g') AS k) x
      $$`));

    await run('função do trigger (com chave Pix)', () => sql.unsafe(`
      CREATE OR REPLACE FUNCTION fornecedor_ligar_grupo() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        v_org uuid;
        v_chave text := fornecedor_chave_doc(NEW.cnpj_ou_cpf);
        v_nome text := fornecedor_nome_norm(NEW.nome);
        v_pix text := fornecedor_pix_norm(NEW.chave_pix);
        v_grupo uuid;
        v_achou boolean;
        s record;
      BEGIN
        IF NEW.data_delete IS NOT NULL THEN
          RETURN NEW;
        END IF;
        SELECT organizacao_id INTO v_org FROM filial WHERE id = NEW.filial_id;
        IF v_org IS NULL THEN RETURN NEW; END IF;

        -- Já tem grupo: se o documento ou a chave Pix bate com linha de OUTRO
        -- grupo, é a mesma pessoa/empresa → os grupos viram um só.
        IF NEW.grupo_economico_id IS NOT NULL THEN
          IF v_chave IS NOT NULL OR v_pix IS NOT NULL THEN
            UPDATE fornecedor f SET grupo_economico_id = NEW.grupo_economico_id
              FROM filial fi
             WHERE fi.id = f.filial_id AND fi.organizacao_id = v_org
               AND f.id IS DISTINCT FROM NEW.id
               AND f.grupo_economico_id IS DISTINCT FROM NEW.grupo_economico_id
               AND f.grupo_economico_id IN (
                 SELECT g.grupo_economico_id
                   FROM fornecedor g JOIN filial gi ON gi.id = g.filial_id
                  WHERE gi.organizacao_id = v_org
                    AND g.id IS DISTINCT FROM NEW.id
                    AND g.data_delete IS NULL
                    AND g.grupo_economico_id IS NOT NULL
                    AND g.grupo_economico_id IS DISTINCT FROM NEW.grupo_economico_id
                    AND ((v_chave IS NOT NULL AND fornecedor_chave_doc(g.cnpj_ou_cpf) = v_chave)
                      OR (v_pix IS NOT NULL AND fornecedor_pix_norm(g.chave_pix) = v_pix)));
          END IF;
          RETURN NEW;
        END IF;

        IF v_chave IS NULL AND v_pix IS NULL AND (length(v_nome) < 3 OR v_nome LIKE '%exclu%') THEN
          RETURN NEW;
        END IF;

        -- Irmã da mesma empresa: documento igual, chave Pix igual, ou nome igual
        -- sem documento que brigue. Prefere a que já tem grupo e a que tem Pix.
        SELECT f.* INTO s
          FROM fornecedor f JOIN filial fi ON fi.id = f.filial_id
         WHERE fi.organizacao_id = v_org
           AND f.id IS DISTINCT FROM NEW.id
           AND f.data_delete IS NULL
           AND ((v_chave IS NOT NULL AND fornecedor_chave_doc(f.cnpj_ou_cpf) = v_chave)
             OR (v_pix IS NOT NULL AND fornecedor_pix_norm(f.chave_pix) = v_pix)
             OR (length(v_nome) >= 3 AND v_nome NOT LIKE '%exclu%'
                 AND fornecedor_nome_norm(f.nome) = v_nome
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
               OR (v_pix IS NOT NULL AND fornecedor_pix_norm(f.chave_pix) = v_pix)
               OR (length(v_nome) >= 3 AND v_nome NOT LIKE '%exclu%'
                   AND fornecedor_nome_norm(f.nome) = v_nome
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

    await run('trigger (dispara também quando muda a chave Pix)', () => sql.unsafe(`
      DROP TRIGGER IF EXISTS trg_fornecedor_ligar_grupo ON fornecedor;
      CREATE TRIGGER trg_fornecedor_ligar_grupo
        BEFORE INSERT OR UPDATE OF nome, cnpj_ou_cpf, chave_pix ON fornecedor
        FOR EACH ROW EXECUTE FUNCTION fornecedor_ligar_grupo()`));
  }

  // Backfill: junta grupos de hoje por documento OU chave Pix (união).
  const linhas = await sql<{
    id: string; org: string; nome: string; filial: string; grupo: string | null; doc: string | null; pix: string | null;
  }[]>`
    SELECT f.id, fi.organizacao_id AS org, f.nome, fi.nome AS filial, f.grupo_economico_id AS grupo,
      fornecedor_chave_doc(f.cnpj_ou_cpf) AS doc,
      CASE WHEN k = '' THEN NULL WHEN k ~ '^55[0-9]{10,11}$' THEN substr(k, 3) ELSE k END AS pix
    FROM fornecedor f JOIN filial fi ON fi.id = f.filial_id,
      LATERAL (SELECT regexp_replace(lower(trim(coalesce(f.chave_pix, ''))), '[^a-z0-9@.]', '', 'g') AS k) x
    WHERE f.data_delete IS NULL`;

  const pai = new Map<string, string>();
  const achar = (x: string): string => {
    let r = x;
    while (pai.get(r) !== r) r = pai.get(r)!;
    let y = x;
    while (pai.get(y) !== r) { const n = pai.get(y)!; pai.set(y, r); y = n; }
    return r;
  };
  const unir = (a: string, b: string) => { const ra = achar(a), rb = achar(b); if (ra !== rb) pai.set(ra, rb); };
  const primeiro = new Map<string, string>();
  for (const l of linhas) {
    pai.set(l.id, l.id);
    for (const k of [l.grupo && `g:${l.grupo}`, l.doc && `d:${l.org}:${l.doc}`, l.pix && `p:${l.org}:${l.pix}`]) {
      if (!k) continue;
      const o = primeiro.get(k);
      if (o) unir(l.id, o); else primeiro.set(k, l.id);
    }
  }
  const comps = new Map<string, typeof linhas>();
  for (const l of linhas) {
    const r = achar(l.id);
    comps.set(r, [...(comps.get(r) ?? []), l]);
  }

  let gruposJuntados = 0;
  let linhasMovidas = 0;
  for (const c of comps.values()) {
    const grupos = new Map<string, number>();
    for (const l of c) if (l.grupo) grupos.set(l.grupo, (grupos.get(l.grupo) ?? 0) + 1);
    if (grupos.size < 2) continue; // já é um grupo só (ou nenhum: o trigger cuida)
    const fica = [...grupos.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const mudar = c.filter((l) => l.grupo !== fica);
    gruposJuntados += grupos.size - 1;
    linhasMovidas += mudar.length;
    console.log(`\n  ${c.length} cadastros → 1 grupo (${grupos.size} grupos antes):`);
    for (const l of c) console.log(`    ${l.grupo === fica ? '=' : '→'} [${l.filial}] ${l.nome}`);
    if (!SIMULAR) {
      const velhos = [...grupos.keys()].filter((g) => g !== fica);
      await sql`UPDATE fornecedor SET grupo_economico_id = ${fica} WHERE grupo_economico_id IN ${sql(velhos)}`;
    }
  }
  console.log(`\n  grupos juntados: ${gruposJuntados} · cadastros que mudaram de grupo: ${linhasMovidas}`);

  if (!SIMULAR) {
    // Chave Pix vazia numa casa: completa quando o grupo tem UMA chave só.
    const pix = await sql`
      WITH unica AS (
        SELECT grupo_economico_id g, min(chave_pix) chave, min(pix_favorecido) fav
          FROM fornecedor
         WHERE grupo_economico_id IS NOT NULL AND data_delete IS NULL
           AND nullif(trim(chave_pix), '') IS NOT NULL
         GROUP BY grupo_economico_id
        HAVING count(DISTINCT fornecedor_pix_norm(chave_pix)) = 1
      )
      UPDATE fornecedor f SET chave_pix = u.chave,
             pix_favorecido = coalesce(nullif(trim(f.pix_favorecido), ''), u.fav)
        FROM unica u
       WHERE f.grupo_economico_id = u.g AND f.data_delete IS NULL
         AND nullif(trim(f.chave_pix), '') IS NULL
      RETURNING f.nome`;
    console.log(`  chave Pix completada em: ${pix.length}${pix.length ? ' — ' + pix.map((p) => p.nome).join(', ') : ''}`);
  }
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

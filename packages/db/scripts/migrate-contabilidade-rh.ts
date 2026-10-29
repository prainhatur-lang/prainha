// Permissão nova `ponto.atestado` (lançar atestado sem poder corrigir batida)
// + grupo "Contabilidade RH" (escritório de contabilidade sobe documentos,
// ASO, contrato, vê ponto e lança atestado). Idempotente.
//
// Uso: pnpm --filter @concilia/db migrate:contabilidade-rh

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

const ORG = 'a7238ba3-b150-4fb5-aa37-a895866df03f';
const GRUPO = 'Contabilidade RH';
const PERMS = [
  'funcionario.read',
  'funcionario.create',
  'funcionario.update',
  'funcionario.desligar',
  'ponto.read',
  'ponto.atestado',
  'folha_equipe.read',
];

async function main() {
  await sql`
    INSERT INTO permissao (codigo, modulo, acao, descricao, escopo)
    VALUES ('ponto.atestado', 'ponto', 'atestado', 'Lançar atestado médico (sem mexer nas batidas)', 'filial')
    ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao
  `;
  console.log('permissao ponto.atestado OK');

  // Quem já corrigia ponto (e portanto já lançava atestado) ganha a nova também.
  const r = await sql`
    INSERT INTO grupo_permissao (grupo_id, permissao_id)
    SELECT gp.grupo_id, (SELECT id FROM permissao WHERE codigo = 'ponto.atestado')
    FROM grupo_permissao gp JOIN permissao p ON p.id = gp.permissao_id
    WHERE p.codigo = 'ponto.corrigir'
    ON CONFLICT DO NOTHING
  `;
  console.log(`ponto.atestado copiado pra ${r.count} grupo(s) que tinham ponto.corrigir`);

  let [g] = await sql`SELECT id FROM grupo_usuario WHERE organizacao_id = ${ORG} AND nome = ${GRUPO}`;
  if (!g) {
    [g] = await sql`
      INSERT INTO grupo_usuario (organizacao_id, nome, descricao, sistema)
      VALUES (${ORG}, ${GRUPO}, 'Escritório de contabilidade: cadastro e documentos dos funcionários (ASO, contrato), ponto (só ver) e atestado', false)
      RETURNING id
    `;
  }
  const r2 = await sql`
    INSERT INTO grupo_permissao (grupo_id, permissao_id)
    SELECT ${g.id}, id FROM permissao WHERE codigo = ANY(${PERMS})
    ON CONFLICT DO NOTHING
  `;
  console.log(`grupo ${GRUPO} = ${g.id} (+${r2.count} permissões)`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

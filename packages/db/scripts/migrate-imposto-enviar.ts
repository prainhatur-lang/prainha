// Permissão nova `imposto.enviar` (enviar guias de imposto — INSS, FGTS, GRRF,
// DARF… — pela tela /contador/impostos, sem abrir o Financeiro) e entrega ao
// grupo "Contabilidade RH". Pedido do dono 19/11/2026: o contador precisa subir
// as guias e não tem acesso ao Financeiro. Idempotente. Não cria tabela.
//
// Uso: pnpm --filter @concilia/db migrate:imposto-enviar

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

const ORG = 'a7238ba3-b150-4fb5-aa37-a895866df03f';
const GRUPO = 'Contabilidade RH';

async function main() {
  await sql`
    INSERT INTO permissao (codigo, modulo, acao, descricao, escopo)
    VALUES ('imposto.enviar', 'imposto', 'enviar', 'Enviar guias de imposto (INSS, FGTS, GRRF, DARF…) sem acesso ao Financeiro', 'filial')
    ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao
  `;
  console.log('permissao imposto.enviar OK');

  const [g] = await sql`SELECT id FROM grupo_usuario WHERE organizacao_id = ${ORG} AND nome = ${GRUPO}`;
  if (!g) throw new Error(`grupo ${GRUPO} não existe`);
  const r = await sql`
    INSERT INTO grupo_permissao (grupo_id, permissao_id)
    SELECT ${g.id}, id FROM permissao WHERE codigo = 'imposto.enviar'
    ON CONFLICT DO NOTHING
  `;
  console.log(`grupo ${GRUPO} = ${g.id} (+${r.count} permissão)`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

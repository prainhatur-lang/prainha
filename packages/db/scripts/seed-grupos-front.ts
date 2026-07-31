// Seed idempotente dos grupos de front of house: Recepção e Vendas.
// Da acesso operacional a Reservas + Lista de espera (fila) — read/create/update
// nos dois modulos (ver RESERVAS_FILA_OPERACIONAL em catalogo-permissoes.ts).
//
// Cria SOMENTE esses dois grupos; nao toca nos demais grupos de sistema (evita
// re-embaralhar os duplicados legados). Dedup-safe: busca pelo nome (mais antigo
// = canonico) antes de inserir, mesmo padrao do migrate-permissoes.ts.
//
// Idempotente: rodar de novo so reaplica as permissoes do catalogo.
//
// Uso: pnpm --filter @concilia/db seed:grupos-front

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
import { GRUPOS_SISTEMA } from '../src/catalogo-permissoes';

const ALVO = ['Recepção', 'Vendas'];

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  const grupos = GRUPOS_SISTEMA.filter((g) => ALVO.includes(g.nome));
  if (grupos.length !== ALVO.length) {
    throw new Error(
      `Catalogo nao tem todos os grupos alvo. Esperado [${ALVO.join(', ')}], achou [${grupos
        .map((g) => g.nome)
        .join(', ')}]`,
    );
  }

  const todasPerm = await sql<Array<{ id: string; codigo: string }>>`
    SELECT id, codigo FROM permissao
  `;
  const idPorCodigo = new Map(todasPerm.map((p) => [p.codigo, p.id]));
  const todosCodigos = todasPerm.map((p) => p.codigo);

  for (const g of grupos) {
    // Dedup-safe: NULL != NULL no Postgres, entao ON CONFLICT (organizacao_id, nome)
    // nunca casaria pra grupos de sistema (org NULL). Busca pelo nome primeiro.
    let grupoId: string;
    const existente = await sql<Array<{ id: string }>>`
      SELECT id FROM grupo_usuario
      WHERE sistema = true AND organizacao_id IS NULL AND nome = ${g.nome}
      ORDER BY criado_em ASC LIMIT 1
    `;
    if (existente.length > 0) {
      grupoId = existente[0].id;
      await sql`UPDATE grupo_usuario SET descricao = ${g.descricao} WHERE id = ${grupoId}`;
    } else {
      const [novo] = await sql<Array<{ id: string }>>`
        INSERT INTO grupo_usuario (organizacao_id, nome, descricao, sistema)
        VALUES (NULL, ${g.nome}, ${g.descricao}, true)
        RETURNING id
      `;
      grupoId = novo.id;
    }

    await sql`DELETE FROM grupo_permissao WHERE grupo_id = ${grupoId}`;
    const codigos = g.permissoes(todosCodigos);
    for (const codigo of codigos) {
      const permId = idPorCodigo.get(codigo);
      if (!permId) continue;
      await sql`
        INSERT INTO grupo_permissao (grupo_id, permissao_id)
        VALUES (${grupoId}, ${permId})
        ON CONFLICT DO NOTHING
      `;
    }
    console.log(`  ${g.nome}: ${codigos.length} permissoes -> ${codigos.join(', ')}`);
  }

  console.log('\nSeed concluido. Agora atribua os usuarios aos grupos em /configuracoes/usuarios.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

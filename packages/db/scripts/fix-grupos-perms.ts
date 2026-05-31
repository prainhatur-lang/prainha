// Fix pontual: grupos de sistema DUPLICADOS (bug do UNIQUE com organizacao_id
// NULL no upsert do migrate-permissoes). Reaplica o catalogo de permissoes a
// TODOS os grupos de sistema por nome, de forma ADITIVA (insert ON CONFLICT DO
// NOTHING — nao apaga nada, nao mexe em usuario_grupo). Idempotente.
// Uso: pnpm --filter @concilia/db tsx scripts/fix-grupos-perms.ts

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
import { GRUPOS_SISTEMA } from '../src/catalogo-permissoes';

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { prepare: false });

async function main() {
  const todasPerm = await sql<Array<{ id: string; codigo: string }>>`SELECT id, codigo FROM permissao`;
  const idPorCodigo = new Map(todasPerm.map((p) => [p.codigo, p.id]));
  const todosCodigos = todasPerm.map((p) => p.codigo);

  // Todos os grupos de sistema (incl. duplicados)
  const grupos = await sql<Array<{ id: string; nome: string }>>`
    SELECT id, nome FROM grupo_usuario WHERE sistema = true`;

  for (const def of GRUPOS_SISTEMA) {
    const codigos = def.permissoes(todosCodigos);
    const alvos = grupos.filter((g) => g.nome === def.nome);
    for (const g of alvos) {
      let add = 0;
      for (const codigo of codigos) {
        const permId = idPorCodigo.get(codigo);
        if (!permId) continue;
        const r = await sql`
          INSERT INTO grupo_permissao (grupo_id, permissao_id)
          VALUES (${g.id}, ${permId}) ON CONFLICT DO NOTHING RETURNING grupo_id`;
        if (r.length) add++;
      }
      console.log(`  ${def.nome} (${g.id.slice(0,8)}): +${add} permissoes (total alvo ${codigos.length})`);
    }
  }
  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });

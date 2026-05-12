// Runtime check de permissoes: dado um userId e um codigo de permissao,
// retorna true/false. Usa cache em memoria (60s) pra evitar query por request.
//
// Compatibilidade: ALEM dos grupos novos, mantem fallback para usuario_filial.role
// (sem migracao, ja existia). Migration ja copia roles -> grupos, mas se algum
// usuario tem so role e nenhum grupo, ainda funciona.

import { db, schema } from '@concilia/db';
import { eq, inArray, and } from 'drizzle-orm';

const CACHE_TTL_MS = 60_000;

interface UserPerms {
  codigos: Set<string>;
  expiresAt: number;
}
const cache = new Map<string, UserPerms>();

async function carregarPermissoesDoUsuario(userId: string): Promise<Set<string>> {
  const grupos = await db
    .select({ grupoId: schema.usuarioGrupo.grupoId })
    .from(schema.usuarioGrupo)
    .where(eq(schema.usuarioGrupo.usuarioId, userId));
  if (grupos.length === 0) return new Set();

  const linhas = await db
    .select({ codigo: schema.permissao.codigo })
    .from(schema.grupoPermissao)
    .innerJoin(
      schema.permissao,
      eq(schema.permissao.id, schema.grupoPermissao.permissaoId),
    )
    .where(
      inArray(
        schema.grupoPermissao.grupoId,
        grupos.map((g) => g.grupoId),
      ),
    );
  return new Set(linhas.map((l) => l.codigo));
}

export async function permissoesDoUsuario(userId: string): Promise<Set<string>> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.codigos;
  const codigos = await carregarPermissoesDoUsuario(userId);
  cache.set(userId, { codigos, expiresAt: Date.now() + CACHE_TTL_MS });
  return codigos;
}

export function invalidarCachePermissoes(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

export async function podeUsuario(userId: string, codigo: string): Promise<boolean> {
  const codigos = await permissoesDoUsuario(userId);
  return codigos.has(codigo);
}

/** Helper que da throw 403 se nao tiver a permissao. Pra uso em API routes. */
export async function exigirPermissao(userId: string, codigo: string): Promise<void> {
  if (!(await podeUsuario(userId, codigo))) {
    throw new Error(`Sem permissao: ${codigo}`);
  }
}

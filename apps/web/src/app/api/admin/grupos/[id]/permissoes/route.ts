// PATCH /api/admin/grupos/[id]/permissoes — atualiza permissoes de um grupo custom
//
// Body: { add?: string[], rem?: string[] }  — IDs de permissao
// Auth: grupo_usuario.update; grupo nao pode ser sistema.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { invalidarCachePermissoes } from '@/lib/permissoes-runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  add?: string[];
  rem?: string[];
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const guard = await exigirPermApi('grupo_usuario.update');
  if (guard.error) return guard.error;

  // Valida grupo
  const [grupo] = await db
    .select()
    .from(schema.grupoUsuario)
    .where(eq(schema.grupoUsuario.id, id))
    .limit(1);
  if (!grupo) return NextResponse.json({ error: 'grupo nao encontrado' }, { status: 404 });
  if (grupo.sistema) {
    return NextResponse.json(
      { error: 'grupo do sistema e imutavel' },
      { status: 403 },
    );
  }

  // Pertence a org do user
  const filiais = await filiaisDoUsuario(guard.user.id);
  const [filialRow] = await db
    .select({ orgId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filiais[0]?.id ?? ''))
    .limit(1);
  if (!filialRow || filialRow.orgId !== grupo.organizacaoId) {
    return NextResponse.json({ error: 'sem acesso a esse grupo' }, { status: 403 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const add = Array.isArray(body.add) ? body.add : [];
  const rem = Array.isArray(body.rem) ? body.rem : [];

  // Valida que existem
  const todos = [...new Set([...add, ...rem])];
  if (todos.length > 0) {
    const existentes = await db
      .select({ id: schema.permissao.id })
      .from(schema.permissao)
      .where(inArray(schema.permissao.id, todos));
    if (existentes.length !== todos.length) {
      return NextResponse.json({ error: 'permissao inexistente' }, { status: 400 });
    }
  }

  // Remove
  if (rem.length > 0) {
    await db
      .delete(schema.grupoPermissao)
      .where(
        and(
          eq(schema.grupoPermissao.grupoId, id),
          inArray(schema.grupoPermissao.permissaoId, rem),
        ),
      );
  }
  // Adiciona
  for (const permId of add) {
    await db
      .insert(schema.grupoPermissao)
      .values({ grupoId: id, permissaoId: permId })
      .onConflictDoNothing();
  }

  // Invalida cache de todos os usuarios que estao no grupo
  const usuariosNoGrupo = await db
    .select({ usuarioId: schema.usuarioGrupo.usuarioId })
    .from(schema.usuarioGrupo)
    .where(eq(schema.usuarioGrupo.grupoId, id));
  for (const u of usuariosNoGrupo) {
    invalidarCachePermissoes(u.usuarioId);
  }

  return NextResponse.json({ ok: true, added: add.length, removed: rem.length });
}

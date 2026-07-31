// PATCH /api/admin/grupos/[id] — atualiza nome/descricao do grupo custom
// DELETE /api/admin/grupos/[id] — remove grupo custom (sistema=false)
//
// Auth: grupo_usuario.update / grupo_usuario.delete.
// Bloqueia: grupos sistema (sistema=true) sao imutaveis.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function podeMexerNoGrupo(
  userId: string,
  grupoId: string,
): Promise<{ grupo: typeof schema.grupoUsuario.$inferSelect; error?: undefined } | { error: NextResponse }> {
  const [grupo] = await db
    .select()
    .from(schema.grupoUsuario)
    .where(eq(schema.grupoUsuario.id, grupoId))
    .limit(1);
  if (!grupo) {
    return { error: NextResponse.json({ error: 'grupo nao encontrado' }, { status: 404 }) };
  }
  if (grupo.sistema) {
    return {
      error: NextResponse.json({ error: 'grupo do sistema e imutavel' }, { status: 403 }),
    };
  }
  // Verifica que o grupo pertence a uma org que o user administra
  const filiais = await filiaisDoUsuario(userId);
  const [filialRow] = await db
    .select({ orgId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filiais[0]?.id ?? ''))
    .limit(1);
  if (!filialRow || filialRow.orgId !== grupo.organizacaoId) {
    return {
      error: NextResponse.json({ error: 'sem acesso a esse grupo' }, { status: 403 }),
    };
  }
  return { grupo };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const guard = await exigirPermApi('grupo_usuario.update');
  if (guard.error) return guard.error;
  const check = await podeMexerNoGrupo(guard.user.id, id);
  if (check.error) return check.error;

  let body: { nome?: string; descricao?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const updates: Partial<typeof schema.grupoUsuario.$inferInsert> = {};
  if (typeof body.nome === 'string') {
    const nome = body.nome.trim();
    if (nome.length < 2 || nome.length > 80) {
      return NextResponse.json({ error: 'nome invalido' }, { status: 400 });
    }
    updates.nome = nome;
  }
  if (typeof body.descricao === 'string' || body.descricao === null) {
    updates.descricao = body.descricao?.trim() || null;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 });
  }

  await db.update(schema.grupoUsuario).set(updates).where(eq(schema.grupoUsuario.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const guard = await exigirPermApi('grupo_usuario.delete');
  if (guard.error) return guard.error;
  const check = await podeMexerNoGrupo(guard.user.id, id);
  if (check.error) return check.error;

  // Cascade do schema deleta grupo_permissao e usuario_grupo automaticamente
  await db.delete(schema.grupoUsuario).where(eq(schema.grupoUsuario.id, id));
  return NextResponse.json({ ok: true });
}

// PATCH /api/admin/usuarios/[id]  → atualiza vinculos OU troca senha
// DELETE /api/admin/usuarios/[id]  → remove do Auth + apaga vinculos
//
// PATCH body (uma das duas formas):
//   { vinculos: [{ filialId, grupoIds: string[] }] } — substitui completamente
//   { novaSenha: string }                            — redefine senha no Auth
//
// Auth: 'usuario.update' pra alterar; 'usuario.delete' pra deletar.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { podeUsuario, invalidarCachePermissoes } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface Vinculo {
  filialId: string;
  grupoIds: string[];
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await podeUsuario(user.id, 'usuario.update'))) {
    return NextResponse.json({ error: 'sem permissao usuario.update' }, { status: 403 });
  }

  let body: { vinculos?: Vinculo[]; novaSenha?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }

  // --- Branch 1: troca senha ---
  if (typeof body.novaSenha === 'string') {
    if (body.novaSenha.length < 6) {
      return NextResponse.json({ error: 'senha curta' }, { status: 400 });
    }
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      method: 'PUT',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: body.novaSenha }),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: `auth: ${t}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // --- Branch 2: substitui vinculos ---
  if (!Array.isArray(body.vinculos)) {
    return NextResponse.json({ error: 'vinculos obrigatorios' }, { status: 400 });
  }
  const vinculos = body.vinculos;

  // Valida que o caller administra todas as filiais alvo
  const filiaisDoCaller = await filiaisDoUsuario(user.id);
  const idsDoCaller = new Set(filiaisDoCaller.map((f) => f.id));
  for (const v of vinculos) {
    if (!idsDoCaller.has(v.filialId)) {
      return NextResponse.json(
        { error: `sem acesso a filial ${v.filialId}` },
        { status: 403 },
      );
    }
  }

  // Valida grupos existem
  const todosGrupoIds = [...new Set(vinculos.flatMap((v) => v.grupoIds))];
  if (todosGrupoIds.length > 0) {
    const gExist = await db
      .select({ id: schema.grupoUsuario.id })
      .from(schema.grupoUsuario)
      .where(inArray(schema.grupoUsuario.id, todosGrupoIds));
    if (gExist.length !== todosGrupoIds.length) {
      return NextResponse.json({ error: 'grupo inexistente' }, { status: 400 });
    }
  }

  // Estrategia: replace por filial. Pra cada filial do caller, apaga usuario_grupo
  // antigos do (usuario, filial) e re-insere; idem usuario_filial.
  // Filiais que o caller NAO administra ficam intactas (nao tocamos).
  for (const filialDoCaller of filiaisDoCaller) {
    const v = vinculos.find((x) => x.filialId === filialDoCaller.id);

    // Apaga vinculos antigos (escopados a essa filial)
    await db
      .delete(schema.usuarioGrupo)
      .where(
        and(
          eq(schema.usuarioGrupo.usuarioId, id),
          eq(schema.usuarioGrupo.filialId, filialDoCaller.id),
        ),
      );

    if (!v) {
      // Filial nao esta no payload → remove usuario_filial tambem
      await db
        .delete(schema.usuarioFilial)
        .where(
          and(
            eq(schema.usuarioFilial.usuarioId, id),
            eq(schema.usuarioFilial.filialId, filialDoCaller.id),
          ),
        );
      continue;
    }

    // Garante usuario_filial
    await db
      .insert(schema.usuarioFilial)
      .values({ usuarioId: id, filialId: v.filialId, role: 'GERENTE' })
      .onConflictDoNothing({
        target: [schema.usuarioFilial.usuarioId, schema.usuarioFilial.filialId],
      });

    // Re-insere grupos
    for (const grupoId of v.grupoIds) {
      await db
        .insert(schema.usuarioGrupo)
        .values({ usuarioId: id, grupoId, filialId: v.filialId })
        .onConflictDoNothing();
    }
  }

  invalidarCachePermissoes(id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await podeUsuario(user.id, 'usuario.delete'))) {
    return NextResponse.json({ error: 'sem permissao usuario.delete' }, { status: 403 });
  }
  if (id === user.id) {
    return NextResponse.json({ error: 'nao pode deletar voce mesmo' }, { status: 400 });
  }

  // Deleta no Auth (cascade no DB cuida de usuario / usuario_filial / usuario_grupo)
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok && r.status !== 404) {
    const t = await r.text();
    return NextResponse.json({ error: `auth: ${t}` }, { status: 500 });
  }

  // Fallback: garante limpeza no DB (caso FK pra auth.users nao tenha cascade)
  await db.delete(schema.usuarioGrupo).where(eq(schema.usuarioGrupo.usuarioId, id));
  await db.delete(schema.usuarioFilial).where(eq(schema.usuarioFilial.usuarioId, id));
  await db.delete(schema.usuario).where(eq(schema.usuario.id, id));

  invalidarCachePermissoes(id);
  return NextResponse.json({ ok: true });
}

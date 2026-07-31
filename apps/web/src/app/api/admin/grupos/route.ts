// POST /api/admin/grupos — cria grupo custom da organizacao do user.
//
// Body: { nome: string, descricao?: string, permissaoIds?: string[] }
// Auth: grupo_usuario.create.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  nome: string;
  descricao?: string;
  permissaoIds?: string[];
}

export async function POST(req: Request) {
  const guard = await exigirPermApi('grupo_usuario.create');
  if (guard.error) return guard.error;
  const { user } = guard;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const nome = body.nome?.trim();
  if (!nome || nome.length < 2 || nome.length > 80) {
    return NextResponse.json({ error: 'nome invalido' }, { status: 400 });
  }

  // Descobre organizacaoId via filiais do user
  const filiais = await filiaisDoUsuario(user.id);
  const [filialRow] = await db
    .select({ orgId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filiais[0]?.id ?? ''))
    .limit(1);
  if (!filialRow) {
    return NextResponse.json({ error: 'sem organizacao' }, { status: 400 });
  }
  const organizacaoId = filialRow.orgId;

  // Bloqueia colidir com nome de sistema (case-insensitive)
  const [existe] = await db
    .select({ id: schema.grupoUsuario.id, sistema: schema.grupoUsuario.sistema })
    .from(schema.grupoUsuario)
    .where(eq(schema.grupoUsuario.nome, nome))
    .limit(1);
  if (existe?.sistema) {
    return NextResponse.json(
      { error: 'nome ja usado por grupo do sistema' },
      { status: 409 },
    );
  }

  // Cria grupo
  const [criado] = await db
    .insert(schema.grupoUsuario)
    .values({
      organizacaoId,
      nome,
      descricao: body.descricao?.trim() || null,
      sistema: false,
    })
    .onConflictDoUpdate({
      target: [schema.grupoUsuario.organizacaoId, schema.grupoUsuario.nome],
      set: { descricao: body.descricao?.trim() || null },
    })
    .returning({ id: schema.grupoUsuario.id });

  // Atribui permissoes iniciais (se fornecidas)
  if (body.permissaoIds && body.permissaoIds.length > 0) {
    // Valida que todos existem
    const existentes = await db
      .select({ id: schema.permissao.id })
      .from(schema.permissao)
      .where(inArray(schema.permissao.id, body.permissaoIds));
    if (existentes.length !== body.permissaoIds.length) {
      return NextResponse.json({ error: 'permissao inexistente' }, { status: 400 });
    }
    for (const permId of body.permissaoIds) {
      await db
        .insert(schema.grupoPermissao)
        .values({ grupoId: criado!.id, permissaoId: permId })
        .onConflictDoNothing();
    }
  }

  return NextResponse.json({ id: criado!.id, nome });
}

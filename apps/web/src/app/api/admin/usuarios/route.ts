// POST /api/admin/usuarios
// Cria usuario no Supabase Auth + insere em usuario + usuario_filial + usuario_grupo.
// Body: { email, senha, vinculos: [{ filialId, grupoIds: string[] }] }
//
// Auth: apenas usuarios com permissao 'usuario.create' (Admin) podem criar.
//
// Idempotente em Auth: se email ja existe, reusa o id existente.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { inArray } from 'drizzle-orm';
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

interface Body {
  email: string;
  senha: string;
  vinculos: Vinculo[];
}

async function getOrCreateAuthUser(email: string, senha: string): Promise<string> {
  const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (list.ok) {
    const data = (await list.json()) as { users?: { id: string; email: string }[] };
    const existente = data.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existente) {
      // Email já existia no Auth: a senha digitada no formulário passa a valer.
      // Antes a senha era descartada em silêncio e o admin "criava" o usuário
      // sem conseguir logar com ela (aconteceu com financeiro@ em 20/08/2026).
      const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existente.id}`, {
        method: 'PUT',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: senha, email_confirm: true }),
      });
      if (!upd.ok) {
        const t = await upd.text();
        throw new Error(`Falha redefinir senha do Auth user existente: ${upd.status} ${t}`);
      }
      return existente.id;
    }
  }
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password: senha, email_confirm: true }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Falha criar Auth user: ${r.status} ${body}`);
  }
  const d = (await r.json()) as { id: string };
  return d.id;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!(await podeUsuario(user.id, 'usuario.create'))) {
    return NextResponse.json({ error: 'sem permissao usuario.create' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const { email, senha, vinculos } = body;
  if (!email || !senha) {
    return NextResponse.json({ error: 'email e senha obrigatorios' }, { status: 400 });
  }
  if (!Array.isArray(vinculos) || vinculos.length === 0) {
    return NextResponse.json({ error: 'vinculos obrigatorios' }, { status: 400 });
  }

  // Garantir que o caller administra todas as filiais dos vinculos
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

  // Valida que todos grupoIds existem
  const todosGrupoIds = [...new Set(vinculos.flatMap((v) => v.grupoIds))];
  if (todosGrupoIds.length === 0) {
    return NextResponse.json({ error: 'selecione ao menos um grupo' }, { status: 400 });
  }
  const gruposExistentes = await db
    .select({ id: schema.grupoUsuario.id })
    .from(schema.grupoUsuario)
    .where(inArray(schema.grupoUsuario.id, todosGrupoIds));
  if (gruposExistentes.length !== todosGrupoIds.length) {
    return NextResponse.json({ error: 'grupo inexistente' }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await getOrCreateAuthUser(email, senha);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'falha auth' },
      { status: 500 },
    );
  }

  // Linha em usuario (tabela do app)
  await db
    .insert(schema.usuario)
    .values({ id: userId, email })
    .onConflictDoNothing({ target: schema.usuario.id });

  // Vinculos usuario_filial (mantem compat com sistema antigo, role=GERENTE default)
  for (const v of vinculos) {
    await db
      .insert(schema.usuarioFilial)
      .values({ usuarioId: userId, filialId: v.filialId, role: 'GERENTE' })
      .onConflictDoNothing({
        target: [schema.usuarioFilial.usuarioId, schema.usuarioFilial.filialId],
      });
  }

  // Vinculos usuario_grupo (escopado por filial)
  for (const v of vinculos) {
    for (const grupoId of v.grupoIds) {
      await db
        .insert(schema.usuarioGrupo)
        .values({ usuarioId: userId, grupoId, filialId: v.filialId })
        .onConflictDoNothing();
    }
  }

  invalidarCachePermissoes(userId);
  return NextResponse.json({ id: userId, email });
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await podeUsuario(user.id, 'usuario.read'))) {
    return NextResponse.json({ error: 'sem permissao' }, { status: 403 });
  }
  const url = new URL(req.url);
  const ids = url.searchParams.getAll('id');
  const where = ids.length > 0 ? inArray(schema.usuario.id, ids) : undefined;
  const rows = await db.select().from(schema.usuario).where(where as never);
  return NextResponse.json({ usuarios: rows });
}

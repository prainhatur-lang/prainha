// POST /api/fornecedores/trazer — { fornecedorId, filialId }
// Cadastro único: traz pra esta casa um fornecedor que só existe nas outras
// (cópia ligada ao mesmo grupo, ativa pra compras, com os mesmos vendedores).

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { garantirFornecedorNaFilial } from '@/lib/fornecedor-unico';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'fornecedor.update');
  if (semPerm) return semPerm;

  const body = (await req.json().catch(() => null)) as { fornecedorId?: string; filialId?: string } | null;
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!body || !uuid.test(String(body.fornecedorId)) || !uuid.test(String(body.filialId))) {
    return NextResponse.json({ error: 'fornecedorId e filialId obrigatorios' }, { status: 400 });
  }

  const [acesso] = await db
    .select({ id: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, body.filialId!)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso a filial' }, { status: 403 });

  try {
    const id = await db.transaction((tx) => garantirFornecedorNaFilial(body.fornecedorId!, body.filialId!, tx));
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

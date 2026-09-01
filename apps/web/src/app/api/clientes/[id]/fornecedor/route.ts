// POST /api/clientes/[id]/fornecedor — marca o cliente TAMBÉM como fornecedor
// (vendedor). Cadastro único: é a mesma pessoa ganhando outro papel, por
// escolha de quem cadastra — nunca automático.

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { marcarClienteComoFornecedor } from '@/lib/rh/pessoa-unica';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'fornecedor.create');
  if (semPerm) return semPerm;

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const [cli] = await db
    .select({ filialId: schema.cliente.filialId })
    .from(schema.cliente)
    .where(eq(schema.cliente.id, id))
    .limit(1);
  if (!cli) return NextResponse.json({ error: 'cliente não encontrado' }, { status: 404 });

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, cli.filialId),
      ),
    )
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });

  const r = await marcarClienteComoFornecedor(id);
  if (!r) return NextResponse.json({ error: 'cliente não encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true, ...r });
}

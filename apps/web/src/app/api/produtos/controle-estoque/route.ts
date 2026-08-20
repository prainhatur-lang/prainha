// Liga/desliga o controle de estoque em VÁRIOS produtos de uma vez.
//
// Existe por causa da lista "vendeu e não baixou nada": marcar 97 produtos um
// a um seria trabalho de digitação, e trabalho de digitação não é feito.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { inArray, eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  controlaEstoque: z.boolean(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'produto.update');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const { ids, controlaEstoque } = parsed.data;

  // RBAC: só produto de filial que o usuário enxerga
  const filiais = (await filiaisDoUsuario(user.id)).map((f) => f.id);
  if (filiais.length === 0) return NextResponse.json({ error: 'sem filial' }, { status: 403 });

  const alvo = await db
    .select({ id: schema.produto.id })
    .from(schema.produto)
    .where(and(inArray(schema.produto.id, ids), inArray(schema.produto.filialId, filiais)));
  if (alvo.length === 0) return NextResponse.json({ error: 'nenhum produto acessível' }, { status: 404 });

  await db
    .update(schema.produto)
    .set({ controlaEstoque })
    .where(inArray(schema.produto.id, alvo.map((a) => a.id)));

  return NextResponse.json({ ok: true, alterados: alvo.length, ignorados: ids.length - alvo.length });
}

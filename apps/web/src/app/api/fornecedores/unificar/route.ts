// POST /api/fornecedores/unificar { manterId, removerIds[] } — junta cadastros
// repetidos da mesma casa no que fica (lib/unificar-fornecedor). 04/11/2026.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { ErroUnificar, unificarFornecedor } from '@/lib/unificar-fornecedor';

const Body = z.object({
  manterId: z.string().uuid(),
  removerIds: z.array(z.string().uuid()).min(1).max(20),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'fornecedor.update');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'body invalido' }, { status: 400 });
  const { manterId, removerIds } = parsed.data;

  const linhas = await db
    .select({ id: schema.fornecedor.id, filialId: schema.fornecedor.filialId })
    .from(schema.fornecedor)
    .where(inArray(schema.fornecedor.id, [manterId, ...removerIds]));
  const filialId = linhas.find((l) => l.id === manterId)?.filialId;
  if (!filialId) return NextResponse.json({ error: 'cadastro não encontrado' }, { status: 404 });
  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });

  const feitos: string[] = [];
  for (const removerId of removerIds) {
    try {
      await unificarFornecedor({ manterId, removerId });
      feitos.push(removerId);
    } catch (e) {
      const msg = e instanceof ErroUnificar ? e.message : `erro: ${(e as Error).message}`;
      return NextResponse.json({ error: msg, feitos }, { status: feitos.length ? 207 : 400 });
    }
  }
  return NextResponse.json({ ok: true, feitos });
}

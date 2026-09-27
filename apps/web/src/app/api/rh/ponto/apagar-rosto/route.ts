// Apaga o rosto cadastrado no ponto facial (ex: alguém se cadastrou tocando
// no nome de outra pessoa). A loja pega no próximo pull do roster: rosto
// nulo na nuvem + já sincronizado lá = apagado (vendas-local loopPontoRoster).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ funcionarioId: z.string().uuid() });

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const semPerm = await negarSemPerm(user.id, 'ponto.corrigir');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'body inválido' }, { status: 400 });

  const [func] = await db
    .select({ filialId: schema.funcionario.filialId })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, parsed.data.funcionarioId))
    .limit(1);
  if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, func.filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  await db
    .update(schema.funcionario)
    .set({ faceDescriptor: null, atualizadoEm: new Date() })
    .where(eq(schema.funcionario.id, parsed.data.funcionarioId));
  return NextResponse.json({ ok: true });
}

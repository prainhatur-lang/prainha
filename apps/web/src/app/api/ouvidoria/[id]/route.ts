// PATCH /api/ouvidoria/[id] — triagem (status/observação interna). NUNCA
// aceita/retorna nada que identifique o remetente — não existe no schema.
// Sem DELETE — descarte é status='descartada' (ver contrato de anonimato
// em packages/db/src/schema/escuta.ts).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  status: z.enum(['lida', 'em_apuracao', 'resolvida', 'descartada']).optional(),
  observacaoInterna: z.string().max(2000).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('ouvidoria.triar');
  if (error) return error;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id invalido' }, { status: 400 });

  const [msg] = await db.select().from(schema.ouvidoriaMensagem).where(eq(schema.ouvidoriaMensagem.id, id)).limit(1);
  if (!msg) return NextResponse.json({ error: 'mensagem nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, msg.filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const set: Record<string, unknown> = {};
  if (d.observacaoInterna !== undefined) set.observacaoInterna = d.observacaoInterna;
  if (d.status !== undefined) {
    set.status = d.status;
    if (d.status === 'lida' && !msg.lidaEm) {
      set.lidaEm = hojeBr();
      set.lidaPor = user.id;
    }
    if (d.status === 'resolvida') {
      set.resolvidaEm = hojeBr();
      set.resolvidaPor = user.id;
    }
  }

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  await db.update(schema.ouvidoriaMensagem).set(set).where(eq(schema.ouvidoriaMensagem.id, id));
  return NextResponse.json({ ok: true });
}

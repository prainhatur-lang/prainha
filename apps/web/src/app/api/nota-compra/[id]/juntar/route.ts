// POST /api/nota-compra/[id]/juntar   body: { com: <id da outra nota>, motivo? }
// Junta o "📸 Pedido sem nota" (foto do DANFE) na NF-e da SEFAZ da mesma
// compra: estoque, contas, parcelas e conferência passam pra NF-e e a foto
// sai (com registro de exclusão). [id] pode ser qualquer uma das duas.
// Ver lib/juntar-pedido-foto.ts.

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { ErroJuntar, juntarFotoNaNfe } from '@/lib/juntar-pedido-foto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const _semPerm = await negarSemPerm(user.id, 'nota_compra.lancar_estoque');
  if (_semPerm) return _semPerm;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { com?: unknown; motivo?: unknown };
  const com = typeof body.com === 'string' ? body.com : '';
  if (!UUID.test(id) || !UUID.test(com)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const notas = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      origem: schema.notaCompra.origemImportacao,
    })
    .from(schema.notaCompra)
    .where(inArray(schema.notaCompra.id, [id, com]));
  if (notas.length !== 2) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, notas[0].filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const foto = notas.find((n) => n.origem === 'PEDIDO_FOTO');
  const nfe = notas.find((n) => n.origem !== 'PEDIDO_FOTO');
  if (!foto || !nfe) {
    return NextResponse.json({ error: 'precisa ser um Pedido sem nota e uma NF-e da SEFAZ' }, { status: 409 });
  }

  try {
    const r = await juntarFotoNaNfe({
      fotoId: foto.id,
      nfeId: nfe.id,
      usuarioId: user.id,
      motivo: typeof body.motivo === 'string' ? body.motivo.slice(0, 500) : null,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ErroJuntar) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[juntar nota]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'erro' }, { status: 500 });
  }
}

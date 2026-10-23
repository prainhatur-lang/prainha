// POST /api/pedido-celular/link   Body: { filialId }
// Gera o link assinado do celular (/pedido-celular?f&u&k&e&s) que fotografa o
// pedido sem nota. Mesmo acesso do /api/notas/pedido-foto: quem tem a casa.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { gerarLinkPedidoCelular } from '@/lib/pedido-celular-link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { filialId } = (await req.json().catch(() => ({}))) as { filialId?: string };
  if (!filialId || !/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const l = gerarLinkPedidoCelular(filialId, user.id);
  if (!l) return NextResponse.json({ error: 'PAGAR_MESA_SECRET não configurada' }, { status: 500 });
  return NextResponse.json({ ok: true, ...l });
}

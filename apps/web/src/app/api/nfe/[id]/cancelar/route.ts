// POST /api/nfe/[id]/cancelar — cancela a NF-e emitida a partir de cupom
// (evento 110111). O cupom de origem NÃO é mexido. Prazo é da SEFAZ (24h).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { cancelarNfeEmitida } from '@/lib/nfe/emitir';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({ justificativa: z.string().trim().min(15).max(255) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('nfce.cancelar');
  if (error) return error;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'justificativa precisa de 15 a 255 caracteres' }, { status: 400 });
  }
  const [nota] = await db
    .select({ id: schema.nfeEmitida.id })
    .from(schema.nfeEmitida)
    .where(and(eq(schema.nfeEmitida.id, id), isNotNull(schema.nfeEmitida.nfceOrigemId)))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota não encontrada' }, { status: 404 });

  const r = await cancelarNfeEmitida({ nfeId: id, userId: user.id, justificativa: parsed.data.justificativa });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.transitorio ? 503 : 400 });
  return NextResponse.json({ ok: true, protocolo: r.protocolo });
}

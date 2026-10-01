// POST /api/transferencias/[id]/nfe/cancelar — cancela na SEFAZ a NF-e
// autorizada da transferência. Body: { nfeId, justificativa (15–255) }.
// A transferência em si continua valendo (só financeiro).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { cancelarNfeEmitida } from '@/lib/nfe/emitir';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  nfeId: z.string().uuid(),
  justificativa: z.string().trim().min(15).max(255),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('nota_compra.lancar_estoque');
  if (error) return error;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'informe o motivo do cancelamento (mínimo 15 letras)' }, { status: 400 });
  }
  const [nota] = await db
    .select({ id: schema.nfeEmitida.id })
    .from(schema.nfeEmitida)
    .where(and(eq(schema.nfeEmitida.id, parsed.data.nfeId), eq(schema.nfeEmitida.transferenciaId, id)))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota não encontrada nessa transferência' }, { status: 404 });

  const r = await cancelarNfeEmitida({ nfeId: nota.id, userId: user.id, justificativa: parsed.data.justificativa });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.transitorio ? 503 : 400 });
  return NextResponse.json({ ok: true, protocolo: r.protocolo });
}

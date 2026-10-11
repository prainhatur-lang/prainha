// POST /api/nfe/avulsa/[id]/cancelar — cancela a NF-e avulsa (venda de bem do
// imobilizado), evento 110111. Prazo é da SEFAZ (24h).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { cancelarNfeEmitida } from '@/lib/nfe/emitir';
import { nfeAvulsaPorId } from '@/lib/nfe/emitir-avulsa';

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
  const nota = await nfeAvulsaPorId(id);
  if (!nota) return NextResponse.json({ error: 'nota não encontrada' }, { status: 404 });

  // cancelarNfeEmitida confere o acesso do usuário à casa que emitiu
  const r = await cancelarNfeEmitida({ nfeId: id, userId: user.id, justificativa: parsed.data.justificativa });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.transitorio ? 503 : 400 });
  return NextResponse.json({ ok: true, protocolo: r.protocolo });
}

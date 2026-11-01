// POST /api/lelis/nfe/[id]/cancelar — cancela a NF-e de venda da Lelis (110111, prazo 24h).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { acessoLelisApi } from '@/lib/lelis/acesso';
import { cancelarNfeEmitida } from '@/lib/nfe/emitir';
import { nfeVendaLelisPorId } from '@/lib/nfe/emitir-venda';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({ justificativa: z.string().trim().min(15).max(255) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'justificativa precisa de 15 a 255 caracteres' }, { status: 400 });
  const nota = await nfeVendaLelisPorId(a.filialId, id);
  if (!nota) return NextResponse.json({ error: 'nota não encontrada' }, { status: 404 });
  const r = await cancelarNfeEmitida({ nfeId: id, userId: a.userId, justificativa: parsed.data.justificativa, acessoConferido: true });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.transitorio ? 503 : 400 });
  return NextResponse.json({ ok: true, protocolo: r.protocolo });
}

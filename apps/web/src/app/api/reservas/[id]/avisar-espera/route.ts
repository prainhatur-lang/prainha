// POST /api/reservas/[id]/avisar-espera — recepção clica quando o cliente
// chegou mas ainda não tem mesa livre. Manda um WhatsApp avisando que ele
// está na fila de espera. Não muda status/dados da reserva, só notifica.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { enviarAvisoEspera } from '@/lib/whatsapp-otp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('reserva.update');
  if (error) return error;

  const { id } = await params;
  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  if (filialIds.length === 0) return NextResponse.json({ error: 'sem filiais' }, { status: 403 });

  const [reserva] = await db
    .select({ clienteNome: schema.reserva.clienteNome, clienteTelefone: schema.reserva.clienteTelefone })
    .from(schema.reserva)
    .where(and(eq(schema.reserva.id, id), inArray(schema.reserva.filialId, filialIds)))
    .limit(1);
  if (!reserva) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });
  if (!reserva.clienteTelefone) return NextResponse.json({ error: 'reserva sem telefone' }, { status: 400 });

  const enviado = await enviarAvisoEspera(reserva.clienteTelefone, reserva.clienteNome);
  return NextResponse.json({ ok: true, enviado });
}

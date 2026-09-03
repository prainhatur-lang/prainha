// GET /api/reservar/[token]/pagamento/[reservaId] — status do pagamento
// (polling do formulário público). Se ainda "aguardando", reconsulta a
// Cielo direto (não depende só do webhook) e, se acabou de confirmar,
// dispara a mensagem de confirmação no WhatsApp — mesma que a reserva sem
// taxa recebe no /confirmar.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { queryPayment } from '@/lib/pagamento-online';
import { marcarReservaPaga } from '@/lib/reservas/pagamento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ token: string; reservaId: string }> }) {
  const { token, reservaId } = await params;
  if (!token || token.length < 20) return NextResponse.json({ error: 'token inválido' }, { status: 404 });

  const [filial] = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });

  const [reserva] = await db
    .select()
    .from(schema.reserva)
    .where(eq(schema.reserva.id, reservaId))
    .limit(1);
  if (!reserva || reserva.filialId !== filial.id) {
    return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });
  }

  let status = reserva.pagamentoStatus;

  if (status === 'aguardando' && reserva.pagamentoId) {
    try {
      const cielo = await queryPayment(reserva.pagamentoId, filial.id);
      if (cielo.status !== 'pendente') {
        status = cielo.status;
        if (status === 'pago') {
          const origin = new URL(request.url).origin;
          await marcarReservaPaga(reserva.id, origin);
        } else {
          await db.update(schema.reserva).set({ pagamentoStatus: status }).where(eq(schema.reserva.id, reserva.id));
        }
      }
    } catch (e) {
      console.error('Erro consultando pagamento Cielo:', (e as Error).message);
      // mantém status atual, cliente tenta de novo no próximo poll
    }
  }

  return NextResponse.json({
    status,
    qrCodeString: reserva.pagamentoQrcode,
    valor: reserva.pagamentoValor,
  });
}

// Confirma pagamento de uma reserva (taxa do Lounge etc) — marca pago no
// banco e dispara a mensagem de confirmação/lembrete no WhatsApp que a
// reserva sem taxa recebe direto no /confirmar. Usado tanto pelo polling
// (pagamento/[reservaId]) quanto pelo webhook da Cielo.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { enviarConfirmacaoReserva, enviarAvisoTolerancia, enviarLembreteReserva, lembreteReservaConfigurado } from '@/lib/whatsapp-otp';
import { hojeBr } from '@/lib/datas';

export async function marcarReservaPaga(reservaId: string, appOrigin: string): Promise<void> {
  const [reserva] = await db.select().from(schema.reserva).where(eq(schema.reserva.id, reservaId)).limit(1);
  if (!reserva || reserva.pagamentoStatus === 'pago') return; // idempotente

  await db.update(schema.reserva).set({ pagamentoStatus: 'pago' }).where(eq(schema.reserva.id, reservaId));

  try {
    const [a, mes, d] = reserva.data.split('-');
    const enviouConfirmacao = await enviarConfirmacaoReserva(reserva.clienteTelefone ?? '', {
      nome: reserva.clienteNome,
      data: `${d}/${mes}/${a}`,
      hora: reserva.hora,
      local: reserva.area ?? '',
      pessoas: String(reserva.pessoas),
      linkCancelar: `${appOrigin}/reservar/cancelar/${reserva.cancelToken}`,
    });
    if (enviouConfirmacao && reserva.clienteTelefone) {
      await enviarAvisoTolerancia(reserva.clienteTelefone, reserva.clienteNome);
    }
  } catch {
    // best-effort
  }

  try {
    if (reserva.data === hojeBr() && lembreteReservaConfigurado() && reserva.clienteTelefone) {
      const [filial] = await db
        .select({ nome: schema.filial.nome })
        .from(schema.filial)
        .where(eq(schema.filial.id, reserva.filialId))
        .limit(1);
      const [a, mes, d] = reserva.data.split('-');
      await enviarLembreteReserva(reserva.clienteTelefone, {
        nome: reserva.clienteNome.split(' ')[0] || 'tudo bem',
        data: `${d}/${mes}/${a}`,
        hora: reserva.hora,
        local: `${filial?.nome ?? ''}${reserva.area ? ' · ' + reserva.area : ''}`,
        token: reserva.cancelToken ?? '',
      });
      await db.update(schema.reserva).set({ lembreteConfirmacaoEm: new Date() }).where(eq(schema.reserva.id, reservaId));
    }
  } catch {
    // best-effort
  }
}

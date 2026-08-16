// Estorno de reserva paga (lounge) — regra do Elison, 16/08:
//   cancelou com 48h+ de antecedência  -> estorno INTEGRAL
//   entre 24h e 48h                    -> estorno de 50%
//   menos de 24h (ou no-show)          -> taxa RETIDA
// O estorno sai automático pela Cielo no cancelamento (site, botão do
// lembrete ou Nina) — o código decide o percentual, nunca a IA.

import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { refundCieloPayment } from '@/lib/cielo';
import { registrarAlteracoesReserva } from '@/lib/reservas/alteracoes';

export interface ResultadoEstorno {
  percentual: 100 | 50 | 0;
  valorEstornado: number; // R$
  rotulo: string;
}

export function percentualEstorno(dataReserva: string, horaReserva: string | null): 100 | 50 | 0 {
  const alvo = Date.parse(`${dataReserva}T${horaReserva || '00:00'}:00-03:00`);
  if (Number.isNaN(alvo)) return 0;
  const horasAte = (alvo - Date.now()) / 3_600_000;
  if (horasAte >= 48) return 100;
  if (horasAte >= 24) return 50;
  return 0;
}

/** Aplica a regra ao cancelar. Chamar DEPOIS de marcar a reserva cancelada.
 *  Best-effort: falha de estorno não desfaz o cancelamento (fica registrada
 *  pro painel/equipe agir). */
export async function estornarReservaSePago(
  reserva: {
    id: string;
    data: string;
    hora: string | null;
    pagamentoStatus: string | null;
    pagamentoId: string | null;
    pagamentoValor: string | null;
  },
  /** true = cancelamento pela CASA (admin): estorno integral sempre,
   *  ignorando a regra de prazo. */
  forcarIntegral = false,
): Promise<ResultadoEstorno | null> {
  if (reserva.pagamentoStatus !== 'pago' || !reserva.pagamentoId) return null;
  const valorPago = Number(reserva.pagamentoValor ?? 0);
  if (!(valorPago > 0)) return null;

  const percentual = forcarIntegral ? 100 : percentualEstorno(reserva.data, reserva.hora);
  const valorEstornado = percentual === 100 ? valorPago : percentual === 50 ? valorPago / 2 : 0;

  let novoStatus = 'retido';
  let rotulo = `taxa retida (cancelamento com menos de 24h): R$ ${valorPago.toFixed(2)} não retorna`;
  try {
    if (percentual === 100) {
      await refundCieloPayment(reserva.pagamentoId);
      novoStatus = 'estornado';
      rotulo = `estorno INTEGRAL de R$ ${valorPago.toFixed(2)} no Pix (48h+ de antecedência); o banco leva alguns dias`;
    } else if (percentual === 50) {
      await refundCieloPayment(reserva.pagamentoId, Math.round(valorPago * 50));
      novoStatus = 'estornado_50';
      rotulo = `estorno de 50% — R$ ${(valorPago / 2).toFixed(2)} voltam no Pix (cancelamento entre 24h e 48h); o restante é retido`;
    }
  } catch (e) {
    console.error('[estorno] falhou:', e instanceof Error ? e.message : e);
    novoStatus = 'estorno_falhou';
    rotulo = `estorno de ${percentual}% FALHOU na Cielo — equipe precisa estornar manual (R$ ${valorEstornado.toFixed(2)})`;
  }

  await db
    .update(schema.reserva)
    .set({ pagamentoStatus: novoStatus, atualizadoEm: sql`now()` })
    .where(eq(schema.reserva.id, reserva.id));
  await registrarAlteracoesReserva(
    reserva.id,
    { observacao: null },
    { observacao: `estorno automático: ${rotulo}` },
    { tipo: 'sistema', nome: 'regra de estorno 48h/24h' },
  );

  return { percentual, valorEstornado, rotulo };
}

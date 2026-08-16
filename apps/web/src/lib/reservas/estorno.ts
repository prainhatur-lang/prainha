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
  /** SEMPRE seguro pra mostrar ao cliente (falha vira "em processamento" —
   *  o cron retry-estornos garante que sai; detalhe técnico fica na auditoria). */
  rotulo: string;
  /** false = a Cielo negou/errou agora; o cron vai reprocessar. */
  sucesso: boolean;
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
  let detalheInterno = rotulo;
  let sucesso = true;
  try {
    if (percentual === 100) {
      const r = await refundCieloPayment(reserva.pagamentoId);
      if (r.status !== 'reembolsado') throw new Error(r.reason ?? 'negado pela Cielo');
      novoStatus = 'estornado';
      rotulo = `estorno INTEGRAL de R$ ${valorPago.toFixed(2)} no Pix; o banco leva alguns dias`;
      detalheInterno = rotulo;
    } else if (percentual === 50) {
      const r = await refundCieloPayment(reserva.pagamentoId, Math.round(valorPago * 50));
      if (r.status !== 'reembolsado') throw new Error(r.reason ?? 'negado pela Cielo');
      novoStatus = 'estornado_50';
      rotulo = `estorno de 50% — R$ ${(valorPago / 2).toFixed(2)} voltam no Pix (cancelamento entre 24h e 48h); o restante é retido`;
      detalheInterno = rotulo;
    }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error('[estorno] falhou:', motivo);
    sucesso = false;
    // Guarda o percentual devido no status: o cron retry-estornos reprocessa
    // diariamente (caso clássico: a Cielo nega por saldo insuficiente até o
    // repasse do Pix cair na conta e-commerce).
    novoStatus = `estorno_falhou_${percentual}`;
    rotulo =
      percentual === 100
        ? `estorno INTEGRAL de R$ ${valorPago.toFixed(2)} em processamento no Pix — o banco leva alguns dias`
        : `estorno de 50% — R$ ${(valorPago / 2).toFixed(2)} em processamento no Pix — o banco leva alguns dias; o restante é retido`;
    detalheInterno = `estorno de ${percentual}% (R$ ${valorEstornado.toFixed(2)}) FALHOU na Cielo (${motivo.slice(0, 90)}) — reprocesso automático diário até sair`;
  }

  await db
    .update(schema.reserva)
    .set({ pagamentoStatus: novoStatus, atualizadoEm: sql`now()` })
    .where(eq(schema.reserva.id, reserva.id));
  await registrarAlteracoesReserva(
    reserva.id,
    { observacao: null },
    { observacao: `estorno automático: ${detalheInterno}` },
    { tipo: 'sistema', nome: 'regra de estorno 48h/24h' },
  );

  return { percentual, valorEstornado, rotulo, sucesso };
}

/** Retry pro cron: reprocessa reservas com pagamento_status estorno_falhou_*.
 *  Sucesso -> estornado/estornado_50 + auditoria; falha -> mantém o status
 *  (tenta de novo no dia seguinte). */
export async function reprocessarEstornosFalhos(): Promise<{ ok: number; pendentes: number }> {
  const falhas = await db
    .select({
      id: schema.reserva.id,
      pagamentoStatus: schema.reserva.pagamentoStatus,
      pagamentoId: schema.reserva.pagamentoId,
      pagamentoValor: schema.reserva.pagamentoValor,
    })
    .from(schema.reserva)
    .where(sql`${schema.reserva.pagamentoStatus} like 'estorno_falhou%'`);

  let ok = 0;
  for (const r of falhas) {
    if (!r.pagamentoId) continue;
    const valorPago = Number(r.pagamentoValor ?? 0);
    if (!(valorPago > 0)) continue;
    // 'estorno_falhou' legado (sem sufixo) = era o caminho integral
    const percentual = r.pagamentoStatus === 'estorno_falhou_50' ? 50 : 100;
    try {
      const resp =
        percentual === 100
          ? await refundCieloPayment(r.pagamentoId)
          : await refundCieloPayment(r.pagamentoId, Math.round(valorPago * 50));
      if (resp.status !== 'reembolsado') throw new Error(resp.reason ?? 'negado pela Cielo');
      const valor = percentual === 100 ? valorPago : valorPago / 2;
      await db
        .update(schema.reserva)
        .set({ pagamentoStatus: percentual === 100 ? 'estornado' : 'estornado_50', atualizadoEm: sql`now()` })
        .where(eq(schema.reserva.id, r.id));
      await registrarAlteracoesReserva(
        r.id,
        { observacao: null },
        { observacao: `estorno reprocessado com SUCESSO: R$ ${valor.toFixed(2)} (${percentual}%) devolvidos no Pix` },
        { tipo: 'sistema', nome: 'cron retry-estornos' },
      );
      ok += 1;
    } catch (e) {
      console.error('[retry-estornos] ainda falhando', r.id, e instanceof Error ? e.message : e);
    }
  }
  return { ok, pendentes: falhas.length - ok };
}

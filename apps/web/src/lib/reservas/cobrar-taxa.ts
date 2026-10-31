// Cobrança da taxa do Lounge (área com `taxaReserva`) numa reserva que JÁ
// existe — feita por telefone no painel ou pela Nina. Pedido do dono
// 31/10/2026: os 3 lounges do dia foram reservados por telefone e não havia
// como cobrar; e a Nina mandava o cliente pro site em vez de cobrar.
//
// Status 'cobrado' (e não 'aguardando'): 'aguardando' é o Pix do site, que
// expira em 20 min e CANCELA a reserva (mesa-disponivel). Reserva feita pela
// equipe já está garantida — a cobrança não pode derrubar a mesa. O webhook
// da Cielo e o cron de no-show (conferirTaxasCobradas) marcam 'pago'.

import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { createPixPayment, queryPayment } from '@/lib/pagamento-online';
import { marcarReservaPaga } from '@/lib/reservas/pagamento';
import { hojeBr, horaAgoraBr } from '@/lib/datas';
import { valorTaxaLounge, HORA_ULTIMA_HORA_LOUNGE } from '@/lib/reservas/taxa-lounge';
import { mesasOcupadas } from '@/lib/reservas/mesa-disponivel';
import { ehFeriadoOuProlongado } from '@/lib/reservas/feriados';

/** Mesas do espaço VAZIAS DE ÚLTIMA HORA: a data é hoje, já deu 15h, sem
 *  reserva ativa no dia e sem conta aberta na mesa (mesasOcupadas já soma
 *  as duas coisas pra hoje). Fora disso, conjunto vazio. */
export async function loungesVaziosAgora(
  filialId: string,
  area: string,
  data: string,
  excluirReservaId?: string,
): Promise<Set<string>> {
  if (data !== hojeBr() || horaAgoraBr() < HORA_ULTIMA_HORA_LOUNGE) return new Set();
  const [f] = await db
    .select({ cfg: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const a = f?.cfg?.areas?.find((x) => x.nome.toLowerCase() === area.trim().toLowerCase());
  const mesas = ((a?.mesas ?? []) as Array<{ numero: string | number }>).map((m) => String(m.numero));
  if (!a?.taxaReserva || mesas.length === 0) return new Set();
  const ocupadas = await mesasOcupadas({ filialId, data, area: a.nome, excluirReservaId, mesasValidas: mesas });
  return new Set(mesas.filter((m) => !ocupadas.has(m)));
}

/** Valor da taxa da área nessa data (mesma conta do site, lib/reservas/taxa-lounge:
 *  sáb/dom/feriado = sabDom; última hora com lounge vazio = desconto). null = área sem taxa. */
export async function taxaDaReserva(filialId: string, area: string | null, data: string, ultimaHora = false): Promise<number | null> {
  if (!area) return null;
  const [f] = await db
    .select({ cfg: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const a = f?.cfg?.areas?.find((x) => x.nome.toLowerCase() === area.trim().toLowerCase());
  if (!a?.taxaReserva) return null;
  const feriado = await ehFeriadoOuProlongado(data).catch(() => false);
  return valorTaxaLounge(a.taxaReserva, data, feriado, ultimaHora);
}

export type CobrancaTaxa =
  | { ok: true; valor: number; pixCopiaECola: string; qrCodeBase64: string; reaproveitado: boolean }
  | { ok: false; erro: string };

/** Gera (ou reaproveita) o Pix da taxa de uma reserva existente. */
export async function cobrarTaxaReserva(reservaId: string, opts?: { valor?: number }): Promise<CobrancaTaxa> {
  const [r] = await db.select().from(schema.reserva).where(eq(schema.reserva.id, reservaId)).limit(1);
  if (!r) return { ok: false, erro: 'reserva não encontrada' };
  if (r.status === 'cancelada' || r.status === 'no_show') return { ok: false, erro: 'reserva cancelada' };
  if (r.pagamentoStatus === 'pago') return { ok: false, erro: 'taxa já está paga' };

  // Última hora: reserva feita HOJE depois das 15h numa mesa de lounge que
  // estava vazia (sem outra reserva no dia e sem conta aberta).
  let ultimaHora = false;
  if (r.area && r.mesa && r.data === hojeBr() && r.criadoEm >= new Date(`${r.data}T${HORA_ULTIMA_HORA_LOUNGE}:00-03:00`)) {
    ultimaHora = (await loungesVaziosAgora(r.filialId, r.area, r.data, r.id).catch(() => new Set<string>())).has(String(r.mesa));
  }
  const taxa = opts?.valor ?? (await taxaDaReserva(r.filialId, r.area, r.data, ultimaHora));
  if (taxa == null || !(taxa > 0)) return { ok: false, erro: `a área ${r.area ?? '?'} não tem taxa configurada` };

  // Já tem Pix gerado com o mesmo valor e ainda em aberto: reaproveita.
  if (
    r.pagamentoId &&
    r.pagamentoQrcode &&
    (r.pagamentoStatus === 'cobrado' || r.pagamentoStatus === 'aguardando') &&
    Number(r.pagamentoValor) === taxa
  ) {
    return { ok: true, valor: taxa, pixCopiaECola: r.pagamentoQrcode, qrCodeBase64: '', reaproveitado: true };
  }

  const pix = await createPixPayment({
    orderId: r.id,
    amount: Math.round(taxa * 100),
    customerName: r.clienteNome,
    customerCpf: r.clienteCpf ?? undefined,
    filialId: r.filialId,
  });
  await db
    .update(schema.reserva)
    .set({
      pagamentoId: pix.paymentId,
      pagamentoQrcode: pix.qrCodeString,
      pagamentoStatus: 'cobrado',
      pagamentoValor: taxa.toFixed(2),
      valor: taxa.toFixed(2),
      atualizadoEm: new Date(),
    })
    .where(eq(schema.reserva.id, r.id));
  return { ok: true, valor: taxa, pixCopiaECola: pix.qrCodeString, qrCodeBase64: pix.qrCodeBase64, reaproveitado: false };
}

/** Reconsulta a operadora; se pagou, marca pago (manda a confirmação no zap). */
export async function conferirPagamentoReserva(reservaId: string, origin = 'https://app.prainhabar.com'): Promise<string | null> {
  const [r] = await db.select().from(schema.reserva).where(eq(schema.reserva.id, reservaId)).limit(1);
  if (!r?.pagamentoId) return r?.pagamentoStatus ?? null;
  if (r.pagamentoStatus === 'pago') return 'pago';
  const st = await queryPayment(r.pagamentoId, r.filialId);
  if (st.status === 'pago') {
    await marcarReservaPaga(r.id, origin);
    return 'pago';
  }
  return r.pagamentoStatus;
}

/** Cron: confere as taxas cobradas de hoje em diante (o webhook pode falhar). */
export async function conferirTaxasCobradas(): Promise<number> {
  const abertas = await db
    .select({ id: schema.reserva.id })
    .from(schema.reserva)
    .where(
      and(
        eq(schema.reserva.pagamentoStatus, 'cobrado'),
        isNotNull(schema.reserva.pagamentoId),
        gte(schema.reserva.data, hojeBr()),
        inArray(schema.reserva.status, ['pendente', 'confirmada', 'sentada']),
      ),
    )
    .limit(50);
  let pagas = 0;
  for (const a of abertas) {
    try {
      if ((await conferirPagamentoReserva(a.id)) === 'pago') pagas++;
    } catch {
      // segue as outras
    }
  }
  return pagas;
}

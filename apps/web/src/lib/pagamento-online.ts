// FACHADA da cobrança ONLINE (Pix/cartão nas reservas, orçamentos, delivery,
// pagar-mesa): despacha pra Cielo (@/lib/cielo) ou Rede (@/lib/rede) conforme
// a filial — mesma cara de retorno nos dois. As rotas importam DAQUI.
//
//  - CRIAR (Pix): decide pela escolha da filial em Configurações → Pagamento
//    ("Cobrança online por": filial.adquirente_online).
//  - CONSULTAR / ESTORNAR: decide pelo FORMATO do paymentId já gravado —
//    Cielo = UUID (36), Rede = TID (20). Assim uma reserva paga na Cielo
//    continua consultável depois que a casa migrar pra Rede, sem coluna nova.
//
// Tudo da Cielo continua exportado daqui (createCieloCardPayment, MPI, etc.),
// então quem só precisa da Cielo não muda nada.
export * from '@/lib/cielo';
import { createCieloPixPayment, queryCieloPayment, refundCieloPayment } from '@/lib/cielo';
import { createRedePixPayment, queryRedePayment, refundRedePayment } from '@/lib/rede';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export type AdquirenteOnline = 'cielo' | 'rede';

export async function adquirenteOnlineDaFilial(filialId?: string | null): Promise<AdquirenteOnline> {
  if (!filialId) return 'cielo';
  const [f] = await db
    .select({ a: schema.filial.adquirenteOnline })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  return f?.a === 'rede' ? 'rede' : 'cielo';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** De qual adquirente é este paymentId (pelo formato). */
export function provedorDoPaymentId(paymentId: string): AdquirenteOnline {
  return UUID.test(String(paymentId || '')) ? 'cielo' : 'rede';
}

export async function createPixPayment(params: Parameters<typeof createCieloPixPayment>[0]) {
  return (await adquirenteOnlineDaFilial(params.filialId)) === 'rede'
    ? createRedePixPayment(params)
    : createCieloPixPayment(params);
}

export async function queryPayment(paymentId: string, filialId?: string | null) {
  return provedorDoPaymentId(paymentId) === 'rede'
    ? queryRedePayment(paymentId, filialId)
    : queryCieloPayment(paymentId, filialId);
}

export async function refundPayment(paymentId: string, amountCents?: number, filialId?: string | null) {
  return provedorDoPaymentId(paymentId) === 'rede'
    ? refundRedePayment(paymentId, amountCents, filialId)
    : refundCieloPayment(paymentId, amountCents, filialId);
}

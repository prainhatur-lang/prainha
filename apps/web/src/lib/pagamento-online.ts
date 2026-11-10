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
import { bancoDoTxid, createBancoPixPayment, queryBancoPixPayment, refundBancoPixPayment } from '@/lib/pix-cob';
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

export type ProvedorPix = 'cielo' | 'rede' | 'sicredi' | 'inter';

/** Por onde esta casa recebe PIX (configurador "Pix por", 10/11/2026).
 *  filial.pix_provedor; NULL = segue o adquirente online, como sempre foi. */
export async function provedorPixDaFilial(filialId?: string | null): Promise<ProvedorPix> {
  if (!filialId) return 'cielo';
  const [f] = await db
    .select({ p: schema.filial.pixProvedor, a: schema.filial.adquirenteOnline })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const p = f?.p;
  if (p === 'cielo' || p === 'rede' || p === 'sicredi' || p === 'inter') return p;
  return f?.a === 'rede' ? 'rede' : 'cielo';
}

/** De quem é este paymentId (pelo formato): txid PRAINHAS/PRAINHAI = banco. */
export function provedorPixDoPaymentId(paymentId: string): ProvedorPix {
  return bancoDoTxid(paymentId) ?? provedorDoPaymentId(paymentId);
}

export async function createPixPayment(params: Parameters<typeof createRedePixPayment>[0]) {
  // Casa com Pix no banco: SÓ banco. Sem credencial dá erro — nunca cai na
  // Cielo escondido (pedido do dono: Pix da Mar exclusivamente Sicredi).
  const prov = await provedorPixDaFilial(params.filialId);
  if (prov === 'sicredi' || prov === 'inter') return createBancoPixPayment(prov, params);
  return prov === 'rede' ? createRedePixPayment(params) : createCieloPixPayment(params);
}

export async function queryPayment(paymentId: string, filialId?: string | null) {
  const banco = bancoDoTxid(paymentId);
  if (banco) return queryBancoPixPayment(banco, paymentId, filialId);
  return provedorDoPaymentId(paymentId) === 'rede'
    ? queryRedePayment(paymentId, filialId)
    : queryCieloPayment(paymentId, filialId);
}

export async function refundPayment(paymentId: string, amountCents?: number, filialId?: string | null) {
  const banco = bancoDoTxid(paymentId);
  if (banco) return refundBancoPixPayment(banco, paymentId, amountCents, filialId);
  return provedorDoPaymentId(paymentId) === 'rede'
    ? refundRedePayment(paymentId, amountCents, filialId)
    : refundCieloPayment(paymentId, amountCents, filialId);
}

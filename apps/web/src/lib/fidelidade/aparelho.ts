// Trava contra uso por terceiro: só o celular do dono gera código.
//
// O link /cartao/<token> pode ser encaminhado — por isso ele sozinho não gera
// código. O aparelho precisa ser confirmado uma vez com o código de 6 dígitos
// que vai pelo WHATSAPP do TELEFONE DO CARTÃO (template de OTP da Meta,
// WHATSAPP_OTP_TEMPLATE). Twilio Verify (SMS) só se a Meta falhar. Confirmado, o navegador guarda um cookie httpOnly
// (segredo aleatório; no banco só o sha256) e passa a poder tocar "Vou pagar
// agora". Até MAX_APARELHOS por cartão (celular novo derruba o mais antigo).

import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { twilioCheck, twilioConfigurado, twilioStart } from '@/lib/twilio-verify';
import { enviarOtpWhatsApp, whatsappConfigurado } from '@/lib/whatsapp-otp';

type Cartao = typeof schema.fidelidadeCartao.$inferSelect;

const MAX_APARELHOS = 3;
const OTP_MIN = 10;
const OTP_TENTATIVAS = 5;
const REENVIO_SEG = 45;
export const COOKIE_DIAS = 400;

const sha = (x: string) => createHash('sha256').update(x).digest('hex');

export function nomeCookie(cartao: Pick<Cartao, 'id'>): string {
  return `vip_${cartao.id.replace(/-/g, '').slice(0, 12)}`;
}

/** Id curto do aparelho confirmado que mandou o cookie, ou null. */
export function aparelhoConfirmado(cartao: Cartao, valorCookie: string | null | undefined): string | null {
  const [id, segredo] = String(valorCookie ?? '').split('.');
  if (!id || !segredo) return null;
  const h = Buffer.from(sha(segredo), 'utf8');
  for (const a of cartao.aparelhos ?? []) {
    if (a.id !== id) continue;
    const b = Buffer.from(a.h, 'utf8');
    if (b.length === h.length && timingSafeEqual(b, h)) return id;
  }
  return null;
}

/** (79) 9••••-1234 */
export function telefoneMascarado(tel: string): string {
  const d = tel.replace(/\D/g, '');
  if (d.length < 10) return '••••';
  return `(${d.slice(0, 2)}) ${d.slice(2, 3)}••••-${d.slice(-4)}`;
}

const e164 = (tel: string) => '55' + tel.replace(/\D/g, '');

/** Manda o código de confirmação pro WhatsApp do cartão (Meta); se a Meta
 *  falhar, SMS pelo Twilio. Devolve o canal usado. */
export async function enviarConfirmacao(cartao: Cartao): Promise<'whatsapp' | 'sms'> {
  if (cartao.otpEnviadoEm && Date.now() - cartao.otpEnviadoEm.getTime() < REENVIO_SEG * 1000) {
    throw new Error('Código já enviado. Aguarde alguns segundos pra pedir outro.');
  }
  await db
    .update(schema.fidelidadeCartao)
    .set({ otpEnviadoEm: new Date() })
    .where(eq(schema.fidelidadeCartao.id, cartao.id));
  // nunca mostra o código na tela: sem canal de envio, não tem confirmação
  let falhaMeta: unknown = null;
  if (whatsappConfigurado()) {
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db
      .update(schema.fidelidadeCartao)
      .set({ otpHash: sha(`${cartao.id}:${codigo}`), otpExpiraEm: new Date(Date.now() + OTP_MIN * 60_000), otpTentativas: 0 })
      .where(eq(schema.fidelidadeCartao.id, cartao.id));
    try {
      // o modo teste do OTP da reserva não vale aqui: o cartão sempre envia
      const r = await enviarOtpWhatsApp(e164(cartao.telefone), codigo, { ignorarModoTeste: true });
      if (r.enviado) return 'whatsapp';
    } catch (e) {
      falhaMeta = e;
    }
    // não saiu pela Meta: o hash não vale (a conferência cai no Twilio)
    await db.update(schema.fidelidadeCartao).set({ otpHash: null, otpExpiraEm: null }).where(eq(schema.fidelidadeCartao.id, cartao.id));
  }
  if (twilioConfigurado()) {
    await twilioStart(e164(cartao.telefone));
    return 'sms';
  }
  if (falhaMeta) console.error('[fidelidade] OTP Meta falhou', falhaMeta);
  throw new Error('Envio do código pelo WhatsApp indisponível no momento. Fale com a gerência.');
}

/** Confere o código; certo → registra o aparelho e devolve o valor do cookie. */
export async function confirmarAparelho(
  cartao: Cartao, codigoBruto: unknown, userAgent: string | null,
): Promise<{ ok: true; cookie: string; aparelhoId: string } | { ok: false; erro: string }> {
  const codigo = String(codigoBruto ?? '').replace(/\D/g, '');
  if (codigo.length < 4 || codigo.length > 8) return { ok: false, erro: 'Digite o código que chegou no seu WhatsApp.' };

  let certo = false;
  // tem hash = o código saiu pela Meta; sem hash = saiu pelo Twilio (SMS)
  if (!cartao.otpHash && twilioConfigurado()) {
    certo = await twilioCheck(e164(cartao.telefone), codigo);
  } else {
    if (!cartao.otpHash || !cartao.otpExpiraEm || cartao.otpExpiraEm < new Date()) {
      return { ok: false, erro: 'Código vencido. Peça um novo.' };
    }
    if (cartao.otpTentativas >= OTP_TENTATIVAS) return { ok: false, erro: 'Muitas tentativas. Peça um código novo.' };
    await db
      .update(schema.fidelidadeCartao)
      .set({ otpTentativas: cartao.otpTentativas + 1 })
      .where(eq(schema.fidelidadeCartao.id, cartao.id));
    certo = sha(`${cartao.id}:${codigo}`) === cartao.otpHash;
  }
  if (!certo) return { ok: false, erro: 'Código errado. Confira a mensagem e tente de novo.' };

  const aparelhoId = randomBytes(6).toString('hex');
  const segredo = randomBytes(24).toString('base64url');
  const lista = [
    ...(cartao.aparelhos ?? []),
    { id: aparelhoId, h: sha(segredo), em: new Date().toISOString(), ua: (userAgent ?? '').slice(0, 120) },
  ].slice(-MAX_APARELHOS);
  await db
    .update(schema.fidelidadeCartao)
    .set({
      aparelhos: lista,
      otpHash: null,
      otpExpiraEm: null,
      otpTentativas: 0,
      // confirmar o telefone é também aceitar o convite
      ...(cartao.aderidoEm ? {} : { aderidoEm: new Date(), recusadoEm: null }),
    })
    .where(eq(schema.fidelidadeCartao.id, cartao.id));
  return { ok: true, cookie: `${aparelhoId}.${segredo}`, aparelhoId };
}

/** Primeiro aparelho do cartão entra SEM código: o link chegou no WhatsApp do
 *  próprio telefone do cartão, então quem abre primeiro é o dono — pedir o
 *  código ali era mandar o cliente de volta pro WhatsApp à toa. Só vale
 *  enquanto o cartão não tem NENHUM aparelho confirmado (o update confere isso
 *  no banco); depois disso, link encaminhado continua pedindo o código.
 *  Devolve null quando o cartão já tem aparelho. */
export async function ativarPrimeiroAparelho(
  cartao: Cartao, userAgent: string | null,
): Promise<{ cookie: string; aparelhoId: string } | null> {
  if ((cartao.aparelhos ?? []).length > 0) return null;
  const aparelhoId = randomBytes(6).toString('hex');
  const segredo = randomBytes(24).toString('base64url');
  const lista = [{ id: aparelhoId, h: sha(segredo), em: new Date().toISOString(), ua: (userAgent ?? '').slice(0, 120) }];
  const gravou = await db
    .update(schema.fidelidadeCartao)
    .set({
      aparelhos: lista,
      otpHash: null,
      otpExpiraEm: null,
      otpTentativas: 0,
      ...(cartao.aderidoEm ? {} : { aderidoEm: new Date(), recusadoEm: null }),
    })
    .where(and(
      eq(schema.fidelidadeCartao.id, cartao.id),
      sql`jsonb_array_length(${schema.fidelidadeCartao.aparelhos}) = 0`,
    ))
    .returning({ id: schema.fidelidadeCartao.id });
  if (!gravou.length) return null;
  return { cookie: `${aparelhoId}.${segredo}`, aparelhoId };
}

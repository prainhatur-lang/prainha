// Confirmar o celular do Cliente VIP SEM a casa mandar o código primeiro.
//
// O código de 6 dígitos normalmente sai pela Meta (template de OTP) ou pelo
// Twilio. Quando nenhum dos dois entrega (template de autenticação bloqueado
// na conta, Twilio em conta de teste), o cliente fica preso no convite. Aqui o
// caminho é o inverso: ele toca num botão que abre o WhatsApp da casa com a
// frase pronta; a mensagem chega no webhook VINDO do celular dele — o próprio
// remetente é a prova de que o número é dele — e a resposta (texto livre, de
// graça, dentro da janela de atendimento) leva o código. O resto é igual:
// digita o código na página e o aparelho fica confirmado.

import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, randomInt } from 'node:crypto';
import { enviarTexto } from '@/lib/atendimento/zap';
import { carregarPrograma } from '@/lib/fidelidade/config';

type Cartao = typeof schema.fidelidadeCartao.$inferSelect;

const OTP_MIN = 10;
const FRASE = 'Quero ativar meu cartão Cliente VIP';
const RE_ATIVAR = /ativar\s+(o\s+)?meu\s+cart[ãa]o\s+cliente\s+vip/i;

const sha = (x: string) => createHash('sha256').update(x).digest('hex');

/** Link wa.me pro WhatsApp da casa do cartão, com a frase pronta. null = a
 *  casa não tem número cadastrado (nem o número padrão do sistema). */
export async function linkAtivarPorZap(cartao: Pick<Cartao, 'filialId'>): Promise<string | null> {
  const numeros = await db
    .select({
      phoneNumberId: schema.whatsappNumero.phoneNumberId,
      filialId: schema.whatsappNumero.filialId,
      numero: schema.whatsappNumero.numeroExibicao,
    })
    .from(schema.whatsappNumero);
  const padrao = (process.env.WHATSAPP_PHONE_ID || '').trim();
  const n =
    numeros.find((x) => x.filialId === cartao.filialId && x.numero) ??
    numeros.find((x) => x.phoneNumberId === padrao && x.numero);
  const digitos = String(n?.numero ?? '').replace(/\D/g, '');
  if (digitos.length < 12) return null;
  return `https://wa.me/${digitos}?text=${encodeURIComponent(FRASE)}`;
}

/** Webhook: a mensagem é o pedido de ativação? true = tratada aqui (a Nina não
 *  vê). Responde com o código só se o remetente for o celular de um cartão. */
export async function tratarAtivarVip(
  msg: { from?: string; type?: string; text?: { body?: string } },
  phoneNumberId: string | undefined,
): Promise<boolean> {
  if (!msg.from || !phoneNumberId || msg.type !== 'text') return false;
  if (!RE_ATIVAR.test(msg.text?.body ?? '')) return false;
  try {
    // wa_id do Brasil pode vir sem o 9 (55 79 8802-0325): casa por DDD + 8 finais
    const d = msg.from.replace(/\D/g, '').replace(/^55/, '');
    const ddd = d.slice(0, 2);
    const fim = d.slice(-8);
    if (ddd.length !== 2 || fim.length !== 8) return false;
    const [numero] = await db
      .select({ filialId: schema.whatsappNumero.filialId })
      .from(schema.whatsappNumero)
      .where(eq(schema.whatsappNumero.phoneNumberId, phoneNumberId))
      .limit(1);
    const cartoes = await db
      .select()
      .from(schema.fidelidadeCartao)
      .where(and(
        eq(schema.fidelidadeCartao.status, 'ativo'),
        sql`left(${schema.fidelidadeCartao.telefone}, 2) = ${ddd}`,
        sql`right(${schema.fidelidadeCartao.telefone}, 8) = ${fim}`,
      ));
    // o cartão da casa dona deste número primeiro; senão o que ainda não ativou
    const cartao =
      cartoes.find((c) => c.filialId === numero?.filialId) ??
      cartoes.find((c) => !c.aderidoEm) ??
      cartoes[0];
    if (!cartao) {
      await enviarTexto(
        phoneNumberId, msg.from,
        'Não achei um cartão Cliente VIP neste número de WhatsApp. O cartão só é ativado pelo celular que recebeu o convite.',
      );
      return true;
    }
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db
      .update(schema.fidelidadeCartao)
      .set({
        otpHash: sha(`${cartao.id}:${codigo}`),
        otpExpiraEm: new Date(Date.now() + OTP_MIN * 60_000),
        otpTentativas: 0,
        otpEnviadoEm: new Date(),
      })
      .where(eq(schema.fidelidadeCartao.id, cartao.id));
    const prog = await carregarPrograma(cartao.filialId);
    const r = await enviarTexto(
      phoneNumberId, msg.from,
      `Seu código do ${prog.marca}: *${codigo}*\n\nVolte pra página do cartão e digite esse código. Ele vale por ${OTP_MIN} minutos.`,
    );
    if (r.erro) console.error('[fidelidade] ativar por zap: resposta não saiu', cartao.id, r.erro);
    else console.log('[fidelidade] ativar por zap: código enviado', cartao.id);
    return true;
  } catch (e) {
    console.error('[fidelidade] ativar por zap', e);
    return false;
  }
}

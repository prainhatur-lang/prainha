// Ações do cliente no próprio cartão (público; token do link + cookie do
// aparelho confirmado).
//
// POST { token, acao }
//   'enviar_sms'            → manda o código de confirmação pro WhatsApp do cartão
//                             (Meta; SMS pelo Twilio só se a Meta falhar)
//   'confirmar' { codigo }  → confere; certo = aparelho liberado (cookie) e cartão ativado
//   'gerar_codigo'          → "Vou pagar agora": código de 4 letras, vale 1 min.
//                             Só de aparelho confirmado — link encaminhado não gera.
//   'entregar_drink'        → 81ª SOEA: o garçom dá baixa no drink de boas-vindas na
//                             tela do cliente (uma vez por cartão, só no período).

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import {
  COOKIE_DIAS, aparelhoConfirmado, confirmarAparelho, enviarConfirmacao, nomeCookie,
} from '@/lib/fidelidade/aparelho';
import { gerarCodigoUso } from '@/lib/fidelidade/nucleo';
import { carregarPrograma } from '@/lib/fidelidade/config';
import { drinkEntregueEm, drinkNoPeriodo, ehSoea, entregarDrink } from '@/lib/soea';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { token?: string; acao?: string; codigo?: string } | null;
  const token = String(b?.token || '');
  if (token.length < 16) return NextResponse.json({ erro: 'link inválido' }, { status: 400 });
  const [c] = await db.select().from(schema.fidelidadeCartao).where(eq(schema.fidelidadeCartao.token, token)).limit(1);
  if (!c) return NextResponse.json({ erro: 'cartão não encontrado' }, { status: 404 });
  if (c.status !== 'ativo') return NextResponse.json({ erro: 'Este cartão está bloqueado. Fale com a gerência.' }, { status: 409 });
  const jar = await cookies();

  try {
    if (b?.acao === 'enviar_sms') {
      const canal = await enviarConfirmacao(c);
      return NextResponse.json({ ok: true, canal });
    }
    if (b?.acao === 'confirmar') {
      const r = await confirmarAparelho(c, b.codigo, req.headers.get('user-agent'));
      if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 });
      jar.set(nomeCookie(c), r.cookie, {
        httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: COOKIE_DIAS * 86400,
      });
      return NextResponse.json({ ok: true });
    }
    if (b?.acao === 'gerar_codigo') {
      const aparelho = aparelhoConfirmado(c, jar.get(nomeCookie(c))?.value);
      if (!aparelho) return NextResponse.json({ erro: 'Confirme o seu celular antes (código no WhatsApp).', confirmar: true }, { status: 403 });
      if (!c.aderidoEm) return NextResponse.json({ erro: 'Ative o cartão primeiro.' }, { status: 409 });
      const prog = await carregarPrograma(c.filialId);
      if (!prog.ativo) return NextResponse.json({ erro: `O ${prog.marca} está pausado no momento.` }, { status: 409 });
      const r = await gerarCodigoUso(c.id, aparelho);
      return NextResponse.json({ ok: true, codigo: r.codigo, expira_em: r.expiraEm.toISOString(), em_uso: r.emUso });
    }
    if (b?.acao === 'entregar_drink') {
      if (!ehSoea(c)) return NextResponse.json({ erro: 'Este cartão não tem o drink da SOEA.' }, { status: 409 });
      if (!aparelhoConfirmado(c, jar.get(nomeCookie(c))?.value)) {
        return NextResponse.json({ erro: 'Confirme o seu celular antes (código no WhatsApp).', confirmar: true }, { status: 403 });
      }
      if (!c.aderidoEm) return NextResponse.json({ erro: 'Ative o cartão primeiro.' }, { status: 409 });
      if (!drinkNoPeriodo()) return NextResponse.json({ erro: 'O drink de boas-vindas vale de 13 a 18 de outubro.' }, { status: 409 });
      const quando = (await entregarDrink(c.id)) ?? drinkEntregueEm(c);
      if (!quando) return NextResponse.json({ erro: 'Não deu certo, tente de novo.' }, { status: 409 });
      return NextResponse.json({ ok: true, entregue_em: quando });
    }
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message || 'Não deu certo, tente de novo.' }, { status: 502 });
  }
  return NextResponse.json({ erro: 'ação inválida' }, { status: 400 });
}

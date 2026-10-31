// POST /api/reservas/[id]/cobrar-taxa — gera o Pix da taxa do Lounge numa
// reserva já feita (telefone/balcão) e, se pedir, manda no WhatsApp do
// cliente. GET — reconsulta a operadora (botão "Conferir pagamento").

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { cobrarTaxaReserva, conferirPagamentoReserva } from '@/lib/reservas/cobrar-taxa';
import { enviarTexto } from '@/lib/atendimento/zap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function reservaDoUsuario(userId: string, id: string) {
  const [r] = await db.select().from(schema.reserva).where(eq(schema.reserva.id, id)).limit(1);
  if (!r) return null;
  const filiais = await filiaisDoUsuario(userId);
  return filiais.some((f) => f.id === r.filialId) ? r : null;
}

/** Manda as mensagens pela conversa do cliente no número da casa (a mesma
 *  da Nina), se ele escreveu nas últimas 24h. Grava no histórico como equipe. */
async function enviarNaConversa(filialId: string, telefone: string, textos: string[], userId: string): Promise<boolean> {
  const suf = telefone.replace(/\D/g, '').slice(-8);
  if (suf.length < 8) return false;
  const [conversa] = await db
    .select()
    .from(schema.atendimentoConversa)
    .where(
      and(
        eq(schema.atendimentoConversa.filialId, filialId),
        sql`right(regexp_replace(${schema.atendimentoConversa.telefone}, '\\D', '', 'g'), 8) = ${suf}`,
        sql`${schema.atendimentoConversa.ultimaMsgClienteEm} > now() - interval '23 hours 50 minutes'`,
      ),
    )
    .orderBy(desc(schema.atendimentoConversa.ultimaMsgClienteEm))
    .limit(1);
  if (!conversa) return false;
  const [numero] = await db
    .select({ phoneNumberId: schema.whatsappNumero.phoneNumberId })
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.filialId, filialId))
    .limit(1);
  if (!numero) return false;
  for (const corpo of textos) {
    const envio = await enviarTexto(numero.phoneNumberId, conversa.telefone, corpo);
    await db.insert(schema.atendimentoMensagem).values({
      conversaId: conversa.id,
      waMessageId: envio.waMessageId,
      direcao: 'saida',
      autor: 'equipe',
      autorUsuarioId: userId,
      tipo: 'texto',
      corpo,
      statusEnvio: envio.erro ? 'erro' : 'enviada',
      erro: envio.erro ?? null,
    });
    if (envio.erro && !envio.waMessageId) return false;
  }
  await db
    .update(schema.atendimentoConversa)
    .set({ ultimaMsgEm: sql`now()`, atualizadoEm: sql`now()` })
    .where(eq(schema.atendimentoConversa.id, conversa.id));
  return true;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('reserva.update');
  if (error) return error;
  const { id } = await params;
  const r = await reservaDoUsuario(user.id, id);
  if (!r) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });

  const b = (await request.json().catch(() => null)) as { valor?: number; enviarZap?: boolean } | null;
  const valor = typeof b?.valor === 'number' && b.valor > 0 ? b.valor : undefined;

  let cob;
  try {
    cob = await cobrarTaxaReserva(id, { valor });
  } catch (e) {
    return NextResponse.json({ error: `Não consegui gerar o Pix: ${(e as Error).message}` }, { status: 502 });
  }
  if (!cob.ok) return NextResponse.json({ error: cob.erro }, { status: 400 });

  const [a, m, d] = r.data.split('-');
  const texto =
    `Olá, ${r.clienteNome.split(' ')[0]}! Pra garantir o ${r.area ?? 'Lounge'}${r.mesa ? ` (mesa ${r.mesa})` : ''} ` +
    `em ${d}/${m} às ${String(r.hora).slice(0, 5)}, a taxa é de R$ ${cob.valor.toFixed(2).replace('.', ',')}.\n\n` +
    `Pix copia e cola (é só copiar a mensagem abaixo e colar no app do banco):`;

  let zapEnviado = false;
  let zapErro: string | null = null;
  if (b?.enviarZap && r.clienteTelefone) {
    try {
      zapEnviado = await enviarNaConversa(r.filialId, r.clienteTelefone, [texto, cob.pixCopiaECola], user.id);
      if (!zapEnviado) zapErro = 'sem conversa aberta no WhatsApp da casa nas últimas 24h — use o botão do wa.me';
    } catch (e) {
      zapErro = (e as Error).message;
    }
  }

  return NextResponse.json({ ...cob, texto, zapEnviado, zapErro });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('reserva.read');
  if (error) return error;
  const { id } = await params;
  const r = await reservaDoUsuario(user.id, id);
  if (!r) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });
  try {
    const status = await conferirPagamentoReserva(id, new URL(_req.url).origin);
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

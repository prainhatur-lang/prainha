// GET /api/cron/lembrete-reserva
// Cron diário (20:00 UTC → 17:00 BRT) que manda no WhatsApp, na VÉSPERA, um
// lembrete pedindo pro cliente confirmar a reserva do dia seguinte.
//
// Autenticação: Vercel Cron envia `Authorization: Bearer <CRON_SECRET>`.
// Só envia pra reservas de amanhã, ativas (pendente/confirmada), com telefone,
// e que ainda não receberam lembrete (lembrete_confirmacao_em IS NULL).
// Env-gated: se o template do WhatsApp não estiver configurado, não faz nada.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { diasAtrasBr } from '@/lib/datas';
import { lembreteReservaConfigurado, enviarLembreteReserva } from '@/lib/whatsapp-otp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function normTelefone(v: string | null): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!lembreteReservaConfigurado()) {
    return NextResponse.json({ ok: true, skip: 'WhatsApp lembrete nao configurado', enviados: 0 });
  }

  const amanha = diasAtrasBr(-1); // YYYY-MM-DD (BRT)

  const reservas = await db
    .select({
      id: schema.reserva.id,
      nome: schema.reserva.clienteNome,
      telefone: schema.reserva.clienteTelefone,
      data: schema.reserva.data,
      hora: schema.reserva.hora,
      area: schema.reserva.area,
      cancelToken: schema.reserva.cancelToken,
      filialNome: schema.filial.nome,
    })
    .from(schema.reserva)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.reserva.filialId))
    .where(
      and(
        eq(schema.reserva.data, amanha),
        inArray(schema.reserva.status, ['pendente', 'confirmada']),
        isNull(schema.reserva.lembreteConfirmacaoEm),
        sql`${schema.reserva.clienteTelefone} IS NOT NULL`,
      ),
    );

  let enviados = 0;
  let semTelefone = 0;
  const falhas: string[] = [];

  for (const r of reservas) {
    const tel = normTelefone(r.telefone);
    if (!tel) {
      semTelefone++;
      continue;
    }
    // Garante token pro link de confirmação.
    let token = r.cancelToken;
    if (!token) {
      token = randomBytes(24).toString('hex');
      await db.update(schema.reserva).set({ cancelToken: token }).where(eq(schema.reserva.id, r.id));
    }
    const [a, m, d] = r.data.split('-');
    try {
      await enviarLembreteReserva(tel, {
        nome: (r.nome ?? '').split(' ')[0] || 'tudo bem',
        data: `${d}/${m}/${a}`,
        hora: r.hora,
        local: `${r.filialNome}${r.area ? ' · ' + r.area : ''}`,
        token,
      });
      await db
        .update(schema.reserva)
        .set({ lembreteConfirmacaoEm: sql`now()` })
        .where(eq(schema.reserva.id, r.id));
      enviados++;
    } catch (e) {
      falhas.push(`${r.nome}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true, data: amanha, total: reservas.length, enviados, semTelefone, falhas });
}

// POST /api/reservas/enviar-lembretes
// Dispara MANUALMENTE os lembretes de confirmação das reservas de amanhã
// (botão no painel /reservas). Autenticado pela sessão (perm reserva.update),
// limitado às filiais do usuário. Mesma lógica do cron das 17h.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { diasAtrasBr } from '@/lib/datas';
import { processarLembretesReserva } from '@/lib/reservas/lembrete';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const { user, error } = await exigirPermApi('reserva.update');
  if (error) return error;

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  const amanha = diasAtrasBr(-1);

  const r = await processarLembretesReserva(amanha, filialIds);
  if (!r.configurado) {
    const faltando: string[] = [];
    if (!process.env.WHATSAPP_TOKEN) faltando.push('WHATSAPP_TOKEN');
    if (!process.env.WHATSAPP_PHONE_ID) faltando.push('WHATSAPP_PHONE_ID');
    if (!process.env.WHATSAPP_LEMBRETE_TEMPLATE) faltando.push('WHATSAPP_LEMBRETE_TEMPLATE');
    return NextResponse.json(
      { error: `WhatsApp de lembrete não configurado. Falta(m) no Vercel: ${faltando.join(', ') || '(nada? confira o redeploy)'}` },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, ...r });
}

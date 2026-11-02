// POST /api/conheca — "Quero começar" do site público /conheca (funil do
// Concilia SaaS). Público, sem login. Grava em saas_interessado e, se
// configurado, avisa o time no WhatsApp (SAAS_AVISO_NUMEROS, separado por
// vírgula, pelo template de aviso da equipe). Sem aviso configurado a lista
// /saas/interessados continua mostrando tudo.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { avisarEquipe } from '@/lib/atendimento/avisos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PLANOS = ['gratis', 'essencial', 'gestao', 'completo', 'consultoria', 'nao_sei'];

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
  // Campo escondido: robô preenche, gente não vê.
  if (String(b.site ?? '').trim()) return NextResponse.json({ ok: true });

  const txt = (k: string, max: number) => String(b[k] ?? '').trim().slice(0, max);
  const nome = txt('nome', 200);
  const whatsapp = txt('whatsapp', 30).replace(/\D/g, '').slice(0, 20);
  const email = txt('email', 200).toLowerCase();
  const plano = PLANOS.includes(txt('plano', 30)) ? txt('plano', 30) : null;
  const maqRaw = parseInt(txt('maquininhas', 4), 10);
  const maquininhas = Number.isFinite(maqRaw) && maqRaw >= 0 && maqRaw < 1000 ? maqRaw : null;

  if (!nome || whatsapp.length < 10) {
    return NextResponse.json({ error: 'Preencha seu nome e um WhatsApp com DDD.' }, { status: 400 });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Confira o e-mail.' }, { status: 400 });
  }

  const estabelecimento = txt('estabelecimento', 200) || null;
  const cidade = txt('cidade', 120) || null;
  await db.insert(schema.saasInteressado).values({
    nome,
    estabelecimento,
    cidade,
    whatsapp,
    email: email || null,
    maquininhas,
    plano,
    mensagem: txt('mensagem', 2000) || null,
    origem: txt('origem', 40).replace(/[^a-z0-9_-]/gi, '') || 'site',
  });

  const numeros = (process.env.SAAS_AVISO_NUMEROS || '')
    .split(',')
    .map((n) => n.replace(/\D/g, ''))
    .filter((n) => n.length >= 12);
  if (numeros.length) {
    await avisarEquipe(numeros, {
      motivo: `Interessado no Concilia${plano ? ` (${plano})` : ''}`,
      nomeCliente: [nome, estabelecimento].filter(Boolean).join(' · '),
      telefone: whatsapp,
      filial: cidade || 'site /conheca',
    });
  }

  return NextResponse.json({ ok: true });
}

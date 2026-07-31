// GET /api/admin/whatsapp-subscribe
// Inscreve o app na WABA (subscribed_apps) usando o token do servidor, pra a
// Meta passar a entregar os webhooks de mensagens recebidas (cliques de botão).
// Protegido: exige usuário logado. Rota pontual de setup — pode remover depois.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Aceita: usuário logado OU ?key=<verify token do webhook> (pra rodar via URL
  // direta sem depender da sessão do navegador).
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const expectedKey = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'prainha_zap_2026';
  let autorizado = key != null && key === expectedKey;
  if (!autorizado) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    autorizado = !!user;
  }
  if (!autorizado) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const token = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META;
  const waba = process.env.WHATSAPP_WABA_ID || '2163799284418471';
  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';
  if (!token) return NextResponse.json({ error: 'sem WHATSAPP_TOKEN/WHATSAPP_META' }, { status: 400 });

  // status atual
  let antes: unknown = null;
  try {
    const r = await fetch(`https://graph.facebook.com/${ver}/${waba}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    antes = await r.json();
  } catch (e) {
    antes = { erro: (e as Error).message };
  }

  // inscreve o app na WABA
  const post = await fetch(`https://graph.facebook.com/${ver}/${waba}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const resultado = await post.json().catch(() => ({}));

  // confirma depois
  let depois: unknown = null;
  try {
    const r = await fetch(`https://graph.facebook.com/${ver}/${waba}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    depois = await r.json();
  } catch (e) {
    depois = { erro: (e as Error).message };
  }

  return NextResponse.json({ waba, statusHttp: post.status, resultado, antes, depois });
}

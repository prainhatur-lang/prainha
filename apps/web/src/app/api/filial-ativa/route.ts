// GET  /api/filial-ativa — filiais que o usuário enxerga + qual está ativa
// POST /api/filial-ativa — troca a filial ativa (grava o cookie)
//
// O seletor do menu (filial-switcher.tsx) consome os dois. A validação é
// sempre contra filiaisDoUsuario: cookie não vira porta de entrada pra filial
// que o usuário não acessa.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { COOKIE_FILIAL, COOKIE_FILIAL_MAX_AGE, escolherFilial } from '@/lib/filial-ativa';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const filiais = await filiaisDoUsuario(user.id);
  const ativa = await escolherFilial(filiais);

  return NextResponse.json({
    filiais: filiais.map((f) => ({ id: f.id, nome: f.nome, organizacao: f.organizacaoNome })),
    ativaId: ativa?.id ?? null,
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { filialId?: string };
  const filialId = (body.filialId ?? '').trim();
  if (!filialId) return NextResponse.json({ error: 'filialId obrigatório' }, { status: 400 });

  const filiais = await filiaisDoUsuario(user.id);
  const alvo = filiais.find((f) => f.id === filialId);
  if (!alvo) return NextResponse.json({ error: 'sem acesso a essa filial' }, { status: 403 });

  (await cookies()).set(COOKIE_FILIAL, alvo.id, {
    path: '/',
    maxAge: COOKIE_FILIAL_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  return NextResponse.json({ ok: true, filialId: alvo.id, nome: alvo.nome });
}

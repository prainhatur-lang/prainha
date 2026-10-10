// GET /api/avaliacoes/google/conectar — leva quem configura as avaliações pra
// tela de autorização do Google (conta que administra as fichas das casas).
// O retorno cai em /api/avaliacoes/google/callback.

import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { segredoConfigurado } from '@/lib/segredo';
import { googleConfigurado, uriDeRetorno, urlDeAutorizacao } from '@/lib/google-avaliacoes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COOKIE = 'g_aval_state';

export async function GET(request: Request) {
  const voltar = (aviso: string) =>
    NextResponse.redirect(new URL(`/avaliacoes?google=${aviso}#google`, request.url));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  if (!(await podeUsuario(user.id, 'avaliacao.configurar'))) return voltar('sem-permissao');
  if (!googleConfigurado() || !segredoConfigurado()) return voltar('falta-env');

  const origem = new URL(request.url).origin;
  const state = randomBytes(24).toString('base64url');
  const res = NextResponse.redirect(urlDeAutorizacao(uriDeRetorno(origem), state));
  // confere no retorno que a volta do Google nasceu deste clique (10 min)
  res.cookies.set(COOKIE, state, {
    httpOnly: true,
    secure: origem.startsWith('https://'),
    sameSite: 'lax',
    path: '/api/avaliacoes/google',
    maxAge: 600,
  });
  return res;
}

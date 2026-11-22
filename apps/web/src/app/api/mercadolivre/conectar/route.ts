// GET /api/mercadolivre/conectar — leva o Admin pra tela de autorização do
// Mercado Livre (conta COMPRADORA). O retorno cai em /api/mercadolivre/callback.

import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ehAdmin } from '@/lib/usuario-admin';
import { segredoConfigurado } from '@/lib/segredo';
import { mlConfigurado, mlUriDeRetorno, mlUrlDeAutorizacao } from '@/lib/mercadolivre';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COOKIE = 'ml_state';

export async function GET(request: Request) {
  const voltar = (aviso: string) =>
    NextResponse.redirect(new URL(`/compras/mercadolivre?ml=${aviso}`, request.url));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  if (!(await ehAdmin(user.id))) return voltar('sem-permissao');
  if (!mlConfigurado() || !segredoConfigurado()) return voltar('falta-env');

  const origem = new URL(request.url).origin;
  const state = randomBytes(24).toString('base64url');
  const res = NextResponse.redirect(mlUrlDeAutorizacao(mlUriDeRetorno(origem), state));
  res.cookies.set(COOKIE, state, {
    httpOnly: true,
    secure: origem.startsWith('https://'),
    sameSite: 'lax',
    path: '/api/mercadolivre',
    maxAge: 600,
  });
  return res;
}

// GET /api/mercadolivre/callback — volta da autorização do Mercado Livre.
// Troca o código pelos tokens e grava a conta (cifrada) em ml_conta.
// /api/* não passa pelo login do proxy: login e Admin são conferidos aqui; o
// `state` do cookie garante que a volta nasceu do clique em "Ligar conta".

import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ehAdmin } from '@/lib/usuario-admin';
import { segredoConfigurado } from '@/lib/segredo';
import { mlConfigurado, mlSalvarConta, mlTrocarCodigo, mlUriDeRetorno } from '@/lib/mercadolivre';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const COOKIE = 'ml_state';

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: Request) {
  const voltar = (aviso: string) => {
    const res = NextResponse.redirect(new URL(`/compras/mercadolivre?ml=${aviso}`, request.url));
    res.cookies.set(COOKIE, '', { path: '/api/mercadolivre', maxAge: 0 });
    return res;
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  if (!(await ehAdmin(user.id))) return voltar('sem-permissao');
  if (!mlConfigurado() || !segredoConfigurado()) return voltar('falta-env');

  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  const esperado = (await cookies()).get(COOKIE)?.value ?? '';
  if (!state || !esperado || !igual(state, esperado)) return voltar('estado');
  if (url.searchParams.get('error')) return voltar('negado');
  const code = url.searchParams.get('code') ?? '';
  if (!code) return voltar('erro');

  try {
    const t = await mlTrocarCodigo(code, mlUriDeRetorno(url.origin));
    await mlSalvarConta(t, user.id);
  } catch (e) {
    console.error('[mercadolivre] ligar conta falhou:', e instanceof Error ? e.message : e);
    return voltar('erro');
  }
  return voltar('ok');
}

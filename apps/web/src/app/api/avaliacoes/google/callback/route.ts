// GET /api/avaliacoes/google/callback — volta da tela de autorização do Google.
// Troca o código pela chave de longa duração, guarda (cifrada) nas casas de
// quem ligou e já tenta achar a ficha de cada casa pelo nome.
//
// /api/* não passa pelo login do proxy: quem confere login e permissão é esta
// rota. O `state` do cookie garante que a volta nasceu do clique em "Ligar".

import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { segredoConfigurado } from '@/lib/segredo';
import {
  ErroGoogle,
  casarFichas,
  googleConfigurado,
  listarFichas,
  trocarCodigo,
  uriDeRetorno,
  type FichaGoogle,
} from '@/lib/google-avaliacoes';
import { ligacoesGoogle, salvarChaveGoogle, salvarFichaGoogle } from '@/lib/google-avaliacoes-ligacao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const COOKIE = 'g_aval_state';

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: Request) {
  const voltar = (aviso: string) => {
    const res = NextResponse.redirect(new URL(`/avaliacoes?google=${aviso}#google`, request.url));
    res.cookies.set(COOKIE, '', { path: '/api/avaliacoes/google', maxAge: 0 });
    return res;
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  if (!(await podeUsuario(user.id, 'avaliacao.configurar'))) return voltar('sem-permissao');
  if (!googleConfigurado() || !segredoConfigurado()) return voltar('falta-env');

  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  const esperado = (await cookies()).get(COOKIE)?.value ?? '';
  if (!state || !esperado || !igual(state, esperado)) return voltar('estado');
  if (url.searchParams.get('error')) return voltar('negado');
  const code = url.searchParams.get('code') ?? '';
  if (!code) return voltar('erro');

  let refreshToken = '';
  let accessToken = '';
  try {
    const t = await trocarCodigo(code, uriDeRetorno(url.origin));
    if (!t.escopoOk) return voltar('sem-escopo');
    refreshToken = t.refreshToken;
    accessToken = t.accessToken;
  } catch (e) {
    console.error('[google-avaliacoes] troca do código falhou:', e instanceof Error ? e.message : e);
    return voltar('erro');
  }
  if (!refreshToken || !accessToken) return voltar('sem-chave');

  const casas = (await filiaisDoUsuario(user.id)).map((f) => ({ id: f.id, nome: f.nome }));
  if (casas.length === 0) return voltar('sem-permissao');
  const atuais = await ligacoesGoogle(casas.map((c) => c.id));

  // O projeto pode ainda não ter a API liberada pelo Google: a chave fica
  // guardada do mesmo jeito e as fichas são procuradas depois, pela tela.
  let fichas: FichaGoogle[] | null = null;
  try {
    fichas = await listarFichas(accessToken);
  } catch (e) {
    console.error(
      '[google-avaliacoes] ligou, mas não listou as fichas:',
      e instanceof ErroGoogle ? `${e.motivo} ${e.status}` : e,
    );
  }

  if (!fichas) {
    for (const c of casas) await salvarChaveGoogle(c.id, refreshToken, user.id);
    return voltar('ligado-sem-api');
  }

  const sugeridas = casarFichas(casas, fichas);
  let semFicha = 0;
  for (const c of casas) {
    const atual = atuais.get(c.id);
    if (atual?.local) {
      // casa que já tem ficha: só renova a chave se ESTA conta Google administra
      // a ficha dela (outra casa pode estar ligada por outra conta Google)
      if (fichas.some((f) => f.conta === atual.conta && f.local === atual.local)) {
        await salvarChaveGoogle(c.id, refreshToken, user.id);
      }
      continue;
    }
    await salvarChaveGoogle(c.id, refreshToken, user.id);
    const f = sugeridas.get(c.id);
    if (f) await salvarFichaGoogle(c.id, f, user.id);
    else semFicha++;
  }
  return voltar(semFicha > 0 ? 'ok-escolher' : 'ok');
}

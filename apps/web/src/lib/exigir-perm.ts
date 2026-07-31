// Guards server-side de permissoes — chamados no topo de pages e APIs.
//
// Pages: chama exigirPermPage(codigo). Se nao autenticado, redirect /login.
//        Se autenticado mas sem permissao, redirect /inicio?erro=sem-permissao.
//
// APIs:  chama exigirPermApi(codigo). Retorna Response 401/403 se falhar,
//        senao retorna { user } pra usar.

import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import type { User } from '@supabase/supabase-js';

/**
 * Use no topo de server components de pages protegidas.
 * Garante usuario autenticado + permissao especifica. Caso contrario, redirect.
 *
 * Retorna o user logado.
 */
export async function exigirPermPage(codigo: string): Promise<User> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!(await podeUsuario(user.id, codigo))) {
    redirect(`/inicio?erro=sem-permissao&p=${encodeURIComponent(codigo)}`);
  }
  return user;
}

/**
 * Variante quando a page ja fez supabase.auth.getUser(). Apenas checa permissao
 * e redireciona se faltar. Use logo apos `if (!user) redirect('/login')`.
 */
export async function exigirPerm(userId: string, codigo: string): Promise<void> {
  if (!(await podeUsuario(userId, codigo))) {
    redirect(`/inicio?erro=sem-permissao&p=${encodeURIComponent(codigo)}`);
  }
}

/**
 * Versao pra route handlers (apps/web/src/app/api/.../route.ts).
 * Retorna { user } em sucesso ou { error: Response } em falha.
 */
export async function exigirPermApi(
  codigo: string,
): Promise<{ user: User; error?: undefined } | { user?: undefined; error: NextResponse }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  if (!(await podeUsuario(user.id, codigo))) {
    return {
      error: NextResponse.json(
        { error: `sem permissao: ${codigo}` },
        { status: 403 },
      ),
    };
  }
  return { user };
}

/**
 * Versao one-line para injecao em handlers que ja chamaram getUser().
 * Retorna NextResponse 403 se faltar perm, ou null pra continuar.
 *
 * Uso:
 *   const semPerm = await negarSemPerm(user.id, 'fornecedor.create');
 *   if (semPerm) return semPerm;
 */
export async function negarSemPerm(
  userId: string,
  codigo: string,
): Promise<NextResponse | null> {
  if (!(await podeUsuario(userId, codigo))) {
    return NextResponse.json({ error: `sem permissao: ${codigo}` }, { status: 403 });
  }
  return null;
}

/**
 * Variante de exigirPermApi que recebe um array — passa se tiver QUALQUER uma.
 */
export async function exigirAlgumaPermApi(
  codigos: string[],
): Promise<{ user: User; error?: undefined } | { user?: undefined; error: NextResponse }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  for (const c of codigos) {
    if (await podeUsuario(user.id, c)) return { user };
  }
  return {
    error: NextResponse.json(
      { error: `sem nenhuma das permissoes: ${codigos.join(', ')}` },
      { status: 403 },
    ),
  };
}

import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Atualiza sessao automaticamente
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith('/login') || path.startsWith('/auth') || path.startsWith('/signup');
  // APIs tem auth propria (Bearer token, etc) - middleware nao deve interceptar
  const isApiRoute = path.startsWith('/api/');
  // /op/[token] e /cozinheiro/[token] sao acessos publicos via link com
  // token (sem login). Cozinheiro nao tem conta no sistema.
  const isOpPublica = path.startsWith('/op/');
  const isCozinheiroPublico = path.startsWith('/cozinheiro/');
  // /nota-boleto/[token] eh pagina mobile pra enviar foto do boleto da NFe
  // (compartilhada via WhatsApp/SMS, sem login).
  const isNotaBoletoPublico = path.startsWith('/nota-boleto/');
  const isPublicRoute =
    path === '/' ||
    isAuthRoute ||
    isApiRoute ||
    isOpPublica ||
    isCozinheiroPublico ||
    isNotaBoletoPublico;

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', path);
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Roda em todas as rotas, exceto:
     * - _next/static, _next/image
     * - arquivos estaticos (svg, png, etc)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

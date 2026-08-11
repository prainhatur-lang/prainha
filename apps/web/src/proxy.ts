import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

// Subdomínio amigável da reserva do cliente. reservas.prainhabar.com (root)
// serve a reserva pública do Prainha Bar com URL limpa (sem token na barra).
// O token é o avaliacaoToken da filial Prainha Bar (público, vai na URL mesmo).
const RESERVAS_HOST = 'reservas.prainhabar.com';
const RESERVAS_TOKEN_PRAINHA_BAR =
  '023c8170d59b84fff285540e88584fbf5d00db5606fd1e65deda36fb1df54ac6';

// Subdomínio amigável do delivery. delivery.prainhabar.com (root) abre o
// cardápio público (/delivery). Requer o CNAME no DNS + domínio na Vercel.
const DELIVERY_HOST = 'delivery.prainhabar.com';

export async function proxy(request: NextRequest) {
  const hostname = (request.headers.get('host') ?? '').split(':')[0];
  if (hostname === RESERVAS_HOST && request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = `/reservar/${RESERVAS_TOKEN_PRAINHA_BAR}`;
    return NextResponse.rewrite(url);
  }
  if (hostname === DELIVERY_HOST && request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/delivery';
    return NextResponse.rewrite(url);
  }

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
  // /agente-release/* sao bundles do agente local baixados pelo PowerShell
  // direto do PC da filial (.ps1 atualizador) — sem sessao do navegador.
  const isAgenteRelease = path.startsWith('/agente-release/');
  // /avaliar/[token] eh a pagina publica de avaliacao do cliente (QR na mesa).
  // O token na URL identifica a filial; sem login.
  const isAvaliarPublico = path.startsWith('/avaliar/');
  // /reservar/[token] eh a pagina publica de reserva do cliente (sem login).
  const isReservarPublico = path.startsWith('/reservar/');
  // /cotacao/preencher/[token] eh a pagina publica do FORNECEDOR responder a
  // cotacao (link enviado no WhatsApp; token = autenticacao, sem login).
  const isCotacaoPublica = path.startsWith('/cotacao/preencher/');
  // /pagar-mesa eh o cliente pagando a conta da mesa no cartao, vindo do QR.
  // Sem login: quem autoriza eh a assinatura HMAC nos parametros (a propria
  // pagina recusa link adulterado ou vencido). Existe porque o servidor da
  // loja roda em HTTP e nao pode capturar cartao.
  const isPagarMesaPublico = path === '/pagar-mesa';
  // /orcamento/[token] (singular; o painel interno eh /orcamentos) eh a
  // pagina publica do orcamento de evento: cliente aceita o contrato e paga
  // a entrada via Pix. Token na URL identifica o orcamento; sem login.
  const isOrcamentoPublico = path.startsWith('/orcamento/');
  // /delivery é o cardápio/checkout público de pedidos online (sem login).
  // O painel interno é /delivery-admin (protegido, fora desta lista).
  const isDeliveryPublico = path === '/delivery' || path.startsWith('/delivery/');
  const isPublicRoute =
    path === '/' ||
    isAuthRoute ||
    isApiRoute ||
    isOpPublica ||
    isCozinheiroPublico ||
    isNotaBoletoPublico ||
    isAgenteRelease ||
    isAvaliarPublico ||
    isReservarPublico ||
    isCotacaoPublica ||
    isPagarMesaPublico ||
    isOrcamentoPublico ||
    isDeliveryPublico;

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

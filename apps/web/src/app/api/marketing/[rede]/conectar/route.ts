// GET /api/marketing/{instagram|tiktok}/conectar?filialId= — leva quem
// configura pra tela de autorização da rede, pra ligar a conta DESTA casa.
// O retorno cai em /api/marketing/{rede}/callback.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { segredoConfigurado } from '@/lib/segredo';
import { ehRede, gerarEstado, uriDeRetornoRede } from '@/lib/marketing/ligacao';
import { instagramConfigurado, urlAutorizacaoInstagram } from '@/lib/marketing/instagram';
import { tiktokConfigurado, urlAutorizacaoTiktok } from '@/lib/marketing/tiktok';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, ctx: { params: Promise<{ rede: string }> }) {
  const { rede } = await ctx.params;
  const url = new URL(request.url);
  const filialId = url.searchParams.get('filialId') ?? '';
  const voltar = (aviso: string) =>
    NextResponse.redirect(
      new URL(`/marketing?${new URLSearchParams({ filialId, rede, aviso }).toString()}`, request.url),
    );
  if (!ehRede(rede)) return voltar('rede');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  if (!(await podeUsuario(user.id, 'atendimento.config'))) return voltar('sem-permissao');
  const casas = await filiaisDoUsuario(user.id);
  if (!casas.some((c) => c.id === filialId)) return voltar('sem-permissao');

  const configurado = rede === 'instagram' ? instagramConfigurado() : tiktokConfigurado();
  if (!configurado || !segredoConfigurado()) return voltar('falta-env');

  const state = gerarEstado(filialId, rede, user.id);
  const retorno = uriDeRetornoRede(rede, url.origin);
  return NextResponse.redirect(
    rede === 'instagram' ? urlAutorizacaoInstagram(retorno, state) : urlAutorizacaoTiktok(retorno, state),
  );
}

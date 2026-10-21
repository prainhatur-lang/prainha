// GET /api/marketing/{instagram|tiktok}/callback — volta da autorização da
// rede. Troca o código pelas chaves e guarda (cifradas) na casa do `state`.
// /api/* não passa pelo login do proxy: login e permissão são conferidos aqui,
// e o `state` assinado garante que a volta nasceu do clique em "Conectar".

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { ehRede, lerEstado, salvarLigacaoRede, uriDeRetornoRede } from '@/lib/marketing/ligacao';
import { perfilInstagram, trocarCodigoInstagram } from '@/lib/marketing/instagram';
import { perfilTiktok, trocarCodigoTiktok } from '@/lib/marketing/tiktok';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request, ctx: { params: Promise<{ rede: string }> }) {
  const { rede } = await ctx.params;
  const url = new URL(request.url);
  const estado = lerEstado(url.searchParams.get('state') ?? '');
  const filialId = estado?.filialId ?? '';
  const voltar = (aviso: string) =>
    NextResponse.redirect(
      new URL(`/marketing?${new URLSearchParams({ filialId, rede, aviso }).toString()}`, request.url),
    );
  if (!ehRede(rede) || !estado || estado.rede !== rede) return voltar('estado');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  if (user.id !== estado.userId) return voltar('estado');
  if (!(await podeUsuario(user.id, 'atendimento.config'))) return voltar('sem-permissao');
  const casas = await filiaisDoUsuario(user.id);
  if (!casas.some((c) => c.id === filialId)) return voltar('sem-permissao');

  if (url.searchParams.get('error')) return voltar('negado');
  const code = url.searchParams.get('code') ?? '';
  if (!code) return voltar('erro');
  const retorno = uriDeRetornoRede(rede, url.origin);

  try {
    if (rede === 'instagram') {
      const t = await trocarCodigoInstagram(code, retorno);
      let usuario = '';
      try {
        usuario = (await perfilInstagram(t.accessToken)).usuario;
      } catch {
        // perfil fica pra tela
      }
      await salvarLigacaoRede(
        filialId,
        rede,
        { accessToken: t.accessToken, refreshToken: '', expiraEm: t.expiraEm, refreshExpiraEm: '', contaId: t.contaId, usuario, escopos: t.escopos },
        user.id,
      );
    } else {
      const t = await trocarCodigoTiktok(code, retorno);
      let usuario = '';
      try {
        const p = await perfilTiktok(t.accessToken);
        usuario = p.usuario || p.nome;
      } catch {
        // perfil fica pra tela
      }
      await salvarLigacaoRede(filialId, rede, { ...t, usuario }, user.id);
    }
  } catch (e) {
    console.error(`[marketing/${rede}] troca do código falhou:`, e instanceof Error ? e.message : e);
    return voltar('erro');
  }
  return voltar('ok');
}

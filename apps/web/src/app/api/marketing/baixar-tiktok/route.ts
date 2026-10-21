// GET /api/marketing/baixar-tiktok?filialId&postId — devolve os links das
// fotos (ou do vídeo) de um post do Instagram da casa + a legenda, pro botão
// "📲 Baixar pro TikTok" salvar no celular e a casa postar pelo "+" do TikTok.
// Não fala com o TikTok. As fotos passam por /api/marketing/midia, que já
// entrega JPEG no tamanho do TikTok (até 1080p).

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { chaveValida } from '@/lib/marketing/chave';
import { baseDoApp } from '@/lib/marketing/ligacao';
import { ErroInstagram, midiaPostInstagram } from '@/lib/marketing/instagram';
import { cdnDaMeta, linkMidia } from '@/lib/marketing/midia-link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

export async function GET(req: Request) {
  const { user, error } = await exigirPermApi('atendimento.config');
  if (error) return error;
  const q = new URL(req.url).searchParams;
  const filialId = q.get('filialId') ?? '';
  const postId = q.get('postId') ?? '';
  const casas = await filiaisDoUsuario(user.id);
  if (!filialId || !casas.some((c) => c.id === filialId)) return erro('sem acesso a essa casa', 403);
  if (!/^\d+$/.test(postId)) return erro('post inválido');

  try {
    const ig = await chaveValida(filialId, 'instagram');
    if (!ig) return erro('O Instagram desta casa não está conectado.', 409);
    const m = await midiaPostInstagram(ig.accessToken, postId);
    const base = baseDoApp(req.url);
    const ehFoto = m.fotos.length > 0 && (m.tipo === 'CAROUSEL_ALBUM' || m.tipo === 'IMAGE' || !m.videos.length);
    if (ehFoto) {
      const fotos = m.fotos.filter(cdnDaMeta).map((u) => linkMidia(base, u));
      if (!fotos.length) return erro('Não achei as fotos deste post no Instagram.', 422);
      return NextResponse.json({ ok: true, tipo: 'fotos', fotos, legenda: m.legenda });
    }
    const video = m.videos.find(cdnDaMeta);
    if (video) {
      return NextResponse.json({ ok: true, tipo: 'video', video: linkMidia(base, video), videoOriginal: video, legenda: m.legenda });
    }
    if (m.tipo === 'VIDEO') {
      return erro(
        'O Instagram não libera o arquivo deste Reels (costuma ser música com direito autoral). Baixe pelo app do Instagram.',
        422,
      );
    }
    return erro('Este post não tem foto nem vídeo que dê pra baixar.', 422);
  } catch (e) {
    if (e instanceof ErroInstagram) {
      console.error('[marketing/baixar-tiktok]', e.message);
      return erro(e.message, 502);
    }
    throw e;
  }
}

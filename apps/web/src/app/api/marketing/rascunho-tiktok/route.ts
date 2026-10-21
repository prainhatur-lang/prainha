// POST /api/marketing/rascunho-tiktok { filialId, postId } — pega um post do
// Instagram da casa e manda pro RASCUNHO do TikTok da mesma casa (caixa de
// entrada; quem publica é a casa, pelo app do TikTok).
// Vídeo/Reels: o servidor baixa do Instagram e sobe o arquivo pro TikTok.
// Foto/carrossel: o TikTok puxa cada foto por link assinado do nosso domínio
// (/api/marketing/midia), com a legenda junto.
// Precisa do escopo video.upload na ligação do TikTok.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { chaveValida } from '@/lib/marketing/chave';
import { baseDoApp } from '@/lib/marketing/ligacao';
import { ErroInstagram, midiaPostInstagram } from '@/lib/marketing/instagram';
import {
  ErroTiktok,
  rascunhoFotosTiktok,
  rascunhoVideoTiktok,
  esperarEnvioTiktok, statusEnvioTiktok,
  temRascunhoTiktok,
} from '@/lib/marketing/tiktok';
import { cdnDaMeta, linkMidia } from '@/lib/marketing/midia-link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const LIMITE_VIDEO = 500 * 1024 * 1024;

const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('atendimento.config');
  if (error) return error;
  const b = (await req.json().catch(() => ({}))) as { filialId?: string; postId?: string };
  const casas = await filiaisDoUsuario(user.id);
  if (!b.filialId || !casas.some((c) => c.id === b.filialId)) return erro('sem acesso a essa casa', 403);
  if (!b.postId || !/^\d+$/.test(b.postId)) return erro('post inválido');

  try {
    const tt = await chaveValida(b.filialId, 'tiktok');
    if (!tt) return erro('O TikTok desta casa não está conectado.', 409);
    if (!temRascunhoTiktok(tt.escopos)) {
      return erro(
        'A ligação do TikTok desta casa ainda não tem a permissão de rascunho (video.upload). ' +
          'Depois de liberada no app do TikTok e na Vercel (TIKTOK_ESCOPOS), clique em Desconectar e Conectar TikTok de novo.',
        409,
      );
    }
    const ig = await chaveValida(b.filialId, 'instagram');
    if (!ig) return erro('O Instagram desta casa não está conectado.', 409);

    const m = await midiaPostInstagram(ig.accessToken, b.postId);
    let publishId: string;
    let tipo: 'video' | 'fotos';
    if (m.fotos.length && (m.tipo === 'CAROUSEL_ALBUM' || m.tipo === 'IMAGE' || !m.videos.length)) {
      const base = baseDoApp(req.url);
      const fotos = m.fotos.filter(cdnDaMeta).map((u) => linkMidia(base, u));
      if (!fotos.length) return erro('Não achei as fotos deste post no Instagram.', 422);
      publishId = await rascunhoFotosTiktok(tt.accessToken, fotos, m.legenda);
      tipo = 'fotos';
    } else if (m.videos.length) {
      let r: Response;
      try {
        r = await fetch(m.videos[0]!, { cache: 'no-store', signal: AbortSignal.timeout(120000) });
      } catch {
        return erro('O Instagram não entregou o vídeo a tempo. Tente de novo.', 502);
      }
      if (!r.ok) return erro(`O Instagram recusou o download do vídeo (HTTP ${r.status}).`, 502);
      if (Number(r.headers.get('content-length') ?? 0) > LIMITE_VIDEO) return erro('Vídeo grande demais (mais de 500 MB).', 413);
      const video = new Uint8Array(await r.arrayBuffer());
      publishId = await rascunhoVideoTiktok(tt.accessToken, video);
      tipo = 'video';
    } else if (m.tipo === 'VIDEO') {
      // A API do Instagram omite o media_url de Reels com música protegida por direito autoral.
      return erro(
        'O Instagram não libera o arquivo deste Reels (costuma ser música com direito autoral). Mande pelo app do TikTok ou escolha outro post.',
        422,
      );
    } else {
      return erro('Este post não tem foto nem vídeo que dê pra mandar.', 422);
    }

    // uma olhada na situação (não espera terminar)
    let status = '';
    let motivo = '';
    try {
      // foto: o TikTok busca o link e só depois diz se aceitou — espera até 20 s
      ({ status, motivo } =
        tipo === 'fotos' ? await esperarEnvioTiktok(tt.accessToken, publishId) : await statusEnvioTiktok(tt.accessToken, publishId));
    } catch {
      // sem situação: o envio já foi aceito
    }
    if (status === 'FAILED') return erro(`O TikTok aceitou e depois recusou o envio (${motivo || 'sem motivo'}).`, 502);
    return NextResponse.json({ ok: true, tipo, publishId, status, legenda: m.legenda });
  } catch (e) {
    if (e instanceof ErroTiktok || e instanceof ErroInstagram) {
      console.error('[marketing/rascunho-tiktok]', e.message);
      return erro(e.message, 502);
    }
    throw e;
  }
}

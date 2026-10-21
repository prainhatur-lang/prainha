// POST /api/marketing/legenda { filialId, ideia, imagens[base64 jpeg], video, redes }
// → { legenda } escrita pela IA olhando as fotos (ou quadros do vídeo) e as
// legendas recentes da casa no Instagram (pra seguir o estilo).

import { NextResponse } from 'next/server';
import { acessoMarketingApi } from '@/lib/marketing/acesso';
import { chaveValida } from '@/lib/marketing/chave';
import { postsInstagram } from '@/lib/marketing/instagram';
import { escreverLegenda } from '@/lib/marketing/ia';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as {
    filialId?: string;
    ideia?: string;
    imagens?: unknown;
    video?: boolean;
    redes?: unknown;
  };
  const a = await acessoMarketingApi(b.filialId);
  if (a.error) return a.error;
  const imagens = (Array.isArray(b.imagens) ? b.imagens : [])
    .filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9+/=]+$/.test(x) && x.length < 1_500_000)
    .slice(0, 4);
  const ideia = String(b.ideia ?? '').slice(0, 1000);
  if (!imagens.length && !ideia.trim()) {
    return NextResponse.json({ error: 'Ponha uma foto/vídeo ou escreva a ideia do post.' }, { status: 400 });
  }
  let exemplos: string[] = [];
  try {
    const ig = await chaveValida(a.casa.id, 'instagram');
    if (ig) exemplos = (await postsInstagram(ig.accessToken, 6)).map((p) => p.legenda);
  } catch {
    // sem exemplos: a IA escreve do zero
  }
  try {
    const legenda = await escreverLegenda({
      filialId: a.casa.id,
      casa: a.casa.nome,
      ideia,
      imagens,
      exemplos,
      video: !!b.video,
      redes: Array.isArray(b.redes) ? b.redes.map(String) : [],
    });
    return NextResponse.json({ legenda });
  } catch (e) {
    console.error('[marketing/legenda]', (e as Error).message);
    return NextResponse.json({ error: `A IA não conseguiu escrever agora (${(e as Error).message.slice(0, 120)}).` }, { status: 502 });
  }
}

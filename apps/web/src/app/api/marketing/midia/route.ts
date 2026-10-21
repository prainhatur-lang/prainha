// GET /api/marketing/midia?u&x&s — PÚBLICA (quem chama é o TikTok buscando a
// foto do rascunho). Só repassa foto do CDN da Meta com link assinado
// (lib/marketing/midia-link.ts), que vence em 2 h.

import { fotoParaTiktok } from '@/lib/marketing/foto-tiktok';
import { lerLinkMidia } from '@/lib/marketing/midia-link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const url = lerLinkMidia(q.get('u') ?? '', q.get('x') ?? '', q.get('s') ?? '');
  if (!url) return new Response('link inválido ou vencido', { status: 403 });
  let r: Response;
  try {
    r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  } catch {
    return new Response('a Meta não respondeu', { status: 502 });
  }
  if (!r.ok || !r.body) return new Response('a Meta recusou a foto', { status: 502 });
  const tipo = r.headers.get('content-type') ?? 'image/jpeg';
  // O TikTok só aceita foto até 1080p (a do Instagram vem com 1440 px): vira JPEG menor.
  // Se a conversão falhar, segue o caminho antigo (repassa como veio).
  if (!tipo.startsWith('video/')) {
    try {
      const jpeg = await fotoParaTiktok(new Uint8Array(await r.arrayBuffer()));
      return new Response(new Uint8Array(jpeg), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.length), 'cache-control': 'private, max-age=600' },
      });
    } catch (e) {
      console.error('[marketing/midia] não converti a foto', (e as Error).message);
      try {
        r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      } catch {
        return new Response('a Meta não respondeu', { status: 502 });
      }
      if (!r.ok || !r.body) return new Response('a Meta recusou a foto', { status: 502 });
    }
  }
  const headers: Record<string, string> = { 'content-type': tipo, 'cache-control': 'private, max-age=600' };
  const tam = r.headers.get('content-length');
  if (tam) headers['content-length'] = tam;
  return new Response(r.body, { status: 200, headers });
}

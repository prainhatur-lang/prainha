// GET /api/marketing/arquivo?p&x&s — PÚBLICA (quem chama é o TikTok buscando a
// foto do post montado na tela Publicar). Confere o link assinado
// (lib/marketing/midia-link.ts, vale 2 h) e repassa o arquivo do bucket
// privado marketing-midia.

import { createAdminClient } from '@/lib/supabase/server';
import { BUCKET_MARKETING, lerLinkArquivo } from '@/lib/marketing/midia-link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const path = lerLinkArquivo(q.get('p') ?? '', q.get('x') ?? '', q.get('s') ?? '');
  if (!path) return new Response('link inválido ou vencido', { status: 403 });
  const admin = await createAdminClient();
  const { data } = await admin.storage.from(BUCKET_MARKETING).createSignedUrl(path, 600);
  if (!data?.signedUrl) return new Response('arquivo não encontrado', { status: 404 });
  let r: Response;
  try {
    r = await fetch(data.signedUrl, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  } catch {
    return new Response('o depósito não respondeu', { status: 502 });
  }
  if (!r.ok || !r.body) return new Response('arquivo não encontrado', { status: 404 });
  const headers: Record<string, string> = {
    'content-type': r.headers.get('content-type') ?? 'application/octet-stream',
    'cache-control': 'private, max-age=600',
  };
  const tam = r.headers.get('content-length');
  if (tam) headers['content-length'] = tam;
  return new Response(r.body, { status: 200, headers });
}

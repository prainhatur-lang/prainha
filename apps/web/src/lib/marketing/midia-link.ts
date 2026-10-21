// Link assinado pra foto do Instagram passar pelo nosso domínio — o TikTok só
// puxa foto de domínio verificado no app (app.prainhabar.com), e o CDN da Meta
// não é. A rota pública /api/marketing/midia confere a assinatura e repassa.
// Vale 2 h e só aponta pro CDN da Meta.

import { createHmac, timingSafeEqual } from 'node:crypto';

const VALIDADE_MS = 2 * 3600 * 1000;

function assinar(corpo: string): string {
  return createHmac('sha256', `marketing-midia:${process.env.CREDENCIAL_SECRET ?? ''}`).update(corpo).digest('base64url');
}

export function cdnDaMeta(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname);
  } catch {
    return false;
  }
}

export function linkMidia(base: string, url: string): string {
  const u = Buffer.from(url).toString('base64url');
  const x = String(Date.now() + VALIDADE_MS);
  return `${base}/api/marketing/midia?u=${u}&x=${x}&s=${assinar(`${u}.${x}`)}`;
}

/** Devolve o link original se a assinatura bate e não venceu. */
export function lerLinkMidia(u: string, x: string, s: string): string | null {
  if (!u || !x || !s) return null;
  const esperado = Buffer.from(assinar(`${u}.${x}`));
  const veio = Buffer.from(s);
  if (esperado.length !== veio.length || !timingSafeEqual(esperado, veio)) return null;
  if (!(Number(x) > Date.now())) return null;
  const url = Buffer.from(u, 'base64url').toString('utf8');
  return cdnDaMeta(url) ? url : null;
}

// ── Arquivo nosso (bucket marketing-midia) pelo nosso domínio ─────────────
// O TikTok só puxa foto de domínio verificado: a tela Publicar sobe a foto pro
// Storage e o TikTok busca em /api/marketing/arquivo com este link assinado.

export const BUCKET_MARKETING = 'marketing-midia';

function assinarArquivo(corpo: string): string {
  return createHmac('sha256', `marketing-arquivo:${process.env.CREDENCIAL_SECRET ?? ''}`).update(corpo).digest('base64url');
}

export function linkArquivo(base: string, path: string): string {
  const p = Buffer.from(path).toString('base64url');
  const x = String(Date.now() + VALIDADE_MS);
  return `${base}/api/marketing/arquivo?p=${p}&x=${x}&s=${assinarArquivo(`${p}.${x}`)}`;
}

/** Devolve o path no bucket se a assinatura bate e não venceu. */
export function lerLinkArquivo(p: string, x: string, s: string): string | null {
  if (!p || !x || !s) return null;
  const esperado = Buffer.from(assinarArquivo(`${p}.${x}`));
  const veio = Buffer.from(s);
  if (esperado.length !== veio.length || !timingSafeEqual(esperado, veio)) return null;
  if (!(Number(x) > Date.now())) return null;
  const path = Buffer.from(p, 'base64url').toString('utf8');
  return /^[0-9a-f-]{36}\/[\w./-]+$/.test(path) && !path.includes('..') ? path : null;
}

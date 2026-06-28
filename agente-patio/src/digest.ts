// HTTP Digest auth (MD5, qop=auth) — o que o CGI do Intelbras/Dahua exige.
// Faz o handshake de 2 passos: 1) GET sem auth -> 401 com nonce/realm/opaque;
// 2) reenvia com Authorization: Digest ... calculado.
import { createHash, randomBytes } from 'node:crypto';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

function parseAuthHeader(h: string): Record<string, string> {
  const out: Record<string, string> = {};
  // remove o "Digest " inicial
  const body = h.replace(/^Digest\s+/i, '');
  // campos no formato chave="valor" ou chave=valor, separados por virgula
  const re = /(\w+)=(?:"([^"]*)"|([^,]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = m[2] ?? m[3] ?? '';
  }
  return out;
}

export interface DigestResult {
  status: number;
  text: string;
  ok: boolean;
}

/**
 * Faz uma requisicao com Digest auth. `url` deve ser http(s)://host/path?query.
 * Retorna status + corpo em texto.
 */
export async function digestRequest(
  url: string,
  user: string,
  pass: string,
  method = 'GET',
  timeoutMs = 8000,
): Promise<DigestResult> {
  const u = new URL(url);
  const uri = u.pathname + u.search;

  const doFetch = (headers: Record<string, string>) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    return fetch(url, { method, headers, signal: ctl.signal }).finally(() => clearTimeout(t));
  };

  // Passo 1: sem auth, pega o desafio
  const r1 = await doFetch({});
  if (r1.status !== 401) {
    const text = await r1.text();
    return { status: r1.status, text, ok: r1.ok };
  }
  const wwwAuth = r1.headers.get('www-authenticate') ?? '';
  if (!/digest/i.test(wwwAuth)) {
    throw new Error(`servidor nao pediu Digest: ${wwwAuth || '(sem header)'}`);
  }
  const d = parseAuthHeader(wwwAuth);
  const realm = d.realm ?? '';
  const nonce = d.nonce ?? '';
  const qop = (d.qop ?? 'auth').split(',')[0].trim();
  const opaque = d.opaque;

  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = '00000001';
  const cnonce = randomBytes(8).toString('hex');
  const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);

  let auth =
    `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", ` +
    `qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
  if (opaque) auth += `, opaque="${opaque}"`;

  const r2 = await doFetch({ Authorization: auth });
  const text = await r2.text();
  return { status: r2.status, text, ok: r2.ok };
}

/** Igual digestRequest, mas devolve o corpo em bytes (pra snapshot/imagem). */
export async function digestRequestBuffer(
  url: string,
  user: string,
  pass: string,
  method = 'GET',
  timeoutMs = 10000,
): Promise<{ status: number; buffer: Buffer; ok: boolean }> {
  const u = new URL(url);
  const uri = u.pathname + u.search;
  const doFetch = (headers: Record<string, string>) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    return fetch(url, { method, headers, signal: ctl.signal }).finally(() => clearTimeout(t));
  };
  const r1 = await doFetch({});
  if (r1.status !== 401) {
    return { status: r1.status, buffer: Buffer.from(await r1.arrayBuffer()), ok: r1.ok };
  }
  const wwwAuth = r1.headers.get('www-authenticate') ?? '';
  const d = parseAuthHeader(wwwAuth);
  const realm = d.realm ?? '';
  const nonce = d.nonce ?? '';
  const qop = (d.qop ?? 'auth').split(',')[0].trim();
  const opaque = d.opaque;
  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = '00000001';
  const cnonce = randomBytes(8).toString('hex');
  const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  let auth =
    `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", ` +
    `qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
  if (opaque) auth += `, opaque="${opaque}"`;
  const r2 = await doFetch({ Authorization: auth });
  return { status: r2.status, buffer: Buffer.from(await r2.arrayBuffer()), ok: r2.ok };
}

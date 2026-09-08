// Conferência de Caixa: o web (central) fala com o vendas-local da loja pela URL
// pública (Tailscale Funnel, filial.caixa_url), assinando com o mesmo segredo do
// canal da NFC-e (PAGAR_MESA_SECRET, escopo 'caixa'). A loja verifica em
// centralAssinou() e serve /api/central/caixa/* (relatorio/detalhe/fechar).
import { createHmac } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export async function caixaUrlDaFilial(filialId: string): Promise<string | null> {
  const [f] = await db
    .select({ url: schema.filial.caixaUrl })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const u = f?.url?.trim();
  return u ? u.replace(/\/+$/, '') : null;
}

function assinar(filialId: string, e: number): string {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) throw new Error('PAGAR_MESA_SECRET não configurado no servidor');
  return createHmac('sha256', seg).update([filialId, 'caixa', String(e)].join('|')).digest('hex');
}

type Resp = { ok: boolean; erro?: string; [k: string]: unknown };

/** Chama /api/central/caixa{path} da loja, assinado. `path` já com querystring
 *  do endpoint (ex.: '/relatorio?data=2026-08-19'). Nunca lança — devolve
 *  {ok:false,erro} em falha de rede/config. */
export async function chamarLojaCaixa(
  filialId: string,
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<Resp> {
  const base = await caixaUrlDaFilial(filialId);
  if (!base) {
    return { ok: false, erro: 'Esta filial não tem a Conferência de Caixa configurada (URL da loja).' };
  }
  const e = Math.floor(Date.now() / 1000) + 120;
  let s: string;
  try {
    s = assinar(filialId, e);
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : 'erro ao assinar' };
  }
  const sep = path.includes('?') ? '&' : '?';
  const url = `${base}/api/central/caixa${path}${sep}e=${e}&s=${s}`;
  const method = opts.method ?? 'GET';
  const body = opts.body ? JSON.stringify(opts.body) : undefined;
  const tag = `[caixa-loja] ${filialId.slice(0, 8)} ${method} ${path.split('?')[0]}`;
  // A rota tem maxDuration 30: tudo aqui dentro cabe em 27 s.
  const t0 = Date.now();
  const restante = () => Math.max(1000, 27000 - (Date.now() - t0));
  // Uma tentativa a mais SÓ pra GET (leitura) e só quando a 1ª morreu rápido
  // em erro de rede (TLS/reset no caminho Vercel → Funnel). Timeout de 20 s
  // não repete: a 2ª tentativa estouraria o teto.
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body,
        signal: AbortSignal.timeout(Math.min(20000, restante())),
      });
      return await lerJson(r);
    } catch (err) {
      const causa = descreverFalha(err);
      console.warn(`${tag} tentativa ${tentativa}: ${causa}`);
      // O resolver da Vercel sem o nome do Funnel (ENOTFOUND) com o registro
      // vivo na fonte: em 07/09/2026 o cache negativo ficou preso por mais de
      // 25 min (o 1.1.1.1 idem) enquanto Google/Quad9/OpenDNS e os NS do
      // ts.net respondiam certo. Repetir no mesmo resolver não adianta:
      // resolve por DNS-over-HTTPS e chama direto no IP, com o nome no
      // SNI/Host. Vale pra POST também — com ENOTFOUND nada chegou na loja,
      // então repetir não duplica.
      if (codigoDe(err) === 'ENOTFOUND') {
        return await chamarPeloIp(url, method, body, restante(), tag);
      }
      const rapido = Date.now() - t0 < 6000;
      const timeout = err instanceof Error && err.name === 'TimeoutError';
      if (tentativa === 1 && method === 'GET' && rapido && !timeout) {
        await new Promise((res) => setTimeout(res, 1500));
        continue;
      }
      return { ok: false, erro: 'Loja fora do ar — ' + causa };
    }
  }
}

async function lerJson(r: Response): Promise<Resp> {
  const j = (await r.json().catch(() => null)) as Resp | null;
  return j ?? { ok: false, erro: `loja respondeu ${r.status} sem JSON` };
}

/** Plano B do DNS: resolve o nome por DoH e chama a loja direto no IP. */
async function chamarPeloIp(url: string, method: string, body: string | undefined, timeoutMs: number, tag: string): Promise<Resp> {
  const host = new URL(url).hostname;
  const dns = await resolverPorDoH(host, timeoutMs);
  if (!dns.ip) {
    console.warn(`${tag} DoH ${host}: ${dns.nxdomain ? 'NXDOMAIN' : dns.erro}`);
    return {
      ok: false,
      erro: dns.nxdomain
        ? 'Loja fora do ar — o endereço público da loja (Tailscale Funnel) não existe no DNS. O Funnel está ligado na loja?'
        : `Loja fora do ar — o DNS da nuvem não achou a loja (ENOTFOUND) e o DNS alternativo também falhou (${dns.erro})`,
    };
  }
  try {
    const resp = await pedirNoIp(url, dns.ip, method, body, Math.min(20000, timeoutMs));
    console.warn(`${tag} via IP ${dns.ip} (DoH ${dns.fonte}): HTTP ${resp.status}`);
    try {
      return JSON.parse(resp.texto) as Resp;
    } catch {
      return { ok: false, erro: `loja respondeu ${resp.status} sem JSON` };
    }
  } catch (err) {
    const causa = descreverFalha(err);
    console.warn(`${tag} via IP ${dns.ip} (DoH ${dns.fonte}): ${causa}`);
    return { ok: false, erro: 'Loja fora do ar — ' + causa };
  }
}

/** DNS-over-HTTPS: Google, depois Cloudflare. nxdomain só quando TODOS dizem
 *  que o nome não existe (= Funnel desligado na loja). */
async function resolverPorDoH(host: string, timeoutMs: number): Promise<{ ip?: string; fonte?: string; nxdomain?: boolean; erro?: string }> {
  const fontes = [
    `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
  ];
  let nx = 0;
  let erro = 'DoH sem resposta';
  for (const u of fontes) {
    try {
      const r = await fetch(u, {
        headers: { accept: 'application/dns-json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.min(5000, timeoutMs)),
      });
      const j = (await r.json()) as { Status?: number; Answer?: { type: number; data: string }[] };
      const ip = j.Answer?.find((a) => a.type === 1 && /^\d{1,3}(\.\d{1,3}){3}$/.test(a.data))?.data;
      if (j.Status === 0 && ip) return { ip, fonte: new URL(u).hostname };
      if (j.Status === 3) nx++;
      else erro = `DoH ${new URL(u).hostname} status ${j.Status}`;
    } catch (err) {
      erro = `DoH ${new URL(u).hostname}: ${descreverFalha(err)}`;
    }
  }
  return nx === fontes.length ? { nxdomain: true } : { erro };
}

/** Chama a URL direto no IP (node:https com lookup fixo), mantendo o nome da
 *  loja no SNI e no Host — o certificado do Funnel é do nome. O fetch não
 *  deixa trocar o lookup, por isso node:https aqui. */
function pedirNoIp(url: string, ip: string, method: string, body: string | undefined, timeoutMs: number): Promise<{ status: number; texto: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      {
        host: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers: body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : undefined,
        servername: u.hostname,
        // Node 20+ (autoSelectFamily) chama com { all: true } e espera lista.
        lookup: (_h, o, cb) => (o?.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)),
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        let texto = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          texto += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, texto }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function codigoDe(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const e = err as Error & { code?: string; cause?: { code?: string } };
  return e.code || e.cause?.code;
}

/** "fetch failed" sozinho não diz nada; o motivo real (ENOTFOUND, ECONNRESET,
 *  certificado…) vem em err.cause (fetch) ou em err.code (node:https). */
function descreverFalha(err: unknown): string {
  if (!(err instanceof Error)) return 'sem resposta';
  const cause = (err as Error & { cause?: { name?: string; code?: string; message?: string } }).cause;
  if (err.name === 'TimeoutError' || cause?.name === 'TimeoutError') return 'a loja não respondeu em 20 s';
  const detalhe = codigoDe(err) || cause?.message;
  return detalhe ? `${err.message} (${detalhe})` : err.message;
}

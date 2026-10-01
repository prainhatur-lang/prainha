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
  let dns = await resolverPorDoH(host, timeoutMs);
  if (!dns.ip && dns.nxdomain && host.endsWith('.ts.net')) {
    // Funnel ligado mas SEM o registro A público (caso da Tabuará,
    // servidordell.tailb22e0d.ts.net, 08/09/2026: `tailscale cert` emite, o
    // ingress atende pelo SNI, e o painel nunca publica o A). O ingress do
    // Funnel roteia pelo SNI, então bate direto nos IPs conhecidos dele.
    const ip = await primeiroIngressVivo(host, Math.min(8000, timeoutMs));
    if (ip) dns = { ip, fonte: 'ingress fixo' };
  }
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

/** IPs do ingress do Tailscale Funnel (os mesmos que o DNS devolve pros nós
 *  que têm o registro publicado, ex. win-3tt8lmsanuh). Testa a conexão TLS
 *  com o nome no SNI e devolve o primeiro que aceita. */
const INGRESS_FUNNEL = ['199.38.181.54', '209.177.145.137'];
async function primeiroIngressVivo(host: string, timeoutMs: number): Promise<string | undefined> {
  const tls = await import('node:tls');
  for (const ip of INGRESS_FUNNEL) {
    const ok = await new Promise<boolean>((res) => {
      const s = tls.connect({ host: ip, port: 443, servername: host, timeout: timeoutMs }, () => { s.destroy(); res(true); });
      s.on('timeout', () => { s.destroy(); res(false); });
      s.on('error', () => res(false));
    });
    if (ok) return ip;
  }
  return undefined;
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

// ---------------------------------------------------------------------------
// VIGIA DO TÚNEL (01/10/2026). O Funnel de uma casa caiu 4 vezes em 4 dias
// (Mar 28/09 e 29/09, Tabuará 29/09 e 01/10), sempre com a mesma cara: o
// vendas-local vivo, o Tailscale "online" na máquina e, de fora, o relay
// derrubando o TLS (ECONNRESET / curl 35). O remédio foi sempre reiniciar o
// serviço do Tailscale na loja — e gente desligando o servidor na tomada pra
// isso. Aqui é o lado da NUVEM do vigia: a loja pergunta (POST /api/loja/tunel)
// "você me alcança por fora?" e, com vários "não" seguidos, reinicia o
// Tailscale sozinha (server.mjs → vigiaTunelCiclo).
//
// A sonda só bate no endereço que está no cadastro da filial (caixa_url),
// nunca em URL vinda do pedido. Qualquer resposta HTTP conta como viva: o
// relay do Funnel só repassa TCP pelo SNI e o TLS termina na máquina da loja,
// então resposta = a máquina está no ar por aquele caminho.
// ---------------------------------------------------------------------------

/** Os 4 relays do Funnel vistos em 29/09/2026 (o DNS de cada casa devolve 2
 *  deles). Depois de um restart do Tailscale eles voltam um por um (~3 min):
 *  basta UM responder pra casa contar como alcançável. */
const RELAYS_FUNNEL_SONDA = [...INGRESS_FUNNEL, '209.177.145.97', '209.177.145.192'];

export type SondaTunel = {
  /** true = a nuvem alcança a loja; false = não alcança por nenhum caminho;
   *  null = não deu pra concluir (a loja NÃO age). */
  alcancavel: boolean | null;
  motivo?: string;
  via?: string;
  ms: number;
  /** Só quando a casa não respondeu: as outras casas da organização, pra loja
   *  separar "sou eu" de "caiu pra todo mundo" (nuvem ou Tailscale fora). */
  outras?: { total: number; alcancaveis: number };
};

type RespostaTunel = { ok: boolean; via?: string; erro?: string };

function baseDe(url: string | null | undefined): string | null {
  const u = url?.trim();
  return u ? u.replace(/\/+$/, '') : null;
}

function hostDe(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase().replace(/\.+$/, '') : null;
  } catch {
    return null;
  }
}

function falhaDaSonda(err: unknown, ms: number): string {
  const cause = err instanceof Error ? (err as Error & { cause?: { name?: string } }).cause : undefined;
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError' || cause?.name === 'TimeoutError')) {
    return `sem resposta em ${Math.round(ms / 1000)} s`;
  }
  return descreverFalha(err);
}

/** Pelo nome, do jeito que a nuvem chama a loja no dia a dia. Nunca lança. */
async function tunelPeloNome(base: string, ms: number): Promise<RespostaTunel> {
  try {
    const r = await fetch(`${base}/api/versao`, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(ms) });
    await r.body?.cancel().catch(() => undefined);
    return { ok: true, via: `nome (HTTP ${r.status})` };
  } catch (err) {
    return { ok: false, erro: falhaDaSonda(err, ms) };
  }
}

/** Direto nos relays, com o nome no SNI (e no IP que o DoH devolver, se for
 *  um que a lista não conhece). Cobre o DNS da Vercel sem o nome (07/09) e a
 *  volta relay por relay depois de um restart. Nunca lança. */
async function tunelPelosIps(base: string, ms: number, comDoH: boolean): Promise<RespostaTunel> {
  const url = `${base}/api/versao`;
  const t0 = Date.now();
  const resta = () => Math.max(1000, ms - (Date.now() - t0));
  const tentar = (ip: string) =>
    pedirNoIp(url, ip, 'GET', undefined, resta()).then((resp) => `IP ${ip} (HTTP ${resp.status})`);
  const tentativas: Promise<string>[] = RELAYS_FUNNEL_SONDA.map(tentar);
  if (comDoH) {
    tentativas.push(
      resolverPorDoH(new URL(url).hostname, 3000).then((d) => {
        if (!d.ip || RELAYS_FUNNEL_SONDA.includes(d.ip)) throw new Error('DoH sem IP novo');
        return tentar(d.ip);
      }),
    );
  }
  try {
    return { ok: true, via: await Promise.any(tentativas) };
  } catch (err) {
    const erros = err instanceof AggregateError ? err.errors : [err];
    return { ok: false, erro: falhaDaSonda(erros[0], ms) };
  }
}

/** As outras casas da mesma organização respondem? (controle) */
async function outrasCasasRespondem(organizacaoId: string, filialId: string, host: string): Promise<{ total: number; alcancaveis: number }> {
  const irmas = await db
    .select({ id: schema.filial.id, url: schema.filial.caixaUrl })
    .from(schema.filial)
    .where(eq(schema.filial.organizacaoId, organizacaoId));
  const bases = new Map<string, string>();
  for (const i of irmas) {
    const b = baseDe(i.url);
    const h = hostDe(b);
    if (i.id !== filialId && b && h && h !== host && h.endsWith('.ts.net')) bases.set(h, b);
  }
  const res = await Promise.all(
    [...bases.values()].map(async (b) => {
      const nome = await tunelPeloNome(b, 5000);
      return nome.ok ? nome : tunelPelosIps(b, 3000, false);
    }),
  );
  return { total: res.length, alcancaveis: res.filter((r) => r.ok).length };
}

/** A nuvem alcança o vendas-local desta filial pelo endereço público? `dnsDaLoja`
 *  é o nome que a máquina tem no Tailscale (ela manda): se não bate com o
 *  cadastro, a resposta é null — reiniciar o Tailscale não conserta cadastro.
 *  Cabe em ~17 s no pior caso (a rota tem maxDuration 30). Nunca lança. */
export async function sondarTunelLoja(filialId: string, dnsDaLoja?: string | null): Promise<SondaTunel> {
  const t0 = Date.now();
  const fim = (r: Omit<SondaTunel, 'ms'>): SondaTunel => ({ ...r, ms: Date.now() - t0 });
  try {
    const [f] = await db
      .select({ url: schema.filial.caixaUrl, org: schema.filial.organizacaoId })
      .from(schema.filial)
      .where(eq(schema.filial.id, filialId))
      .limit(1);
    const base = baseDe(f?.url);
    const host = hostDe(base);
    if (!f || !base || !host) {
      return fim({ alcancavel: null, motivo: 'a filial não tem endereço público (caixa_url) no cadastro' });
    }
    if (!host.endsWith('.ts.net')) {
      return fim({ alcancavel: null, motivo: 'o endereço público desta filial não é do Tailscale' });
    }
    const daLoja = String(dnsDaLoja || '').trim().toLowerCase().replace(/\.+$/, '');
    if (daLoja && daLoja !== host) {
      return fim({ alcancavel: null, motivo: `o cadastro aponta pra ${host}, mas esta máquina é ${daLoja} no Tailscale` });
    }
    const nome = await tunelPeloNome(base, 8000);
    if (nome.ok) return fim({ alcancavel: true, via: nome.via });
    // Pelo nome não foi. Em paralelo: direto nos relays e o controle (as
    // outras casas respondem?). Se algum relay atender, a casa está viva.
    const [ips, outras] = await Promise.all([
      tunelPelosIps(base, 8000, true),
      outrasCasasRespondem(f.org, filialId, host).catch(() => undefined),
    ]);
    if (ips.ok) return fim({ alcancavel: true, via: ips.via, motivo: `pelo nome não foi (${nome.erro})` });
    return fim({ alcancavel: false, motivo: `${nome.erro}; nos relays: ${ips.erro}`, outras });
  } catch (err) {
    return fim({ alcancavel: null, motivo: 'a sonda falhou: ' + (err instanceof Error ? err.message : 'erro') });
  }
}

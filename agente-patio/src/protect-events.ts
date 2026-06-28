// Leitura de placas do UniFi Protect por POLLING da API legada (com sessão).
//
// Por que polling (e nao webhook): a Ubiquiti obriga 2FA em conta de nuvem e
// removeu conta local pura — mas uma conta LOCAL criada no NVR (sem 2FA) loga
// na API e o agente re-loga sozinho. O polling e outbound (agente -> NVR), entao
// funciona de qualquer rede que alcance o NVR, sem depender de roteamento inverso.
//
// Formato real do evento de placa (descoberto ao vivo 28/06):
//   event.type === 'smartDetectZone' && event.smartDetectTypes inclui 'licensePlate'
//   placa  = event.metadata.detectedThumbnails[0].attributes.matchedName
//   conf   = event.metadata.detectedThumbnails[0].attributes.namesTopK [valor apos a placa]
//   nome   = event.metadata.detectedThumbnails[0].name  (cadastro UniFi, ex "Toro Elison")
//   camera = event.camera (id) ; tempo = event.start (ms)
import { log } from './logger.js';

export interface ProtectAuthCfg {
  host: string;
  username: string;
  password: string;
}

export interface PlacaLeitura {
  eventId: string;
  placa: string;
  confianca: number; // 0-1
  cameraId: string;
  ts: number; // ms
  nomeCadastro: string | null;
}

// Sessao em memoria (cookie + csrf). Re-login automatico em 401.
let session: { cookie: string; csrf: string } | null = null;

function pickSetCookie(res: Response): string {
  // Node >=20 tem getSetCookie(); fallback pro header combinado.
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const arr = anyHeaders.getSetCookie?.() ?? [];
  const all = arr.length ? arr : [res.headers.get('set-cookie') ?? ''];
  for (const c of all) {
    // queremos o cookie TOKEN=...
    const m = c.match(/(^|\s)(TOKEN=[^;]+)/);
    if (m) return m[2];
  }
  // se nao achou TOKEN, devolve o primeiro cookie cru (sem atributos)
  return (all[0] ?? '').split(';')[0];
}

export async function login(cfg: ProtectAuthCfg): Promise<void> {
  const res = await fetch(`https://${cfg.host}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cfg.username, password: cfg.password, rememberMe: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`login NVR HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
  const cookie = pickSetCookie(res);
  const csrf = res.headers.get('x-csrf-token') ?? res.headers.get('x-updated-csrf-token') ?? '';
  if (!cookie) throw new Error('login OK mas sem cookie de sessao');
  session = { cookie, csrf };
  log.info('NVR sessao iniciada', { host: cfg.host, user: cfg.username });
}

async function apiGet(cfg: ProtectAuthCfg, path: string): Promise<Response> {
  if (!session) await login(cfg);
  const doFetch = () =>
    fetch(`https://${cfg.host}${path}`, {
      headers: {
        Cookie: session!.cookie,
        'x-csrf-token': session!.csrf,
        Accept: 'application/json',
      },
    });
  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    log.warn('sessao NVR expirada — re-logando', { status: res.status });
    session = null;
    await login(cfg);
    res = await doFetch();
  }
  return res;
}

const PLACA_RE = /[^A-Z0-9]/g;
function normalizaPlaca(s: string): string {
  return s.toUpperCase().replace(PLACA_RE, '');
}

/** Extrai a leitura de placa de um evento, ou null se nao for placa valida. */
export function extraiPlaca(event: any): PlacaLeitura | null {
  const tipos: string[] = event?.smartDetectTypes ?? [];
  if (!tipos.includes('licensePlate')) return null;
  const th = event?.metadata?.detectedThumbnails;
  if (!Array.isArray(th) || th.length === 0) return null;
  const attr = th[0]?.attributes;
  const matched: string | undefined = attr?.matchedName;
  if (!matched) return null;
  const placa = normalizaPlaca(matched);
  if (placa.length < 6 || placa.length > 8) return null;

  // confianca: namesTopK = [nome, conf, nome, conf, ...]; pega o conf logo apos matchedName
  let confianca = 0;
  const topk: unknown[] = attr?.namesTopK ?? [];
  const idx = topk.findIndex((v) => v === matched);
  if (idx >= 0 && idx + 1 < topk.length) confianca = Number(topk[idx + 1]) || 0;
  else if (topk.length > 1) confianca = Number(topk[1]) || 0;

  return {
    eventId: String(event.id),
    placa,
    confianca,
    cameraId: String(event.camera ?? ''),
    ts: Number(event.start ?? event.timestamp ?? 0),
    nomeCadastro: th[0]?.name || null,
  };
}

/**
 * Le placas novas desde `desdeMs`. Filtra pela camera (se informada) e por
 * confianca minima. Retorna em ordem cronologica (mais antigo primeiro).
 */
export async function lerPlacas(
  cfg: ProtectAuthCfg,
  desdeMs: number,
  opts: { cameraId?: string; minConfianca?: number } = {},
): Promise<PlacaLeitura[]> {
  const now = Date.now();
  const path =
    `/proxy/protect/api/events?start=${desdeMs}&end=${now}` +
    `&types=smartDetectZone&limit=500`;
  const res = await apiGet(cfg, path);
  if (!res.ok) throw new Error(`events HTTP ${res.status}`);
  const eventos = (await res.json()) as any[];
  const min = opts.minConfianca ?? 0;
  const out: PlacaLeitura[] = [];
  for (const e of eventos) {
    const p = extraiPlaca(e);
    if (!p) continue;
    if (opts.cameraId && p.cameraId !== opts.cameraId) continue;
    if (p.confianca < min) continue;
    out.push(p);
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

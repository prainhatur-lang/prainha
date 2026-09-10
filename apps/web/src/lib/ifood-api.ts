// Cliente da API do iFood na NUVEM (o vendas-local tem o seu, igual em espírito).
//
// Diferença que importa: aqui uma mesma instância fala por VÁRIAS lojas, então
// nada de estado global — token é cache por client_id e todo o resto vem por
// parâmetro. Só app CENTRALIZADO (client_credentials): o distribuído tem
// refresh_token rotativo, que precisa de gravação durável e não cabe num
// processo serverless que pode morrer no meio.

const IFOOD_BASE = process.env.IFOOD_BASE || 'https://merchant-api.ifood.com.br';

export interface CredIfood {
  clientId: string;
  clientSecret: string;
}

/** Cache de token por client_id. Sobrevive entre invocações quentes da mesma
 *  lambda; se morrer, o pior que acontece é um /oauth/token a mais. */
const tokens = new Map<string, { token: string; expira: number }>();

export async function ifoodToken(c: CredIfood, forcar = false): Promise<string> {
  if (!c.clientId || !c.clientSecret) throw new Error('sem client_id/client_secret do iFood');
  const cache = tokens.get(c.clientId);
  // 10 min de folga: token não pode vencer no meio de um polling.
  if (!forcar && cache && Date.now() < cache.expira - 10 * 60 * 1000) return cache.token;

  const r = await fetch(IFOOD_BASE + '/authentication/v1.0/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grantType: 'client_credentials',
      clientId: c.clientId,
      clientSecret: c.clientSecret,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await r.json().catch(() => ({}))) as { accessToken?: string; expiresIn?: number; error?: { message?: string } };
  if (!r.ok || !j.accessToken) {
    // 400 costuma ser client_id cortado (tem que ter 36 chars), 401 é o par errado.
    throw new Error('token iFood ' + r.status + ': ' + (j.error?.message || JSON.stringify(j).slice(0, 200)));
  }
  tokens.set(c.clientId, {
    token: j.accessToken,
    expira: Date.now() + Number(j.expiresIn || 21600) * 1000,
  });
  return j.accessToken;
}

interface OpcoesApi {
  metodo?: string;
  corpo?: unknown;
  headers?: Record<string, string>;
  /** Devolve a Response crua — o polling precisa distinguir 204 de 200. */
  cru?: boolean;
  timeoutMs?: number;
}

/** Chamada autenticada. 401 renova o token e repete UMA vez. */
export async function ifoodApi(c: CredIfood, caminho: string, o: OpcoesApi = {}): Promise<unknown> {
  const { metodo = 'GET', corpo = null, headers = {}, cru = false, timeoutMs = 20000 } = o;
  let tentou = false;
  for (;;) {
    const tk = await ifoodToken(c, tentou);
    const r = await fetch(IFOOD_BASE + caminho, {
      method: metodo,
      headers: {
        authorization: 'Bearer ' + tk,
        ...(corpo ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status === 401 && !tentou) { tentou = true; continue; }
    if (cru) return r;
    if (r.status === 204 || r.status === 202) return {};
    const txt = await r.text();
    const j = txt ? JSON.parse(txt) : {};
    if (!r.ok) throw new Error('iFood ' + metodo + ' ' + caminho + ' → ' + r.status + ': ' + txt.slice(0, 300));
    return j;
  }
}

/** Códigos curtos que o polling devolve → nome cheio do status. */
export const IFOOD_ST: Record<string, string> = {
  PLC: 'PLACED', CFM: 'CONFIRMED', DSP: 'DISPATCHED', CON: 'CONCLUDED', CAN: 'CANCELLED',
  RTP: 'READY_TO_PICKUP', SPS: 'SEPARATION_STARTED', CAR: 'CANCELLATION_REQUESTED',
  DDCR: 'DELIVERY_DROP_CODE_REQUESTED',
};

/** Ação do caixa → caminho do POST no iFood. Mesmo mapa do vendas-local. */
export const IFOOD_ACOES: Record<string, string> = {
  confirmar: 'confirm',
  despachar: 'dispatch',
  pronto: 'readyToPickup',
  cancelar: 'requestCancellation',
  aceitar_cancel: 'acceptCancellation',
  negar_cancel: 'denyCancellation',
};

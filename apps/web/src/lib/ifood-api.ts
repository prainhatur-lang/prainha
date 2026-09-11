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
    // IfoodErro (e não Error) pra o status chegar no recado de tela: sem ele
    // um segredo errado virava "o iFood não respondeu".
    throw new IfoodErro(
      'token iFood ' + r.status + ': ' + (j.error?.message || JSON.stringify(j).slice(0, 200)),
      r.status,
      'TOKEN',
      JSON.stringify(j).slice(0, 2000),
    );
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
  /** Quantas vezes repetir em 429/5xx/queda de rede. 0 desliga. */
  tentativas?: number;
}

/** Erro de chamada ao iFood com o status HTTP à mão — a tela precisa separar
 *  409 (pausa sobreposta) de 403 (módulo não liberado) sem regex em mensagem.
 *  A mensagem segue o formato antigo ("iFood GET /x → 403: …") porque rotas
 *  ainda testam `/→ 403/` nela. */
export class IfoodErro extends Error {
  constructor(
    msg: string,
    readonly status: number,
    /** Código do corpo de erro do iFood (ex.: `InterruptionOverlap`). */
    readonly codigo: string,
    readonly corpo: string,
  ) {
    super(msg);
    this.name = 'IfoodErro';
  }
}

const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Espera antes da tentativa `n` (0, 1, 2…): 0,5s · 1s · 2s · 4s, com um
 *  pouco de sorteio pra três casas não baterem no iFood no mesmo milissegundo. */
function espera(n: number): number {
  return Math.min(8000, 500 * 2 ** n) + Math.floor(Math.random() * 250);
}

/** `Retry-After` vem em segundos (ou data HTTP). Teto de 10s: a função da
 *  Vercel tem prazo, e esperar mais que isso é pior do que devolver o erro. */
function esperaRetryAfter(r: Response, n: number): number {
  const h = r.headers.get('retry-after');
  if (h) {
    const s = Number(h);
    if (Number.isFinite(s)) return Math.min(10000, Math.max(0, s * 1000));
    const t = Date.parse(h);
    if (Number.isFinite(t)) return Math.min(10000, Math.max(0, t - Date.now()));
  }
  return espera(n);
}

function codigoDoErro(txt: string): string {
  try {
    const j = JSON.parse(txt) as { code?: string; error?: { code?: string } };
    return String(j?.error?.code ?? j?.code ?? '');
  } catch {
    return '';
  }
}

/** Chamada autenticada.
 *
 *  - 401 renova o token e repete UMA vez;
 *  - 429 espera o `Retry-After` e repete;
 *  - 5xx e queda de rede repetem com espera exponencial.
 *  4xx que não seja 401/429 NUNCA repete: é pedido errado, repetir só gasta
 *  cota e esconde o problema (critério da homologação do iFood).
 *
 *  POST só repete em 429/502/503/504/rede: são os casos em que o iFood não
 *  chegou a processar. Num 500 o POST pode ter entrado — repetir criaria a
 *  mesma pausa duas vezes. */
export async function ifoodApi(c: CredIfood, caminho: string, o: OpcoesApi = {}): Promise<unknown> {
  const { metodo = 'GET', corpo = null, headers = {}, cru = false, timeoutMs = 20000, tentativas = 3 } = o;
  const idempotente = metodo !== 'POST';
  let renovou = false;
  let forcar = false;
  for (let n = 0; ; n++) {
    const tk = await ifoodToken(c, forcar);
    forcar = false;
    let r: Response;
    try {
      r = await fetch(IFOOD_BASE + caminho, {
        method: metodo,
        headers: {
          authorization: 'Bearer ' + tk,
          ...(corpo ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (n < tentativas) { await dormir(espera(n)); continue; }
      throw new IfoodErro('iFood ' + metodo + ' ' + caminho + ' → sem resposta: ' + (e as Error).message, 0, 'SEM_RESPOSTA', '');
    }

    if (r.status === 401 && !renovou) {
      // Token revogado/rotacionado: renova e repete sem gastar tentativa.
      renovou = true;
      forcar = true;
      n--;
      continue;
    }
    const repete =
      n < tentativas &&
      (r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504 || (r.status >= 500 && idempotente));
    if (repete) {
      await r.body?.cancel().catch(() => undefined);
      await dormir(r.status === 429 ? esperaRetryAfter(r, n) : espera(n));
      continue;
    }

    if (cru) return r;
    if (r.status === 204 || r.status === 202) return {};
    const txt = await r.text();
    if (!r.ok) {
      throw new IfoodErro(
        'iFood ' + metodo + ' ' + caminho + ' → ' + r.status + ': ' + txt.slice(0, 300),
        r.status,
        codigoDoErro(txt),
        txt.slice(0, 2000),
      );
    }
    if (!txt) return {};
    try {
      return JSON.parse(txt);
    } catch {
      // 2xx com corpo que não é JSON (o PUT de horário já devolveu texto):
      // sucesso é sucesso, não vira exceção.
      return { texto: txt };
    }
  }
}

/** Erro do iFood → recado de tela + status HTTP da nossa rota.
 *
 *  A homologação cobra mensagem clara pra cada código (400/401/403/409/429/5xx)
 *  em vez de "erro 409" cru. `modulo` entra no recado do 403, que aqui quase
 *  sempre é módulo não liberado no app e não credencial errada. */
export function explicarErroIfood(
  e: unknown,
  modulo = 'Merchant',
): { mensagem: string; status: number; semModulo: boolean; codigo: string } {
  const bruto = String((e as Error)?.message ?? e ?? '');
  const status = e instanceof IfoodErro ? e.status : Number((bruto.match(/→ (\d{3})/) ?? [])[1] ?? 0);
  const codigo = e instanceof IfoodErro ? e.codigo : '';
  let doIfood = '';
  if (e instanceof IfoodErro && e.corpo) {
    try {
      const j = JSON.parse(e.corpo) as { message?: string; error?: { message?: string; details?: unknown } };
      doIfood = String(j?.error?.message ?? j?.message ?? '');
    } catch {
      doIfood = e.corpo.slice(0, 200);
    }
  }
  const sobreposto = /overlap/i.test(codigo + ' ' + doIfood);
  const r = (mensagem: string, st: number, semModulo = false) => ({ mensagem, status: st, semModulo, codigo });

  // Falha no /oauth/token é credencial (par errado, client_id cortado, app
  // desativado), não iFood fora do ar.
  if (codigo === 'TOKEN' && status > 0 && status < 500) {
    const onde = modulo === 'Financeiro' ? 'do app do Financeiro' : 'desta casa';
    return r(
      `o iFood recusou a credencial ${onde} (token ${status}${doIfood ? ': ' + doIfood : ''}) — confira client_id e client_secret em Configurações → iFood`,
      502,
    );
  }

  if (status === 409 || (status === 400 && sobreposto && /interruption/i.test(bruto))) {
    return r(
      sobreposto
        ? 'já existe uma pausa cobrindo esse horário no iFood — retome a pausa atual antes de criar outra'
        : 'o iFood recusou por conflito' + (doIfood ? ': ' + doIfood : ''),
      409,
    );
  }
  if (status === 400) {
    return r(
      sobreposto
        ? 'dois turnos se sobrepõem no mesmo dia — o iFood não aceita horário encavalado'
        : 'o iFood recusou os dados' + (doIfood ? ': ' + doIfood : ''),
      400,
    );
  }
  if (status === 401) return r('o iFood recusou a credencial desta casa — confira client_id e client_secret em Configurações → iFood', 502);
  if (status === 403) {
    return r(`este app ainda não tem o módulo ${modulo} liberado para esta loja no Portal do Desenvolvedor`, 409, true);
  }
  if (status === 404) return r('o iFood não encontrou o recurso — confira o merchant_id desta casa', 404);
  if (status === 429) return r('o iFood pediu pra ir mais devagar (limite de chamadas) — tente de novo em alguns segundos', 429);
  if (status >= 500 || status === 0) {
    return r('o iFood não respondeu (tentei de novo com espera crescente) — tente em instantes', 502);
  }
  return r(bruto.slice(0, 300), 502);
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

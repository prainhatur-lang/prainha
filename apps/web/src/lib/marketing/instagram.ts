// INSTAGRAM pela API oficial da Meta ("Instagram API com login do Instagram").
// A casa entra com a conta profissional do Instagram dela — não precisa de
// Página do Facebook. Chave de 60 dias, renovada todo dia pelo cron
// /api/cron/marketing-tokens (a Meta só renova chave com mais de 24 h).
//
// Envs (Vercel, quem grava é o dono): INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET
// — são os do produto "Instagram" do app na Meta (não o id do app Facebook).
// URI de retorno cadastrada lá: https://app.prainhabar.com/api/marketing/instagram/callback
//
// Este arquivo só fala com a Meta (não toca no banco).

const URL_AUTORIZAR = 'https://www.instagram.com/oauth/authorize';
const URL_TOKEN = 'https://api.instagram.com/oauth/access_token';
const GRAPH = 'https://graph.instagram.com';
const VERSAO = () => (process.env.INSTAGRAM_API_VERSION ?? '').trim() || 'v23.0';
const ESPERA_MS = 15000;

export const ESCOPOS_INSTAGRAM = [
  'instagram_business_basic',
  'instagram_business_manage_insights',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
  'instagram_business_content_publish',
];

const env = (n: string) => (process.env[n] ?? '').trim();

export function instagramConfigurado(): boolean {
  return Boolean(env('INSTAGRAM_APP_ID') && env('INSTAGRAM_APP_SECRET'));
}

export class ErroInstagram extends Error {
  constructor(
    mensagem: string,
    readonly religar = false,
  ) {
    super(mensagem);
    this.name = 'ErroInstagram';
  }
}

export function urlAutorizacaoInstagram(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: env('INSTAGRAM_APP_ID'),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ESCOPOS_INSTAGRAM.join(','),
    state,
    // conta errada logada no navegador: deixa trocar
    force_reauth: 'true',
  });
  return `${URL_AUTORIZAR}?${q.toString()}`;
}

async function lerJson(resp: Response): Promise<Record<string, unknown>> {
  const j = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
  if (!resp.ok || !j || j.error || j.error_type) {
    const e = (j?.error ?? {}) as { message?: string; code?: number; type?: string };
    const msg = e.message || (j?.error_message as string) || `HTTP ${resp.status}`;
    // 190 = chave inválida/vencida/revogada
    const religar = e.code === 190 || e.type === 'OAuthException' || resp.status === 401;
    throw new ErroInstagram(`Instagram: ${msg}`, religar);
  }
  return j;
}

async function chamar(caminho: string, token: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams({ ...params, access_token: token });
  let resp: Response;
  try {
    resp = await fetch(`${GRAPH}/${VERSAO()}/${caminho}?${q.toString()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    throw new ErroInstagram('O Instagram não respondeu a tempo.');
  }
  return lerJson(resp);
}

/** Troca o `code` do retorno pela chave de 60 dias. */
export async function trocarCodigoInstagram(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; expiraEm: string; contaId: string; escopos: string }> {
  let resp: Response;
  try {
    resp = await fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env('INSTAGRAM_APP_ID'),
        client_secret: env('INSTAGRAM_APP_SECRET'),
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code: code.replace(/#_$/, ''),
      }).toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    throw new ErroInstagram('O Instagram não respondeu a tempo.');
  }
  const j = await lerJson(resp);
  // a Meta já devolveu nos dois formatos: plano ou dentro de data[0]
  const d = (Array.isArray(j.data) ? (j.data[0] as Record<string, unknown>) : j) ?? {};
  const curta = String(d.access_token ?? '');
  const contaId = String(d.user_id ?? '');
  const perms = d.permissions;
  const escopos = Array.isArray(perms) ? perms.join(',') : String(perms ?? '');
  if (!curta) throw new ErroInstagram('O Instagram não devolveu a chave.');

  // chave curta (1 h) → longa (60 dias)
  let r2: Response;
  try {
    r2 = await fetch(
      `${GRAPH}/access_token?${new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: env('INSTAGRAM_APP_SECRET'),
        access_token: curta,
      }).toString()}`,
      { cache: 'no-store', signal: AbortSignal.timeout(ESPERA_MS) },
    );
  } catch {
    throw new ErroInstagram('O Instagram não respondeu a tempo.');
  }
  const longa = await lerJson(r2);
  const accessToken = String(longa.access_token ?? '');
  const seg = Number(longa.expires_in) || 60 * 24 * 3600;
  if (!accessToken) throw new ErroInstagram('O Instagram não devolveu a chave de 60 dias.');
  return { accessToken, expiraEm: new Date(Date.now() + seg * 1000).toISOString(), contaId, escopos };
}

/** Renova a chave de 60 dias (precisa ter mais de 24 h). */
export async function renovarInstagram(accessToken: string): Promise<{ accessToken: string; expiraEm: string }> {
  let resp: Response;
  try {
    resp = await fetch(
      `${GRAPH}/refresh_access_token?${new URLSearchParams({
        grant_type: 'ig_refresh_token',
        access_token: accessToken,
      }).toString()}`,
      { cache: 'no-store', signal: AbortSignal.timeout(ESPERA_MS) },
    );
  } catch {
    throw new ErroInstagram('O Instagram não respondeu a tempo.');
  }
  const j = await lerJson(resp);
  const nova = String(j.access_token ?? '');
  const seg = Number(j.expires_in) || 60 * 24 * 3600;
  if (!nova) throw new ErroInstagram('O Instagram não devolveu a chave renovada.');
  return { accessToken: nova, expiraEm: new Date(Date.now() + seg * 1000).toISOString() };
}

export interface PerfilInstagram {
  id: string;
  usuario: string;
  nome: string;
  foto: string | null;
  seguidores: number | null;
  seguindo: number | null;
  posts: number | null;
}

export async function perfilInstagram(token: string): Promise<PerfilInstagram> {
  const j = await chamar('me', token, {
    fields: 'user_id,username,name,profile_picture_url,followers_count,follows_count,media_count',
  });
  const n = (x: unknown) => (typeof x === 'number' ? x : null);
  return {
    id: String(j.user_id ?? j.id ?? ''),
    usuario: String(j.username ?? ''),
    nome: String(j.name ?? ''),
    foto: (j.profile_picture_url as string) || null,
    seguidores: n(j.followers_count),
    seguindo: n(j.follows_count),
    posts: n(j.media_count),
  };
}

export interface PostInstagram {
  id: string;
  legenda: string;
  tipo: string; // IMAGE | VIDEO | CAROUSEL_ALBUM
  produto: string; // FEED | REELS | STORY
  imagem: string | null;
  link: string;
  quando: string;
  curtidas: number | null;
  comentarios: number | null;
  alcance: number | null;
  views: number | null;
  salvos: number | null;
  compartilhamentos: number | null;
}

/** Últimos posts com os números de cada um. Número que a Meta não der fica null. */
export async function postsInstagram(token: string, limite = 12): Promise<PostInstagram[]> {
  const j = await chamar('me/media', token, {
    fields:
      'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
    limit: String(limite),
  });
  const lista = (Array.isArray(j.data) ? j.data : []) as Array<Record<string, unknown>>;
  const n = (x: unknown) => (typeof x === 'number' ? x : null);
  const posts: PostInstagram[] = lista.map((m) => ({
    id: String(m.id),
    legenda: String(m.caption ?? ''),
    tipo: String(m.media_type ?? ''),
    produto: String(m.media_product_type ?? ''),
    imagem: ((m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url) as string) || (m.thumbnail_url as string) || null,
    link: String(m.permalink ?? ''),
    quando: String(m.timestamp ?? ''),
    curtidas: n(m.like_count),
    comentarios: n(m.comments_count),
    alcance: null,
    views: null,
    salvos: null,
    compartilhamentos: null,
  }));

  // números de cada post: um pedido por post, e métrica que não existe pro
  // tipo (ou post antigo) não derruba a tela
  await Promise.all(
    posts.map(async (p) => {
      try {
        const r = await chamar(`${p.id}/insights`, token, { metric: 'reach,views,saved,shares' });
        for (const it of (Array.isArray(r.data) ? r.data : []) as Array<{
          name?: string;
          values?: Array<{ value?: number }>;
          total_value?: { value?: number };
        }>) {
          const v = it.total_value?.value ?? it.values?.[0]?.value ?? null;
          if (typeof v !== 'number') continue;
          if (it.name === 'reach') p.alcance = v;
          else if (it.name === 'views') p.views = v;
          else if (it.name === 'saved') p.salvos = v;
          else if (it.name === 'shares') p.compartilhamentos = v;
        }
      } catch {
        // sem números pra este post
      }
    }),
  );
  return posts;
}

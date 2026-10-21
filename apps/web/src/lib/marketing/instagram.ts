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

// Opcional: INSTAGRAM_ESCOPOS (separados por vírgula) quando o app da Meta
// ainda não tem todas as permissões (20/10: comentários/mensagens/publicar
// davam "Ocorreu um erro" ao adicionar). Sem a env, pede as cinco.
function escoposInstagram(): string[] {
  const e = env('INSTAGRAM_ESCOPOS');
  return e ? e.split(/[,\s]+/).filter(Boolean) : ESCOPOS_INSTAGRAM;
}

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
    scope: escoposInstagram().join(','),
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

  // chave curta (1 h) → longa (60 dias). 20/10: a Meta respondeu "Unsupported
  // request - method type: get" na troca sem versão; tenta com versão e, se as
  // duas falharem, guarda a curta (vale 1 h, a tela pede pra religar depois).
  const q = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: env('INSTAGRAM_APP_SECRET'),
    access_token: curta,
  }).toString();
  let ultimoErro = '';
  for (const url of [`${GRAPH}/access_token?${q}`, `${GRAPH}/${VERSAO()}/access_token?${q}`]) {
    try {
      const r2 = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(ESPERA_MS) });
      const corpo = (await r2.json().catch(() => null)) as Record<string, unknown> | null;
      const accessToken = String(corpo?.access_token ?? '');
      if (r2.ok && accessToken) {
        const seg = Number(corpo?.expires_in) || 60 * 24 * 3600;
        return { accessToken, expiraEm: new Date(Date.now() + seg * 1000).toISOString(), contaId, escopos };
      }
      ultimoErro = `HTTP ${r2.status} ${JSON.stringify(corpo)}`;
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e);
    }
    console.error('[marketing/instagram] troca pela chave de 60 dias falhou:', url.split('?')[0], ultimoErro);
  }
  const segCurta = Number(d.expires_in) || 3600;
  return { accessToken: curta, expiraEm: new Date(Date.now() + segCurta * 1000).toISOString(), contaId, escopos };
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

export interface MidiaPostInstagram {
  tipo: string;
  legenda: string;
  videos: string[];
  fotos: string[];
}

/** Links frescos das mídias de um post (o media_url do CDN vence em horas).
 *  Carrossel: cada item. */
export async function midiaPostInstagram(token: string, id: string): Promise<MidiaPostInstagram> {
  const j = await chamar(id, token, { fields: 'id,media_type,media_url,caption,children{media_type,media_url}' });
  const out: MidiaPostInstagram = { tipo: String(j.media_type ?? ''), legenda: String(j.caption ?? ''), videos: [], fotos: [] };
  const filhos = ((j.children as { data?: unknown } | undefined)?.data ?? []) as Array<Record<string, unknown>>;
  const itens = filhos.length ? filhos : [j];
  for (const it of itens) {
    const url = String(it.media_url ?? '');
    if (!url) continue;
    if (it.media_type === 'VIDEO') out.videos.push(url);
    else out.fotos.push(url);
  }
  return out;
}

// ── Publicar (tela /marketing → Publicar) ─────────────────────────────────
// Precisa do escopo `instagram_business_content_publish` na ligação. Fluxo da
// Meta: cria o "container" de cada mídia (ela busca o arquivo no link), espera
// ficar FINISHED e manda publicar. Foto TEM que ser JPEG; proporção do feed
// entre 4:5 e 1,91:1 (a tela corta antes de subir). Vídeo vai como Reels.

export function temPublicarInstagram(escopos: string): boolean {
  return escopos.split(/[,\s]+/).includes('instagram_business_content_publish');
}

async function postar(caminho: string, token: string, params: Record<string, string>) {
  let resp: Response;
  try {
    resp = await fetch(`${GRAPH}/${VERSAO()}/${caminho}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, access_token: token }).toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new ErroInstagram('O Instagram não respondeu a tempo.');
  }
  return lerJson(resp);
}

export interface MidiaParaPublicar {
  tipo: 'foto' | 'video';
  /** link que a Meta consegue baixar (assinado, vale algumas horas) */
  url: string;
}

/** Cria o(s) container(s) e devolve o id do container principal. */
export async function criarContainerInstagram(
  token: string,
  contaId: string,
  midias: MidiaParaPublicar[],
  legenda: string,
): Promise<string> {
  const conta = contaId || 'me';
  if (!midias.length) throw new ErroInstagram('Post sem foto nem vídeo.');
  if (midias.length === 1) {
    const m = midias[0]!;
    const j =
      m.tipo === 'video'
        ? await postar(`${conta}/media`, token, { media_type: 'REELS', video_url: m.url, caption: legenda, share_to_feed: 'true' })
        : await postar(`${conta}/media`, token, { image_url: m.url, caption: legenda });
    return String(j.id ?? '');
  }
  const filhos: string[] = [];
  for (const m of midias.slice(0, 10)) {
    const j =
      m.tipo === 'video'
        ? await postar(`${conta}/media`, token, { media_type: 'VIDEO', video_url: m.url, is_carousel_item: 'true' })
        : await postar(`${conta}/media`, token, { image_url: m.url, is_carousel_item: 'true' });
    filhos.push(String(j.id ?? ''));
  }
  // carrossel só fecha com os filhos prontos
  for (const f of filhos) {
    const s = await esperarContainerInstagram(token, f, 180000);
    if (s !== 'FINISHED') throw new ErroInstagram(`Um item do carrossel não ficou pronto no Instagram (${s}).`);
  }
  const j = await postar(`${conta}/media`, token, { media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda });
  return String(j.id ?? '');
}

/** Situação do container: FINISHED · IN_PROGRESS · ERROR · EXPIRED · PUBLISHED */
export async function situacaoContainerInstagram(token: string, id: string): Promise<{ status: string; detalhe: string }> {
  const j = await chamar(id, token, { fields: 'status_code,status' });
  return { status: String(j.status_code ?? ''), detalhe: String(j.status ?? '') };
}

/** Espera o container sair de IN_PROGRESS (até `limiteMs`). Devolve o último status. */
export async function esperarContainerInstagram(token: string, id: string, limiteMs: number): Promise<string> {
  const fim = Date.now() + limiteMs;
  let s = '';
  for (;;) {
    s = (await situacaoContainerInstagram(token, id)).status;
    if (s && s !== 'IN_PROGRESS') return s;
    if (Date.now() + 5000 > fim) return s || 'IN_PROGRESS';
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/** Publica o container pronto. Devolve {id, link}. */
export async function publicarContainerInstagram(
  token: string,
  contaId: string,
  containerId: string,
): Promise<{ id: string; link: string }> {
  const j = await postar(`${contaId || 'me'}/media_publish`, token, { creation_id: containerId });
  const id = String(j.id ?? '');
  let link = '';
  try {
    link = String((await chamar(id, token, { fields: 'permalink' })).permalink ?? '');
  } catch {
    // publicado; só sem o link
  }
  return { id, link };
}

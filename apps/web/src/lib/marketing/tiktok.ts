// TIKTOK pela API oficial (Login Kit + Display API; Content Posting depois).
// Chave de 24 h + chave de renovação de 365 dias (renova a cada uso). O cron
// /api/cron/marketing-tokens renova todo dia, e a tela renova na hora se
// precisar.
//
// O TikTok NÃO abre comentários nem mensagens pra sistema de fora — aqui é
// perfil, vídeos e números (e, com o app auditado, publicar).
//
// Envs (Vercel, quem grava é o dono): TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET.
// Opcional: TIKTOK_ESCOPOS (separados por vírgula) se o app não tiver todos.
// URI de retorno cadastrada no app: https://app.prainhabar.com/api/marketing/tiktok/callback

const URL_AUTORIZAR = 'https://www.tiktok.com/v2/auth/authorize/';
const API = 'https://open.tiktokapis.com/v2';
const ESPERA_MS = 15000;

const ESCOPOS_PADRAO = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'];

const env = (n: string) => (process.env[n] ?? '').trim();

export function escoposTiktok(): string[] {
  const e = env('TIKTOK_ESCOPOS');
  return e ? e.split(/[,\s]+/).filter(Boolean) : ESCOPOS_PADRAO;
}

export function tiktokConfigurado(): boolean {
  return Boolean(env('TIKTOK_CLIENT_KEY') && env('TIKTOK_CLIENT_SECRET'));
}

export class ErroTiktok extends Error {
  constructor(
    mensagem: string,
    readonly religar = false,
  ) {
    super(mensagem);
    this.name = 'ErroTiktok';
  }
}

export function urlAutorizacaoTiktok(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_key: env('TIKTOK_CLIENT_KEY'),
    scope: escoposTiktok().join(','),
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  });
  return `${URL_AUTORIZAR}?${q.toString()}`;
}

export interface ChavesTiktok {
  accessToken: string;
  refreshToken: string;
  expiraEm: string;
  refreshExpiraEm: string;
  contaId: string;
  escopos: string;
}

async function pedirToken(campos: Record<string, string>): Promise<ChavesTiktok> {
  let resp: Response;
  try {
    resp = await fetch(`${API}/oauth/token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: env('TIKTOK_CLIENT_KEY'),
        client_secret: env('TIKTOK_CLIENT_SECRET'),
        ...campos,
      }).toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    throw new ErroTiktok('O TikTok não respondeu a tempo.');
  }
  const j = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
  if (!resp.ok || !j || j.error || !j.access_token) {
    const cod = String(j?.error ?? `HTTP ${resp.status}`);
    throw new ErroTiktok(`TikTok recusou a chave (${cod}).`, cod === 'invalid_grant');
  }
  const agora = Date.now();
  return {
    accessToken: String(j.access_token),
    refreshToken: String(j.refresh_token ?? ''),
    expiraEm: new Date(agora + (Number(j.expires_in) || 86400) * 1000).toISOString(),
    refreshExpiraEm: new Date(agora + (Number(j.refresh_expires_in) || 365 * 86400) * 1000).toISOString(),
    contaId: String(j.open_id ?? ''),
    escopos: String(j.scope ?? ''),
  };
}

export function trocarCodigoTiktok(code: string, redirectUri: string) {
  return pedirToken({ code, grant_type: 'authorization_code', redirect_uri: redirectUri });
}

export function renovarTiktok(refreshToken: string) {
  return pedirToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

async function chamar(
  caminho: string,
  token: string,
  init: { metodo?: 'GET' | 'POST'; corpo?: unknown } = {},
): Promise<Record<string, unknown>> {
  let resp: Response;
  try {
    resp = await fetch(`${API}/${caminho}`, {
      method: init.metodo ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.corpo ? { 'content-type': 'application/json' } : {}),
      },
      body: init.corpo ? JSON.stringify(init.corpo) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    throw new ErroTiktok('O TikTok não respondeu a tempo.');
  }
  const j = (await resp.json().catch(() => null)) as {
    data?: Record<string, unknown>;
    error?: { code?: string; message?: string };
  } | null;
  const cod = j?.error?.code ?? '';
  if (!resp.ok || !j || (cod && cod !== 'ok')) {
    const religar = cod === 'access_token_invalid' || resp.status === 401;
    throw new ErroTiktok(`TikTok: ${j?.error?.message || cod || `HTTP ${resp.status}`}`, religar);
  }
  return j.data ?? {};
}

export interface PerfilTiktok {
  id: string;
  usuario: string;
  nome: string;
  foto: string | null;
  link: string | null;
  seguidores: number | null;
  seguindo: number | null;
  curtidas: number | null;
  videos: number | null;
}

export async function perfilTiktok(token: string): Promise<PerfilTiktok> {
  // campo de escopo não aceito derruba o pedido inteiro: pede só o que tem
  const esc = escoposTiktok();
  const campos = ['open_id', 'avatar_url', 'display_name'];
  if (esc.includes('user.info.profile')) campos.push('username', 'profile_deep_link');
  if (esc.includes('user.info.stats')) campos.push('follower_count', 'following_count', 'likes_count', 'video_count');
  const d = await chamar(`user/info/?fields=${campos.join(',')}`, token);
  const u = (d.user ?? {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' ? x : null);
  return {
    id: String(u.open_id ?? ''),
    usuario: String(u.username ?? ''),
    nome: String(u.display_name ?? ''),
    foto: (u.avatar_url as string) || null,
    link: (u.profile_deep_link as string) || null,
    seguidores: n(u.follower_count),
    seguindo: n(u.following_count),
    curtidas: n(u.likes_count),
    videos: n(u.video_count),
  };
}

export interface VideoTiktok {
  id: string;
  titulo: string;
  capa: string | null;
  link: string;
  quando: string;
  views: number | null;
  curtidas: number | null;
  comentarios: number | null;
  compartilhamentos: number | null;
}

export async function videosTiktok(token: string, limite = 12): Promise<VideoTiktok[]> {
  if (!escoposTiktok().includes('video.list')) return [];
  const d = await chamar(
    'video/list/?fields=id,title,video_description,cover_image_url,share_url,create_time,like_count,comment_count,share_count,view_count',
    token,
    { metodo: 'POST', corpo: { max_count: Math.min(20, limite) } },
  );
  const n = (x: unknown) => (typeof x === 'number' ? x : null);
  return ((Array.isArray(d.videos) ? d.videos : []) as Array<Record<string, unknown>>).map((v) => ({
    id: String(v.id),
    titulo: String(v.title || v.video_description || ''),
    capa: (v.cover_image_url as string) || null,
    link: String(v.share_url ?? ''),
    quando: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : '',
    views: n(v.view_count),
    curtidas: n(v.like_count),
    comentarios: n(v.comment_count),
    compartilhamentos: n(v.share_count),
  }));
}

// ── Rascunho (caixa de entrada do TikTok) ─────────────────────────────────
// Escopo `video.upload` (produto Content Posting API no app). O post NÃO sai
// publicado: cai na caixa de entrada/rascunhos da conta e quem posta é a casa,
// pelo app do TikTok (edita, põe música e publica). Publicar direto precisa
// de `video.publish` + auditoria do app.

const MB = 1024 * 1024;

/** A chave da casa tem o escopo de rascunho? (`escopos` da ligação) */
export function temRascunhoTiktok(escopos: string): boolean {
  return escopos.split(/[,\s]+/).includes('video.upload');
}

/** Manda o vídeo (arquivo inteiro na memória) pra caixa de entrada. Devolve o publish_id. */
export async function rascunhoVideoTiktok(token: string, video: Uint8Array<ArrayBuffer>): Promise<string> {
  const total = video.byteLength;
  if (total < 1) throw new ErroTiktok('O vídeo veio vazio.');
  // regra do TikTok: pedaço de 5 a 64 MB; até 64 MB vai inteiro; o último
  // pedaço leva a sobra
  const pedaco = total <= 64 * MB ? total : 10 * MB;
  const qtd = Math.max(1, Math.floor(total / pedaco));
  const d = await chamar('post/publish/inbox/video/init/', token, {
    metodo: 'POST',
    corpo: {
      source_info: { source: 'FILE_UPLOAD', video_size: total, chunk_size: pedaco, total_chunk_count: qtd },
    },
  });
  const publishId = String(d.publish_id ?? '');
  const uploadUrl = String(d.upload_url ?? '');
  if (!publishId || !uploadUrl) throw new ErroTiktok('O TikTok não devolveu o endereço de envio.');
  for (let i = 0; i < qtd; i++) {
    const ini = i * pedaco;
    const fim = i === qtd - 1 ? total : ini + pedaco;
    let r: Response;
    try {
      r = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${ini}-${fim - 1}/${total}` },
        body: video.subarray(ini, fim),
        cache: 'no-store',
        signal: AbortSignal.timeout(180000),
      });
    } catch {
      throw new ErroTiktok('O envio do vídeo pro TikTok caiu no meio. Tente de novo.');
    }
    if (!r.ok) throw new ErroTiktok(`O TikTok recusou o vídeo (pedaço ${i + 1}/${qtd}, HTTP ${r.status}).`);
  }
  return publishId;
}

/** Fotos (até 35) pro rascunho, com a legenda. O TikTok BUSCA cada foto no
 *  link — o endereço tem que ser de domínio verificado no app (app.prainhabar.com). */
export async function rascunhoFotosTiktok(token: string, fotos: string[], legenda: string): Promise<string> {
  const titulo = (legenda.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 90);
  const d = await chamar('post/publish/content/init/', token, {
    metodo: 'POST',
    corpo: {
      post_info: { title: titulo, description: legenda.slice(0, 4000) },
      source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: fotos.slice(0, 35) },
      post_mode: 'MEDIA_UPLOAD',
      media_type: 'PHOTO',
    },
  });
  const publishId = String(d.publish_id ?? '');
  if (!publishId) throw new ErroTiktok('O TikTok não devolveu o número do envio.');
  return publishId;
}

/** Situação do envio: PROCESSING_UPLOAD, PROCESSING_DOWNLOAD, SEND_TO_USER_INBOX, FAILED… */
export async function statusEnvioTiktok(token: string, publishId: string): Promise<{ status: string; motivo: string }> {
  const d = await chamar('post/publish/status/fetch/', token, { metodo: 'POST', corpo: { publish_id: publishId } });
  return { status: String(d.status ?? ''), motivo: String(d.fail_reason ?? '') };
}

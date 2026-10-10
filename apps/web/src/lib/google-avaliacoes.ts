// AVALIAÇÕES DO GOOGLE (Perfil da Empresa) → ler e responder pela API oficial.
//
// Diferente do TripAdvisor, o Google TEM caminho oficial pra casa publicar a
// resposta (Business Profile API). Em troca, a política da API proíbe guardar
// o conteúdo: nada de pré-buscar, indexar ou armazenar (só cache de até 30 dias
// e sem agregar). Por isso aqui NÃO tem cron nem tabela: a tela lê ao vivo e
// não grava avaliação nenhuma. Não "melhorar" isso gravando histórico.
//
// Este arquivo só fala com o Google (não toca no banco) — quem guarda a
// ligação de cada casa é lib/google-avaliacoes-ligacao.ts.
//
// Acesso: o projeto do Google Cloud precisa ter o acesso à API APROVADO pelo
// Google (formulário "Application for Basic API Access"); projeto não aprovado
// fica com cota zero e toda chamada volta 429.
import { createHash } from 'node:crypto';

const ESCOPO = 'https://www.googleapis.com/auth/business.manage';
const URL_AUTORIZAR = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const API_CONTAS = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const API_FICHAS = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const API_AVALIACOES = 'https://mybusiness.googleapis.com/v4';
const ESPERA_MS = 12000;

/** A resposta da casa no Google aceita até 4096 bytes. */
export const MAX_RESPOSTA_BYTES = 4096;

export type MotivoErroGoogle =
  /** a autorização caiu (revogada, 6 meses sem uso, tela de consentimento em "Teste") */
  | 'religar'
  /** o Google ainda não liberou a API pra este projeto (cota zero) */
  | 'sem-cota'
  /** falta ativar a API no Google Cloud */
  | 'api-desligada'
  /** a conta ligada não administra esta ficha */
  | 'sem-acesso'
  | 'outro';

export class ErroGoogle extends Error {
  constructor(
    mensagem: string,
    readonly motivo: MotivoErroGoogle,
    readonly status = 0,
  ) {
    super(mensagem);
    this.name = 'ErroGoogle';
  }
}

function env(nome: string): string {
  return (process.env[nome] ?? '').trim();
}

/** As duas envs do cliente OAuth estão na Vercel. Sem elas nada aparece na tela
 *  de quem não configura, e quem configura vê o que falta. */
export function googleConfigurado(): boolean {
  return Boolean(env('GOOGLE_BUSINESS_CLIENT_ID') && env('GOOGLE_BUSINESS_CLIENT_SECRET'));
}

/** Endereço público do app (o NEXT_PUBLIC_APP_URL de produção tem quebra de
 *  linha no fim — por isso o trim). Rodando local, usa o endereço do pedido. */
export function baseDoApp(origemDoPedido: string): string {
  try {
    const h = new URL(origemDoPedido).hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return origemDoPedido.replace(/\/+$/, '');
  } catch {
    // cai no endereço público
  }
  return (env('NEXT_PUBLIC_APP_URL') || 'https://app.prainhabar.com').replace(/\/+$/, '');
}

/** URI de retorno — tem que ser IGUAL à cadastrada no cliente OAuth do Google Cloud. */
export function uriDeRetorno(origemDoPedido: string): string {
  return `${baseDoApp(origemDoPedido)}/api/avaliacoes/google/callback`;
}

/** Tela de consentimento do Google. `prompt=consent` + `access_type=offline`
 *  é o que faz o Google devolver a chave de longa duração (refresh token). */
export function urlDeAutorizacao(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: env('GOOGLE_BUSINESS_CLIENT_ID'),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ESCOPO,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${URL_AUTORIZAR}?${q.toString()}`;
}

async function pedirToken(campos: Record<string, string>): Promise<Record<string, unknown>> {
  let resp: Response;
  try {
    resp = await fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env('GOOGLE_BUSINESS_CLIENT_ID'),
        client_secret: env('GOOGLE_BUSINESS_CLIENT_SECRET'),
        ...campos,
      }).toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    throw new ErroGoogle('O Google não respondeu a tempo.', 'outro');
  }
  const j = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
  if (!resp.ok || !j) {
    const cod = String(j?.error ?? '');
    if (cod === 'invalid_grant') {
      throw new ErroGoogle('A ligação com o Google caiu — precisa ligar a conta de novo.', 'religar', resp.status);
    }
    if (cod === 'invalid_client' || cod === 'unauthorized_client') {
      throw new ErroGoogle(
        'O Google recusou o cliente OAuth — confira GOOGLE_BUSINESS_CLIENT_ID e GOOGLE_BUSINESS_CLIENT_SECRET na Vercel.',
        'outro',
        resp.status,
      );
    }
    // só o código do erro: a descrição do Google pode repetir o que foi enviado
    throw new ErroGoogle(`O Google recusou a autorização (${cod || `HTTP ${resp.status}`}).`, 'outro', resp.status);
  }
  return j;
}

/** Troca o `code` do retorno pela chave de longa duração. */
export async function trocarCodigo(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string; escopoOk: boolean }> {
  const j = await pedirToken({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const accessToken = String(j.access_token ?? '');
  const refreshToken = String(j.refresh_token ?? '');
  const escopoOk = String(j.scope ?? '').split(/\s+/).includes(ESCOPO);
  if (accessToken && refreshToken) guardarAcesso(refreshToken, accessToken, Number(j.expires_in) || 3600);
  return { refreshToken, accessToken, escopoOk };
}

// Token de acesso dura ~1 h: guarda na memória da instância pra não pedir um a
// cada tela. A chave do mapa é o hash do refresh token (não o token em si).
const acessos = new Map<string, { token: string; vence: number }>();
const marca = (refreshToken: string) => createHash('sha256').update(refreshToken).digest('hex');

function guardarAcesso(refreshToken: string, token: string, expiraEm: number) {
  acessos.set(marca(refreshToken), { token, vence: Date.now() + Math.max(60, expiraEm - 120) * 1000 });
}

export async function tokenDeAcesso(refreshToken: string): Promise<string> {
  const k = marca(refreshToken);
  const a = acessos.get(k);
  if (a && a.vence > Date.now()) return a.token;
  let j: Record<string, unknown>;
  try {
    j = await pedirToken({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  } catch (e) {
    acessos.delete(k);
    throw e;
  }
  const token = String(j.access_token ?? '');
  if (!token) throw new ErroGoogle('O Google não devolveu o acesso.', 'outro');
  guardarAcesso(refreshToken, token, Number(j.expires_in) || 3600);
  return token;
}

async function chamar<T>(
  acesso: string,
  url: string,
  init?: { method?: 'GET' | 'PUT'; body?: unknown },
): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${acesso}`,
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    throw new ErroGoogle('O Google não respondeu a tempo.', 'outro');
  }
  if (resp.ok) return (await resp.json().catch(() => ({}))) as T;

  const corpo = await resp.text().catch(() => '');
  let msg = corpo.slice(0, 200);
  let estado = '';
  try {
    const j = JSON.parse(corpo) as { error?: { message?: string; status?: string } };
    msg = String(j.error?.message ?? msg).slice(0, 200);
    estado = String(j.error?.status ?? '');
  } catch {
    // corpo não era JSON
  }
  if (resp.status === 401) {
    throw new ErroGoogle('A ligação com o Google caiu — precisa ligar a conta de novo.', 'religar', 401);
  }
  if (resp.status === 429 || estado === 'RESOURCE_EXHAUSTED') {
    throw new ErroGoogle(
      'O Google ainda não liberou o acesso da API pra este projeto (cota zero) — depende da aprovação do pedido de acesso.',
      'sem-cota',
      resp.status,
    );
  }
  if (resp.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(corpo)) {
    throw new ErroGoogle(
      'Falta ativar as APIs do Perfil da Empresa no projeto do Google Cloud.',
      'api-desligada',
      403,
    );
  }
  if (resp.status === 403 || resp.status === 404) {
    throw new ErroGoogle(
      `A conta Google ligada não tem acesso a esta ficha (HTTP ${resp.status}: ${msg}).`,
      'sem-acesso',
      resp.status,
    );
  }
  throw new ErroGoogle(`Google HTTP ${resp.status}: ${msg}`, 'outro', resp.status);
}

// ---------------------------------------------------------------- fichas ---

export interface FichaGoogle {
  /** "accounts/123" */
  conta: string;
  /** "locations/456" */
  local: string;
  titulo: string;
  /** rua/bairro/cidade, só pra pessoa reconhecer a ficha na hora de escolher */
  endereco: string;
}

interface ContaApi {
  name?: string;
}
interface FichaApi {
  name?: string;
  title?: string;
  storefrontAddress?: { addressLines?: string[]; sublocality?: string; locality?: string };
}

const RE_CONTA = /^accounts\/[A-Za-z0-9_-]+$/;
const RE_LOCAL = /^locations\/[A-Za-z0-9_-]+$/;
const RE_REVIEW = /^[A-Za-z0-9_-]+$/;

/** Todas as fichas (locais) que a conta Google ligada administra. */
export async function listarFichas(acesso: string): Promise<FichaGoogle[]> {
  const contas: string[] = [];
  let pagina = '';
  for (let i = 0; i < 10; i++) {
    const r = await chamar<{ accounts?: ContaApi[]; nextPageToken?: string }>(
      acesso,
      `${API_CONTAS}/accounts?pageSize=20${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`,
    );
    for (const c of r.accounts ?? []) if (c.name && RE_CONTA.test(c.name)) contas.push(c.name);
    pagina = r.nextPageToken ?? '';
    if (!pagina) break;
  }

  const fichas: FichaGoogle[] = [];
  for (const conta of contas) {
    let pg = '';
    for (let i = 0; i < 10; i++) {
      const q = new URLSearchParams({ readMask: 'name,title,storefrontAddress', pageSize: '100' });
      if (pg) q.set('pageToken', pg);
      let r: { locations?: FichaApi[]; nextPageToken?: string };
      try {
        r = await chamar(acesso, `${API_FICHAS}/${conta}/locations?${q.toString()}`);
      } catch (e) {
        // conta sem ficha nenhuma (ou grupo vazio) não pode esconder as outras
        if (e instanceof ErroGoogle && e.motivo === 'sem-acesso') break;
        throw e;
      }
      for (const f of r.locations ?? []) {
        if (!f.name || !RE_LOCAL.test(f.name)) continue;
        const a = f.storefrontAddress;
        fichas.push({
          conta,
          local: f.name,
          titulo: (f.title ?? '').trim() || f.name,
          endereco: [...(a?.addressLines ?? []), a?.sublocality, a?.locality].filter(Boolean).join(', '),
        });
      }
      pg = r.nextPageToken ?? '';
      if (!pg) break;
    }
  }
  return fichas;
}

function palavras(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Liga cada casa à ficha do Google pelo NOME: todas as palavras do nome da
 *  casa têm que estar no título da ficha ("Prainha Mar" casa com "Prainha Mar
 *  Restaurante", não com "Prainha Bar"). Na dúvida — nenhuma, mais de uma, ou a
 *  mesma ficha servindo a duas casas — não liga: a pessoa escolhe na tela. */
export function casarFichas(
  casas: Array<{ id: string; nome: string }>,
  fichas: FichaGoogle[],
): Map<string, FichaGoogle> {
  const candidatas = new Map<string, FichaGoogle[]>();
  for (const c of casas) {
    const alvo = palavras(c.nome);
    if (alvo.length === 0) continue;
    candidatas.set(
      c.id,
      fichas.filter((f) => {
        const t = new Set(palavras(f.titulo));
        return alvo.every((p) => t.has(p));
      }),
    );
  }
  const usos = new Map<string, number>();
  for (const lista of candidatas.values()) {
    if (lista.length !== 1) continue;
    const k = `${lista[0]!.conta}/${lista[0]!.local}`;
    usos.set(k, (usos.get(k) ?? 0) + 1);
  }
  const out = new Map<string, FichaGoogle>();
  for (const [id, lista] of candidatas) {
    if (lista.length !== 1) continue;
    const f = lista[0]!;
    if (usos.get(`${f.conta}/${f.local}`) === 1) out.set(id, f);
  }
  return out;
}

// ------------------------------------------------------------ avaliações ---

export interface AvaliacaoGoogle {
  id: string;
  nota: number | null;
  texto: string;
  autor: string;
  /** ISO */
  criadoEm: string | null;
  resposta: { texto: string; em: string | null; estado: string | null } | null;
}

export interface LeituraGoogle {
  media: number | null;
  total: number;
  avaliacoes: AvaliacaoGoogle[];
  /** o Google tem mais avaliações do que as que esta leitura trouxe */
  temMais: boolean;
}

const ESTRELAS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

interface ReviewApi {
  reviewId?: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string; reviewReplyState?: string };
}

function conferirFicha(conta: string, local: string) {
  if (!RE_CONTA.test(conta) || !RE_LOCAL.test(local)) {
    throw new ErroGoogle('Ficha do Google inválida — escolha a ficha de novo.', 'outro');
  }
}

/** As avaliações mais recentes da ficha (até 50), com nota média e total. */
export async function lerAvaliacoes(acesso: string, conta: string, local: string): Promise<LeituraGoogle> {
  conferirFicha(conta, local);
  const q = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc' });
  const r = await chamar<{
    reviews?: ReviewApi[];
    averageRating?: number;
    totalReviewCount?: number;
    nextPageToken?: string;
  }>(acesso, `${API_AVALIACOES}/${conta}/${local}/reviews?${q.toString()}`);

  const avaliacoes: AvaliacaoGoogle[] = [];
  for (const v of r.reviews ?? []) {
    if (!v.reviewId || !RE_REVIEW.test(v.reviewId)) continue;
    const rr = v.reviewReply;
    avaliacoes.push({
      id: v.reviewId,
      nota: ESTRELAS[v.starRating ?? ''] ?? null,
      texto: (v.comment ?? '').trim(),
      autor: v.reviewer?.isAnonymous ? '' : (v.reviewer?.displayName ?? '').trim(),
      criadoEm: v.createTime ?? v.updateTime ?? null,
      resposta:
        rr && (rr.comment ?? '').trim()
          ? { texto: (rr.comment ?? '').trim(), em: rr.updateTime ?? null, estado: rr.reviewReplyState ?? null }
          : null,
    });
  }
  const media = typeof r.averageRating === 'number' && r.averageRating > 0 ? r.averageRating : null;
  return {
    media,
    total: Number(r.totalReviewCount) || avaliacoes.length,
    avaliacoes,
    temMais: Boolean(r.nextPageToken),
  };
}

/** Publica (ou troca) a resposta da casa numa avaliação. Só é chamada pelo
 *  clique de quem está na tela — nada responde sozinho. */
export async function publicarResposta(
  acesso: string,
  conta: string,
  local: string,
  reviewId: string,
  texto: string,
): Promise<{ estado: string | null }> {
  conferirFicha(conta, local);
  if (!RE_REVIEW.test(reviewId)) throw new ErroGoogle('Avaliação inválida.', 'outro');
  const comment = texto.trim();
  if (!comment) throw new ErroGoogle('Resposta vazia.', 'outro');
  if (Buffer.byteLength(comment, 'utf8') > MAX_RESPOSTA_BYTES) {
    throw new ErroGoogle('Resposta grande demais pro Google (máximo de 4096 bytes).', 'outro');
  }
  const r = await chamar<{ reviewReplyState?: string }>(
    acesso,
    `${API_AVALIACOES}/${conta}/${local}/reviews/${reviewId}/reply`,
    { method: 'PUT', body: { comment } },
  );
  return { estado: r.reviewReplyState ?? null };
}

// Publica um post da tela /marketing → Publicar nas redes escolhidas.
// Usado pelo botão "Publicar agora" e pelo cron /api/cron/marketing-publicar
// (agendados e Reels que a Meta ainda estava processando).
//
// Cada rede guarda o próprio resultado em `marketing_post.resultado`:
//   ok         → saiu (Instagram: publicado; TikTok: caiu na caixa de entrada)
//   aguardando → Instagram ainda processando o vídeo; o cron termina depois
//   erro       → motivo em `erro` (Tentar de novo refaz só a rede que falhou)

import { db, schema } from '@concilia/db';
import { and, eq, inArray, lt, lte, or } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { chaveValida } from './chave';
import {
  ErroInstagram,
  criarContainerInstagram,
  esperarContainerInstagram,
  publicarContainerInstagram,
  situacaoContainerInstagram,
  temPublicarInstagram,
} from './instagram';
import { ErroTiktok, esperarEnvioTiktok, rascunhoFotosTiktok, rascunhoVideoTiktok, statusEnvioTiktok, temRascunhoTiktok } from './tiktok';
import { BUCKET_MARKETING, linkArquivo } from './midia-link';

const T = schema.marketingPost;
export type PostMarketing = typeof T.$inferSelect;

export interface ResultadoRede {
  estado: 'ok' | 'erro' | 'aguardando';
  id?: string;
  link?: string;
  container?: string;
  erro?: string;
  obs?: string;
  quando?: string;
}

/** Quanto tempo um PUBLICANDO fica "preso" a quem pegou antes de outro poder pegar. */
const TRAVA_MS = 4 * 60 * 1000;

const msgErro = (e: unknown) =>
  e instanceof ErroInstagram || e instanceof ErroTiktok || e instanceof Error ? e.message : String(e);

async function linksAssinados(paths: string[]): Promise<string[]> {
  const admin = await createAdminClient();
  const out: string[] = [];
  for (const p of paths) {
    const { data, error } = await admin.storage.from(BUCKET_MARKETING).createSignedUrl(p, 6 * 3600);
    if (error || !data?.signedUrl) throw new Error(`Arquivo sumiu do depósito (${p.split('/').pop()}).`);
    out.push(data.signedUrl);
  }
  return out;
}

async function baixar(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_MARKETING).download(path);
  if (error || !data) throw new Error('Não consegui ler o vídeo no depósito.');
  return new Uint8Array(await data.arrayBuffer());
}

async function noInstagram(p: PostMarketing, ant: ResultadoRede | undefined, ate: number): Promise<ResultadoRede> {
  const ig = await chaveValida(p.filialId, 'instagram');
  if (!ig) return { estado: 'erro', erro: 'O Instagram desta casa não está conectado.' };
  if (!temPublicarInstagram(ig.escopos)) {
    return {
      estado: 'erro',
      erro:
        'A ligação do Instagram ainda não tem a permissão de publicar (instagram_business_content_publish). ' +
        'Falta liberar no app da Meta, pôr em INSTAGRAM_ESCOPOS na Vercel e clicar em Conectar Instagram de novo.',
    };
  }
  let container = ant?.estado === 'aguardando' ? ant.container : undefined;
  if (container) {
    // container de outra rodada: confere se ainda vale
    const s = (await situacaoContainerInstagram(ig.accessToken, container)).status;
    if (s === 'EXPIRED' || s === 'ERROR') container = undefined;
  }
  if (!container) {
    const urls = await linksAssinados(p.midias.map((m) => m.path));
    container = await criarContainerInstagram(
      ig.accessToken,
      ig.contaId,
      p.midias.map((m, i) => ({ tipo: m.tipo, url: urls[i]! })),
      p.legenda,
    );
    if (!container) return { estado: 'erro', erro: 'O Instagram não devolveu o número do post.' };
  }
  const s = await esperarContainerInstagram(ig.accessToken, container, Math.max(5000, ate - Date.now()));
  if (s === 'FINISHED') {
    const r = await publicarContainerInstagram(ig.accessToken, ig.contaId, container);
    return { estado: 'ok', id: r.id, link: r.link, quando: new Date().toISOString() };
  }
  if (s === 'IN_PROGRESS') {
    return { estado: 'aguardando', container, obs: 'O Instagram ainda está processando o vídeo; sai sozinho em alguns minutos.' };
  }
  const det = (await situacaoContainerInstagram(ig.accessToken, container).catch(() => ({ detalhe: '' }))).detalhe;
  return { estado: 'erro', erro: `O Instagram recusou o arquivo (${s}${det ? `: ${det}` : ''}).` };
}

async function noTiktok(p: PostMarketing, base: string): Promise<ResultadoRede> {
  const tt = await chaveValida(p.filialId, 'tiktok');
  if (!tt) return { estado: 'erro', erro: 'O TikTok desta casa não está conectado.' };
  if (!temRascunhoTiktok(tt.escopos)) {
    return {
      estado: 'erro',
      erro: 'A ligação do TikTok ainda não tem a permissão de rascunho (video.upload). Clique em Conectar TikTok de novo.',
    };
  }
  const video = p.midias.find((m) => m.tipo === 'video');
  let publishId: string;
  let obs: string;
  if (video) {
    publishId = await rascunhoVideoTiktok(tt.accessToken, await baixar(video.path));
    obs = 'Vídeo na caixa de entrada do TikTok. A legenda não vai junto: copie daqui e cole no app ao publicar.';
  } else {
    const fotos = p.midias.filter((m) => m.tipo === 'foto').map((m) => linkArquivo(base, m.path));
    // post da fila de aprovação pode ter legenda própria (mais curta) pro TikTok
    publishId = await rascunhoFotosTiktok(tt.accessToken, fotos, p.legendaTiktok?.trim() || p.legenda);
    obs = 'Fotos com a legenda na caixa de entrada do TikTok. Abra o app, escolha a música e publique.';
  }
  try {
    const { status, motivo } = video
      ? await statusEnvioTiktok(tt.accessToken, publishId)
      : await esperarEnvioTiktok(tt.accessToken, publishId);
    if (status === 'FAILED') return { estado: 'erro', erro: `O TikTok recusou o envio (${motivo || 'sem motivo'}).` };
  } catch {
    // sem situação: o envio já foi aceito
  }
  return { estado: 'ok', id: publishId, obs, quando: new Date().toISOString() };
}

/** Pega o post pra publicar (trava contra o cron e o botão ao mesmo tempo) e
 *  publica em cada rede que ainda não saiu. `refazer` = botão Tentar de novo. */
export async function processarPost(
  id: string,
  base: string,
  opcoes: { refazer?: boolean; ateMs?: number } = {},
): Promise<PostMarketing | null> {
  const podem = opcoes.refazer ? ['RASCUNHO', 'AGENDADO', 'ERRO', 'PARCIAL'] : ['RASCUNHO', 'AGENDADO'];
  const [p] = await db
    .update(T)
    .set({ status: 'PUBLICANDO', atualizadoEm: new Date() })
    .where(
      and(
        eq(T.id, id),
        or(inArray(T.status, podem), and(eq(T.status, 'PUBLICANDO'), lt(T.atualizadoEm, new Date(Date.now() - TRAVA_MS)))),
      ),
    )
    .returning();
  if (!p) return null;

  const ate = opcoes.ateMs ?? Date.now() + 230000;
  const resultado = { ...((p.resultado ?? {}) as Record<string, ResultadoRede>) };
  // TikTok primeiro (rápido); o Instagram usa o resto do tempo esperando o vídeo
  const ordem = [...p.redes].sort((a, b) => (a === 'tiktok' ? -1 : b === 'tiktok' ? 1 : 0));
  for (const rede of ordem) {
    const ant = resultado[rede];
    if (ant?.estado === 'ok') continue;
    try {
      resultado[rede] = rede === 'instagram' ? await noInstagram(p, ant, ate) : await noTiktok(p, base);
    } catch (e) {
      console.error(`[marketing/publicar] ${rede} ${p.id}:`, msgErro(e));
      resultado[rede] = { estado: 'erro', erro: msgErro(e) };
    }
    // grava a cada rede: se a função cair, o que já saiu não sai de novo
    await db.update(T).set({ resultado, atualizadoEm: new Date() }).where(eq(T.id, p.id));
  }

  const estados = p.redes.map((r) => resultado[r]?.estado);
  const status = estados.every((e) => e === 'ok')
    ? 'PUBLICADO'
    : estados.some((e) => e === 'aguardando')
      ? 'PUBLICANDO'
      : estados.some((e) => e === 'ok')
        ? 'PARCIAL'
        : 'ERRO';
  const erro =
    p.redes
      .filter((r) => resultado[r]?.estado === 'erro')
      .map((r) => `${r === 'instagram' ? 'Instagram' : 'TikTok'}: ${resultado[r]?.erro ?? ''}`)
      .join(' · ') || null;
  const [fim] = await db
    .update(T)
    .set({
      status,
      resultado,
      erro,
      atualizadoEm: new Date(),
      ...(status === 'PUBLICADO' ? { publicadoEm: new Date() } : {}),
    })
    .where(eq(T.id, p.id))
    .returning();
  return fim ?? null;
}

/** Posts que o cron tem que mexer: agendados vencidos e Instagram aguardando. */
export async function postsPendentes(): Promise<string[]> {
  const linhas = await db
    .select({ id: T.id })
    .from(T)
    .where(
      or(
        and(eq(T.status, 'AGENDADO'), lte(T.agendadoPara, new Date())),
        and(eq(T.status, 'PUBLICANDO'), lt(T.atualizadoEm, new Date(Date.now() - TRAVA_MS))),
      ),
    )
    .limit(10);
  return linhas.map((l) => l.id);
}

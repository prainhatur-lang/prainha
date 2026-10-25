// Instagram → TikTok automático (pedido do dono 25/10/2026: "conectar o
// Instagram ao TikTok pra postar de uma vez nos 2").
//
// Com o interruptor ligado na casa (/marketing), todo post NOVO do Instagram —
// feito pelo sistema ou direto no app do Instagram — vai sozinho pra caixa de
// entrada do TikTok da mesma casa (escopo video.upload; o TikTok não deixa app
// sem auditoria publicar direto: a casa toca em Publicar no app do TikTok).
// Post que já foi pro TikTok pelo bloco 📤 Publicar é pulado (não duplica).
// Roda pelo cron /api/cron/marketing-espelho (10 em 10 min).

import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { chaveValida } from './chave';
import { ErroInstagram, midiaPostInstagram, postsRecentesInstagram } from './instagram';
import { ErroTiktok, esperarEnvioTiktok, rascunhoFotosTiktok, rascunhoVideoTiktok, statusEnvioTiktok, temRascunhoTiktok } from './tiktok';
import { cdnDaMeta, linkMidia } from './midia-link';

const E = schema.marketingEspelho;
const V = schema.marketingEspelhoEnvio;
const LIMITE_VIDEO = 500 * 1024 * 1024;
const MAX_TENTATIVAS = 3;

/** Erro de um post. `definitivo` = não adianta tentar de novo (ex.: Reels com música protegida). */
export class ErroEspelho extends Error {
  constructor(
    msg: string,
    readonly definitivo = false,
  ) {
    super(msg);
  }
}

/** Manda um post do Instagram pra caixa de entrada do TikTok da casa. */
export async function postIgProTiktok(
  filialId: string,
  postId: string,
  base: string,
): Promise<{ tipo: 'video' | 'fotos'; publishId: string }> {
  const tt = await chaveValida(filialId, 'tiktok');
  if (!tt) throw new ErroEspelho('O TikTok desta casa não está conectado.');
  if (!temRascunhoTiktok(tt.escopos)) throw new ErroEspelho('A ligação do TikTok não tem a permissão video.upload. Conecte o TikTok de novo.');
  const ig = await chaveValida(filialId, 'instagram');
  if (!ig) throw new ErroEspelho('O Instagram desta casa não está conectado.');

  const m = await midiaPostInstagram(ig.accessToken, postId);
  let publishId: string;
  let tipo: 'video' | 'fotos';
  if (m.fotos.length && (m.tipo === 'CAROUSEL_ALBUM' || m.tipo === 'IMAGE' || !m.videos.length)) {
    const fotos = m.fotos.filter(cdnDaMeta).map((u) => linkMidia(base, u));
    if (!fotos.length) throw new ErroEspelho('Não achei as fotos deste post no Instagram.');
    publishId = await rascunhoFotosTiktok(tt.accessToken, fotos.slice(0, 35), m.legenda);
    tipo = 'fotos';
  } else if (m.videos.length) {
    let r: Response;
    try {
      r = await fetch(m.videos[0]!, { cache: 'no-store', signal: AbortSignal.timeout(120000) });
    } catch {
      throw new ErroEspelho('O Instagram não entregou o vídeo a tempo.');
    }
    if (!r.ok) throw new ErroEspelho(`O Instagram recusou o download do vídeo (HTTP ${r.status}).`);
    if (Number(r.headers.get('content-length') ?? 0) > LIMITE_VIDEO) throw new ErroEspelho('Vídeo grande demais (mais de 500 MB).', true);
    publishId = await rascunhoVideoTiktok(tt.accessToken, new Uint8Array(await r.arrayBuffer()));
    tipo = 'video';
  } else if (m.tipo === 'VIDEO') {
    throw new ErroEspelho(
      'O Instagram não libera o arquivo deste Reels (costuma ser música com direito autoral). Use o 📲 Baixar pro TikTok.',
      true,
    );
  } else {
    throw new ErroEspelho('Este post não tem foto nem vídeo que dê pra mandar.', true);
  }

  let status = '';
  let motivo = '';
  try {
    ({ status, motivo } =
      tipo === 'fotos' ? await esperarEnvioTiktok(tt.accessToken, publishId) : await statusEnvioTiktok(tt.accessToken, publishId));
  } catch {
    // sem situação: o envio já foi aceito
  }
  if (status === 'FAILED') throw new ErroEspelho(`O TikTok recusou o envio (${motivo || 'sem motivo'}).`);
  return { tipo, publishId };
}

/** Post do Instagram que saiu pelo bloco Publicar já com o TikTok junto. */
async function jaFoiPeloPublicar(filialId: string, igPostId: string): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT 1 FROM marketing_post
     WHERE filial_id = ${filialId}
       AND resultado -> 'instagram' ->> 'id' = ${igPostId}
       AND redes ? 'tiktok'
     LIMIT 1`);
  return (r as unknown as unknown[]).length > 0;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Uma casa: olha os últimos posts do Instagram e manda pro TikTok os novos. */
export async function espelharCasa(
  filialId: string,
  desde: Date,
  base: string,
  ateMs: number,
): Promise<Array<{ post: string; status: string; erro?: string }>> {
  const ig = await chaveValida(filialId, 'instagram');
  if (!ig) return [];
  const posts = (await postsRecentesInstagram(ig.accessToken, 8))
    .filter((p) => p.produto !== 'STORY' && (Date.parse(p.quando) || 0) >= desde.getTime())
    .sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando));
  const saida: Array<{ post: string; status: string; erro?: string }> = [];
  for (const p of posts) {
    if (Date.now() > ateMs - 60_000) break;
    const [ant] = await db.select().from(V).where(and(eq(V.filialId, filialId), eq(V.igPostId, p.id))).limit(1);
    if (ant && ant.status !== 'ERRO') continue;
    if (ant && ant.tentativas >= MAX_TENTATIVAS) continue;
    const base0 = { filialId, igPostId: p.id, igLink: p.link || null, igQuando: p.quando ? new Date(p.quando) : null };
    if (!ant && (await jaFoiPeloPublicar(filialId, p.id))) {
      await db.insert(V).values({ ...base0, status: 'PULADO', erro: 'Já foi pro TikTok pelo 📤 Publicar.' }).onConflictDoNothing();
      saida.push({ post: p.id, status: 'PULADO' });
      continue;
    }
    // reserva o post antes de mandar (dois crons ao mesmo tempo não duplicam)
    if (!ant) {
      const ins = await db
        .insert(V)
        .values({ ...base0, status: 'ENVIANDO', tentativas: 1 })
        .onConflictDoNothing()
        .returning({ id: V.id });
      if (!ins.length) continue;
    } else {
      const up = await db
        .update(V)
        .set({ status: 'ENVIANDO', tentativas: ant.tentativas + 1, atualizadoEm: new Date() })
        .where(and(eq(V.id, ant.id), eq(V.status, 'ERRO')))
        .returning({ id: V.id });
      if (!up.length) continue;
    }
    const tentativas = (ant?.tentativas ?? 0) + 1;
    try {
      const r = await postIgProTiktok(filialId, p.id, base);
      await db
        .update(V)
        .set({ status: 'OK', publishId: r.publishId, tipo: r.tipo, erro: null, atualizadoEm: new Date() })
        .where(and(eq(V.filialId, filialId), eq(V.igPostId, p.id)));
      saida.push({ post: p.id, status: 'OK' });
    } catch (e) {
      const definitivo = e instanceof ErroEspelho && e.definitivo;
      const status = definitivo || tentativas >= MAX_TENTATIVAS ? 'DESISTIU' : 'ERRO';
      if (!(e instanceof ErroEspelho || e instanceof ErroTiktok || e instanceof ErroInstagram)) {
        console.error('[marketing/espelho]', filialId, p.id, e);
      }
      await db
        .update(V)
        .set({ status, erro: msg(e), atualizadoEm: new Date() })
        .where(and(eq(V.filialId, filialId), eq(V.igPostId, p.id)));
      saida.push({ post: p.id, status, erro: msg(e) });
    }
  }
  return saida;
}

/** Todas as casas com o interruptor ligado. */
export async function rodarEspelho(base: string, ateMs: number) {
  // ENVIANDO preso há mais de 10 min (função caiu no meio) volta pra ERRO
  await db.execute(sql`
    UPDATE marketing_espelho_envio SET status = 'ERRO', erro = 'Envio interrompido; tentando de novo.'
     WHERE status = 'ENVIANDO' AND atualizado_em < now() - interval '10 minutes'`);
  const casas = await db.select().from(E).where(eq(E.ativo, true));
  const out: Record<string, Array<{ post: string; status: string; erro?: string }>> = {};
  for (const c of casas) {
    if (Date.now() > ateMs - 60_000) break;
    try {
      const r = await espelharCasa(c.filialId, c.desde, base, ateMs);
      if (r.length) out[c.filialId] = r;
    } catch (e) {
      console.error('[marketing/espelho] casa', c.filialId, msg(e));
      out[c.filialId] = [{ post: '-', status: 'falhou', erro: msg(e) }];
    }
  }
  return out;
}

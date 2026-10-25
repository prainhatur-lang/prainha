// /api/marketing/fila/instagram — pegar foto/vídeo que uma casa já postou no
// Instagram e pôr num post da fila de aprovação (pedido do dono 25/10/2026:
// "pega fotos no Instagram do Prainha Bar").
//   GET  ?filialId=<casa do post>&deCasa=<casa do Instagram>&depois=<cursor>  → galeria
//   POST { filialId, id (post), deCasa, igId, arquivos?: number[] }           → copia pro post
// A cópia busca o link fresco pelo id (o CDN da Meta vence em horas), baixa e
// guarda no depósito marketing-midia da casa do post — o motor de publicar só
// trabalha com arquivo nosso.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { acessoMarketingApi } from '@/lib/marketing/acesso';
import { chaveValida } from '@/lib/marketing/chave';
import { arquivosPostInstagram, ErroInstagram, galeriaInstagram } from '@/lib/marketing/instagram';
import { BUCKET_MARKETING, cdnDaMeta } from '@/lib/marketing/midia-link';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const T = schema.marketingPost;
const MAX_VIDEO = 50 * 1024 * 1024;
const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

/** Acesso às duas casas (a do post e a do Instagram) e a chave do Instagram da segunda. */
async function abrir(filialId: string | null | undefined, deCasa: string | null | undefined) {
  const a = await acessoMarketingApi(filialId);
  if (a.error) return { error: a.error };
  const b = deCasa && deCasa !== a.casa.id ? await acessoMarketingApi(deCasa) : a;
  if (b.error) return { error: b.error };
  const ig = await chaveValida(b.casa.id, 'instagram').catch(() => null);
  if (!ig) return { error: erro(`O Instagram da ${b.casa.nome} não está ligado no /marketing.`) };
  return { a, origem: b.casa, token: ig.accessToken };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const r = await abrir(sp.get('filialId'), sp.get('deCasa'));
  if (r.error) return r.error;
  try {
    const g = await galeriaInstagram(r.token, sp.get('depois'));
    return NextResponse.json({ casa: r.origem.nome, ...g });
  } catch (e) {
    return erro(e instanceof ErroInstagram ? e.message : 'Não consegui ler o Instagram agora.', 502);
  }
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as {
    filialId?: string;
    id?: string;
    deCasa?: string;
    igId?: string;
    arquivos?: unknown;
  };
  const r = await abrir(b.filialId, b.deCasa);
  if (r.error) return r.error;
  const casaId = r.a.casa.id;
  if (!b.id || !/^[0-9a-f-]{36}$/.test(b.id)) return erro('post inválido');
  if (!b.igId || !/^\d{5,30}$/.test(b.igId)) return erro('item do Instagram inválido');
  const [p] = await db
    .select()
    .from(T)
    .where(and(eq(T.id, b.id), eq(T.filialId, casaId)))
    .limit(1);
  if (!p) return erro('post não encontrado', 404);
  if (p.status !== 'AGUARDANDO') return erro('Esse post já saiu da fila; recarregue a página.', 409);

  let lista: Array<{ tipo: 'foto' | 'video'; url: string }>;
  try {
    lista = await arquivosPostInstagram(r.token, b.igId);
  } catch (e) {
    return erro(e instanceof ErroInstagram ? e.message : 'Não consegui ler esse post do Instagram.', 502);
  }
  const quais = Array.isArray(b.arquivos) ? b.arquivos.map(Number).filter((n) => Number.isInteger(n)) : [];
  if (quais.length) lista = lista.filter((_, i) => quais.includes(i));
  if (!lista.length) return erro('Esse post do Instagram não tem arquivo pra copiar.');

  // mesmas regras do card: vídeo vai sozinho (troca o que tinha); fotos somam até 10
  const video = lista.find((x) => x.tipo === 'video');
  const escolhidos = video ? [video] : lista;
  const ficam = video ? [] : p.midias.filter((m) => m.tipo === 'foto');
  if (ficam.length + escolhidos.length > 10) return erro('No máximo 10 fotos por post. Tire alguma antes.');

  const admin = await createAdminClient();
  const novos: Array<{ path: string; tipo: 'foto' | 'video'; nome: string }> = [];
  for (const [i, x] of escolhidos.entries()) {
    if (!cdnDaMeta(x.url)) return erro('Link do Instagram fora do CDN da Meta.');
    const resp = await fetch(x.url, { cache: 'no-store' }).catch(() => null);
    if (!resp?.ok) return erro('Não consegui baixar o arquivo do Instagram. Tente de novo.', 502);
    const tipoArq = (resp.headers.get('content-type') ?? '').split(';')[0].trim();
    if (x.tipo === 'foto' && tipoArq !== 'image/jpeg') {
      return erro(`Foto do Instagram veio como ${tipoArq || 'desconhecido'}; o Instagram só publica JPEG.`);
    }
    const corpo = Buffer.from(await resp.arrayBuffer());
    if (x.tipo === 'video' && corpo.length > MAX_VIDEO) return erro('Vídeo maior que 50 MB.');
    const ext = x.tipo === 'video' ? 'mp4' : 'jpg';
    const nome = `instagram-${r.origem.nome.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${b.igId}-${i + 1}.${ext}`;
    const path = `${casaId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${nome}`;
    const up = await admin.storage
      .from(BUCKET_MARKETING)
      .upload(path, corpo, { contentType: x.tipo === 'video' ? 'video/mp4' : 'image/jpeg', upsert: false });
    if (up.error) return erro(`Depósito: ${up.error.message}`, 502);
    novos.push({ path, tipo: x.tipo, nome });
  }

  const midias = [...ficam, ...novos];
  const [fim] = await db
    .update(T)
    .set({ midias, atualizadoEm: new Date() })
    .where(and(eq(T.id, p.id), eq(T.status, 'AGUARDANDO')))
    .returning();
  if (!fim) return erro('Esse post já saiu da fila; recarregue a página.', 409);

  // miniaturas pro card
  const fotos = midias.filter((m) => m.tipo === 'foto').map((m) => m.path);
  const links = new Map<string, string>();
  if (fotos.length) {
    const { data } = await admin.storage.from(BUCKET_MARKETING).createSignedUrls(fotos, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) links.set(d.path, d.signedUrl);
  }
  // vídeo substituído sai do depósito
  const saiu = p.midias.filter((m) => !midias.some((n) => n.path === m.path)).map((m) => m.path);
  if (saiu.length) await admin.storage.from(BUCKET_MARKETING).remove(saiu).catch(() => null);

  return NextResponse.json({
    midias: midias.map((m) => ({ ...m, url: links.get(m.path) ?? null })),
  });
}

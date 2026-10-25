// /api/marketing/posts — tela /marketing → Publicar.
//   POST  { filialId, midias, legenda, redes, agendadoPara? }  cria; sem agendadoPara publica na hora
//   PATCH { filialId, id, acao: 'refazer' | 'excluir' | 'publicar' }
// Publicar = lib/marketing/publicar.ts (o mesmo que o cron usa pros agendados).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { acessoMarketingApi } from '@/lib/marketing/acesso';
import { baseDoApp } from '@/lib/marketing/ligacao';
import { processarPost } from '@/lib/marketing/publicar';
import { BUCKET_MARKETING } from '@/lib/marketing/midia-link';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const T = schema.marketingPost;
const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
/** Tempo do pedido (maxDuration 300) menos folga pra gravar e responder. */
const ate = () => Date.now() + 240_000;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as {
    filialId?: string;
    midias?: unknown;
    legenda?: string;
    redes?: unknown;
    agendadoPara?: string | null;
  };
  const a = await acessoMarketingApi(b.filialId);
  if (a.error) return a.error;

  const midias = (Array.isArray(b.midias) ? b.midias : [])
    .map((m) => m as { path?: unknown; tipo?: unknown; nome?: unknown })
    .filter((m) => typeof m.path === 'string' && m.path.startsWith(`${a.casa.id}/`) && !m.path.includes('..'))
    .map((m) => ({
      path: String(m.path),
      tipo: (m.tipo === 'video' ? 'video' : 'foto') as 'foto' | 'video',
      nome: typeof m.nome === 'string' ? m.nome.slice(0, 120) : undefined,
    }));
  const videos = midias.filter((m) => m.tipo === 'video').length;
  if (!midias.length) return erro('Ponha pelo menos uma foto ou um vídeo.');
  if (videos && midias.length > 1) return erro('Vídeo vai sozinho: um vídeo por post (ou até 10 fotos).');
  if (midias.length > 10) return erro('No máximo 10 fotos por post.');
  const redes = [...new Set((Array.isArray(b.redes) ? b.redes : []).map(String))].filter(
    (r) => r === 'instagram' || r === 'tiktok',
  );
  if (!redes.length) return erro('Escolha Instagram, TikTok ou os dois.');
  const legenda = String(b.legenda ?? '').trim();
  if (legenda.length > 2200) return erro('Legenda passou de 2.200 caracteres (limite do Instagram).');

  let agendadoPara: Date | null = null;
  if (b.agendadoPara) {
    agendadoPara = new Date(b.agendadoPara);
    if (Number.isNaN(agendadoPara.getTime())) return erro('Data do agendamento inválida.');
    if (agendadoPara.getTime() < Date.now() - 60_000) return erro('Esse horário já passou.');
  }

  const [p] = await db
    .insert(T)
    .values({
      filialId: a.casa.id,
      midias,
      legenda,
      redes,
      agendadoPara,
      status: agendadoPara ? 'AGENDADO' : 'RASCUNHO',
      criadoPor: a.user.id,
      criadoPorEmail: a.user.email ?? null,
    })
    .returning();
  if (!p) return erro('Não consegui salvar o post.', 500);
  if (agendadoPara) return NextResponse.json({ post: p });
  const fim = await processarPost(p.id, baseDoApp(req.url), { ateMs: ate() });
  return NextResponse.json({ post: fim ?? p });
}

export async function PATCH(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { filialId?: string; id?: string; acao?: string };
  const a = await acessoMarketingApi(b.filialId);
  if (a.error) return a.error;
  if (!b.id || !/^[0-9a-f-]{36}$/.test(b.id)) return erro('post inválido');
  const [p] = await db
    .select()
    .from(T)
    .where(and(eq(T.id, b.id), eq(T.filialId, a.casa.id)))
    .limit(1);
  if (!p) return erro('post não encontrado', 404);

  if (b.acao === 'excluir') {
    if (!['RASCUNHO', 'AGENDADO', 'ERRO', 'RECUSADO'].includes(p.status)) {
      return erro('Post que já saiu (ou está saindo) não se apaga daqui — apague na rede.', 409);
    }
    const [apagado] = await db
      .delete(T)
      .where(and(eq(T.id, p.id), inArray(T.status, ['RASCUNHO', 'AGENDADO', 'ERRO', 'RECUSADO'])))
      .returning({ id: T.id });
    if (!apagado) return erro('O post mudou de situação; recarregue a página.', 409);
    try {
      const admin = await createAdminClient();
      await admin.storage.from(BUCKET_MARKETING).remove(p.midias.map((m) => m.path));
    } catch {
      // arquivo fica no depósito; não atrapalha
    }
    return NextResponse.json({ ok: true });
  }
  if (b.acao === 'refazer' || b.acao === 'publicar') {
    const fim = await processarPost(p.id, baseDoApp(req.url), { refazer: b.acao === 'refazer', ateMs: ate() });
    if (!fim) return erro('Esse post já está sendo publicado. Espere uns minutos e recarregue.', 409);
    return NextResponse.json({ post: fim });
  }
  return erro('ação inválida');
}

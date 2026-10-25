// /api/marketing/fila — fila de aprovação do /marketing (pedido do dono 25/10/2026).
// O Claude monta o post (status AGUARDANDO, origem 'claude'); aqui o dono:
//   PATCH { filialId, id, acao: 'salvar',  legenda?, legendaTiktok?, midias?, agendadoPara?, redes? }
//   PATCH { filialId, id, acao: 'aprovar', ...mesmos campos }  → AGENDADO (hora futura) ou sai na hora
//   PATCH { filialId, id, acao: 'recusar', motivo? }           → RECUSADO
//   PATCH { filialId, id, acao: 'excluir' }                    → apaga (só AGUARDANDO/RECUSADO)
// Quem publica é o mesmo motor da tela Publicar (lib/marketing/publicar.ts):
// na hora pelo processarPost, ou pelo cron de 5 em 5 min quando agendado.

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
const ate = () => Date.now() + 240_000;

type Midia = { path: string; tipo: 'foto' | 'video'; nome?: string };

/** Mesmas regras da tela Publicar: arquivo da própria casa, vídeo sozinho, até 10 fotos. */
function lerMidias(bruto: unknown, casaId: string): { midias: Midia[] } | { erro: string } {
  const midias = (Array.isArray(bruto) ? bruto : [])
    .map((m) => m as { path?: unknown; tipo?: unknown; nome?: unknown })
    .filter((m) => typeof m.path === 'string' && m.path.startsWith(`${casaId}/`) && !m.path.includes('..'))
    .map((m) => ({
      path: String(m.path),
      tipo: (m.tipo === 'video' ? 'video' : 'foto') as 'foto' | 'video',
      nome: typeof m.nome === 'string' ? m.nome.slice(0, 120) : undefined,
    }));
  if (midias.some((m) => m.tipo === 'video') && midias.length > 1) {
    return { erro: 'Vídeo vai sozinho: um vídeo por post (ou até 10 fotos).' };
  }
  if (midias.length > 10) return { erro: 'No máximo 10 fotos por post.' };
  return { midias };
}

export async function PATCH(req: Request) {
  const b = (await req.json().catch(() => ({}))) as {
    filialId?: string;
    id?: string;
    acao?: string;
    legenda?: unknown;
    legendaTiktok?: unknown;
    midias?: unknown;
    agendadoPara?: unknown;
    redes?: unknown;
    motivo?: unknown;
  };
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
    const [apagado] = await db
      .delete(T)
      .where(and(eq(T.id, p.id), inArray(T.status, ['AGUARDANDO', 'RECUSADO'])))
      .returning({ id: T.id });
    if (!apagado) return erro('Esse post já saiu da fila; recarregue a página.', 409);
    try {
      const admin = await createAdminClient();
      if (p.midias.length) await admin.storage.from(BUCKET_MARKETING).remove(p.midias.map((m) => m.path));
    } catch {
      // arquivo fica no depósito; não atrapalha
    }
    return NextResponse.json({ ok: true });
  }

  if (b.acao === 'recusar') {
    const motivo = typeof b.motivo === 'string' ? b.motivo.trim().slice(0, 500) : '';
    const [fim] = await db
      .update(T)
      .set({ status: 'RECUSADO', recusaMotivo: motivo || null, atualizadoEm: new Date() })
      .where(and(eq(T.id, p.id), eq(T.status, 'AGUARDANDO')))
      .returning();
    if (!fim) return erro('Esse post já saiu da fila; recarregue a página.', 409);
    return NextResponse.json({ post: fim });
  }

  if (b.acao !== 'salvar' && b.acao !== 'aprovar') return erro('ação inválida');
  if (p.status !== 'AGUARDANDO') return erro('Esse post já saiu da fila; recarregue a página.', 409);

  // campos que o dono pode mexer antes de aprovar (o que não veio fica como está)
  const mudar: Partial<typeof T.$inferInsert> = {};
  if (typeof b.legenda === 'string') {
    const l = b.legenda.trim();
    if (l.length > 2200) return erro('Legenda passou de 2.200 caracteres (limite do Instagram).');
    mudar.legenda = l;
  }
  if (typeof b.legendaTiktok === 'string') mudar.legendaTiktok = b.legendaTiktok.trim().slice(0, 2200) || null;
  if (b.midias !== undefined) {
    const m = lerMidias(b.midias, a.casa.id);
    if ('erro' in m) return erro(m.erro);
    mudar.midias = m.midias;
  }
  if (b.redes !== undefined) {
    const redes = [...new Set((Array.isArray(b.redes) ? b.redes : []).map(String))].filter(
      (r) => r === 'instagram' || r === 'tiktok',
    );
    if (!redes.length) return erro('Escolha Instagram, TikTok ou os dois.');
    mudar.redes = redes;
  }
  if (b.agendadoPara !== undefined) {
    if (b.agendadoPara === null || b.agendadoPara === '') mudar.agendadoPara = null;
    else {
      const d = new Date(String(b.agendadoPara));
      if (Number.isNaN(d.getTime())) return erro('Data do agendamento inválida.');
      mudar.agendadoPara = d;
    }
  }

  if (b.acao === 'salvar') {
    const [fim] = await db
      .update(T)
      .set({ ...mudar, atualizadoEm: new Date() })
      .where(and(eq(T.id, p.id), eq(T.status, 'AGUARDANDO')))
      .returning();
    if (!fim) return erro('Esse post já saiu da fila; recarregue a página.', 409);
    return NextResponse.json({ post: fim });
  }

  // aprovar
  const midias = mudar.midias ?? p.midias;
  if (!midias.length) return erro('Falta a foto ou o vídeo. Ponha o arquivo no card antes de aprovar.');
  const quando = mudar.agendadoPara !== undefined ? mudar.agendadoPara : p.agendadoPara;
  const futuro = !!quando && quando.getTime() > Date.now() + 60_000;
  const [aprovado] = await db
    .update(T)
    .set({
      ...mudar,
      status: futuro ? 'AGENDADO' : 'RASCUNHO',
      aprovadoPor: a.user.id,
      aprovadoPorEmail: a.user.email ?? null,
      aprovadoEm: new Date(),
      atualizadoEm: new Date(),
    })
    .where(and(eq(T.id, p.id), eq(T.status, 'AGUARDANDO')))
    .returning();
  if (!aprovado) return erro('Esse post já saiu da fila; recarregue a página.', 409);
  if (futuro) return NextResponse.json({ post: aprovado });
  // horário vazio ou já passou: sai agora
  const fim = await processarPost(aprovado.id, baseDoApp(req.url), { ateMs: ate() });
  return NextResponse.json({ post: fim ?? aprovado });
}

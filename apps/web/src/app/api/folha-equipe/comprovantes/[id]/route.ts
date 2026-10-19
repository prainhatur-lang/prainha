// /api/folha-equipe/comprovantes/[id]
//  GET    → abre a foto guardada (endereço assinado de 10 min)
//  POST   { acao: 'casar' | 'ler' } → procura a conta de novo / relê a foto
//  POST   { acao: 'escolher', contaId } → casa na mão (depósito na conta de outra pessoa;
//         contaId pode ser 'a,b' = soma das contas da pessoa na mesma folha)
//  POST   { acao: 'casa', filialId } → o depósito é dessa casa (vazio = descobrir sozinho)
//         e procura a conta só nela — quem trabalha em várias casas
//  DELETE { acao: 'desfazer' } → estorna a baixa (contas voltam a abertas)
//  DELETE { acao: 'tirar' }    → tira da lista (a foto continua no bucket)

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import {
  BUCKET_LOTERICA,
  PERM_LOTERICA,
  RecusaComprovante,
  casarEGravar,
  casarManual,
  desfazerBaixa,
  escolherCasa,
  filialIdsDoUsuario,
  lerECasar,
} from '@/lib/comprovante-loterica';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

async function carregar(id: string, userId: string) {
  const [c] = await db
    .select()
    .from(schema.comprovanteLoterica)
    .where(eq(schema.comprovanteLoterica.id, id))
    .limit(1);
  if (!c || c.excluidoEm) return null;
  const filiais = await filialIdsDoUsuario(userId);
  const ok = c.filialId ? filiais.includes(c.filialId) : c.enviadoPor === userId;
  return ok ? { c, filiais } : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await exigirPermApi(PERM_LOTERICA);
  if (auth.error) return auth.error;
  const { id } = await params;
  const achado = await carregar(id, auth.user.id);
  if (!achado) return NextResponse.json({ error: 'comprovante não encontrado' }, { status: 404 });
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_LOTERICA).createSignedUrl(achado.c.storagePath, 600);
  if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await exigirPermApi(PERM_LOTERICA);
  if (auth.error) return auth.error;
  const { id } = await params;
  const achado = await carregar(id, auth.user.id);
  if (!achado) return NextResponse.json({ error: 'comprovante não encontrado' }, { status: 404 });
  if (achado.c.status === 'BAIXADO') return NextResponse.json({ error: 'já está baixado — desfaça a baixa antes' }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { acao?: string; contaId?: string; filialId?: string } | null;
  if (body?.acao === 'casa') {
    try {
      const r = await escolherCasa(id, body.filialId ? String(body.filialId) : null, auth.user.id, achado.filiais);
      return NextResponse.json({ ok: true, ...r });
    } catch (e) {
      if (e instanceof RecusaComprovante) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  }
  if (body?.acao === 'escolher') {
    try {
      await casarManual(id, String(body.contaId ?? '').split(','), achado.filiais);
      return NextResponse.json({ ok: true, status: 'CASADO' });
    } catch (e) {
      if (e instanceof RecusaComprovante) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  }
  const r = body?.acao === 'ler' ? await lerECasar(id, auth.user.id) : await casarEGravar(id, auth.user.id);
  return NextResponse.json({ ok: true, ...r });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await exigirPermApi(PERM_LOTERICA);
  if (auth.error) return auth.error;
  const { id } = await params;
  const achado = await carregar(id, auth.user.id);
  if (!achado) return NextResponse.json({ error: 'comprovante não encontrado' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { acao?: string } | null;

  if (body?.acao === 'desfazer') {
    try {
      const n = await desfazerBaixa(id, achado.filiais);
      return NextResponse.json({ ok: true, estornadas: n });
    } catch (e) {
      if (e instanceof RecusaComprovante) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  }
  if (achado.c.status === 'BAIXADO') {
    return NextResponse.json({ error: 'está baixado — desfaça a baixa antes de tirar' }, { status: 400 });
  }
  await db
    .update(schema.comprovanteLoterica)
    .set({ excluidoEm: new Date(), excluidoPor: auth.user.id, contaPagarIds: [] })
    .where(eq(schema.comprovanteLoterica.id, id));
  return NextResponse.json({ ok: true });
}

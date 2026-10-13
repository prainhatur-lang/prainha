// GET    /api/cartoes/faturas/[id] — baixa o arquivo da fatura (redireciona pra
//        um endereço assinado do bucket privado, válido por 1 minuto).
// POST   /api/cartoes/faturas/[id] — lê o arquivo de novo (troca os lançamentos).
// DELETE /api/cartoes/faturas/[id] — tira a fatura da lista (enviada errada).
//        Só marca: o arquivo continua guardado no bucket.

import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import {
  BUCKET_CARTOES,
  PERM_CARTAO_ENVIAR,
  PERM_CARTAO_VER,
  faturaVisivel,
  lerEGravarFatura,
} from '@/lib/cartao-fatura';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await exigirPermApi(PERM_CARTAO_VER);
  if (auth.error) return auth.error;
  const { id } = await params;
  const fat = await faturaVisivel(auth.user.id, id);
  if (!fat) return NextResponse.json({ error: 'fatura não encontrada' }, { status: 404 });

  const admin = await createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET_CARTOES)
    .createSignedUrl(fat.storagePath, 60, { download: fat.nomeOriginal });
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: `storage: ${error?.message ?? 'sem endereço'}` }, { status: 500 });
  }
  return NextResponse.redirect(data.signedUrl, 302);
}

// Ler de novo refaz os lançamentos e apaga a categoria e a casa marcadas na
// mão — por isso pede a SENHA do usuário logado (pedido do dono, 13/10/2026).
// Mesma re-autenticação da reabertura da folha: client isolado, sem sessão.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await exigirPermApi(PERM_CARTAO_ENVIAR);
  if (auth.error) return auth.error;
  const { id } = await params;
  const fat = await faturaVisivel(auth.user.id, id);
  if (!fat) return NextResponse.json({ error: 'fatura não encontrada' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { senha?: unknown } | null;
  const senha = typeof body?.senha === 'string' ? body.senha : '';
  if (!senha) return NextResponse.json({ error: 'informe a senha pra ler de novo' }, { status: 400 });
  if (!auth.user.email) return NextResponse.json({ error: 'usuário sem e-mail' }, { status: 403 });
  const verifier = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: authErr } = await verifier.auth.signInWithPassword({ email: auth.user.email, password: senha });
  if (authErr) return NextResponse.json({ error: 'senha incorreta' }, { status: 403 });
  const leitura = await lerEGravarFatura(fat.id, auth.user.id);
  return NextResponse.json({ ok: true, id: fat.id, ...leitura });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await exigirPermApi(PERM_CARTAO_ENVIAR);
  if (auth.error) return auth.error;
  const { id } = await params;
  const fat = await faturaVisivel(auth.user.id, id);
  if (!fat) return NextResponse.json({ error: 'fatura não encontrada' }, { status: 404 });
  await db
    .update(schema.cartaoFatura)
    .set({ excluidoEm: new Date(), excluidoPor: auth.user.id })
    .where(eq(schema.cartaoFatura.id, fat.id));
  return NextResponse.json({ ok: true });
}

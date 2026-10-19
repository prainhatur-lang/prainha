// POST /api/folha-equipe/comprovantes/upload-url — passo 1 do envio de um
// comprovante da lotérica (o 10% da equipe). Devolve um endereço assinado pra
// o navegador mandar a foto DIRETO pro bucket. O passo 2 é
// POST /api/folha-equipe/comprovantes, que registra, lê e casa com a conta.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import {
  BUCKET_LOTERICA,
  LOTERICA_EXTENSOES,
  LOTERICA_TAMANHO_MAX,
  PERM_LOTERICA,
  extensaoLoterica,
  pastaLoterica,
} from '@/lib/comprovante-loterica';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await exigirPermApi(PERM_LOTERICA);
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => null)) as { nome?: string; tamanho?: number } | null;
  const nome = String(body?.nome ?? '').trim();
  const tamanho = Number(body?.tamanho);
  if (!nome) return NextResponse.json({ error: 'arquivo ausente' }, { status: 400 });
  if (!LOTERICA_EXTENSOES.includes(extensaoLoterica(nome))) {
    return NextResponse.json(
      { error: `tipo de arquivo não aceito — envie ${LOTERICA_EXTENSOES.map((e) => e.toUpperCase()).join(', ')}` },
      { status: 400 },
    );
  }
  if (!(tamanho > 0)) return NextResponse.json({ error: 'arquivo vazio' }, { status: 400 });
  if (tamanho > LOTERICA_TAMANHO_MAX) return NextResponse.json({ error: 'arquivo maior que 15 MB' }, { status: 413 });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const sorte = Math.random().toString(36).slice(2, 8);
  const safe = nome.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${pastaLoterica(auth.user.id)}/${ts}-${sorte}-${safe}`;

  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_LOTERICA).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
  }
  return NextResponse.json({ bucket: BUCKET_LOTERICA, path: data.path, token: data.token });
}

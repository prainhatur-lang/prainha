// POST /api/delivery-admin/foto — upload da foto de um item do cardápio.
// Body: multipart/form-data com 'arquivo' (image) e 'filialId'.
// Bucket Supabase: cardapio (público). Path: filialId/timestamp-random.ext
// Devolve { url, path } — quem grava no item é a rota /item (PATCH/POST).

import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'cardapio';
const MAX_SIZE = 8 * 1024 * 1024; // 8MB (o client já comprime antes)
const MIMES_OK = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function extOf(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic') || mime.includes('heif')) return 'heic';
  return 'jpg';
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;

  const ct = request.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'use multipart/form-data' }, { status: 400 });
  }

  const form = await request.formData();
  const arquivo = form.get('arquivo');
  const filialId = String(form.get('filialId') ?? '');

  if (!(arquivo instanceof File)) {
    return NextResponse.json({ error: 'arquivo ausente' }, { status: 400 });
  }
  if (!MIMES_OK.has(arquivo.type)) {
    return NextResponse.json({ error: 'formato não suportado' }, { status: 400 });
  }
  if (arquivo.size > MAX_SIZE) {
    return NextResponse.json({ error: 'imagem muito grande (máx 8MB)' }, { status: 400 });
  }
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const storagePath = `${filialId}/${Date.now()}-${randomBytes(6).toString('hex')}.${extOf(arquivo.type)}`;
  const buffer = Buffer.from(await arquivo.arrayBuffer());
  const supa = await createAdminClient();

  let up = await supa.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: arquivo.type,
    upsert: false,
  });
  // Bucket ainda não existe (primeira foto do cardápio): cria e tenta de novo.
  if (up.error && /bucket/i.test(up.error.message)) {
    await supa.storage.createBucket(BUCKET, { public: true });
    up = await supa.storage.from(BUCKET).upload(storagePath, buffer, {
      contentType: arquivo.type,
      upsert: false,
    });
  }
  if (up.error) {
    return NextResponse.json({ error: `storage: ${up.error.message}` }, { status: 500 });
  }

  const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(storagePath);
  return NextResponse.json({ ok: true, url: pub.publicUrl, path: storagePath });
}

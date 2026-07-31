// POST /api/op/[token]/foto — upload de foto (entrada ou saída) via link público
// Body: multipart/form-data com 'arquivo' (image), 'tipo' (ENTRADA/SAIDA),
// 'observacao' (opcional).
//
// Limite: 10MB por foto, image/jpeg|png|webp|heic.
// Bucket Supabase: producao-fotos (público).
// Path: filialId/opId/timestamp-random.ext

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'producao-fotos';
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

const TIPOS_OK = new Set(['ENTRADA', 'SAIDA']);
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token invalido' }, { status: 400 });
  }

  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'use multipart/form-data' }, { status: 400 });
  }

  const form = await req.formData();
  const arquivo = form.get('arquivo');
  const tipo = String(form.get('tipo') ?? '').toUpperCase();
  const observacao = String(form.get('observacao') ?? '').trim() || null;

  if (!(arquivo instanceof File)) {
    return NextResponse.json({ error: 'arquivo ausente' }, { status: 400 });
  }
  if (!TIPOS_OK.has(tipo)) {
    return NextResponse.json({ error: 'tipo deve ser ENTRADA ou SAIDA' }, { status: 400 });
  }
  if (arquivo.size > MAX_SIZE) {
    return NextResponse.json(
      { error: `arquivo > ${MAX_SIZE / 1024 / 1024}MB` },
      { status: 413 },
    );
  }
  if (!MIMES_OK.has(arquivo.type.toLowerCase())) {
    return NextResponse.json(
      { error: `tipo de arquivo nao suportado: ${arquivo.type}` },
      { status: 400 },
    );
  }

  // Carrega OP (e filial) pelo token publico
  const [op] = await db
    .select({
      id: schema.ordemProducao.id,
      filialId: schema.ordemProducao.filialId,
      status: schema.ordemProducao.status,
    })
    .from(schema.ordemProducao)
    .where(eq(schema.ordemProducao.tokenPublico, token))
    .limit(1);
  if (!op) return NextResponse.json({ error: 'OP nao encontrada' }, { status: 404 });
  if (op.status !== 'RASCUNHO') {
    return NextResponse.json(
      { error: `OP ${op.status} nao aceita fotos` },
      { status: 400 },
    );
  }

  // Upload no Storage
  const ext = extOf(arquivo.type);
  const random = randomBytes(8).toString('hex');
  const ts = Date.now();
  const storagePath = `${op.filialId}/${op.id}/${ts}-${random}.${ext}`;

  const buffer = Buffer.from(await arquivo.arrayBuffer());

  const supa = await createAdminClient();
  const up = await supa.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: arquivo.type,
    upsert: false,
  });
  if (up.error) {
    return NextResponse.json(
      { error: `storage: ${up.error.message}` },
      { status: 500 },
    );
  }

  const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(storagePath);

  const [fotoRow] = await db
    .insert(schema.ordemProducaoFoto)
    .values({
      ordemProducaoId: op.id,
      tipo,
      storagePath,
      url: pub.publicUrl,
      observacao,
      enviadaPorToken: token,
    })
    .returning({ id: schema.ordemProducaoFoto.id });

  return NextResponse.json(
    {
      id: fotoRow?.id,
      url: pub.publicUrl,
      tipo,
      tamanhoBytes: arquivo.size,
    },
    { status: 201 },
  );
}

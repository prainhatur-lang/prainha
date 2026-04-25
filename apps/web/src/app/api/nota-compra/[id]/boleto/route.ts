// POST /api/nota-compra/[id]/boleto — upload de boleto digitalizado pelo PC
// (autenticado). Aceita PDF ou imagem.
// Body: multipart/form-data com 'arquivo'.
// Retorna: { storagePath, url }
//
// Bucket: producao-fotos (publico, ja existente)
// Prefixo: nfe-boletos/{filialId}/{notaId}/{timestamp-random}.{ext}

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'producao-fotos';
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const MIMES_OK = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function extOf(mime: string): string {
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic') || mime.includes('heif')) return 'heic';
  return 'jpg';
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, nota.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'use multipart/form-data' }, { status: 400 });
  }
  const form = await req.formData();
  const arquivo = form.get('arquivo');
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ error: 'arquivo ausente' }, { status: 400 });
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

  const ext = extOf(arquivo.type);
  const random = randomBytes(8).toString('hex');
  const ts = Date.now();
  const storagePath = `nfe-boletos/${nota.filialId}/${nota.id}/${ts}-${random}.${ext}`;

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
  return NextResponse.json({
    storagePath,
    url: pub.publicUrl,
    tamanhoBytes: arquivo.size,
  });
}

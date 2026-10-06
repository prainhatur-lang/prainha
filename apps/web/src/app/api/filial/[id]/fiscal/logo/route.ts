// POST /api/filial/[id]/fiscal/logo — sobe a logo da casa (multipart, campo
// 'arquivo') e guarda o endereço em fiscal_config.logoUrl; ela sai no cabeçalho
// das notas (DANFE). DELETE tira a logo enviada (volta a padrão da casa, se
// houver). Permissão configuracao.editar + vínculo com a filial.

import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'cardapio';
const MAX_SIZE = 2 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

async function autorizar(params: Promise<{ id: string }>) {
  const auth = await exigirPermApi('configuracao.editar');
  if (auth.error) return { erro: auth.error };
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { erro: NextResponse.json({ error: 'id invalido' }, { status: 400 }) };
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, auth.user.id), eq(schema.usuarioFilial.filialId, id)))
    .limit(1);
  if (!link) return { erro: NextResponse.json({ error: 'sem acesso' }, { status: 403 }) };
  return { id };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await autorizar(params);
  if (a.erro) return a.erro;

  const form = await req.formData().catch(() => null);
  const arquivo = form?.get('arquivo');
  if (!(arquivo instanceof File)) return NextResponse.json({ error: 'arquivo ausente' }, { status: 400 });
  const ext = EXT[arquivo.type];
  if (!ext) return NextResponse.json({ error: 'use PNG, JPG ou WEBP' }, { status: 400 });
  if (arquivo.size > MAX_SIZE) return NextResponse.json({ error: 'imagem muito grande (máx 2 MB)' }, { status: 400 });

  const storagePath = `logos/${a.id}-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
  const supa = await createAdminClient();
  const up = await supa.storage
    .from(BUCKET)
    .upload(storagePath, Buffer.from(await arquivo.arrayBuffer()), { contentType: arquivo.type, upsert: false });
  if (up.error) return NextResponse.json({ error: `storage: ${up.error.message}` }, { status: 500 });
  const url = supa.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;

  // só a chave logoUrl muda; o resto da config fiscal fica como está
  await db
    .update(schema.filial)
    .set({
      fiscalConfig: sql`coalesce(${schema.filial.fiscalConfig}, '{}'::jsonb) || jsonb_build_object('logoUrl', ${url}::text)`,
    })
    .where(eq(schema.filial.id, a.id));
  return NextResponse.json({ ok: true, url });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await autorizar(params);
  if (a.erro) return a.erro;
  await db
    .update(schema.filial)
    .set({ fiscalConfig: sql`${schema.filial.fiscalConfig} - 'logoUrl'` })
    .where(eq(schema.filial.id, a.id));
  return NextResponse.json({ ok: true });
}

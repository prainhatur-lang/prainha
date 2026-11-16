// POST /api/financeiro/recibo/[id]/assinado — sobe o recibo impresso e
// assinado (foto ou PDF) de uma conta. multipart/form-data com 'arquivo'.
// Pode subir mais de um (frente/verso, foto melhor); nada é apagado.

import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { createAdminClient } from '@/lib/supabase/server';
import { BUCKET_RECIBO, listarRecibosAssinados, pastaReciboAssinado } from '@/lib/recibo-assinado';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX = 10 * 1024 * 1024;
const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('conta_pagar.create');
  if (error) return error;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id invalido' }, { status: 400 });

  const [conta] = await db
    .select({ id: schema.contaPagar.id, filialId: schema.contaPagar.filialId, dataDelete: schema.contaPagar.dataDelete })
    .from(schema.contaPagar)
    .where(eq(schema.contaPagar.id, id))
    .limit(1);
  if (!conta || conta.dataDelete) return NextResponse.json({ error: 'conta não encontrada' }, { status: 404 });

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, conta.filialId)))
    .limit(1);
  if (!acesso && !(await ebLiberadaNoFinanceiro(user.id, conta.filialId))) {
    return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const arquivo = form?.get('arquivo');
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return NextResponse.json({ error: 'arquivo ausente' }, { status: 400 });
  }
  if (arquivo.size > MAX) return NextResponse.json({ error: 'arquivo maior que 10 MB' }, { status: 413 });
  const tipo = arquivo.type.toLowerCase();
  const ext = EXT[tipo];
  if (!ext) return NextResponse.json({ error: 'envie foto (JPG, PNG) ou PDF' }, { status: 400 });

  const caminho = `${pastaReciboAssinado(conta.filialId, conta.id)}/${Date.now()}-${randomBytes(8).toString('hex')}.${ext}`;
  const supa = await createAdminClient();
  const up = await supa.storage.from(BUCKET_RECIBO).upload(caminho, Buffer.from(await arquivo.arrayBuffer()), {
    contentType: tipo === 'image/jpg' ? 'image/jpeg' : tipo === 'image/heif' ? 'image/heic' : tipo,
    upsert: false,
  });
  if (up.error) return NextResponse.json({ error: `não consegui guardar: ${up.error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, arquivos: await listarRecibosAssinados(conta.filialId, conta.id) }, { status: 201 });
}

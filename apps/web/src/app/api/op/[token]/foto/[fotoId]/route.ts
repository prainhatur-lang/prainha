// DELETE /api/op/[token]/foto/[fotoId] — remove foto via link público

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'producao-fotos';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ token: string; fotoId: string }> },
) {
  const { token, fotoId } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token invalido' }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(fotoId)) {
    return NextResponse.json({ error: 'fotoId invalido' }, { status: 400 });
  }

  const [foto] = await db
    .select({
      id: schema.ordemProducaoFoto.id,
      storagePath: schema.ordemProducaoFoto.storagePath,
      opStatus: schema.ordemProducao.status,
    })
    .from(schema.ordemProducaoFoto)
    .innerJoin(
      schema.ordemProducao,
      eq(schema.ordemProducao.id, schema.ordemProducaoFoto.ordemProducaoId),
    )
    .where(
      and(
        eq(schema.ordemProducao.tokenPublico, token),
        eq(schema.ordemProducaoFoto.id, fotoId),
      ),
    )
    .limit(1);
  if (!foto) return NextResponse.json({ error: 'foto nao encontrada' }, { status: 404 });

  if (foto.opStatus !== 'RASCUNHO') {
    return NextResponse.json(
      { error: `OP ${foto.opStatus} — fotos so podem ser removidas em RASCUNHO` },
      { status: 400 },
    );
  }

  // Remove do storage (best effort — não bloqueia se falhar)
  const supa = await createAdminClient();
  await supa.storage.from(BUCKET).remove([foto.storagePath]).catch(() => {
    // ignora erro de storage — registro do banco é fonte de verdade
  });

  // Remove do banco
  await db
    .delete(schema.ordemProducaoFoto)
    .where(eq(schema.ordemProducaoFoto.id, fotoId));

  return NextResponse.json({ ok: true });
}

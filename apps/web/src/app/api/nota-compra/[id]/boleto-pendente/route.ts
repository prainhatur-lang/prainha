// GET /api/nota-compra/[id]/boleto-pendente
// Retorna o path do boleto enviado pelo celular (ou null se nao chegou).
// Usado pelo modal de Lancar no estoque pra fazer polling enquanto user
// esta na opcao "📱 Foto pelo celular".

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { createAdminClient, createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'producao-fotos';

export async function GET(
  _req: Request,
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
      boletoPendentePath: schema.notaCompra.boletoPendentePath,
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

  if (!nota.boletoPendentePath) {
    return NextResponse.json({ pendente: false });
  }

  const supa = await createAdminClient();
  const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(nota.boletoPendentePath);

  return NextResponse.json({
    pendente: true,
    storagePath: nota.boletoPendentePath,
    url: pub.publicUrl,
  });
}

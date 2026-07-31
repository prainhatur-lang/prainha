// POST /api/nota-compra/[id]/token-boleto
// Gera (ou retorna o existente) um token publico pra a nota receber upload
// de boleto pelo celular. URL gerada: /nota-boleto/[token].
// Idempotente: se a nota ja tem token, retorna o mesmo.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
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
      boletoTokenPublico: schema.notaCompra.boletoTokenPublico,
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

  if (nota.boletoTokenPublico) {
    return NextResponse.json({ token: nota.boletoTokenPublico });
  }

  const token = `bol_${randomBytes(24).toString('hex')}`;
  await db
    .update(schema.notaCompra)
    .set({ boletoTokenPublico: token })
    .where(eq(schema.notaCompra.id, id));

  return NextResponse.json({ token });
}

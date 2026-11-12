// POST /api/nota-compra/[id]/cartao
// Informa (ou corrige/tira) o cartão de crédito em que a compra foi paga:
// { cartao: { banco, final, parcelas } | null }. Só grava a marcação na nota —
// não cria nem apaga conta a pagar. O encontro com a fatura é leitura.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { gravarCartaoDaNota } from '@/lib/nota-cartao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  cartao: z
    .object({
      banco: z.string().min(1).max(60),
      final: z.string().min(1).max(8),
      parcelas: z.number().int().min(1).max(36),
    })
    .nullable(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'body invalido' }, { status: 400 });

  const [nota] = await db
    .select({ filialId: schema.notaCompra.filialId })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, nota.filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const r = await gravarCartaoDaNota({ notaId: id, filialId: nota.filialId, cartao: parsed.data.cartao });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true });
}

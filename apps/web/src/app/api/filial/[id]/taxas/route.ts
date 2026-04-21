// PATCH /api/filial/[id]/taxas
// Body: TaxasFilial (ecs[] + default)
// Atualiza as taxas da filial usadas pela engine de conciliacao Banco.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TaxasPorBandeiraSchema = z.object({
  pix: z.number().min(0).max(100),
  debito: z.record(z.string(), z.number().min(0).max(100)),
  credito_a_vista: z.record(z.string(), z.number().min(0).max(100)),
});

const PrazosSchema = z.object({
  pix: z.number().int().min(0).max(365),
  debito: z.number().int().min(0).max(365),
  credito_a_vista: z.number().int().min(0).max(365),
});

const EstabelecimentoSchema = TaxasPorBandeiraSchema.extend({
  codigo: z.string().min(1).max(30),
  rotulo: z.string().max(100).optional(),
  canal: z.string().max(30).optional(),
  prazos: PrazosSchema.optional(),
});

const Body = z.object({
  ecs: z.array(EstabelecimentoSchema).max(20),
  default: TaxasPorBandeiraSchema,
  toleranciaAutoAceite: z.number().min(0).max(10).optional(),
});

export async function PATCH(
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

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, id),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { ecs, default: def, toleranciaAutoAceite } = parsed.data;
  const setFields: { taxas: { ecs: typeof ecs; default: typeof def }; toleranciaAutoAceite?: string } = {
    taxas: { ecs, default: def },
  };
  if (toleranciaAutoAceite !== undefined) {
    setFields.toleranciaAutoAceite = toleranciaAutoAceite.toFixed(2);
  }

  const [updated] = await db
    .update(schema.filial)
    .set(setFields)
    .where(eq(schema.filial.id, id))
    .returning({ id: schema.filial.id });

  return NextResponse.json({ id: updated?.id, taxas: parsed.data });
}

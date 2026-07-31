// GET /api/formas-pagamento?filialId=...
// POST /api/formas-pagamento  (cria entry manual; raro — entries normalmente são
// auto-criadas pelo ingest)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { CANAIS_LIQUIDACAO, sugerirCanal } from '@/lib/canal-liquidacao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  filialId: z.string().uuid(),
  formaPagamento: z.string().min(1).max(255).trim(),
  canal: z.enum(CANAIS_LIQUIDACAO).optional(),
  observacao: z.string().max(500).optional(),
});

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const filialId = searchParams.get('filialId');
  if (!filialId || !/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const rows = await db
    .select()
    .from(schema.formaPagamentoCanal)
    .where(eq(schema.formaPagamentoCanal.filialId, filialId))
    .orderBy(asc(schema.formaPagamentoCanal.formaPagamento));

  return NextResponse.json({ formas: rows });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { filialId, formaPagamento, canal, observacao } = parsed.data;

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const canalFinal = canal ?? sugerirCanal(formaPagamento);

  try {
    const [created] = await db
      .insert(schema.formaPagamentoCanal)
      .values({
        filialId,
        formaPagamento,
        canal: canalFinal,
        observacao: observacao ?? null,
        confirmadoPor: user.id,
        confirmadoEm: new Date(),
      })
      .returning({ id: schema.formaPagamentoCanal.id });
    return NextResponse.json({ id: created?.id }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('forma_pagamento_canal_unique')) {
      return NextResponse.json(
        { error: 'essa forma de pagamento ja esta cadastrada nesta filial' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

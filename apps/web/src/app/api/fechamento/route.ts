// POST /api/fechamento — fecha range de dias (admin-only)
// Body: { filialId, processo, dataInicio, dataFim, observacao? }
// DELETE /api/fechamento?filialId=...&processo=...&dataInicio=...&dataFim=...
//   reabre o range (admin-only)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, gte, lte } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PROCESSOS = ['OPERADORA', 'RECEBIVEIS', 'BANCO'] as const;

const Body = z.object({
  filialId: z.string().uuid(),
  processo: z.enum(PROCESSOS),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observacao: z.string().max(500).optional(),
});

async function verificarAdmin(userId: string, filialId: string): Promise<boolean> {
  const [link] = await db
    .select({ role: schema.usuarioFilial.role })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, userId),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  return link?.role === 'DONO';
}

function listarDias(ini: string, fim: string): string[] {
  const dias: string[] = [];
  const d = new Date(ini + 'T00:00:00');
  const f = new Date(fim + 'T00:00:00');
  while (d <= f) {
    dias.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dias;
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
  const { filialId, processo, dataInicio, dataFim, observacao } = parsed.data;

  const admin = await verificarAdmin(user.id, filialId);
  if (!admin) return NextResponse.json({ error: 'apenas DONO pode fechar' }, { status: 403 });

  if (dataFim < dataInicio) {
    return NextResponse.json({ error: 'dataFim < dataInicio' }, { status: 400 });
  }

  const dias = listarDias(dataInicio, dataFim);
  const values = dias.map((data) => ({
    filialId,
    processo,
    data,
    fechadoPor: user.id,
    observacao,
  }));

  // Insere ignorando duplicatas (caso o user feche mesmo dia 2 vezes)
  await db.insert(schema.fechamentoConciliacao).values(values).onConflictDoNothing();

  return NextResponse.json({ ok: true, dias: dias.length });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const u = new URL(req.url);
  const filialId = u.searchParams.get('filialId') ?? '';
  const processo = u.searchParams.get('processo') ?? '';
  const dataInicio = u.searchParams.get('dataInicio') ?? '';
  const dataFim = u.searchParams.get('dataFim') ?? '';

  if (!/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }
  if (!(PROCESSOS as readonly string[]).includes(processo)) {
    return NextResponse.json({ error: 'processo invalido' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
    return NextResponse.json({ error: 'datas invalidas' }, { status: 400 });
  }

  const admin = await verificarAdmin(user.id, filialId);
  if (!admin) return NextResponse.json({ error: 'apenas DONO pode reabrir' }, { status: 403 });

  const r = await db
    .delete(schema.fechamentoConciliacao)
    .where(
      and(
        eq(schema.fechamentoConciliacao.filialId, filialId),
        eq(schema.fechamentoConciliacao.processo, processo),
        gte(schema.fechamentoConciliacao.data, dataInicio),
        lte(schema.fechamentoConciliacao.data, dataFim),
      ),
    )
    .returning({ id: schema.fechamentoConciliacao.id });

  return NextResponse.json({ ok: true, removidos: r.length });
}

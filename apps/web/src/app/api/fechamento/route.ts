// POST /api/fechamento — fecha dias selecionados (admin-only)
// Body novo: { filialId, processo, datas: string[], observacao? }
// Body legado: { filialId, processo, dataInicio, dataFim, observacao? } — aceita
//   por compatibilidade, mas internamente expande pra range completo (use datas[]).
// DELETE /api/fechamento?filialId=...&processo=...&datas=YYYY-MM-DD,YYYY-MM-DD
//   reabre apenas os dias listados.
//
// Bug historico (corrigido aqui): o frontend mandava range [primeiro, ultimo] da
// selecao mas o backend fechava TODOS os dias intermediarios. Quando user
// selecionava 5, 13, 20, fechavam 16 dias. Agora o frontend manda lista exata.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PROCESSOS = ['OPERADORA', 'RECEBIVEIS', 'BANCO'] as const;

const Body = z.object({
  filialId: z.string().uuid(),
  processo: z.enum(PROCESSOS),
  // Formato preferido: lista exata de dias selecionados.
  datas: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(366).optional(),
  // Formato legado (range) — gera todos os dias intermediarios.
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
  const { filialId, processo, datas, dataInicio, dataFim, observacao } = parsed.data;

  const admin = await verificarAdmin(user.id, filialId);
  if (!admin) return NextResponse.json({ error: 'apenas DONO pode fechar' }, { status: 403 });

  // Resolve a lista efetiva de dias. Preferencia: datas[] (exato).
  // Fallback: range dataInicio..dataFim (compat legado).
  let dias: string[];
  if (datas && datas.length > 0) {
    dias = [...new Set(datas)].sort(); // dedupe + sort determinista
  } else if (dataInicio && dataFim) {
    if (dataFim < dataInicio) {
      return NextResponse.json({ error: 'dataFim < dataInicio' }, { status: 400 });
    }
    dias = listarDias(dataInicio, dataFim);
  } else {
    return NextResponse.json(
      { error: 'envie datas[] ou dataInicio+dataFim' },
      { status: 400 },
    );
  }

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
  const datasParam = u.searchParams.get('datas') ?? ''; // CSV: 2026-04-05,2026-04-13
  const dataInicio = u.searchParams.get('dataInicio') ?? '';
  const dataFim = u.searchParams.get('dataFim') ?? '';

  if (!/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }
  if (!(PROCESSOS as readonly string[]).includes(processo)) {
    return NextResponse.json({ error: 'processo invalido' }, { status: 400 });
  }

  // Resolve dias: preferencia pra ?datas=YYYY-MM-DD,YYYY-MM-DD (exato).
  // Fallback: range ?dataInicio=...&dataFim=... (compat legado).
  let diasFiltro: string[] = [];
  if (datasParam) {
    diasFiltro = datasParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    if (diasFiltro.length === 0) {
      return NextResponse.json({ error: 'datas invalidas' }, { status: 400 });
    }
  } else if (
    /^\d{4}-\d{2}-\d{2}$/.test(dataInicio) &&
    /^\d{4}-\d{2}-\d{2}$/.test(dataFim)
  ) {
    diasFiltro = listarDias(dataInicio, dataFim);
  } else {
    return NextResponse.json(
      { error: 'envie datas=YYYY-MM-DD,... ou dataInicio+dataFim' },
      { status: 400 },
    );
  }

  const admin = await verificarAdmin(user.id, filialId);
  if (!admin) return NextResponse.json({ error: 'apenas DONO pode reabrir' }, { status: 403 });

  const r = await db
    .delete(schema.fechamentoConciliacao)
    .where(
      and(
        eq(schema.fechamentoConciliacao.filialId, filialId),
        eq(schema.fechamentoConciliacao.processo, processo),
        inArray(schema.fechamentoConciliacao.data, diasFiltro),
      ),
    )
    .returning({ id: schema.fechamentoConciliacao.id });

  return NextResponse.json({ ok: true, removidos: r.length });
}

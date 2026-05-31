// PUT /api/avaliacoes/config — configura avaliacoes de uma filial:
// link do Google e nota de corte do gating. Requer avaliacao.configurar.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(request: Request) {
  const { user, error } = await exigirPermApi('avaliacao.configurar');
  if (error) return error;

  const body = await request.json().catch(() => null);
  const filialId = typeof body?.filialId === 'string' ? body.filialId : null;
  if (!filialId) {
    return NextResponse.json({ error: 'filialId obrigatório' }, { status: 400 });
  }

  const corte = Number(body?.notaCorteGoogle);
  if (!Number.isInteger(corte) || corte < 1 || corte > 5) {
    return NextResponse.json({ error: 'corte deve ser 1 a 5' }, { status: 400 });
  }

  let googleUrl: string | null = null;
  if (typeof body?.googleReviewUrl === 'string' && body.googleReviewUrl.trim()) {
    const u = body.googleReviewUrl.trim();
    if (!/^https?:\/\//i.test(u)) {
      return NextResponse.json({ error: 'link do Google deve começar com http' }, { status: 400 });
    }
    googleUrl = u.slice(0, 1000);
  }

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  if (!filialIds.includes(filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  await db
    .update(schema.filial)
    .set({ googleReviewUrl: googleUrl, notaCorteGoogle: corte })
    .where(and(eq(schema.filial.id, filialId), inArray(schema.filial.id, filialIds)));

  return NextResponse.json({ ok: true });
}

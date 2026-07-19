// POST /api/inter/sincronizar — busca o extrato Inter via API (sem upload
// manual) pro período pedido (default: últimos 10 dias) e grava em
// lancamento_banco. Auth via cookie (Supabase) + RBAC de filial, mesmo
// padrão de /api/upload.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { processarExtratoInterApi } from '@/lib/processadores';
import { resolverCredenciaisInter } from '@/lib/inter';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const filialId = String(body?.filialId ?? '');
  const dias = Number.isInteger(body?.dias) && body.dias > 0 && body.dias <= 90 ? body.dias : 10;
  if (!filialId) return NextResponse.json({ error: 'filialId ausente' }, { status: 400 });

  const acessivel = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(eq(schema.usuarioFilial.usuarioId, user.id));
  if (!acessivel.some((a) => a.filialId === filialId)) {
    return NextResponse.json({ error: 'sem acesso a esta filial' }, { status: 403 });
  }

  const cred = resolverCredenciaisInter(filialId);
  if (!cred) {
    return NextResponse.json({ error: 'sincronização automática ainda não configurada pra essa filial' }, { status: 400 });
  }

  const fim = hojeBr();
  const inicio = diasAtrasBr(dias);

  try {
    const resumo = await processarExtratoInterApi(filialId, inicio, fim, cred);
    return NextResponse.json({ ok: true, resumo });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

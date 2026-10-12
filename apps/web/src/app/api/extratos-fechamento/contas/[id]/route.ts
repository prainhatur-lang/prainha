// PATCH /api/extratos-fechamento/contas/[id] — liga ou desliga o pedido de
// extrato de uma conta ({ ativo }). Desligar não apaga nada: os meses que já
// têm arquivo continuam mostrando a conta e o arquivo.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { PERM_EXTRATO_ENVIAR, contaExtratoVisivel } from '@/lib/extratos-fechamento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await exigirPermApi(PERM_EXTRATO_ENVIAR);
  if (auth.error) return auth.error;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as { ativo?: boolean } | null;
  if (typeof body?.ativo !== 'boolean') return NextResponse.json({ error: 'informe ativo' }, { status: 400 });

  const conta = await contaExtratoVisivel(auth.user.id, id);
  if (!conta) return NextResponse.json({ error: 'conta não encontrada' }, { status: 404 });

  await db.update(schema.extratoConta).set({ ativo: body.ativo }).where(eq(schema.extratoConta.id, conta.id));
  return NextResponse.json({ ok: true });
}

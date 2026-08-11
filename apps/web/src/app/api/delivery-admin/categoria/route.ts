// Categorias do cardápio de delivery (painel).
// POST cria, PATCH edita/reordena, DELETE remove (leva os itens junto).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function filialOk(userId: string, filialId: string | null): Promise<boolean> {
  if (!filialId) return false;
  const filiais = await filiaisDoUsuario(userId);
  return filiais.some((f) => f.id === filialId);
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('delivery.create');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  const nome = typeof b?.nome === 'string' ? b.nome.trim().slice(0, 80) : '';
  if (!nome) return NextResponse.json({ error: 'nome é obrigatório' }, { status: 400 });
  if (!(await filialOk(user.id, filialId))) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const ordem = Number.isInteger(b?.ordem) ? b.ordem : 0;
  const [nova] = await db
    .insert(schema.deliveryCategoria)
    .values({ filialId: filialId!, nome, ordem })
    .returning({ id: schema.deliveryCategoria.id });
  return NextResponse.json({ ok: true, id: nova.id });
}

export async function PATCH(request: Request) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const id = typeof b?.id === 'string' ? b.id : null;
  if (!id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });

  const [atual] = await db
    .select({ filialId: schema.deliveryCategoria.filialId })
    .from(schema.deliveryCategoria)
    .where(eq(schema.deliveryCategoria.id, id))
    .limit(1);
  if (!atual || !(await filialOk(user.id, atual.filialId))) {
    return NextResponse.json({ error: 'categoria não encontrada' }, { status: 404 });
  }

  const set: Record<string, unknown> = {};
  if (typeof b.nome === 'string' && b.nome.trim()) set.nome = b.nome.trim().slice(0, 80);
  if (Number.isInteger(b.ordem)) set.ordem = b.ordem;
  if (typeof b.ativo === 'boolean') set.ativo = b.ativo;
  if (Object.keys(set).length === 0) return NextResponse.json({ ok: true });

  await db
    .update(schema.deliveryCategoria)
    .set(set)
    .where(eq(schema.deliveryCategoria.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { user, error } = await exigirPermApi('delivery.delete');
  if (error) return error;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });

  const [atual] = await db
    .select({ filialId: schema.deliveryCategoria.filialId })
    .from(schema.deliveryCategoria)
    .where(eq(schema.deliveryCategoria.id, id))
    .limit(1);
  if (!atual || !(await filialOk(user.id, atual.filialId))) {
    return NextResponse.json({ error: 'categoria não encontrada' }, { status: 404 });
  }

  await db
    .delete(schema.deliveryCategoria)
    .where(
      and(eq(schema.deliveryCategoria.id, id), eq(schema.deliveryCategoria.filialId, atual.filialId)),
    );
  return NextResponse.json({ ok: true });
}

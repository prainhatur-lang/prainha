// Itens do cardápio de delivery (painel). Preço aqui é o do DELIVERY e pode
// ser diferente do preço do salão — é essa a intenção do módulo.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'cardapio';

async function filialOk(userId: string, filialId: string | null): Promise<boolean> {
  if (!filialId) return false;
  const filiais = await filiaisDoUsuario(userId);
  return filiais.some((f) => f.id === filialId);
}

function precoValido(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 99999) return null;
  return n.toFixed(2);
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('delivery.create');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  const categoriaId = typeof b?.categoriaId === 'string' ? b.categoriaId : null;
  const nome = typeof b?.nome === 'string' ? b.nome.trim().slice(0, 160) : '';
  const preco = precoValido(b?.preco);
  if (!filialId || !categoriaId || !nome || !preco) {
    return NextResponse.json({ error: 'filial, categoria, nome e preço são obrigatórios' }, { status: 400 });
  }
  if (!(await filialOk(user.id, filialId))) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const [novo] = await db
    .insert(schema.deliveryItem)
    .values({
      filialId,
      categoriaId,
      nome,
      descricao: typeof b.descricao === 'string' ? b.descricao.trim().slice(0, 600) || null : null,
      preco,
      fotoUrl: typeof b.fotoUrl === 'string' ? b.fotoUrl.slice(0, 500) : null,
      fotoPath: typeof b.fotoPath === 'string' ? b.fotoPath.slice(0, 300) : null,
      varianteId: typeof b.varianteId === 'string' ? b.varianteId : null,
      destaque: b.destaque === true,
      ordem: Number.isInteger(b.ordem) ? b.ordem : 0,
    })
    .returning({ id: schema.deliveryItem.id });
  return NextResponse.json({ ok: true, id: novo.id });
}

export async function PATCH(request: Request) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const id = typeof b?.id === 'string' ? b.id : null;
  if (!id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });

  const [atual] = await db
    .select({ filialId: schema.deliveryItem.filialId })
    .from(schema.deliveryItem)
    .where(eq(schema.deliveryItem.id, id))
    .limit(1);
  if (!atual || !(await filialOk(user.id, atual.filialId))) {
    return NextResponse.json({ error: 'item não encontrado' }, { status: 404 });
  }

  const set: Record<string, unknown> = { atualizadoEm: sql`now()` };
  if (typeof b.nome === 'string' && b.nome.trim()) set.nome = b.nome.trim().slice(0, 160);
  if (typeof b.descricao === 'string') set.descricao = b.descricao.trim().slice(0, 600) || null;
  if (b.preco !== undefined) {
    const p = precoValido(b.preco);
    if (!p) return NextResponse.json({ error: 'preço inválido' }, { status: 400 });
    set.preco = p;
  }
  if (typeof b.categoriaId === 'string') set.categoriaId = b.categoriaId;
  if (typeof b.ativo === 'boolean') set.ativo = b.ativo;
  if (typeof b.esgotado === 'boolean') set.esgotado = b.esgotado;
  if (typeof b.destaque === 'boolean') set.destaque = b.destaque;
  if (Number.isInteger(b.ordem)) set.ordem = b.ordem;
  if (typeof b.fotoUrl === 'string') set.fotoUrl = b.fotoUrl.slice(0, 500) || null;
  if (typeof b.fotoPath === 'string') set.fotoPath = b.fotoPath.slice(0, 300) || null;

  await db.update(schema.deliveryItem).set(set).where(eq(schema.deliveryItem.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { user, error } = await exigirPermApi('delivery.delete');
  if (error) return error;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });

  const [atual] = await db
    .select({ filialId: schema.deliveryItem.filialId, fotoPath: schema.deliveryItem.fotoPath })
    .from(schema.deliveryItem)
    .where(eq(schema.deliveryItem.id, id))
    .limit(1);
  if (!atual || !(await filialOk(user.id, atual.filialId))) {
    return NextResponse.json({ error: 'item não encontrado' }, { status: 404 });
  }

  await db.delete(schema.deliveryItem).where(eq(schema.deliveryItem.id, id));

  if (atual.fotoPath) {
    try {
      const supa = await createAdminClient();
      await supa.storage.from(BUCKET).remove([atual.fotoPath]);
    } catch (e) {
      console.error('delivery: erro removendo foto do storage:', (e as Error).message);
    }
  }
  return NextResponse.json({ ok: true });
}

// Cupons promocionais do delivery (painel).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TIPOS = new Set(['percentual', 'fixo', 'frete_gratis']);

async function filialOk(userId: string, filialId: string | null): Promise<boolean> {
  if (!filialId) return false;
  const filiais = await filiaisDoUsuario(userId);
  return filiais.some((f) => f.id === filialId);
}

const dataOk = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

const intOk = (v: unknown): number | null =>
  Number.isInteger(v) && (v as number) > 0 ? (v as number) : null;

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('delivery.create');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  const codigo =
    typeof b?.codigo === 'string' ? b.codigo.trim().toUpperCase().replace(/\s+/g, '').slice(0, 30) : '';
  const tipo = typeof b?.tipo === 'string' ? b.tipo : '';
  if (!filialId || !codigo || !TIPOS.has(tipo)) {
    return NextResponse.json({ error: 'filial, código e tipo são obrigatórios' }, { status: 400 });
  }
  if (!(await filialOk(user.id, filialId))) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const valorNum = Number(b?.valor);
  if (tipo !== 'frete_gratis' && (!Number.isFinite(valorNum) || valorNum <= 0)) {
    return NextResponse.json({ error: 'valor do desconto inválido' }, { status: 400 });
  }
  if (tipo === 'percentual' && valorNum > 100) {
    return NextResponse.json({ error: 'percentual acima de 100%' }, { status: 400 });
  }

  const minimo = Number(b?.minimoPedido);
  try {
    const [novo] = await db
      .insert(schema.deliveryCupom)
      .values({
        filialId,
        codigo,
        tipo,
        valor: tipo === 'frete_gratis' ? '0' : valorNum.toFixed(2),
        minimoPedido: Number.isFinite(minimo) && minimo > 0 ? minimo.toFixed(2) : null,
        validadeInicio: dataOk(b?.validadeInicio),
        validadeFim: dataOk(b?.validadeFim),
        usosMax: intOk(b?.usosMax),
        usosPorCliente: b?.usosPorCliente === null ? null : (intOk(b?.usosPorCliente) ?? 1),
        primeiraCompraApenas: b?.primeiraCompraApenas === true,
      })
      .returning({ id: schema.deliveryCupom.id });
    return NextResponse.json({ ok: true, id: novo.id });
  } catch (e) {
    if (/uq_delivery_cupom_filial_codigo/.test((e as Error).message)) {
      return NextResponse.json({ error: 'já existe um cupom com esse código' }, { status: 409 });
    }
    throw e;
  }
}

export async function PATCH(request: Request) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const id = typeof b?.id === 'string' ? b.id : null;
  if (!id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });

  const [atual] = await db
    .select({ filialId: schema.deliveryCupom.filialId })
    .from(schema.deliveryCupom)
    .where(eq(schema.deliveryCupom.id, id))
    .limit(1);
  if (!atual || !(await filialOk(user.id, atual.filialId))) {
    return NextResponse.json({ error: 'cupom não encontrado' }, { status: 404 });
  }

  const set: Record<string, unknown> = {};
  if (typeof b.ativo === 'boolean') set.ativo = b.ativo;
  if (b.validadeFim !== undefined) set.validadeFim = dataOk(b.validadeFim);
  if (b.usosMax !== undefined) set.usosMax = intOk(b.usosMax);
  if (b.valor !== undefined) {
    const v = Number(b.valor);
    if (!Number.isFinite(v) || v < 0) {
      return NextResponse.json({ error: 'valor inválido' }, { status: 400 });
    }
    set.valor = v.toFixed(2);
  }
  if (Object.keys(set).length === 0) return NextResponse.json({ ok: true });

  await db.update(schema.deliveryCupom).set(set).where(eq(schema.deliveryCupom.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { user, error } = await exigirPermApi('delivery.delete');
  if (error) return error;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });

  const [atual] = await db
    .select({ filialId: schema.deliveryCupom.filialId })
    .from(schema.deliveryCupom)
    .where(eq(schema.deliveryCupom.id, id))
    .limit(1);
  if (!atual || !(await filialOk(user.id, atual.filialId))) {
    return NextResponse.json({ error: 'cupom não encontrado' }, { status: 404 });
  }

  await db.delete(schema.deliveryCupom).where(eq(schema.deliveryCupom.id, id));
  return NextResponse.json({ ok: true });
}

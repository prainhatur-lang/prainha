// POST /api/loja/marcas — o vendas-local sobe os toques do KDS (pronto/
// entregue por item) pra alimentar os tempos no espelho do pedido.
//
// Auth: mesma assinatura HMAC do /api/loja/cancelamentos (PAGAR_MESA_SECRET),
// contexto 'marcas'. Idempotente: UPDATE por (filial, codigo_externo) — a
// loja pode reenviar a mesma marca sem efeito colateral.

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const Marca = z.object({
  item_codigo: z.coerce.number().int().positive(),
  pronto_em: z.string().min(10).nullable().optional(),
  entregue_em: z.string().min(10).nullable().optional(),
});

const Body = z.object({
  f: z.string().uuid(),
  e: z.coerce.number().int(),
  s: z.string().min(10),
  marcas: z.array(Marca).max(500),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'body invalido' }, { status: 400 });
  const { f, e, s, marcas } = parsed.data;
  if (!(e * 1000 >= Date.now() && confere([f, 'marcas', String(e)], s))) {
    return NextResponse.json({ ok: false, erro: 'assinatura invalida' }, { status: 401 });
  }

  let aplicadas = 0;
  for (const m of marcas) {
    const set: Record<string, Date> = {};
    if (m.pronto_em) set.prontoEm = new Date(m.pronto_em);
    if (m.entregue_em) set.entregueEm = new Date(m.entregue_em);
    if (Object.keys(set).length === 0) continue;
    const r = await db
      .update(schema.pedidoItem)
      .set(set)
      .where(
        and(
          eq(schema.pedidoItem.filialId, f),
          eq(schema.pedidoItem.codigoExterno, m.item_codigo),
        ),
      )
      .returning({ id: schema.pedidoItem.id });
    if (r.length > 0) aplicadas++;
  }
  // item que ainda não sincronizou via CDC não conta — a loja reenvia depois
  return NextResponse.json({ ok: true, aplicadas, total: marcas.length });
}

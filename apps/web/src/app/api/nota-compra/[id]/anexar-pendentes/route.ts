// POST /api/nota-compra/[id]/anexar-pendentes
// Entrada JÁ lançada (ex.: pedido sem nota que entrou direto pela foto): a foto
// do recibo/boleto que o celular mandou pelo QR (/nota-boleto/[token]) fica em
// nota_compra_boleto_pendente — aqui ela é pendurada na conta a pagar que
// ainda está "sem boleto anexado". Só anexa o arquivo: valor e vencimento da
// conta não mudam (ajuste continua em "abrir conta / valor do boleto").
// Casa pelo valor lido quando bate; senão vai na primeira conta sem boleto.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id invalido' }, { status: 400 });

  const [nota] = await db
    .select({ id: schema.notaCompra.id, filialId: schema.notaCompra.filialId })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, nota.filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const pendentes = await db
    .select({
      id: schema.notaCompraBoletoPendente.id,
      storagePath: schema.notaCompraBoletoPendente.storagePath,
      valor: schema.notaCompraBoletoPendente.valorExtraido,
    })
    .from(schema.notaCompraBoletoPendente)
    .where(eq(schema.notaCompraBoletoPendente.notaCompraId, id))
    .orderBy(asc(schema.notaCompraBoletoPendente.enviadoEm));
  if (!pendentes.length) return NextResponse.json({ ok: true, anexados: 0, sobraram: 0 });

  const semBoleto = await db
    .select({ id: schema.contaPagar.id, valor: schema.contaPagar.valor })
    .from(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.notaCompraId, id),
        isNull(schema.contaPagar.dataDelete),
        isNull(schema.contaPagar.boletoStoragePath),
      ),
    )
    .orderBy(asc(schema.contaPagar.dataVencimento));

  const livres = [...semBoleto];
  const usados: string[] = [];
  for (const p of pendentes) {
    if (!livres.length) break;
    const v = p.valor != null ? Number(p.valor) : null;
    let i = v != null ? livres.findIndex((c) => Math.abs(Number(c.valor) - v) <= 0.01) : -1;
    if (i < 0) i = 0;
    const conta = livres.splice(i, 1)[0]!;
    await db
      .update(schema.contaPagar)
      .set({ boletoStoragePath: p.storagePath })
      .where(eq(schema.contaPagar.id, conta.id));
    usados.push(p.id);
  }
  if (usados.length) {
    await db.delete(schema.notaCompraBoletoPendente).where(inArray(schema.notaCompraBoletoPendente.id, usados));
  }
  return NextResponse.json({ ok: true, anexados: usados.length, sobraram: pendentes.length - usados.length });
}

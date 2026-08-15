// POST /api/movimento/notas/[id]/conferir
// Grava a conferência de recebimento da NOTA: quanto chegou de cada item.
// Body: { itens: [{ itemId, qtdRecebida }], observacao? }

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { gravarConferenciaNota } from '@/lib/nota-conferencia';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: notaId } = await params;

  let body: {
    itens?: Array<{ itemId: string; qtdRecebida: number }>;
    observacao?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const entradas = (Array.isArray(body.itens) ? body.itens : []).filter(
    (e) => e.itemId && Number.isFinite(Number(e.qtdRecebida)) && Number(e.qtdRecebida) >= 0,
  );
  if (entradas.length === 0) {
    return NextResponse.json({ error: 'itens obrigatorios' }, { status: 400 });
  }

  const [nota] = await db
    .select({ id: schema.notaCompra.id })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, notaId))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  await gravarConferenciaNota(
    notaId,
    entradas.map((e) => ({ itemId: e.itemId, qtdRecebida: Number(e.qtdRecebida) })),
    body.observacao?.trim() || null,
  );

  // Resumo das faltas (nota diz X, chegou Y)
  const itens = await db
    .select({
      id: schema.notaCompraItem.id,
      descricao: schema.notaCompraItem.descricao,
      quantidade: schema.notaCompraItem.quantidade,
      unidade: schema.notaCompraItem.unidade,
      valorUnitario: schema.notaCompraItem.valorUnitario,
    })
    .from(schema.notaCompraItem)
    .where(eq(schema.notaCompraItem.notaCompraId, notaId));
  const recebidaPor = new Map(entradas.map((e) => [e.itemId, Number(e.qtdRecebida)]));
  const faltas = itens
    .map((i) => {
      const rec = recebidaPor.get(i.id);
      if (rec == null) return null;
      const faltou = Number(i.quantidade) - rec;
      if (faltou <= 0.0001) return null;
      return {
        descricao: i.descricao,
        faltou,
        unidade: i.unidade,
        valor: faltou * Number(i.valorUnitario ?? 0),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const valorFaltante = faltas.reduce((a, f) => a + f.valor, 0);

  return NextResponse.json({ ok: true, faltas, valorFaltante });
}

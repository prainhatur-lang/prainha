// POST /api/compras/pedidos/[id]/receber
// Conferência de recebimento: marca item a item quanto CHEGOU de fato.
// Nasceu de um caso real: nota da Fasouto veio com um item cobrado que não
// estava na entrega — sem registro, o prejuízo passava invisível.
//
// Body: { itens: [{ itemId, quantidadeRecebida }], observacao? }
// Efeitos: grava quantidade_recebida por item; status vira ENTREGUE_TOTAL
// (tudo veio) ou ENTREGUE_PARCIAL (faltou algo); devolve o resumo das faltas.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: pedidoId } = await params;

  let body: {
    itens?: Array<{ itemId: string; quantidadeRecebida: number }>;
    observacao?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const entradas = Array.isArray(body.itens) ? body.itens : [];
  if (entradas.length === 0) {
    return NextResponse.json({ error: 'itens obrigatorios' }, { status: 400 });
  }

  const [ped] = await db
    .select({ id: schema.pedidoCompra.id, status: schema.pedidoCompra.status, observacao: schema.pedidoCompra.observacao })
    .from(schema.pedidoCompra)
    .where(eq(schema.pedidoCompra.id, pedidoId))
    .limit(1);
  if (!ped) return NextResponse.json({ error: 'pedido nao encontrado' }, { status: 404 });
  if (ped.status === 'CANCELADO') {
    return NextResponse.json({ error: 'pedido cancelado' }, { status: 400 });
  }

  for (const e of entradas) {
    const qtd = Number(e.quantidadeRecebida);
    if (!e.itemId || !Number.isFinite(qtd) || qtd < 0) continue;
    await db
      .update(schema.pedidoCompraItem)
      .set({ quantidadeRecebida: String(qtd) })
      .where(
        and(
          eq(schema.pedidoCompraItem.id, e.itemId),
          eq(schema.pedidoCompraItem.pedidoCompraId, pedidoId),
        ),
      );
  }

  // Recalcula o status e o resumo das faltas com o estado gravado
  const itens = await db
    .select({
      quantidade: schema.pedidoCompraItem.quantidade,
      quantidadeRecebida: schema.pedidoCompraItem.quantidadeRecebida,
      precoUnitario: schema.pedidoCompraItem.precoUnitario,
      unidade: schema.pedidoCompraItem.unidade,
      produtoNome: schema.produto.nome,
    })
    .from(schema.pedidoCompraItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.pedidoCompraItem.produtoId))
    .where(eq(schema.pedidoCompraItem.pedidoCompraId, pedidoId));

  const conferidos = itens.filter((i) => i.quantidadeRecebida != null);
  const faltas = conferidos
    .map((i) => {
      const faltou = Number(i.quantidade) - Number(i.quantidadeRecebida);
      return {
        produto: i.produtoNome ?? 'item',
        faltou,
        unidade: i.unidade,
        valor: faltou > 0 ? faltou * Number(i.precoUnitario ?? 0) : 0,
      };
    })
    .filter((f) => f.faltou > 0.0001);
  const valorFaltante = faltas.reduce((acc, f) => acc + f.valor, 0);

  // Status: só muda depois que TODOS os itens foram conferidos. RECONCILIADO
  // não regride (a NF já bateu — a falta fica registrada nos itens mesmo assim).
  if (conferidos.length === itens.length && ped.status !== 'RECONCILIADO') {
    await db
      .update(schema.pedidoCompra)
      .set({
        status: faltas.length > 0 ? 'ENTREGUE_PARCIAL' : 'ENTREGUE_TOTAL',
        atualizadoEm: sql`now()`,
        ...(body.observacao?.trim()
          ? {
              observacao: [ped.observacao, `Conferência: ${body.observacao.trim()}`]
                .filter(Boolean)
                .join(' | ')
                .slice(0, 1000),
            }
          : {}),
      })
      .where(eq(schema.pedidoCompra.id, pedidoId));
  }

  return NextResponse.json({ ok: true, faltas, valorFaltante });
}

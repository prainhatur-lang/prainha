// POST /api/compras/pedidos/manual
// Pedido DIRETO, sem cotação — pro fornecedor único (Cassio do peixe, Galega
// do coco): não faz sentido disputa, o dono manda o pedido e acerta o preço
// na entrega quando não há preço combinado.
// Body: { filialId, fornecedorId, observacao?, itens: [{ produtoId,
//         quantidade, precoUnitario?, observacao? }] }

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, max } from 'drizzle-orm';

interface ItemIn {
  produtoId: string;
  quantidade: number;
  precoUnitario?: number | null;
  observacao?: string | null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cotacao.create');
  if (semPerm) return semPerm;

  let body: {
    filialId?: string;
    fornecedorId?: string;
    observacao?: string | null;
    itens?: ItemIn[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  if (!body.filialId || !body.fornecedorId || !body.itens?.length) {
    return NextResponse.json(
      { error: 'filialId, fornecedorId e itens obrigatorios' },
      { status: 400 },
    );
  }

  const [forn] = await db
    .select({ id: schema.fornecedor.id })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, body.fornecedorId))
    .limit(1);
  if (!forn) return NextResponse.json({ error: 'fornecedor nao encontrado' }, { status: 404 });

  const produtoIds = body.itens.map((i) => i.produtoId);
  const produtos = await db
    .select({ id: schema.produto.id, unidade: schema.produto.unidadeEstoque })
    .from(schema.produto)
    .where(
      and(eq(schema.produto.filialId, body.filialId), inArray(schema.produto.id, produtoIds)),
    );
  const unidadePor = new Map(produtos.map((p) => [p.id, p.unidade]));
  for (const i of body.itens) {
    if (!unidadePor.has(i.produtoId)) {
      return NextResponse.json({ error: `produto ${i.produtoId} nao encontrado na filial` }, { status: 400 });
    }
    if (!Number.isFinite(Number(i.quantidade)) || Number(i.quantidade) <= 0) {
      return NextResponse.json({ error: 'quantidade > 0 obrigatoria em todos os itens' }, { status: 400 });
    }
  }

  const [{ ult }] = await db
    .select({ ult: max(schema.pedidoCompra.numero) })
    .from(schema.pedidoCompra)
    .where(eq(schema.pedidoCompra.filialId, body.filialId));
  const numero = (ult ?? 0) + 1;

  const total = body.itens.reduce(
    (a, i) => a + Number(i.quantidade) * Number(i.precoUnitario ?? 0),
    0,
  );

  const [{ pedidoId }] = await db
    .insert(schema.pedidoCompra)
    .values({
      filialId: body.filialId,
      cotacaoId: null,
      fornecedorId: body.fornecedorId,
      numero,
      status: 'GERADO',
      valorTotal: total.toFixed(2),
      observacao: body.observacao ?? 'pedido direto (sem cotação)',
    })
    .returning({ pedidoId: schema.pedidoCompra.id });

  await db.insert(schema.pedidoCompraItem).values(
    body.itens.map((i) => ({
      pedidoCompraId: pedidoId,
      produtoId: i.produtoId,
      quantidade: String(i.quantidade),
      unidade: unidadePor.get(i.produtoId) ?? 'un',
      precoUnitario: Number(i.precoUnitario ?? 0).toFixed(4),
      valorTotal: (Number(i.quantidade) * Number(i.precoUnitario ?? 0)).toFixed(2),
      observacao:
        i.observacao ?? (i.precoUnitario == null ? 'preço a combinar na entrega' : null),
    })),
  );

  return NextResponse.json({ ok: true, id: pedidoId, numero });
}

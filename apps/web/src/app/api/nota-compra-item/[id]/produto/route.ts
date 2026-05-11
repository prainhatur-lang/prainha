// PATCH /api/nota-compra-item/[id]/produto
// Vincula um item de NF a um produto interno.
// Body: { produtoId: string }
//
// Tambem cria/atualiza produto_fornecedor pra esse par (produto + fornecedor
// da NF) preenchendo descricao, ean, cProd, unidade, ultimo_preco.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  let body: { produtoId?: string };
  try {
    body = (await req.json()) as { produtoId?: string };
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  if (!body.produtoId || !/^[0-9a-f-]{36}$/i.test(body.produtoId)) {
    return NextResponse.json({ error: 'produtoId invalido' }, { status: 400 });
  }

  // Pega item + dados pra alimentar produto_fornecedor
  const [item] = await db
    .select({
      id: schema.notaCompraItem.id,
      filialId: schema.notaCompraItem.filialId,
      notaCompraId: schema.notaCompraItem.notaCompraId,
      descricao: schema.notaCompraItem.descricao,
      ean: schema.notaCompraItem.ean,
      codigoProdutoFornecedor: schema.notaCompraItem.codigoProdutoFornecedor,
      unidade: schema.notaCompraItem.unidade,
      valorUnitario: schema.notaCompraItem.valorUnitario,
    })
    .from(schema.notaCompraItem)
    .where(eq(schema.notaCompraItem.id, id))
    .limit(1);
  if (!item) return NextResponse.json({ error: 'item nao encontrado' }, { status: 404 });

  // Pega fornecedor + dataEmissao da nota
  const [nota] = await db
    .select({
      fornecedorId: schema.notaCompra.fornecedorId,
      dataEmissao: schema.notaCompra.dataEmissao,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, item.notaCompraId))
    .limit(1);

  // Update item.produto_id
  await db
    .update(schema.notaCompraItem)
    .set({ produtoId: body.produtoId })
    .where(eq(schema.notaCompraItem.id, id));

  // Atualiza/cria produto_fornecedor pra esse par (se houver fornecedor)
  if (nota?.fornecedorId) {
    const [existente] = await db
      .select({ id: schema.produtoFornecedor.id })
      .from(schema.produtoFornecedor)
      .where(
        and(
          eq(schema.produtoFornecedor.produtoId, body.produtoId),
          eq(schema.produtoFornecedor.fornecedorId, nota.fornecedorId),
        ),
      )
      .limit(1);

    const dados = {
      descricaoFornecedor: item.descricao,
      codigoFornecedor: item.codigoProdutoFornecedor,
      ean: item.ean,
      unidadeFornecedor: item.unidade,
      ultimoPrecoCusto: item.valorUnitario,
      ultimaCompraEm: nota.dataEmissao,
    };

    if (existente) {
      await db
        .update(schema.produtoFornecedor)
        .set({ ...dados, atualizadoEm: new Date() })
        .where(eq(schema.produtoFornecedor.id, existente.id));
    } else {
      await db.insert(schema.produtoFornecedor).values({
        filialId: item.filialId,
        produtoId: body.produtoId,
        fornecedorId: nota.fornecedorId,
        fatorConversao: '1',
        ...dados,
      });
    }
  }

  return NextResponse.json({ ok: true });
}

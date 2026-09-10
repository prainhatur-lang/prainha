// POST /api/cotacao/[id]/gerar-pedido
// Gera 1 pedido_compra pro fornecedor que respondeu DEPOIS da aprovação.
//
// Existe porque a aprovação é única e irrepetível: ela roda a alocação, cria os
// pedidos de todo mundo e trava a cotação (reaprovar devolve "ja aprovada").
// Quem responde depois — o Fernando, da Vinhedo, em 10/09/2026 — ficava sem
// pedido nenhum e sem caminho no app: a compra tinha que ser feita por fora.
//
// Não passa pela disputa: o gestor escolhe os itens na mão. O que a rota
// garante é que um item já pedido a OUTRO fornecedor nesta cotação não saia
// pedido duas vezes.
//
// Body: { cotacaoFornecedorId, itemIds: string[] }

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNotNull, max, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cotacao.update');
  if (semPerm) return semPerm;

  const { id: cotacaoId } = await params;
  const body = await req.json().catch(() => ({}));
  const cfId = typeof body?.cotacaoFornecedorId === 'string' ? body.cotacaoFornecedorId : '';
  const itemIds: string[] = Array.isArray(body?.itemIds)
    ? body.itemIds.filter((x: unknown): x is string => typeof x === 'string')
    : [];
  if (!cfId) return NextResponse.json({ error: 'cotacaoFornecedorId obrigatorio' }, { status: 400 });
  if (itemIds.length === 0) return NextResponse.json({ error: 'escolha pelo menos 1 item' }, { status: 400 });

  const [cot] = await db
    .select({ id: schema.cotacao.id, filialId: schema.cotacao.filialId, status: schema.cotacao.status })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, cotacaoId))
    .limit(1);
  if (!cot) return NextResponse.json({ error: 'cotacao nao encontrada' }, { status: 404 });
  if (cot.status === 'CANCELADA') return NextResponse.json({ error: 'cotacao cancelada' }, { status: 400 });

  const [cf] = await db
    .select({ id: schema.cotacaoFornecedor.id, fornecedorId: schema.cotacaoFornecedor.fornecedorId })
    .from(schema.cotacaoFornecedor)
    .where(and(eq(schema.cotacaoFornecedor.id, cfId), eq(schema.cotacaoFornecedor.cotacaoId, cotacaoId)))
    .limit(1);
  if (!cf) return NextResponse.json({ error: 'fornecedor nao convocado nesta cotacao' }, { status: 404 });

  // Respostas COM PREÇO desse fornecedor, só pros itens escolhidos.
  const respostas = await db
    .select({
      respostaId: schema.cotacaoRespostaItem.id,
      cotacaoItemId: schema.cotacaoRespostaItem.cotacaoItemId,
      precoNormalizado: schema.cotacaoRespostaItem.precoUnitarioNormalizado,
      marcaId: schema.cotacaoRespostaItem.marcaId,
      produtoId: schema.cotacaoItem.produtoId,
      produtoNome: schema.produto.nome,
      quantidade: schema.cotacaoItem.quantidade,
      unidade: schema.cotacaoItem.unidade,
      observacao: schema.cotacaoItem.observacao,
    })
    .from(schema.cotacaoRespostaItem)
    .innerJoin(schema.cotacaoItem, eq(schema.cotacaoItem.id, schema.cotacaoRespostaItem.cotacaoItemId))
    .innerJoin(schema.produto, eq(schema.produto.id, schema.cotacaoItem.produtoId))
    .where(
      and(
        eq(schema.cotacaoRespostaItem.cotacaoFornecedorId, cfId),
        inArray(schema.cotacaoRespostaItem.cotacaoItemId, itemIds),
        isNotNull(schema.cotacaoRespostaItem.precoUnitarioNormalizado),
      ),
    );
  if (respostas.length === 0) {
    return NextResponse.json({ error: 'esse fornecedor nao cotou preco nos itens escolhidos' }, { status: 400 });
  }

  // Item já comprado de outro fornecedor NESTA cotação não pode sair de novo —
  // seria a mesma mercadoria paga duas vezes.
  const jaPedidos = await db
    .select({
      produtoId: schema.pedidoCompraItem.produtoId,
      numero: schema.pedidoCompra.numero,
      fornecedorNome: schema.fornecedor.nome,
    })
    .from(schema.pedidoCompraItem)
    .innerJoin(schema.pedidoCompra, eq(schema.pedidoCompra.id, schema.pedidoCompraItem.pedidoCompraId))
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.pedidoCompra.fornecedorId))
    .where(
      and(
        eq(schema.pedidoCompra.cotacaoId, cotacaoId),
        sql`${schema.pedidoCompra.status} <> 'CANCELADO'`,
        inArray(schema.pedidoCompraItem.produtoId, respostas.map((r) => r.produtoId)),
      ),
    );
  if (jaPedidos.length > 0) {
    const lista = jaPedidos
      .map((p) => `${respostas.find((r) => r.produtoId === p.produtoId)?.produtoNome ?? p.produtoId} (pedido #${p.numero}, ${p.fornecedorNome})`)
      .join('; ');
    return NextResponse.json(
      { error: `esses itens já foram pedidos nesta cotação: ${lista}. Cancele o pedido antigo antes.` },
      { status: 409 },
    );
  }

  const linhas = respostas.map((r) => {
    const preco = Number(r.precoNormalizado);
    const qtd = Number(r.quantidade);
    return {
      respostaId: r.respostaId,
      produtoId: r.produtoId,
      quantidade: r.quantidade,
      unidade: r.unidade,
      marcaId: r.marcaId,
      preco,
      total: preco * qtd,
      observacao: r.observacao,
    };
  });
  const totalPedido = linhas.reduce((a, l) => a + l.total, 0);

  const [{ ult }] = await db
    .select({ ult: max(schema.pedidoCompra.numero) })
    .from(schema.pedidoCompra)
    .where(eq(schema.pedidoCompra.filialId, cot.filialId));
  const numero = (ult ?? 0) + 1;

  const [{ pedidoId }] = await db
    .insert(schema.pedidoCompra)
    .values({
      filialId: cot.filialId,
      cotacaoId,
      fornecedorId: cf.fornecedorId,
      numero,
      status: 'GERADO',
      valorTotal: totalPedido.toFixed(2),
      observacao: 'Resposta fora do prazo — pedido gerado à parte da aprovação.',
    })
    .returning({ pedidoId: schema.pedidoCompra.id });

  await db.insert(schema.pedidoCompraItem).values(
    linhas.map((l) => ({
      pedidoCompraId: pedidoId,
      produtoId: l.produtoId,
      respostaVencedoraId: l.respostaId,
      quantidade: l.quantidade,
      unidade: l.unidade,
      marcaId: l.marcaId,
      precoUnitario: l.preco.toFixed(4),
      valorTotal: l.total.toFixed(2),
      observacao: l.observacao,
    })),
  );

  // Marca as respostas como vencedoras dos seus itens só quando o item ainda
  // não tem vencedor (aprovação anterior deixou órfão) — não rouba item de
  // pedido que já saiu.
  for (const l of linhas) {
    await db
      .update(schema.cotacaoItem)
      .set({ respostaVencedoraId: l.respostaId })
      .where(
        and(
          eq(schema.cotacaoItem.cotacaoId, cotacaoId),
          eq(schema.cotacaoItem.produtoId, l.produtoId),
          sql`${schema.cotacaoItem.respostaVencedoraId} IS NULL`,
        ),
      );
  }

  return NextResponse.json({ ok: true, pedidoId, numero, total: totalPedido, itens: linhas.length });
}

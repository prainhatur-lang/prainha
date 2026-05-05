// POST /api/cotacao/[id]/aprovar
// Para cada item da cotacao, seleciona vencedor (menor preco_unitario_normalizado entre
// respostas do fornecedor — sem filtro de marca aceita ainda, pode adicionar depois).
// Gera 1 pedido_compra por fornecedor que ganhou pelo menos 1 item.
// Atualiza cotacao.status = APROVADA, registra cotacao_item.resposta_vencedora_id.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, max } from 'drizzle-orm';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: cotacaoId } = await params;

  const [cot] = await db
    .select()
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, cotacaoId))
    .limit(1);
  if (!cot) return NextResponse.json({ error: 'cotacao nao encontrada' }, { status: 404 });
  if (cot.status === 'APROVADA' || cot.status === 'CONCLUIDA') {
    return NextResponse.json({ error: 'ja aprovada' }, { status: 400 });
  }
  if (cot.status === 'CANCELADA') {
    return NextResponse.json({ error: 'cotacao cancelada' }, { status: 400 });
  }

  // Itens
  const itens = await db
    .select()
    .from(schema.cotacaoItem)
    .where(eq(schema.cotacaoItem.cotacaoId, cotacaoId));

  // Convocacoes (pra mapear cotacao_fornecedor.id -> fornecedor.id)
  const convocacoes = await db
    .select({
      id: schema.cotacaoFornecedor.id,
      fornecedorId: schema.cotacaoFornecedor.fornecedorId,
    })
    .from(schema.cotacaoFornecedor)
    .where(eq(schema.cotacaoFornecedor.cotacaoId, cotacaoId));
  if (convocacoes.length === 0) {
    return NextResponse.json({ error: 'nenhum fornecedor convocado' }, { status: 400 });
  }
  const fornecedorPorCotForn = new Map(convocacoes.map((c) => [c.id, c.fornecedorId]));

  // Respostas
  const respostas = await db
    .select({
      id: schema.cotacaoRespostaItem.id,
      cotacaoFornecedorId: schema.cotacaoRespostaItem.cotacaoFornecedorId,
      cotacaoItemId: schema.cotacaoRespostaItem.cotacaoItemId,
      precoUnitario: schema.cotacaoRespostaItem.precoUnitario,
      precoUnitarioNormalizado: schema.cotacaoRespostaItem.precoUnitarioNormalizado,
      marcaId: schema.cotacaoRespostaItem.marcaId,
    })
    .from(schema.cotacaoRespostaItem)
    .where(
      inArray(
        schema.cotacaoRespostaItem.cotacaoFornecedorId,
        convocacoes.map((c) => c.id),
      ),
    );

  // Pra cada item, escolhe vencedor (menor preco_unitario_normalizado)
  const respostasPorItem = new Map<string, typeof respostas>();
  for (const r of respostas) {
    if (r.precoUnitarioNormalizado == null) continue;
    if (!respostasPorItem.has(r.cotacaoItemId)) respostasPorItem.set(r.cotacaoItemId, []);
    respostasPorItem.get(r.cotacaoItemId)!.push(r);
  }

  // vencedoresPorFornecedor: cotacaoFornecedorId -> [{itemId, respostaId, qtd, unidade, preco, marcaId}]
  const vencedoresPorFornecedor = new Map<
    string,
    Array<{
      itemId: string;
      respostaId: string;
      produtoId: string;
      qtd: string;
      unidade: string;
      preco: number;
      marcaId: string | null;
    }>
  >();

  for (const item of itens) {
    const candidatos = respostasPorItem.get(item.id) ?? [];
    if (candidatos.length === 0) continue;
    const vencedor = candidatos.reduce((min, r) =>
      Number(r.precoUnitarioNormalizado) < Number(min.precoUnitarioNormalizado) ? r : min,
    );

    // Atualiza item com resposta_vencedora_id
    await db
      .update(schema.cotacaoItem)
      .set({ respostaVencedoraId: vencedor.id })
      .where(eq(schema.cotacaoItem.id, item.id));

    if (!vencedoresPorFornecedor.has(vencedor.cotacaoFornecedorId)) {
      vencedoresPorFornecedor.set(vencedor.cotacaoFornecedorId, []);
    }
    vencedoresPorFornecedor.get(vencedor.cotacaoFornecedorId)!.push({
      itemId: item.id,
      respostaId: vencedor.id,
      produtoId: item.produtoId,
      qtd: item.quantidade,
      unidade: item.unidade,
      preco: Number(vencedor.precoUnitarioNormalizado),
      marcaId: vencedor.marcaId,
    });
  }

  // Gera 1 pedido_compra por fornecedor vencedor
  const pedidosCriados: Array<{ id: string; numero: number; fornecedorId: string }> = [];
  for (const [cotFornId, items] of vencedoresPorFornecedor) {
    const fornecedorId = fornecedorPorCotForn.get(cotFornId);
    if (!fornecedorId) continue;

    // Proximo numero do pedido por filial
    const [{ ult }] = await db
      .select({ ult: max(schema.pedidoCompra.numero) })
      .from(schema.pedidoCompra)
      .where(eq(schema.pedidoCompra.filialId, cot.filialId));
    const numero = (ult ?? 0) + 1;

    const valorTotal = items.reduce((acc, it) => acc + it.preco * Number(it.qtd), 0);

    const [{ pedidoId }] = await db
      .insert(schema.pedidoCompra)
      .values({
        filialId: cot.filialId,
        cotacaoId,
        fornecedorId,
        numero,
        status: 'GERADO',
        valorTotal: valorTotal.toFixed(2),
      })
      .returning({ pedidoId: schema.pedidoCompra.id });

    await db.insert(schema.pedidoCompraItem).values(
      items.map((it) => ({
        pedidoCompraId: pedidoId,
        produtoId: it.produtoId,
        respostaVencedoraId: it.respostaId,
        quantidade: it.qtd,
        unidade: it.unidade,
        marcaId: it.marcaId,
        precoUnitario: it.preco.toFixed(4),
        valorTotal: (it.preco * Number(it.qtd)).toFixed(2),
      })),
    );

    pedidosCriados.push({ id: pedidoId, numero, fornecedorId });
  }

  // Atualiza status da cotacao
  await db
    .update(schema.cotacao)
    .set({ status: 'APROVADA', aprovadaEm: new Date(), aprovadaPor: user.id })
    .where(eq(schema.cotacao.id, cotacaoId));

  return NextResponse.json({ ok: true, pedidos: pedidosCriados });
}

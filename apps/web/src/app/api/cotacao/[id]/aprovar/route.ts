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

  // Respostas ordenadas por preco asc (1º, 2º, 3º colocado por item)
  const respostasOrdenadasPorItem = new Map<string, typeof respostas>();
  for (const r of respostas) {
    if (r.precoUnitarioNormalizado == null) continue;
    if (!respostasOrdenadasPorItem.has(r.cotacaoItemId))
      respostasOrdenadasPorItem.set(r.cotacaoItemId, []);
    respostasOrdenadasPorItem.get(r.cotacaoItemId)!.push(r);
  }
  for (const arr of respostasOrdenadasPorItem.values()) {
    arr.sort(
      (a, b) =>
        Number(a.precoUnitarioNormalizado) - Number(b.precoUnitarioNormalizado),
    );
  }

  // Carrega valor minimo de pedido pra cada fornecedor convocado
  const fornecedoresIds = [...new Set(convocacoes.map((c) => c.fornecedorId))];
  const minimosRows = await db
    .select({
      id: schema.fornecedor.id,
      valorPedidoMinimo: schema.fornecedor.valorPedidoMinimo,
    })
    .from(schema.fornecedor)
    .where(inArray(schema.fornecedor.id, fornecedoresIds));
  const minimoPorFornecedor = new Map<string, number>();
  for (const m of minimosRows) {
    if (m.valorPedidoMinimo) minimoPorFornecedor.set(m.id, Number(m.valorPedidoMinimo));
  }

  // Estado: itemId -> indice no array ordenado (0 = vencedor, 1 = 2 colocado, ...)
  const alocacao = new Map<string, number>();
  for (const item of itens) {
    const candidatos = respostasOrdenadasPorItem.get(item.id) ?? [];
    if (candidatos.length > 0) alocacao.set(item.id, 0);
  }

  // Loop: enquanto houver fornecedor cuja soma fica abaixo do minimo, reassign
  // os itens dele pro proximo colocado. Cap em 10 iteracoes pra evitar oscilacao.
  for (let iter = 0; iter < 10; iter++) {
    // Calcula totais por fornecedor com a alocacao atual
    const totaisPorFornecedor = new Map<string, { total: number; itensAlocados: typeof itens }>();
    for (const [itemId, idx] of alocacao) {
      const candidatos = respostasOrdenadasPorItem.get(itemId)!;
      const resp = candidatos[idx];
      const item = itens.find((i) => i.id === itemId)!;
      const fornId = fornecedorPorCotForn.get(resp.cotacaoFornecedorId)!;
      const total = Number(resp.precoUnitarioNormalizado) * Number(item.quantidade);
      if (!totaisPorFornecedor.has(fornId))
        totaisPorFornecedor.set(fornId, { total: 0, itensAlocados: [] });
      const acc = totaisPorFornecedor.get(fornId)!;
      acc.total += total;
      acc.itensAlocados.push(item);
    }

    // Acha primeiro fornecedor que viola minimo
    let mudou = false;
    for (const [fornId, { total, itensAlocados }] of totaisPorFornecedor) {
      const minimo = minimoPorFornecedor.get(fornId);
      if (!minimo || total >= minimo) continue;
      // Reassigna TODOS os itens desse fornecedor pro proximo colocado
      for (const item of itensAlocados) {
        const idxAtual = alocacao.get(item.id)!;
        const candidatos = respostasOrdenadasPorItem.get(item.id)!;
        if (idxAtual + 1 < candidatos.length) {
          alocacao.set(item.id, idxAtual + 1);
        } else {
          // Sem proximo colocado — item fica orfao (nao gera pedido)
          alocacao.delete(item.id);
        }
      }
      mudou = true;
      break; // recalcula totais antes de tentar proximo fornecedor
    }
    if (!mudou) break;
  }

  // Aplica alocacao final: monta vencedoresPorFornecedor
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
  const reassignedLog: Array<{ itemId: string; ranqueOriginal: number; ranqueFinal: number }> = [];
  for (const item of itens) {
    const idxFinal = alocacao.get(item.id);
    if (idxFinal == null) continue; // item sem fornecedor (vai precisar atencao manual)
    const candidatos = respostasOrdenadasPorItem.get(item.id)!;
    const resp = candidatos[idxFinal];
    if (idxFinal > 0) reassignedLog.push({ itemId: item.id, ranqueOriginal: 0, ranqueFinal: idxFinal });

    await db
      .update(schema.cotacaoItem)
      .set({ respostaVencedoraId: resp.id })
      .where(eq(schema.cotacaoItem.id, item.id));

    if (!vencedoresPorFornecedor.has(resp.cotacaoFornecedorId))
      vencedoresPorFornecedor.set(resp.cotacaoFornecedorId, []);
    vencedoresPorFornecedor.get(resp.cotacaoFornecedorId)!.push({
      itemId: item.id,
      respostaId: resp.id,
      produtoId: item.produtoId,
      qtd: item.quantidade,
      unidade: item.unidade,
      preco: Number(resp.precoUnitarioNormalizado),
      marcaId: resp.marcaId,
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

  return NextResponse.json({
    ok: true,
    pedidos: pedidosCriados,
    reassigned: reassignedLog.length,
    detalheReassign: reassignedLog,
  });
}

// Pagina publica do PEDIDO DE COMPRA (sem login), aberta pelo fornecedor pelo
// link que vai na mensagem do pedido: /cotacao/preencher/pedido/[id]
//
// Existe porque a mensagem de modelo da Meta tem teto de 1024 caracteres: em
// pedido grande a lista nao cabe (pedido 59 da Mega, 09/10) e, em vez de cortar
// item ou observacao, a mensagem leva este link com o pedido inteiro.
// Fica debaixo de /cotacao/preencher/ porque esse prefixo ja e publico no proxy.
// So leitura; o id e um uuid (o mesmo que ja vai nos botoes da mensagem).

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { asc, eq, sql } from 'drizzle-orm';
import { dadosFaturamentoTexto } from '@/lib/dados-faturamento';
import { condicaoPagamentoTexto } from '@/lib/pedido-encomenda';

export const dynamic = 'force-dynamic';

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default async function PedidoCompraPublicoPage(props: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await props.params;
  // Botao de URL dinamica da Meta pode anexar a variavel ("{{1}}<id>").
  const id = decodeURIComponent(rawId).replace(/^(\{\{\d+\}\})+/, '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const [p] = await db
    .select({
      numero: schema.pedidoCompra.numero,
      status: schema.pedidoCompra.status,
      valorTotal: schema.pedidoCompra.valorTotal,
      observacao: schema.pedidoCompra.observacao,
      valorFrete: schema.pedidoCompra.valorFrete,
      valorDesconto: schema.pedidoCompra.valorDesconto,
      referencia: schema.pedidoCompra.referencia,
      criadoEm: schema.pedidoCompra.criadoEm,
      filialId: schema.pedidoCompra.filialId,
      filialNome: schema.filial.nome,
      fornecedorNome: schema.fornecedor.nome,
    })
    .from(schema.pedidoCompra)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.pedidoCompra.filialId))
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.pedidoCompra.fornecedorId))
    .where(eq(schema.pedidoCompra.id, id))
    .limit(1);
  if (!p) notFound();

  const itens = await db
    .select({
      id: schema.pedidoCompraItem.id,
      quantidade: schema.pedidoCompraItem.quantidade,
      unidade: schema.pedidoCompraItem.unidade,
      precoUnitario: schema.pedidoCompraItem.precoUnitario,
      valorTotal: schema.pedidoCompraItem.valorTotal,
      observacao: schema.pedidoCompraItem.observacao,
      produtoNome: sql<string>`coalesce(${schema.produto.nome}, ${schema.pedidoCompraItem.descricao}, 'item')`,
    })
    .from(schema.pedidoCompraItem)
    .leftJoin(schema.produto, eq(schema.produto.id, schema.pedidoCompraItem.produtoId))
    .where(eq(schema.pedidoCompraItem.pedidoCompraId, id))
    .orderBy(asc(sql<string>`coalesce(${schema.produto.nome}, ${schema.pedidoCompraItem.descricao}, 'item')`));

  const faturamento = await dadosFaturamentoTexto(p.filialId).catch(() => null);
  const pagamento = await condicaoPagamentoTexto(id).catch(() => null);
  const frete = Number(p.valorFrete ?? 0);
  const desconto = Number(p.valorDesconto ?? 0);
  const cancelado = p.status === 'CANCELADO';
  const data = p.criadoEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-white px-4 py-6 text-slate-900">
      <p className="text-sm text-slate-500">{p.filialNome}</p>
      <h1 className="text-2xl font-bold">Pedido de compra nº {p.numero}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {p.fornecedorNome} · {data}
        {p.referencia && <> · orçamento nº {p.referencia}</>}
      </p>
      {cancelado && (
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
          Este pedido foi cancelado.
        </p>
      )}

      {/* Regra do dono (09/10): o preço do pedido é o que se paga, sem acréscimo na nota. */}
      <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
        Os preços deste pedido são PREÇO FINAL, já com todos os impostos. A nota deve sair com estes valores.
      </p>

      <ul className="mt-5 divide-y divide-slate-200 rounded-xl border border-slate-200">
        {itens.map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-3">
            <div className="min-w-0">
              <p className="font-medium">{i.produtoNome}</p>
              <p className="text-sm text-slate-600">
                {Number(i.quantidade).toLocaleString('pt-BR')} {i.unidade} × {brl(Number(i.precoUnitario))}
              </p>
              {i.observacao && <p className="mt-0.5 text-sm text-slate-500">{i.observacao}</p>}
            </div>
            <p className="shrink-0 font-semibold tabular-nums">{brl(Number(i.valorTotal))}</p>
          </li>
        ))}
      </ul>

      {(frete > 0 || desconto > 0) && (
        <div className="mt-3 space-y-1 px-3 text-sm text-slate-600">
          {frete > 0 && (
            <p className="flex justify-between">
              <span>Frete</span>
              <span className="tabular-nums">{brl(frete)}</span>
            </p>
          )}
          {desconto > 0 && (
            <p className="flex justify-between">
              <span>Desconto</span>
              <span className="tabular-nums">−{brl(desconto)}</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-100 px-3 py-3">
        <span className="font-semibold">
          Total ({itens.length} {itens.length === 1 ? 'item' : 'itens'})
        </span>
        <span className="text-lg font-bold tabular-nums">
          {p.valorTotal != null ? brl(Number(p.valorTotal)) : '—'}
        </span>
      </div>

      {pagamento && (
        <p className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm font-medium text-emerald-900">
          {pagamento}
        </p>
      )}

      {p.observacao && (
        <p className="mt-4 whitespace-pre-line rounded-xl border border-slate-200 px-3 py-3 text-sm">{p.observacao}</p>
      )}

      {faturamento && (
        <p className="mt-4 whitespace-pre-line rounded-xl border border-slate-200 px-3 py-3 text-sm">{faturamento}</p>
      )}

      <p className="mt-6 text-center text-xs text-slate-400">
        Dúvidas? Responda a mensagem do pedido no WhatsApp.
      </p>
    </main>
  );
}

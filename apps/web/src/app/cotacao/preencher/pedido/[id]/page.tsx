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
import { asc, eq } from 'drizzle-orm';
import { dadosFaturamentoTexto } from '@/lib/dados-faturamento';

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
      produtoNome: schema.produto.nome,
    })
    .from(schema.pedidoCompraItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.pedidoCompraItem.produtoId))
    .where(eq(schema.pedidoCompraItem.pedidoCompraId, id))
    .orderBy(asc(schema.produto.nome));

  const faturamento = await dadosFaturamentoTexto(p.filialId).catch(() => null);
  const cancelado = p.status === 'CANCELADO';
  const data = p.criadoEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-white px-4 py-6 text-slate-900">
      <p className="text-sm text-slate-500">{p.filialNome}</p>
      <h1 className="text-2xl font-bold">Pedido de compra nº {p.numero}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {p.fornecedorNome} · {data}
      </p>
      {cancelado && (
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
          Este pedido foi cancelado.
        </p>
      )}

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

      <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-100 px-3 py-3">
        <span className="font-semibold">
          Total ({itens.length} {itens.length === 1 ? 'item' : 'itens'})
        </span>
        <span className="text-lg font-bold tabular-nums">
          {p.valorTotal != null ? brl(Number(p.valorTotal)) : '—'}
        </span>
      </div>

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

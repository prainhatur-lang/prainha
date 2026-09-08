import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, count, desc, eq, gte, isNull, lte, sql, sum, ne } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDateTime, int } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  dataIni?: string;
  dataFim?: string;
  page?: string;
}

const PAGE_SIZE = 100;

export default async function PedidosPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
   await exigirPerm(user.id, 'conciliacao.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    await escolherFilial(filiais, sp.filialId);
  const dataIni = sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(7);
  const dataFim = sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim) ? sp.dataFim : hojeBr();
  const page = Math.max(0, Number(sp.page ?? '0') || 0);

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const dtIni = new Date(dataIni + 'T00:00:00-03:00');
  const dtFim = new Date(dataFim + 'T23:59:59-03:00');

  const where = and(
    eq(schema.pedido.filialId, filialSelecionada.id),
    isNull(schema.pedido.dataDelete),
    gte(schema.pedido.dataFechamento, dtIni),
    lte(schema.pedido.dataFechamento, dtFim),
  );

  const [stats] = await db
    .select({
      qtd: count(),
      total: sum(schema.pedido.valorTotal),
      totalItens: sum(schema.pedido.valorTotalItens),
      totalServico: sum(schema.pedido.totalServico),
      totalDesconto: sum(schema.pedido.totalDesconto),
    })
    .from(schema.pedido)
    .where(where);

  const pedidos = await db
    .select({
      id: schema.pedido.id,
      codigoExterno: schema.pedido.codigoExterno,
      numero: schema.pedido.numero,
      dataAbertura: schema.pedido.dataAbertura,
      dataFechamento: schema.pedido.dataFechamento,
      nomeCliente: schema.pedido.nomeCliente,
      valorTotal: schema.pedido.valorTotal,
      valorTotalItens: schema.pedido.valorTotalItens,
      totalServico: schema.pedido.totalServico,
      totalDesconto: schema.pedido.totalDesconto,
      valorEntrega: schema.pedido.valorEntrega,
      quantidadePessoas: schema.pedido.quantidadePessoas,
      notaEmitida: schema.pedido.notaEmitida,
      tag: schema.pedido.tag,
    })
    .from(schema.pedido)
    .where(where)
    .orderBy(desc(schema.pedido.dataFechamento))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  // Top produtos no período (valor, volume, margem)
  const whereItens = and(
    eq(schema.pedido.filialId, filialSelecionada.id),
    isNull(schema.pedidoItem.dataDelete),
    isNull(schema.pedido.dataDelete),
    gte(schema.pedido.dataFechamento, dtIni),
    lte(schema.pedido.dataFechamento, dtFim),
    ne(schema.pedidoItem.codigoItemPedidoTipo, 4), // exclui cortesia se for esse codigo
  );

  const valorProdutoSum = sql<number>`COALESCE(SUM(${schema.pedidoItem.valorTotal}), 0)`;
  const topProdutos = await db
    .select({
      nome: schema.pedidoItem.nomeProduto,
      qtd: sql<string>`COALESCE(SUM(${schema.pedidoItem.quantidade}), 0)::text`,
      valor: sql<string>`${valorProdutoSum}::text`,
    })
    .from(schema.pedidoItem)
    .innerJoin(schema.pedido, eq(schema.pedido.id, schema.pedidoItem.pedidoId))
    .where(whereItens)
    .groupBy(schema.pedidoItem.nomeProduto)
    .orderBy(desc(valorProdutoSum))
    .limit(10);

  const volumeProdutoSum = sql<number>`COALESCE(SUM(${schema.pedidoItem.quantidade}), 0)`;
  const topVolume = await db
    .select({
      nome: schema.pedidoItem.nomeProduto,
      qtd: sql<string>`${volumeProdutoSum}::text`,
      valor: sql<string>`COALESCE(SUM(${schema.pedidoItem.valorTotal}), 0)::text`,
    })
    .from(schema.pedidoItem)
    .innerJoin(schema.pedido, eq(schema.pedido.id, schema.pedidoItem.pedidoId))
    .where(whereItens)
    .groupBy(schema.pedidoItem.nomeProduto)
    .orderBy(desc(volumeProdutoSum))
    .limit(10);

  // Margem só é calculável pra produtos com preco_custo cadastrado — nem todo
  // produto tem (ver cobertura abaixo). Item sem custo fica de fora do ranking
  // em vez de contar a receita cheia como "margem" (enganoso).
  const margemProdutoSum = sql<number>`COALESCE(SUM(${schema.pedidoItem.valorTotal} - ${schema.pedidoItem.quantidade} * ${schema.produto.precoCusto}), 0)`;
  const topMargem = await db
    .select({
      nome: schema.pedidoItem.nomeProduto,
      qtd: sql<string>`COALESCE(SUM(${schema.pedidoItem.quantidade}), 0)::text`,
      margem: sql<string>`${margemProdutoSum}::text`,
    })
    .from(schema.pedidoItem)
    .innerJoin(schema.pedido, eq(schema.pedido.id, schema.pedidoItem.pedidoId))
    .innerJoin(schema.produto, eq(schema.produto.id, schema.pedidoItem.produtoId))
    .where(
      and(
        whereItens,
        sql`${schema.produto.precoCusto} IS NOT NULL AND ${schema.produto.precoCusto} > 0`,
      ),
    )
    .groupBy(schema.pedidoItem.nomeProduto)
    .orderBy(desc(margemProdutoSum))
    .limit(10);

  const [coberturaCusto] = await db
    .select({
      totalItens: count(),
      comCusto: sql<string>`COUNT(*) FILTER (WHERE ${schema.produto.precoCusto} IS NOT NULL AND ${schema.produto.precoCusto} > 0)`,
    })
    .from(schema.pedidoItem)
    .innerJoin(schema.pedido, eq(schema.pedido.id, schema.pedidoItem.pedidoId))
    .leftJoin(schema.produto, eq(schema.produto.id, schema.pedidoItem.produtoId))
    .where(whereItens);

  // Estoque baixo: mesma condição usada em /compras/sugestao (produto próprio
  // controla estoque, entra no fluxo de compras e está no ou abaixo do mínimo).
  const estoqueBaixo = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      categoria: schema.produto.categoriaCompras,
      unidade: schema.produto.unidadeEstoque,
      atual: schema.produto.estoqueAtual,
      minimo: schema.produto.estoqueMinimo,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filialSelecionada.id),
        eq(schema.produto.controlaEstoque, true),
        sql`${schema.produto.categoriaCompras} IS NOT NULL`,
        sql`${schema.produto.estoqueMinimo} IS NOT NULL`,
        sql`${schema.produto.estoqueAtual} <= ${schema.produto.estoqueMinimo}`,
        sql`COALESCE(${schema.produto.descontinuado}, false) = false`,
      ),
    )
    .orderBy(sql`(${schema.produto.estoqueMinimo} - ${schema.produto.estoqueAtual}) DESC`)
    .limit(15);

  const totalPag = Math.max(1, Math.ceil(Number(stats?.qtd ?? 0) / PAGE_SIZE));
  const ticketMedio = Number(stats?.qtd ?? 0) > 0
    ? Number(stats?.total ?? 0) / Number(stats?.qtd ?? 0)
    : 0;

  const hrefPag = (p: number) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    if (dataIni) qs.set('dataIni', dataIni);
    if (dataFim) qs.set('dataFim', dataFim);
    if (p > 0) qs.set('page', String(p));
    return `/movimento/pedidos?${qs.toString()}`;
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Pedidos / Vendas</h1>
        <p className="mt-1 text-sm text-slate-600">
          Histórico de pedidos do PDV na {filialSelecionada.nome}.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/movimento/pedidos?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === filialSelecionada.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        <form method="GET" className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="filialId" value={filialSelecionada.id} />
          <label className="text-xs text-slate-600">
            De
            <input
              type="date"
              name="dataIni"
              defaultValue={dataIni}
              className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Até
            <input
              type="date"
              name="dataFim"
              defaultValue={dataFim}
              className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Filtrar
          </button>
        </form>

        {/* KPIs */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Pedidos
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{int(Number(stats?.qtd ?? 0))}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
              Faturamento
            </p>
            <p className="mt-1 text-2xl font-bold text-emerald-900">{brl(Number(stats?.total ?? 0))}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Ticket médio
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{brl(ticketMedio)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Gorjetas
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{brl(Number(stats?.totalServico ?? 0))}</p>
          </div>
        </div>

        {/* Top produtos: valor, volume, margem */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {topProdutos.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Top produtos · valor</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Produto</th>
                    <th className="px-4 py-2 text-right w-16">Qtd</th>
                    <th className="px-4 py-2 text-right w-28">Faturado</th>
                  </tr>
                </thead>
                <tbody>
                  {topProdutos.map((t, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-xs text-slate-800">{t.nome ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {Number(t.qtd).toFixed(Number(t.qtd) % 1 === 0 ? 0 : 2)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-medium text-slate-900">
                        {brl(Number(t.valor))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {topVolume.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Top produtos · volume</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Produto</th>
                    <th className="px-4 py-2 text-right w-16">Qtd</th>
                    <th className="px-4 py-2 text-right w-28">Faturado</th>
                  </tr>
                </thead>
                <tbody>
                  {topVolume.map((t, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-xs text-slate-800">{t.nome ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {Number(t.qtd).toFixed(Number(t.qtd) % 1 === 0 ? 0 : 2)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-medium text-slate-900">
                        {brl(Number(t.valor))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Top produtos · margem</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Considera só itens com custo cadastrado ({int(Number(coberturaCusto?.comCusto ?? 0))} de{' '}
                {int(Number(coberturaCusto?.totalItens ?? 0))} itens no período).
              </p>
            </div>
            {topMargem.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Produto</th>
                    <th className="px-4 py-2 text-right w-16">Qtd</th>
                    <th className="px-4 py-2 text-right w-28">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {topMargem.map((t, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-xs text-slate-800">{t.nome ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {Number(t.qtd).toFixed(Number(t.qtd) % 1 === 0 ? 0 : 2)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-medium text-slate-900">
                        {brl(Number(t.margem))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-center text-xs text-slate-500">
                Nenhum produto com custo cadastrado no período.
              </p>
            )}
          </div>
        </div>

        {/* Estoque baixo */}
        <div className="mt-6 overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Estoque baixo</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Produtos controlados que estão no ou abaixo do estoque mínimo — mesmo critério da sugestão de compra.
              </p>
            </div>
            <Link
              href={`/compras/sugestao?filialId=${filialSelecionada.id}`}
              className="whitespace-nowrap rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50"
            >
              Ver sugestão de compra →
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Produto</th>
                <th className="px-4 py-2">Categoria</th>
                <th className="px-4 py-2 text-right">Atual</th>
                <th className="px-4 py-2 text-right">Mínimo</th>
                <th className="px-4 py-2">Un.</th>
              </tr>
            </thead>
            <tbody>
              {estoqueBaixo.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-slate-500">
                    Nenhum produto abaixo do mínimo. 🎉
                  </td>
                </tr>
              ) : (
                estoqueBaixo.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-xs text-slate-800">{p.nome ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{p.categoria ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-rose-600">
                      {Number(p.atual ?? 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                      {Number(p.minimo ?? 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{p.unidade}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Lista pedidos */}
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Pedidos do período</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Fechamento</th>
                <th className="px-4 py-2">Nº</th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Pessoas</th>
                <th className="px-4 py-2 text-right">Itens</th>
                <th className="px-4 py-2 text-right">Serviço</th>
                <th className="px-4 py-2 text-right">Desconto</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">NF</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-xs text-slate-500">
                    Nenhum pedido no período.
                  </td>
                </tr>
              ) : (
                pedidos.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">
                      {formatDateTime(p.dataFechamento)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      <Link
                        href={`/movimento/pedidos/${p.id}`}
                        className="font-semibold text-sky-700 underline-offset-2 hover:underline"
                        title="Abrir o espelho do pedido — itens, tempos, cancelamentos e pagamentos"
                      >
                        #{p.codigoExterno}
                      </Link>
                      {p.numero != null && (
                        <span className="ml-1.5 text-[10px] text-slate-400">mesa {p.numero}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-700">
                      {p.nomeCliente ?? <span className="text-slate-400">—</span>}
                      {p.tag && <span className="ml-1 text-[10px] text-slate-400">[{p.tag}]</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                      {p.quantidadePessoas ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                      {brl(p.valorTotalItens)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-500">
                      {brl(p.totalServico)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-rose-600">
                      {Number(p.totalDesconto ?? 0) > 0 ? `-${brl(p.totalDesconto)}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
                      {brl(p.valorTotal)}
                    </td>
                    <td className="px-4 py-2">
                      {p.notaEmitida ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                          ✓ NFC-e
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {totalPag > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs">
              <span className="text-slate-600">
                Página {page + 1} de {totalPag} · {int(Number(stats?.qtd ?? 0))} pedidos
              </span>
              <div className="flex gap-2">
                {page > 0 ? (
                  <Link href={hrefPag(page - 1)} className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-white">
                    ← Anterior
                  </Link>
                ) : (
                  <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">← Anterior</span>
                )}
                {page < totalPag - 1 ? (
                  <Link href={hrefPag(page + 1)} className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-white">
                    Próxima →
                  </Link>
                ) : (
                  <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">Próxima →</span>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, maskCnpj } from '@/lib/format';
import { ItemRow } from './item-row';
import { BotoesCabecalho } from './botoes-cabecalho';

export const dynamic = 'force-dynamic';

export default async function NotaDetalhePage(props: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [nota] = await db
    .select()
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!nota) notFound();

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, nota.filialId),
      ),
    )
    .limit(1);
  if (!link) notFound();

  const itens = await db
    .select({
      id: schema.notaCompraItem.id,
      numeroItem: schema.notaCompraItem.numeroItem,
      codigoProdutoFornecedor: schema.notaCompraItem.codigoProdutoFornecedor,
      ean: schema.notaCompraItem.ean,
      descricao: schema.notaCompraItem.descricao,
      unidade: schema.notaCompraItem.unidade,
      quantidade: schema.notaCompraItem.quantidade,
      valorUnitario: schema.notaCompraItem.valorUnitario,
      valorTotal: schema.notaCompraItem.valorTotal,
      produtoId: schema.notaCompraItem.produtoId,
      produtoNome: schema.produto.nome,
      produtoTipo: schema.produto.tipo,
      produtoUnidade: schema.produto.unidadeEstoque,
      // Vinculo fornecedor↔produto pra exibir/editar o fator de conversao.
      // Se a nota tem fornecedorId E o item esta vinculado ao produto, o leftJoin
      // pega o fator atual; senao, vem null e a UI mostra o default.
      produtoFornecedorId: schema.produtoFornecedor.id,
      fatorConversao: schema.produtoFornecedor.fatorConversao,
    })
    .from(schema.notaCompraItem)
    .leftJoin(schema.produto, eq(schema.produto.id, schema.notaCompraItem.produtoId))
    .leftJoin(
      schema.produtoFornecedor,
      and(
        eq(schema.produtoFornecedor.produtoId, schema.notaCompraItem.produtoId),
        nota.fornecedorId
          ? eq(schema.produtoFornecedor.fornecedorId, nota.fornecedorId)
          : sql`false`,
      ),
    )
    .where(eq(schema.notaCompraItem.notaCompraId, id))
    .orderBy(asc(schema.notaCompraItem.numeroItem));

  // Detecta quais itens já foram lançados no estoque (movimento_estoque)
  const itensLancadosRows = await db
    .select({ itemId: schema.movimentoEstoque.notaCompraItemId })
    .from(schema.movimentoEstoque)
    .where(
      and(
        eq(schema.movimentoEstoque.filialId, nota.filialId),
        sql`${schema.movimentoEstoque.notaCompraItemId} IN (
          SELECT id FROM ${schema.notaCompraItem} WHERE ${schema.notaCompraItem.notaCompraId} = ${id}
        )`,
      ),
    );
  const idsLancados = new Set(itensLancadosRows.map((r) => r.itemId).filter(Boolean) as string[]);

  // Produtos disponíveis pra vincular (mesma filial)
  const produtosDisponiveis = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      tipo: schema.produto.tipo,
      unidade: schema.produto.unidadeEstoque,
      codigoPersonalizado: schema.produto.codigoPersonalizado,
    })
    .from(schema.produto)
    .where(eq(schema.produto.filialId, nota.filialId))
    .orderBy(asc(schema.produto.nome))
    .limit(5000);

  const totalItens = itens.length;
  const mapeados = itens.filter((i) => i.produtoId).length;
  const lancados = itens.filter((i) => idsLancados.has(i.id)).length;
  const progresso = totalItens > 0 ? (mapeados / totalItens) * 100 : 0;
  const todosLancados = lancados === totalItens && totalItens > 0;
  const algumLancado = lancados > 0;

  // Fator de rateio: distribui frete/outros/desconto pelos itens
  const valorTotalNota = Number(nota.valorTotal ?? 0);
  const valorProdutos = Number(nota.valorProdutos ?? 0);
  const valorFrete = Number(nota.valorFrete ?? 0);
  const valorSeguro = Number(nota.valorSeguro ?? 0);
  const valorOutros = Number(nota.valorOutros ?? 0);
  const valorDesconto = Number(nota.valorDesconto ?? 0);
  const totalDespesas = valorFrete + valorSeguro + valorOutros - valorDesconto;
  const fatorRateio =
    valorProdutos > 0 && valorTotalNota > 0 ? valorTotalNota / valorProdutos : 1;
  const temRateio = Math.abs(fatorRateio - 1) > 0.0001;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <nav className="text-xs text-slate-500">
          <Link href="/movimento/entrada-notas" className="hover:text-slate-800">
            ← Notas de entrada
          </Link>
        </nav>

        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {nota.emitNome ?? '(sem emissor)'}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span>
                NFe nº{' '}
                <span className="font-mono text-slate-900">
                  {nota.numero ?? '—'}/{nota.serie ?? '—'}
                </span>
              </span>
              {nota.emitCnpj && (
                <span>
                  CNPJ <span className="font-mono">{maskCnpj(nota.emitCnpj)}</span>
                </span>
              )}
              {nota.dataEmissao && (
                <span>
                  Emissão{' '}
                  <span className="font-mono">
                    {new Date(nota.dataEmissao).toLocaleDateString('pt-BR')}
                  </span>
                </span>
              )}
              <span>
                Total <span className="font-mono font-semibold">{brl(nota.valorTotal)}</span>
              </span>
              {nota.situacao && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    nota.situacao === 'AUTORIZADA'
                      ? 'bg-emerald-100 text-emerald-800'
                      : nota.situacao === 'CANCELADA' || nota.situacao === 'DENEGADA'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {nota.situacao}
                </span>
              )}
            </div>
            <div className="mt-1 font-mono text-[10px] text-slate-400">{nota.chave}</div>
          </div>
          <BotoesCabecalho
            notaId={id}
            totalItens={totalItens}
            mapeados={mapeados}
            lancados={lancados}
            canLancar={mapeados > 0 && !todosLancados && nota.situacao !== 'CANCELADA' && nota.situacao !== 'DENEGADA'}
          />
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Itens
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{totalItens}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Vinculados
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {mapeados}{' '}
              <span className="text-sm font-normal text-slate-500">
                ({progresso.toFixed(0)}%)
              </span>
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${progresso}%` }}
              />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Lançados no estoque
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {lancados}
              {todosLancados && (
                <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
                  ✓ Tudo lançado
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Breakdown de valores e fator de rateio */}
        {(temRateio || valorFrete > 0 || valorDesconto > 0) && (
          <div className="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-4">
            <h3 className="text-sm font-semibold text-sky-900">
              Composição do custo
            </h3>
            <p className="mt-0.5 text-[11px] text-sky-800">
              Frete e outras despesas são rateados proporcionalmente pelos itens
              ao lançar no estoque. O custo médio (MPM) do produto absorve essa
              distribuição automaticamente.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-sky-700">
                  Produtos
                </p>
                <p className="mt-0.5 font-mono font-semibold text-slate-900">
                  {brl(valorProdutos)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-sky-700">
                  Frete + outros
                </p>
                <p className="mt-0.5 font-mono font-semibold text-slate-900">
                  {brl(totalDespesas)}
                </p>
                {(valorFrete > 0 || valorSeguro > 0 || valorOutros > 0 || valorDesconto > 0) && (
                  <p className="mt-0.5 text-[9px] text-slate-500">
                    {valorFrete > 0 && `frete ${brl(valorFrete)} · `}
                    {valorSeguro > 0 && `seguro ${brl(valorSeguro)} · `}
                    {valorOutros > 0 && `outros ${brl(valorOutros)} · `}
                    {valorDesconto > 0 && `−desconto ${brl(valorDesconto)}`}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-sky-700">
                  Total NFe
                </p>
                <p className="mt-0.5 font-mono font-semibold text-slate-900">
                  {brl(valorTotalNota)}
                </p>
              </div>
              <div>
                <p
                  className="text-[10px] font-medium uppercase tracking-wide text-sky-700"
                  title="Multiplicador aplicado ao valor de cada item pra incluir o frete proporcionalmente"
                >
                  Fator de rateio
                </p>
                <p className="mt-0.5 font-mono font-semibold text-slate-900">
                  ×{fatorRateio.toFixed(4)}
                </p>
                <p className="mt-0.5 text-[9px] text-slate-500">
                  +{((fatorRateio - 1) * 100).toFixed(2)}% no custo
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Código forn.</th>
                <th className="px-3 py-2">EAN</th>
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2 text-right">Qtd</th>
                <th className="px-3 py-2">Un</th>
                <th className="px-3 py-2 text-right">Unit.</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Produto interno</th>
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-xs text-slate-500">
                    Nota sem itens detalhados.
                  </td>
                </tr>
              ) : (
                itens.map((it) => (
                  <ItemRow
                    key={it.id}
                    item={{
                      id: it.id,
                      numeroItem: it.numeroItem,
                      codigoProdutoFornecedor: it.codigoProdutoFornecedor,
                      ean: it.ean,
                      descricao: it.descricao,
                      unidade: it.unidade,
                      quantidade: it.quantidade,
                      valorUnitario: it.valorUnitario,
                      valorTotal: it.valorTotal,
                      produtoId: it.produtoId,
                      produtoNome: it.produtoNome,
                      produtoTipo: it.produtoTipo,
                      produtoUnidade: it.produtoUnidade,
                      produtoFornecedorId: it.produtoFornecedorId,
                      fatorConversao: it.fatorConversao,
                      lancado: idsLancados.has(it.id),
                    }}
                    produtosDisponiveis={produtosDisponiveis.map((p) => ({
                      id: p.id,
                      nome: p.nome ?? '(sem nome)',
                      tipo: p.tipo,
                      unidade: p.unidade,
                      codigo: p.codigoPersonalizado,
                    }))}
                    filialId={nota.filialId}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {algumLancado && !todosLancados && (
          <p className="mt-3 text-xs text-slate-500">
            Alguns itens já foram lançados (linhas cinzas). Relance para trazer os que faltam —
            a API pula itens já lançados automaticamente.
          </p>
        )}
      </section>
    </main>
  );
}

// Auditoria completa de movimentos de estoque.
// Filtros: produto, tipo, período. Mostra timeline com saldo acumulado.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  produtoId?: string;
  tipo?: string;
  dataIni?: string;
  dataFim?: string;
  page?: string;
}

const PAGE_SIZE = 100;

const TIPOS_FILTRO = [
  { v: '', l: 'Todos' },
  { v: 'ENTRADA_COMPRA', l: 'Entrada (NFe)' },
  { v: 'SAIDA_VENDA', l: 'Saída (venda direta)' },
  { v: 'SAIDA_FICHA_TECNICA', l: 'Saída (ficha técnica)' },
  { v: 'ENTRADA_PRODUCAO', l: 'Entrada (produção)' },
  { v: 'SAIDA_PRODUCAO', l: 'Saída (produção)' },
  { v: 'ENTRADA_DEVOLUCAO', l: 'Entrada (estorno)' },
  { v: 'SAIDA_DEVOLUCAO', l: 'Saída (devolução)' },
  { v: 'ENTRADA_AJUSTE', l: 'Entrada (ajuste)' },
  { v: 'SAIDA_AJUSTE', l: 'Saída (ajuste)' },
  { v: 'PERDA', l: 'Perda' },
];

const COR_TIPO: Record<string, string> = {
  ENTRADA_COMPRA: 'bg-emerald-100 text-emerald-800',
  SAIDA_VENDA: 'bg-rose-100 text-rose-800',
  SAIDA_FICHA_TECNICA: 'bg-rose-50 text-rose-700',
  ENTRADA_PRODUCAO: 'bg-emerald-50 text-emerald-700',
  SAIDA_PRODUCAO: 'bg-amber-50 text-amber-700',
  ENTRADA_DEVOLUCAO: 'bg-sky-100 text-sky-800',
  SAIDA_DEVOLUCAO: 'bg-rose-50 text-rose-600',
  ENTRADA_AJUSTE: 'bg-violet-100 text-violet-800',
  SAIDA_AJUSTE: 'bg-violet-50 text-violet-700',
  PERDA: 'bg-rose-200 text-rose-900',
};

export default async function MovimentosEstoquePage(props: {
  searchParams: Promise<SP>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;
  const produtoIdFiltro = (sp.produtoId ?? '').trim();
  const tipoFiltro = (sp.tipo ?? '').trim();
  const dataIni =
    sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(30);
  const dataFim =
    sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim) ? sp.dataFim : hojeBr();
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
    eq(schema.movimentoEstoque.filialId, filialSelecionada.id),
    gte(schema.movimentoEstoque.dataHora, dtIni),
    lte(schema.movimentoEstoque.dataHora, dtFim),
    produtoIdFiltro && /^[0-9a-f-]{36}$/i.test(produtoIdFiltro)
      ? eq(schema.movimentoEstoque.produtoId, produtoIdFiltro)
      : undefined,
    tipoFiltro ? eq(schema.movimentoEstoque.tipo, tipoFiltro) : undefined,
  );

  // KPIs do período: entradas, saídas, valor liquido
  const [kpis] = await db.execute<{
    qtd: number;
    entradas: string;
    saidas: string;
    valor_entradas: string;
    valor_saidas: string;
  }>(sql`
    SELECT
      COUNT(*)::int AS qtd,
      COALESCE(SUM(CASE WHEN ${schema.movimentoEstoque.quantidade} > 0 THEN ${schema.movimentoEstoque.quantidade} ELSE 0 END), 0)::text AS entradas,
      COALESCE(SUM(CASE WHEN ${schema.movimentoEstoque.quantidade} < 0 THEN -${schema.movimentoEstoque.quantidade} ELSE 0 END), 0)::text AS saidas,
      COALESCE(SUM(CASE WHEN ${schema.movimentoEstoque.quantidade} > 0 THEN ${schema.movimentoEstoque.valorTotal} ELSE 0 END), 0)::text AS valor_entradas,
      COALESCE(SUM(CASE WHEN ${schema.movimentoEstoque.quantidade} < 0 THEN ${schema.movimentoEstoque.valorTotal} ELSE 0 END), 0)::text AS valor_saidas
    FROM ${schema.movimentoEstoque}
    WHERE ${schema.movimentoEstoque.filialId} = ${filialSelecionada.id}
      AND ${schema.movimentoEstoque.dataHora} >= ${dtIni.toISOString()}
      AND ${schema.movimentoEstoque.dataHora} <= ${dtFim.toISOString()}
      ${produtoIdFiltro && /^[0-9a-f-]{36}$/i.test(produtoIdFiltro) ? sql`AND ${schema.movimentoEstoque.produtoId} = ${produtoIdFiltro}` : sql``}
      ${tipoFiltro ? sql`AND ${schema.movimentoEstoque.tipo} = ${tipoFiltro}` : sql``}
  `);

  // Lista de movimentos
  const movimentos = await db
    .select({
      id: schema.movimentoEstoque.id,
      produtoId: schema.movimentoEstoque.produtoId,
      produtoNome: schema.produto.nome,
      produtoUnidade: schema.produto.unidadeEstoque,
      tipo: schema.movimentoEstoque.tipo,
      quantidade: schema.movimentoEstoque.quantidade,
      precoUnitario: schema.movimentoEstoque.precoUnitario,
      valorTotal: schema.movimentoEstoque.valorTotal,
      dataHora: schema.movimentoEstoque.dataHora,
      notaCompraItemId: schema.movimentoEstoque.notaCompraItemId,
      pedidoItemId: schema.movimentoEstoque.pedidoItemId,
      ordemProducaoId: schema.movimentoEstoque.ordemProducaoId,
      observacao: schema.movimentoEstoque.observacao,
      pedidoCodigo: schema.pedidoItem.codigoPedidoExterno,
      notaCompraId: schema.notaCompraItem.notaCompraId,
    })
    .from(schema.movimentoEstoque)
    .leftJoin(schema.produto, eq(schema.produto.id, schema.movimentoEstoque.produtoId))
    .leftJoin(
      schema.pedidoItem,
      eq(schema.pedidoItem.id, schema.movimentoEstoque.pedidoItemId),
    )
    .leftJoin(
      schema.notaCompraItem,
      eq(schema.notaCompraItem.id, schema.movimentoEstoque.notaCompraItemId),
    )
    .where(where)
    .orderBy(desc(schema.movimentoEstoque.dataHora))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  // Produto-foco: se filtrou produto, busca info + saldo atual
  let produtoFoco: {
    id: string;
    nome: string | null;
    unidadeEstoque: string;
    estoqueAtual: string | null;
    saldoCalculado: string;
  } | null = null;
  if (produtoIdFiltro && /^[0-9a-f-]{36}$/i.test(produtoIdFiltro)) {
    const [p] = await db
      .select({
        id: schema.produto.id,
        nome: schema.produto.nome,
        unidadeEstoque: schema.produto.unidadeEstoque,
        estoqueAtual: schema.produto.estoqueAtual,
      })
      .from(schema.produto)
      .where(eq(schema.produto.id, produtoIdFiltro))
      .limit(1);
    if (p) {
      const [calc] = await db.execute<{ saldo: string }>(sql`
        SELECT COALESCE(SUM(${schema.movimentoEstoque.quantidade}), 0)::text AS saldo
        FROM ${schema.movimentoEstoque}
        WHERE ${schema.movimentoEstoque.filialId} = ${filialSelecionada.id}
          AND ${schema.movimentoEstoque.produtoId} = ${produtoIdFiltro}
      `);
      produtoFoco = { ...p, saldoCalculado: calc?.saldo ?? '0' };
    }
  }

  const totalPag = Math.max(1, Math.ceil(Number(kpis?.qtd ?? 0) / PAGE_SIZE));
  const hrefPreserva = (override: Partial<SP>) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    const nextProduto = override.produtoId !== undefined ? override.produtoId : produtoIdFiltro;
    const nextTipo = override.tipo !== undefined ? override.tipo : tipoFiltro;
    const nextPage = override.page !== undefined ? override.page : String(page);
    if (nextProduto) qs.set('produtoId', nextProduto);
    if (nextTipo) qs.set('tipo', nextTipo);
    if (dataIni) qs.set('dataIni', dataIni);
    if (dataFim) qs.set('dataFim', dataFim);
    if (nextPage && nextPage !== '0') qs.set('page', nextPage);
    return `/relatorios/movimentos?${qs.toString()}`;
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Movimentos de estoque</h1>
        <p className="mt-1 text-sm text-slate-600">
          Auditoria completa: cada entrada e saída de estoque com rastro até a origem
          (NFe, venda, produção, ajuste). Útil pra debugar saldo divergente.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/relatorios/movimentos?filialId=${f.id}`}
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

        {/* KPIs do período */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Movimentos
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {int(Number(kpis?.qtd ?? 0))}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
              Total entradas
            </p>
            <p className="mt-1 text-2xl font-bold text-emerald-900">
              {Number(kpis?.entradas ?? 0).toLocaleString('pt-BR', {
                maximumFractionDigits: 2,
              })}
            </p>
            <p className="mt-0.5 text-[10px] text-emerald-700">
              {brl(Number(kpis?.valor_entradas ?? 0))}
            </p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700">
              Total saídas
            </p>
            <p className="mt-1 text-2xl font-bold text-rose-900">
              {Number(kpis?.saidas ?? 0).toLocaleString('pt-BR', {
                maximumFractionDigits: 2,
              })}
            </p>
            <p className="mt-0.5 text-[10px] text-rose-700">
              {brl(Math.abs(Number(kpis?.valor_saidas ?? 0)))}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Variação líquida
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {(Number(kpis?.entradas ?? 0) - Number(kpis?.saidas ?? 0)).toLocaleString(
                'pt-BR',
                { maximumFractionDigits: 2 },
              )}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">no período</p>
          </div>
        </div>

        {/* Foco em produto */}
        {produtoFoco && (
          <div className="mt-6 rounded-xl border border-sky-300 bg-sky-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-sky-700">
                  Filtrando produto
                </p>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  <Link
                    href={`/cadastros/produtos/${produtoFoco.id}`}
                    className="hover:underline"
                  >
                    {produtoFoco.nome ?? '—'}
                  </Link>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-wide text-sky-700">
                  Saldo
                </p>
                <p className="font-mono text-2xl font-bold text-slate-900">
                  {Number(produtoFoco.estoqueAtual ?? 0).toLocaleString('pt-BR', {
                    maximumFractionDigits: 3,
                  })}{' '}
                  <span className="text-xs text-slate-500">{produtoFoco.unidadeEstoque}</span>
                </p>
                <p
                  className={`mt-0.5 text-[10px] font-mono ${
                    Math.abs(
                      Number(produtoFoco.estoqueAtual ?? 0) -
                        Number(produtoFoco.saldoCalculado),
                    ) < 0.001
                      ? 'text-emerald-700'
                      : 'text-rose-700'
                  }`}
                >
                  Σ movimentos = {Number(produtoFoco.saldoCalculado).toLocaleString('pt-BR', {
                    maximumFractionDigits: 3,
                  })}{' '}
                  {Math.abs(
                    Number(produtoFoco.estoqueAtual ?? 0) -
                      Number(produtoFoco.saldoCalculado),
                  ) < 0.001
                    ? '✓'
                    : '⚠ divergente'}
                </p>
              </div>
            </div>
            <Link
              href={hrefPreserva({ produtoId: '' })}
              className="mt-2 inline-block text-[11px] text-sky-700 hover:underline"
            >
              ← remover filtro de produto
            </Link>
          </div>
        )}

        {/* Filtros */}
        <div className="mt-6 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="w-16 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Tipo
            </span>
            {TIPOS_FILTRO.map((t) => (
              <Link
                key={t.v}
                href={hrefPreserva({ tipo: t.v, page: '0' })}
                className={`rounded-md border px-2 py-0.5 text-[11px] ${
                  tipoFiltro === t.v
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t.l}
              </Link>
            ))}
          </div>

          <form method="GET" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="filialId" value={filialSelecionada.id} />
            {tipoFiltro && <input type="hidden" name="tipo" value={tipoFiltro} />}
            {produtoIdFiltro && (
              <input type="hidden" name="produtoId" value={produtoIdFiltro} />
            )}
            <label className="text-xs text-slate-600">
              De
              <input
                type="date"
                name="dataIni"
                defaultValue={dataIni}
                className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              Até
              <input
                type="date"
                name="dataFim"
                defaultValue={dataFim}
                className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Filtrar
            </button>
          </form>
        </div>

        {/* Lista */}
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Data/hora</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Produto</th>
                <th className="px-4 py-2 text-right">Qtd</th>
                <th className="px-4 py-2 text-right">Unit.</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">Origem</th>
              </tr>
            </thead>
            <tbody>
              {movimentos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">
                    Nenhum movimento no período/filtro.
                  </td>
                </tr>
              ) : (
                movimentos.map((m) => {
                  const qtd = Number(m.quantidade);
                  const cls = COR_TIPO[m.tipo] ?? 'bg-slate-100 text-slate-700';
                  const origem = m.notaCompraId ? (
                    <Link
                      href={`/movimento/entrada-notas/${m.notaCompraId}`}
                      className="text-sky-700 hover:underline"
                    >
                      NFe
                    </Link>
                  ) : m.pedidoItemId ? (
                    <span className="text-slate-600">
                      Pedido {m.pedidoCodigo ?? '?'}
                    </span>
                  ) : m.ordemProducaoId ? (
                    <Link
                      href={`/movimento/producao/${m.ordemProducaoId}`}
                      className="text-sky-700 hover:underline"
                    >
                      OP
                    </Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  );
                  return (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs text-slate-600">
                        {m.dataHora
                          ? new Date(m.dataHora).toLocaleString('pt-BR', {
                              timeZone: 'America/Sao_Paulo',
                            })
                          : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
                        >
                          {m.tipo}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-800">
                        <Link
                          href={hrefPreserva({ produtoId: m.produtoId, page: '0' })}
                          className="hover:underline"
                          title="Filtrar por este produto"
                        >
                          {m.produtoNome ?? '—'}
                        </Link>
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono text-xs font-medium ${
                          qtd > 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {qtd > 0 ? '+' : ''}
                        {qtd.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}{' '}
                        <span className="text-[10px] text-slate-400">
                          {m.produtoUnidade}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-500">
                        {m.precoUnitario && Number(m.precoUnitario) > 0
                          ? brl(Number(m.precoUnitario))
                          : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                        {m.valorTotal ? brl(Math.abs(Number(m.valorTotal))) : '—'}
                      </td>
                      <td className="px-4 py-2 text-[11px]">{origem}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {totalPag > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs">
              <span className="text-slate-600">
                Página {page + 1} de {totalPag} · {int(Number(kpis?.qtd ?? 0))} movimentos
              </span>
              <div className="flex gap-2">
                {page > 0 ? (
                  <Link
                    href={hrefPreserva({ page: String(page - 1) })}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1"
                  >
                    ← Anterior
                  </Link>
                ) : (
                  <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">
                    ← Anterior
                  </span>
                )}
                {page < totalPag - 1 ? (
                  <Link
                    href={hrefPreserva({ page: String(page + 1) })}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1"
                  >
                    Próxima →
                  </Link>
                ) : (
                  <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">
                    Próxima →
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

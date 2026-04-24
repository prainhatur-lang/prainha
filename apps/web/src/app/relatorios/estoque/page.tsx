import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  dias?: string; // janela pra curva ABC e slow movers
}

const JANELA_DEFAULT = 30;
const SLOW_MOVER_DIAS = 60;

const BADGE_ABC: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-800',
  B: 'bg-sky-100 text-sky-800',
  C: 'bg-slate-100 text-slate-700',
};

const TIPO_LABEL: Record<string, string> = {
  VENDA_SIMPLES: 'Produto',
  INSUMO: 'Insumo',
  COMPLEMENTO: 'Complemento',
  COMBO: 'Combo',
  VARIANTE: 'Tamanho',
  SERVICO: 'Serviço',
};

export default async function RelatorioEstoquePage(props: {
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
  const dias = Math.max(7, Math.min(365, Number(sp.dias ?? JANELA_DEFAULT) || JANELA_DEFAULT));

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

  const fid = filialSelecionada.id;

  // ===== KPIs =====
  const [kpis] = await db.execute<{
    total_controlados: number;
    valor_estoque: string;
    abaixo_minimo: number;
    zerados: number;
    sem_ficha: number;
    criados_nuvem: number;
  }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE ${schema.produto.controlaEstoque} = true AND (${schema.produto.descontinuado} IS NULL OR ${schema.produto.descontinuado} = false))::int AS total_controlados,
      COALESCE(SUM(
        CASE WHEN ${schema.produto.controlaEstoque} = true
          THEN COALESCE(${schema.produto.estoqueAtual}, 0) * COALESCE(${schema.produto.precoCusto}, 0)
          ELSE 0 END
      ), 0)::text AS valor_estoque,
      COUNT(*) FILTER (
        WHERE ${schema.produto.controlaEstoque} = true
          AND COALESCE(${schema.produto.estoqueMinimo}, 0) > 0
          AND COALESCE(${schema.produto.estoqueAtual}, 0) < COALESCE(${schema.produto.estoqueMinimo}, 0)
          AND (${schema.produto.descontinuado} IS NULL OR ${schema.produto.descontinuado} = false)
      )::int AS abaixo_minimo,
      COUNT(*) FILTER (
        WHERE ${schema.produto.controlaEstoque} = true
          AND COALESCE(${schema.produto.estoqueAtual}, 0) <= 0
          AND (${schema.produto.descontinuado} IS NULL OR ${schema.produto.descontinuado} = false)
      )::int AS zerados,
      COUNT(*) FILTER (
        WHERE (${schema.produto.descontinuado} IS NULL OR ${schema.produto.descontinuado} = false)
          AND NOT EXISTS (SELECT 1 FROM ${schema.fichaTecnica} WHERE ${schema.fichaTecnica.produtoId} = ${schema.produto.id})
          AND ${schema.produto.tipo} IN ('VENDA_SIMPLES', 'COMPLEMENTO', 'COMBO')
      )::int AS sem_ficha,
      COUNT(*) FILTER (WHERE ${schema.produto.criadoNaNuvem} = true)::int AS criados_nuvem
    FROM ${schema.produto}
    WHERE ${schema.produto.filialId} = ${fid}
  `);

  // ===== Críticos (abaixo do mínimo ou zerados) =====
  const criticos = await db.execute<{
    id: string;
    nome: string | null;
    tipo: string;
    unidade_estoque: string;
    estoque_atual: string | null;
    estoque_minimo: string | null;
    preco_custo: string | null;
    criticidade: number;
  }>(sql`
    SELECT
      ${schema.produto.id} AS id,
      ${schema.produto.nome} AS nome,
      ${schema.produto.tipo} AS tipo,
      ${schema.produto.unidadeEstoque} AS unidade_estoque,
      ${schema.produto.estoqueAtual}::text AS estoque_atual,
      ${schema.produto.estoqueMinimo}::text AS estoque_minimo,
      ${schema.produto.precoCusto}::text AS preco_custo,
      CASE
        WHEN COALESCE(${schema.produto.estoqueAtual}, 0) <= 0 THEN 0
        ELSE COALESCE(${schema.produto.estoqueAtual}, 0) / NULLIF(COALESCE(${schema.produto.estoqueMinimo}, 0), 0)
      END::float AS criticidade
    FROM ${schema.produto}
    WHERE ${schema.produto.filialId} = ${fid}
      AND ${schema.produto.controlaEstoque} = true
      AND (${schema.produto.descontinuado} IS NULL OR ${schema.produto.descontinuado} = false)
      AND ${schema.produto.dataPausado} IS NULL
      AND (
        COALESCE(${schema.produto.estoqueAtual}, 0) <= 0
        OR (
          COALESCE(${schema.produto.estoqueMinimo}, 0) > 0
          AND COALESCE(${schema.produto.estoqueAtual}, 0) < COALESCE(${schema.produto.estoqueMinimo}, 0)
        )
      )
    ORDER BY criticidade ASC NULLS FIRST
    LIMIT 50
  `);

  // ===== Curva ABC (últimos N dias por pedido_item) =====
  // Usamos pedido_item como fonte do consumo real (Consumer). ABC pelo valor total vendido.
  const desdeIso = new Date(Date.now() - dias * 86_400_000).toISOString();

  const consumo = await db.execute<{
    produto_id: string;
    nome: string | null;
    tipo: string;
    unidade_estoque: string;
    qtd_total: string;
    valor_total: string;
    pedidos_distintos: number;
  }>(sql`
    SELECT
      ${schema.pedidoItem.produtoId} AS produto_id,
      ${schema.produto.nome} AS nome,
      ${schema.produto.tipo} AS tipo,
      ${schema.produto.unidadeEstoque} AS unidade_estoque,
      COALESCE(SUM(${schema.pedidoItem.quantidade}), 0)::text AS qtd_total,
      COALESCE(SUM(${schema.pedidoItem.valorTotal}), 0)::text AS valor_total,
      COUNT(DISTINCT ${schema.pedidoItem.codigoPedidoExterno})::int AS pedidos_distintos
    FROM ${schema.pedidoItem}
    INNER JOIN ${schema.produto} ON ${schema.produto.id} = ${schema.pedidoItem.produtoId}
    WHERE ${schema.pedidoItem.filialId} = ${fid}
      AND ${schema.pedidoItem.dataHoraCadastro} >= ${desdeIso}
      AND ${schema.pedidoItem.produtoId} IS NOT NULL
      AND ${schema.pedidoItem.dataDelete} IS NULL
    GROUP BY ${schema.pedidoItem.produtoId}, ${schema.produto.nome}, ${schema.produto.tipo}, ${schema.produto.unidadeEstoque}
    HAVING COALESCE(SUM(${schema.pedidoItem.valorTotal}), 0) > 0
    ORDER BY valor_total DESC
    LIMIT 200
  `);

  // Classifica A/B/C por acumulação de valor
  const totalConsumo = consumo.reduce((acc, c) => acc + Number(c.valor_total), 0);
  let acumulado = 0;
  const consumoClass = consumo.map((c) => {
    const valor = Number(c.valor_total);
    acumulado += valor;
    const pctCum = totalConsumo > 0 ? (acumulado / totalConsumo) * 100 : 0;
    const pctInd = totalConsumo > 0 ? (valor / totalConsumo) * 100 : 0;
    const classe: 'A' | 'B' | 'C' = pctCum <= 80 ? 'A' : pctCum <= 95 ? 'B' : 'C';
    return {
      ...c,
      valor: Number(c.valor_total),
      qtdTotal: Number(c.qtd_total),
      pct: pctInd,
      pctCum,
      classe,
    };
  });

  const abcCounts = consumoClass.reduce(
    (acc, c) => {
      acc[c.classe]++;
      return acc;
    },
    { A: 0, B: 0, C: 0 },
  );

  // ===== Slow movers (controla estoque + tem saldo > 0 + zero venda no período) =====
  const slowMovers = await db.execute<{
    id: string;
    nome: string | null;
    tipo: string;
    unidade_estoque: string;
    estoque_atual: string | null;
    preco_custo: string | null;
    valor_parado: string;
    dias_sem_venda: number | null;
  }>(sql`
    WITH ultima_venda AS (
      SELECT
        ${schema.pedidoItem.produtoId} AS produto_id,
        MAX(${schema.pedidoItem.dataHoraCadastro}) AS ult
      FROM ${schema.pedidoItem}
      WHERE ${schema.pedidoItem.filialId} = ${fid}
        AND ${schema.pedidoItem.produtoId} IS NOT NULL
        AND ${schema.pedidoItem.dataDelete} IS NULL
      GROUP BY ${schema.pedidoItem.produtoId}
    )
    SELECT
      p.id,
      p.nome,
      p.tipo,
      p.unidade_estoque,
      p.estoque_atual::text,
      p.preco_custo::text,
      (COALESCE(p.estoque_atual, 0) * COALESCE(p.preco_custo, 0))::text AS valor_parado,
      (EXTRACT(EPOCH FROM (NOW() - uv.ult)) / 86400)::int AS dias_sem_venda
    FROM ${schema.produto} p
    LEFT JOIN ultima_venda uv ON uv.produto_id = p.id
    WHERE p.filial_id = ${fid}
      AND p.controla_estoque = true
      AND (p.descontinuado IS NULL OR p.descontinuado = false)
      AND p.data_pausado IS NULL
      AND COALESCE(p.estoque_atual, 0) > 0
      AND (uv.ult IS NULL OR uv.ult < ${new Date(Date.now() - SLOW_MOVER_DIAS * 86_400_000).toISOString()})
    ORDER BY valor_parado DESC NULLS LAST
    LIMIT 30
  `);

  const valorEstoque = Number(kpis?.valor_estoque ?? 0);
  const hrefJanela = (d: number) =>
    `/relatorios/estoque?filialId=${fid}${d !== JANELA_DEFAULT ? `&dias=${d}` : ''}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Relatório de estoque</h1>
            <p className="mt-1 text-sm text-slate-600">
              Saldos, produtos críticos, curva ABC e slow movers · {filialSelecionada.nome}
            </p>
          </div>
        </div>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/relatorios/estoque?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === fid
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        {/* ===== KPIs ===== */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Valor em estoque (custo)
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{brl(valorEstoque)}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {int(kpis?.total_controlados ?? 0)} produto(s) controlando estoque
            </p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700">
              Abaixo do mínimo
            </p>
            <p className="mt-1 text-2xl font-bold text-rose-900">
              {int(kpis?.abaixo_minimo ?? 0)}
            </p>
            <p className="mt-0.5 text-[10px] text-rose-700">precisa repor</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700">
              Zerados
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-900">{int(kpis?.zerados ?? 0)}</p>
            <p className="mt-0.5 text-[10px] text-amber-700">sem saldo</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Sem ficha técnica
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {int(kpis?.sem_ficha ?? 0)}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              venda não baixa insumo (risco)
            </p>
          </div>
        </div>

        {/* ===== Críticos ===== */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-slate-900">Produtos críticos</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Abaixo do mínimo ou zerados — priorize compra. Top 50 por criticidade.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Produto</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2 text-right">Saldo</th>
                  <th className="px-4 py-2 text-right">Mínimo</th>
                  <th className="px-4 py-2 text-right">Déficit</th>
                  <th className="px-4 py-2 text-right">Custo un.</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {criticos.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-xs text-slate-500"
                    >
                      ✓ Nenhum produto crítico. Estoques sob controle.
                    </td>
                  </tr>
                ) : (
                  criticos.map((c) => {
                    const saldo = Number(c.estoque_atual ?? 0);
                    const min = Number(c.estoque_minimo ?? 0);
                    const deficit = Math.max(0, min - saldo);
                    const custo = Number(c.preco_custo ?? 0);
                    const zerado = saldo <= 0;
                    return (
                      <tr key={c.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-xs text-slate-800">
                          <Link
                            href={`/cadastros/produtos/${c.id}`}
                            className="hover:underline"
                          >
                            {c.nome ?? '—'}
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">
                            {TIPO_LABEL[c.tipo] ?? c.tipo}
                          </span>
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-mono text-xs ${
                            zerado ? 'text-rose-700 font-bold' : 'text-rose-700'
                          }`}
                        >
                          {saldo.toFixed(3)} {c.unidade_estoque}
                          {zerado && ' ⚠'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                          {min.toFixed(3)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-900">
                          {deficit.toFixed(3)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-500">
                          {custo > 0 ? brl(custo) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Link
                            href={`/cadastros/produtos/${c.id}`}
                            className="text-[10px] text-sky-700 hover:underline"
                          >
                            ver →
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ===== Curva ABC ===== */}
        <section className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Curva ABC · consumo</h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Produtos ordenados por valor vendido nos últimos {dias} dias. Classe A =
                80% do faturamento, B = próximos 15%, C = 5% final.
              </p>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-slate-500">Janela:</span>
              {[7, 15, 30, 60, 90, 180].map((d) => (
                <Link
                  key={d}
                  href={hrefJanela(d)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] ${
                    dias === d
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {d}d
                </Link>
              ))}
            </div>
          </div>

          {/* Sumário da ABC */}
          <div className="mt-3 grid grid-cols-3 gap-3">
            {(['A', 'B', 'C'] as const).map((classe) => {
              const count = abcCounts[classe];
              const pct =
                consumoClass.length > 0
                  ? ((count / consumoClass.length) * 100).toFixed(0)
                  : '0';
              return (
                <div key={classe} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-bold ${BADGE_ABC[classe]}`}
                    >
                      {classe}
                    </span>
                    <span className="text-xs text-slate-500">{pct}%</span>
                  </div>
                  <p className="mt-1 text-xl font-bold text-slate-900">{count}</p>
                  <p className="text-[10px] text-slate-500">
                    {classe === 'A'
                      ? 'foco máximo (top 80% do valor)'
                      : classe === 'B'
                        ? 'atenção secundária'
                        : 'cauda longa'}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">ABC</th>
                  <th className="px-4 py-2">Produto</th>
                  <th className="px-4 py-2 text-right">Qtd</th>
                  <th className="px-4 py-2 text-right">Valor</th>
                  <th className="px-4 py-2 text-right">% ind</th>
                  <th className="px-4 py-2 text-right">% cum</th>
                  <th className="px-4 py-2 text-right">Pedidos</th>
                </tr>
              </thead>
              <tbody>
                {consumoClass.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-xs text-slate-500"
                    >
                      Nenhum consumo registrado nos últimos {dias} dias.
                    </td>
                  </tr>
                ) : (
                  consumoClass.slice(0, 50).map((c, i) => (
                    <tr key={c.produto_id} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-xs text-slate-400">{i + 1}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${BADGE_ABC[c.classe]}`}
                        >
                          {c.classe}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-800">
                        <Link
                          href={`/cadastros/produtos/${c.produto_id}`}
                          className="hover:underline"
                        >
                          {c.nome ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {c.qtdTotal.toFixed(2)} {c.unidade_estoque}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-medium text-slate-900">
                        {brl(c.valor)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-[10px] text-slate-500">
                        {c.pct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-[10px] text-slate-400">
                        {c.pctCum.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {c.pedidos_distintos}
                      </td>
                    </tr>
                  ))
                )}
                {consumoClass.length > 50 && (
                  <tr className="border-t border-slate-100">
                    <td
                      colSpan={8}
                      className="px-4 py-2 text-center text-[10px] text-slate-400"
                    >
                      ... e mais {consumoClass.length - 50} itens
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ===== Slow movers ===== */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-slate-900">Capital parado (slow movers)</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Produtos com saldo mas sem venda há pelo menos {SLOW_MOVER_DIAS} dias —
            ordenados por valor parado. Top 30.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Produto</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2 text-right">Saldo</th>
                  <th className="px-4 py-2 text-right">Custo un.</th>
                  <th className="px-4 py-2 text-right">Valor parado</th>
                  <th className="px-4 py-2 text-right">Última venda</th>
                </tr>
              </thead>
              <tbody>
                {slowMovers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-xs text-slate-500"
                    >
                      ✓ Nenhum produto parado há mais de {SLOW_MOVER_DIAS} dias.
                    </td>
                  </tr>
                ) : (
                  slowMovers.map((s) => {
                    const saldo = Number(s.estoque_atual ?? 0);
                    const custo = Number(s.preco_custo ?? 0);
                    const parado = Number(s.valor_parado ?? 0);
                    return (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-xs text-slate-800">
                          <Link
                            href={`/cadastros/produtos/${s.id}`}
                            className="hover:underline"
                          >
                            {s.nome ?? '—'}
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">
                            {TIPO_LABEL[s.tipo] ?? s.tipo}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                          {saldo.toFixed(3)} {s.unidade_estoque}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-500">
                          {custo > 0 ? brl(custo) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs font-medium text-slate-900">
                          {brl(parado)}
                        </td>
                        <td className="px-4 py-2 text-right text-[11px] text-slate-500">
                          {s.dias_sem_venda == null
                            ? 'nunca vendido'
                            : `há ${s.dias_sem_venda}d`}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

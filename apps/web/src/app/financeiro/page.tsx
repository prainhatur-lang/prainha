import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, count, desc, eq, gte, isNull, lte, sql, sum } from 'drizzle-orm';
import { LogoutButton } from '../dashboard/logout-button';
import { AppNav } from '@/components/app-nav';
import { brl, formatDate, int } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  status?: 'todas' | 'abertas' | 'vencidas' | 'pagas' | 'hoje';
  dataIni?: string;
  dataFim?: string;
}

export default async function FinanceiroPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;
  const status = sp.status ?? 'abertas';
  const dataIni = sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(30);
  const dataFim = sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim) ? sp.dataFim : hojeBr();

  const filialIds = filiais.map((f) => f.id);

  // KPIs: abertas, vencidas, pagas no mes, fluxo proximos 30 dias
  const hoje = hojeBr();
  const em30 = diasAtrasBr(-30); // "diasAtras(-30)" = daqui a 30 dias em BRT

  const kpis = filialSelecionada
    ? await (async () => {
        const baseWhere = and(
          eq(schema.contaPagar.filialId, filialSelecionada.id),
          isNull(schema.contaPagar.dataDelete),
        );
        const [emAberto] = await db
          .select({
            qtd: count(),
            total: sum(schema.contaPagar.valor),
          })
          .from(schema.contaPagar)
          .where(and(baseWhere, isNull(schema.contaPagar.dataPagamento)));
        const [vencidas] = await db
          .select({
            qtd: count(),
            total: sum(schema.contaPagar.valor),
          })
          .from(schema.contaPagar)
          .where(
            and(
              baseWhere,
              isNull(schema.contaPagar.dataPagamento),
              sql`${schema.contaPagar.dataVencimento} < ${hoje}`,
            ),
          );
        const [proxima30] = await db
          .select({
            qtd: count(),
            total: sum(schema.contaPagar.valor),
          })
          .from(schema.contaPagar)
          .where(
            and(
              baseWhere,
              isNull(schema.contaPagar.dataPagamento),
              gte(schema.contaPagar.dataVencimento, hoje),
              lte(schema.contaPagar.dataVencimento, em30),
            ),
          );
        const [pagasMes] = await db
          .select({
            qtd: count(),
            total: sum(schema.contaPagar.valorPago),
          })
          .from(schema.contaPagar)
          .where(
            and(
              baseWhere,
              gte(schema.contaPagar.dataPagamento, dataIni),
              lte(schema.contaPagar.dataPagamento, dataFim),
            ),
          );
        return { emAberto, vencidas, proxima30, pagasMes };
      })()
    : null;

  // Lista de contas
  const contas = filialSelecionada
    ? await db
        .select({
          id: schema.contaPagar.id,
          codigoExterno: schema.contaPagar.codigoExterno,
          parcela: schema.contaPagar.parcela,
          totalParcelas: schema.contaPagar.totalParcelas,
          dataVencimento: schema.contaPagar.dataVencimento,
          valor: schema.contaPagar.valor,
          dataPagamento: schema.contaPagar.dataPagamento,
          valorPago: schema.contaPagar.valorPago,
          descricao: schema.contaPagar.descricao,
          fornecedorNome: schema.fornecedor.nome,
          fornecedorCnpj: schema.fornecedor.cnpjOuCpf,
          categoriaDescricao: schema.categoriaConta.descricao,
          categoriaTipo: schema.categoriaConta.tipo,
          origem: schema.contaPagar.origem,
          notaCompraId: schema.contaPagar.notaCompraId,
        })
        .from(schema.contaPagar)
        .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
        .leftJoin(
          schema.categoriaConta,
          eq(schema.categoriaConta.id, schema.contaPagar.categoriaId),
        )
        .where(
          (() => {
            const base = and(
              eq(schema.contaPagar.filialId, filialSelecionada.id),
              isNull(schema.contaPagar.dataDelete),
            );
            if (status === 'abertas') {
              return and(base, isNull(schema.contaPagar.dataPagamento));
            }
            if (status === 'vencidas') {
              return and(
                base,
                isNull(schema.contaPagar.dataPagamento),
                sql`${schema.contaPagar.dataVencimento} < ${hoje}`,
              );
            }
            if (status === 'pagas') {
              return and(
                base,
                gte(schema.contaPagar.dataPagamento, dataIni),
                lte(schema.contaPagar.dataPagamento, dataFim),
              );
            }
            if (status === 'hoje') {
              return and(
                base,
                isNull(schema.contaPagar.dataPagamento),
                eq(schema.contaPagar.dataVencimento, hoje),
              );
            }
            return base;
          })(),
        )
        .orderBy(desc(schema.contaPagar.dataVencimento))
        .limit(200)
    : [];

  const href = (next: Partial<SP>) => {
    const qs = new URLSearchParams();
    if (filialSelecionada) qs.set('filialId', filialSelecionada.id);
    const s = next.status ?? status;
    if (s !== 'abertas') qs.set('status', s);
    if (dataIni && s === 'pagas') qs.set('dataIni', dataIni);
    if (dataFim && s === 'pagas') qs.set('dataFim', dataFim);
    return `/financeiro?${qs.toString()}`;
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold text-slate-900">
              concilia
            </Link>
            <AppNav />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Financeiro — Contas a pagar</h1>
        <p className="mt-1 text-sm text-slate-600">
          Lançamentos sincronizados do Consumer. Dados atualizam a cada ciclo do agente.
        </p>

        {/* Filial selector */}
        {filiais.length > 1 && (
          <div className="mt-4 flex items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/financeiro?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === filialSelecionada?.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        {!filialSelecionada ? (
          <p className="mt-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
        ) : (
          <>
            {/* KPIs */}
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label="Em aberto"
                qtd={Number(kpis?.emAberto?.qtd ?? 0)}
                valor={Number(kpis?.emAberto?.total ?? 0)}
                tom="slate"
                href={href({ status: 'abertas' })}
              />
              <KpiCard
                label="Vencidas"
                qtd={Number(kpis?.vencidas?.qtd ?? 0)}
                valor={Number(kpis?.vencidas?.total ?? 0)}
                tom="rose"
                href={href({ status: 'vencidas' })}
              />
              <KpiCard
                label="Próximos 30 dias"
                qtd={Number(kpis?.proxima30?.qtd ?? 0)}
                valor={Number(kpis?.proxima30?.total ?? 0)}
                tom="amber"
              />
              <KpiCard
                label="Pagas no período"
                qtd={Number(kpis?.pagasMes?.qtd ?? 0)}
                valor={Number(kpis?.pagasMes?.total ?? 0)}
                tom="emerald"
                href={href({ status: 'pagas' })}
              />
            </div>

            {/* Pills status */}
            <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
              {([
                ['abertas', 'Em aberto'],
                ['vencidas', 'Vencidas'],
                ['hoje', 'Vence hoje'],
                ['pagas', 'Pagas'],
                ['todas', 'Todas'],
              ] as Array<[NonNullable<SP['status']>, string]>).map(([k, label]) => (
                <Link
                  key={k}
                  href={href({ status: k })}
                  className={`rounded-md border px-3 py-1 ${
                    status === k
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>

            {/* Tabela */}
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Vencimento</th>
                    <th className="px-4 py-2">Fornecedor</th>
                    <th className="px-4 py-2">Descrição</th>
                    <th className="px-4 py-2">Categoria</th>
                    <th className="px-4 py-2">Parcela</th>
                    <th className="px-4 py-2 text-right">Valor</th>
                    <th className="px-4 py-2">Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {contas.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-500">
                        Nenhuma conta nesse filtro.
                      </td>
                    </tr>
                  ) : (
                    contas.map((c) => {
                      const venc = formatDate(c.dataVencimento);
                      const pgto = c.dataPagamento ? formatDate(c.dataPagamento) : '—';
                      const vencida = !c.dataPagamento && c.dataVencimento < hoje;
                      return (
                        <tr key={c.id} className="border-t border-slate-100">
                          <td
                            className={`px-4 py-2 font-mono text-xs ${
                              vencida ? 'text-rose-700' : 'text-slate-700'
                            }`}
                          >
                            {venc}
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-800">
                            <div className="flex items-center gap-1.5">
                              <span>
                                {c.fornecedorNome ?? (
                                  <span className="text-slate-400">sem fornecedor</span>
                                )}
                              </span>
                              {c.origem === 'NFE' && (
                                <span
                                  className="rounded bg-violet-100 px-1 py-0.5 text-[9px] font-medium text-violet-800"
                                  title={
                                    c.notaCompraId
                                      ? 'Originada de uma NFe lançada no estoque'
                                      : 'Origem NFe'
                                  }
                                >
                                  NFe
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-600">
                            {c.notaCompraId ? (
                              <a
                                href={`/movimento/entrada-notas/${c.notaCompraId}`}
                                className="text-violet-700 hover:underline"
                                title="Ver a nota de origem"
                              >
                                {c.descricao ?? '—'}
                              </a>
                            ) : (
                              c.descricao ?? '—'
                            )}
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-600">
                            {c.categoriaDescricao ?? '—'}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-slate-600">
                            {c.parcela && c.totalParcelas
                              ? `${c.parcela}/${c.totalParcelas}`
                              : '—'}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
                            {brl(c.valor)}
                          </td>
                          <td className="px-4 py-2 text-xs">
                            {c.dataPagamento ? (
                              <span className="text-emerald-700">
                                {pgto} · {brl(c.valorPago)}
                              </span>
                            ) : vencida ? (
                              <span className="text-rose-700">vencida</span>
                            ) : (
                              <span className="text-slate-500">aberta</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              {contas.length >= 200 && (
                <p className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-center text-xs text-slate-500">
                  Mostrando 200. Use filtros pra refinar.
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function KpiCard({
  label,
  qtd,
  valor,
  tom,
  href,
}: {
  label: string;
  qtd: number;
  valor: number;
  tom: 'slate' | 'emerald' | 'amber' | 'rose';
  href?: string;
}) {
  const cor = {
    slate: 'border-slate-200 bg-white',
    emerald: 'border-emerald-200 bg-emerald-50',
    amber: 'border-amber-200 bg-amber-50',
    rose: 'border-rose-200 bg-rose-50',
  }[tom];
  const inner = (
    <div className={`rounded-xl border p-4 ${cor} ${href ? 'cursor-pointer hover:shadow-sm' : ''}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{int(qtd)}</p>
      <p className="text-xs text-slate-700">{brl(valor)}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

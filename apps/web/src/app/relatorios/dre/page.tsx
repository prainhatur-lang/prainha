import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  mes?: string; // YYYY-MM
}

function mesAnteriorIso(): string {
  const d = new Date();
  const brNow = new Date(d.getTime() - 3 * 3600 * 1000);
  const y = brNow.getUTCFullYear();
  const m = brNow.getUTCMonth(); // 0-11, mês atual
  // Mês ANTERIOR
  const ref = new Date(Date.UTC(y, m - 1, 1));
  return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}`;
}

function rangeDoMes(mes: string): { ini: string; fim: string; label: string } {
  const [y, m] = mes.split('-').map(Number);
  const d1 = new Date(Date.UTC(y!, m! - 1, 1));
  const d2 = new Date(Date.UTC(y!, m!, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const mesLabel = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d1);
  return { ini: iso(d1), fim: iso(d2), label: mesLabel };
}

function mesPrevNext(m: string, delta: number): string {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y!, mm! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function DrePage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : mesAnteriorIso();
  const range = rangeDoMes(mes);

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

  // RECEITAS: soma pagamentos (PDV) por forma no mes
  const receitasPorForma = await db
    .select({
      forma: sql<string>`COALESCE(${schema.pagamento.formaPagamento}, 'Sem forma')`,
      total: sql<string>`COALESCE(SUM(${schema.pagamento.valor}), 0)::text`,
      qtd: sql<number>`COUNT(*)::int`,
    })
    .from(schema.pagamento)
    .where(
      and(
        eq(schema.pagamento.filialId, filialSelecionada.id),
        gte(schema.pagamento.dataPagamento, new Date(range.ini + 'T00:00:00-03:00')),
        lte(schema.pagamento.dataPagamento, new Date(range.fim + 'T23:59:59-03:00')),
      ),
    )
    .groupBy(schema.pagamento.formaPagamento)
    .orderBy(sql`2 DESC`);

  const totalReceitas = receitasPorForma.reduce((s, r) => s + Number(r.total), 0);

  // DESPESAS: conta_pagar pagas no mes, agrupadas por categoria
  const despesasPorCategoria = await db
    .select({
      categoriaId: schema.contaPagar.categoriaId,
      categoriaDescricao: schema.categoriaConta.descricao,
      categoriaTipo: schema.categoriaConta.tipo,
      categoriaPaiExterno: schema.categoriaConta.codigoPaiExterno,
      total: sql<string>`COALESCE(SUM(COALESCE(${schema.contaPagar.valorPago}, ${schema.contaPagar.valor})), 0)::text`,
      qtd: sql<number>`COUNT(*)::int`,
    })
    .from(schema.contaPagar)
    .leftJoin(
      schema.categoriaConta,
      eq(schema.categoriaConta.id, schema.contaPagar.categoriaId),
    )
    .where(
      and(
        eq(schema.contaPagar.filialId, filialSelecionada.id),
        isNull(schema.contaPagar.dataDelete),
        gte(schema.contaPagar.dataPagamento, range.ini),
        lte(schema.contaPagar.dataPagamento, range.fim),
      ),
    )
    .groupBy(
      schema.contaPagar.categoriaId,
      schema.categoriaConta.descricao,
      schema.categoriaConta.tipo,
      schema.categoriaConta.codigoPaiExterno,
    )
    .orderBy(sql`5 DESC`);

  const totalDespesas = despesasPorCategoria.reduce((s, d) => s + Number(d.total), 0);

  // CONTAS PROVISIONADAS (em aberto) no mes — vence mas nao pagou
  const [contasAbertas] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${schema.contaPagar.valor}), 0)::text`,
      qtd: sql<number>`COUNT(*)::int`,
    })
    .from(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.filialId, filialSelecionada.id),
        isNull(schema.contaPagar.dataDelete),
        isNull(schema.contaPagar.dataPagamento),
        gte(schema.contaPagar.dataVencimento, range.ini),
        lte(schema.contaPagar.dataVencimento, range.fim),
      ),
    );

  const resultado = totalReceitas - totalDespesas;
  const margem = totalReceitas > 0 ? (resultado / totalReceitas) * 100 : 0;

  const hrefMes = (m: string) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    qs.set('mes', m);
    return `/relatorios/dre?${qs.toString()}`;
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">DRE — Demonstrativo de Resultado</h1>
        <p className="mt-1 text-sm text-slate-600">
          Receitas do PDV vs. despesas pagas no mês. Contas em aberto mostradas separadamente como provisão.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={hrefMes(mes).replace(filialSelecionada.id, f.id)}
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

        <div className="mt-6 flex items-center justify-between">
          <Link
            href={hrefMes(mesPrevNext(mes, -1))}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            ← Mês anterior
          </Link>
          <h2 className="text-lg font-semibold capitalize text-slate-900">{range.label}</h2>
          <Link
            href={hrefMes(mesPrevNext(mes, 1))}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Próximo mês →
          </Link>
        </div>

        {/* Resultado */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
              Receitas (PDV)
            </p>
            <p className="mt-1 text-2xl font-bold text-emerald-900">{brl(totalReceitas)}</p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700">
              Despesas pagas
            </p>
            <p className="mt-1 text-2xl font-bold text-rose-900">{brl(totalDespesas)}</p>
          </div>
          <div
            className={`rounded-xl border p-4 ${
              resultado >= 0
                ? 'border-emerald-300 bg-emerald-100'
                : 'border-rose-300 bg-rose-100'
            }`}
          >
            <p
              className={`text-[11px] font-medium uppercase tracking-wide ${
                resultado >= 0 ? 'text-emerald-800' : 'text-rose-800'
              }`}
            >
              Resultado {resultado >= 0 ? '(lucro)' : '(prejuízo)'}
            </p>
            <p
              className={`mt-1 text-2xl font-bold ${
                resultado >= 0 ? 'text-emerald-900' : 'text-rose-900'
              }`}
            >
              {brl(resultado)}
            </p>
            <p className={`text-xs ${resultado >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
              Margem: {margem.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Provisão (contas em aberto do mês) */}
        {Number(contasAbertas?.total ?? 0) > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
            <p>
              <span className="font-semibold text-amber-900">
                ⚠ Provisionado (contas em aberto vencendo no mês):
              </span>{' '}
              <span className="font-mono text-amber-800">
                {brl(Number(contasAbertas?.total ?? 0))}
              </span>{' '}
              em{' '}
              <span className="font-mono text-amber-800">
                {int(Number(contasAbertas?.qtd ?? 0))}
              </span>{' '}
              conta(s). Não foram incluídas no resultado acima.
            </p>
          </div>
        )}

        {/* Receitas por forma */}
        <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-emerald-700">Receitas por forma de pagamento</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Forma</th>
                <th className="px-4 py-2 text-right w-24">Qtd</th>
                <th className="px-4 py-2 text-right w-36">Total</th>
                <th className="px-4 py-2 text-right w-20">%</th>
              </tr>
            </thead>
            <tbody>
              {receitasPorForma.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-500">
                    Sem receitas no período.
                  </td>
                </tr>
              ) : (
                receitasPorForma.map((r) => {
                  const v = Number(r.total);
                  const pct = totalReceitas > 0 ? (v / totalReceitas) * 100 : 0;
                  return (
                    <tr key={r.forma} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-800">{r.forma}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {int(Number(r.qtd))}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
                        {brl(v)}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-slate-500">
                        {pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Despesas por categoria */}
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-rose-700">Despesas pagas por categoria</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Categoria</th>
                <th className="px-4 py-2 text-right w-24">Qtd</th>
                <th className="px-4 py-2 text-right w-36">Total</th>
                <th className="px-4 py-2 text-right w-20">%</th>
              </tr>
            </thead>
            <tbody>
              {despesasPorCategoria.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-500">
                    Sem despesas pagas no período.
                  </td>
                </tr>
              ) : (
                despesasPorCategoria.map((d, i) => {
                  const v = Number(d.total);
                  const pct = totalDespesas > 0 ? (v / totalDespesas) * 100 : 0;
                  return (
                    <tr key={d.categoriaId ?? `sem-${i}`} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-800">
                        {d.categoriaDescricao ?? (
                          <span className="text-slate-400">Sem categoria</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {int(Number(d.qtd))}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
                        {brl(v)}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-slate-500">
                        {pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-6 text-xs text-slate-500">
          <strong>Nota:</strong> DRE simplificado. Receitas = pagamentos registrados no PDV
          (inclui dinheiro, cartão, Pix). Despesas = contas a pagar efetivamente pagas no mês
          (valor_pago). Contas em aberto aparecem como provisão mas não afetam o resultado.
        </p>
      </section>
    </main>
  );
}

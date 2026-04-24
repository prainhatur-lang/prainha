import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, count, eq, ilike, isNull, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  q?: string;
  page?: string;
}

const PAGE_SIZE = 50;

export default async function ProdutosPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;
  const q = (sp.q ?? '').trim();
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

  const where = and(
    eq(schema.produto.filialId, filialSelecionada.id),
    q
      ? sql`(${ilike(schema.produto.nome, `%${q}%`)} OR ${ilike(
          schema.produto.descricao,
          `%${q}%`,
        )} OR ${ilike(schema.produto.codigoPersonalizado, `%${q}%`)})`
      : undefined,
  );

  const [stats] = await db
    .select({ qtd: count() })
    .from(schema.produto)
    .where(where);

  const produtos = await db
    .select({
      id: schema.produto.id,
      codigoExterno: schema.produto.codigoExterno,
      nome: schema.produto.nome,
      codigoPersonalizado: schema.produto.codigoPersonalizado,
      precoVenda: schema.produto.precoVenda,
      precoCusto: schema.produto.precoCusto,
      estoqueAtual: schema.produto.estoqueAtual,
      estoqueMinimo: schema.produto.estoqueMinimo,
      estoqueControlado: schema.produto.estoqueControlado,
      descontinuado: schema.produto.descontinuado,
      itemPorKg: schema.produto.itemPorKg,
      ncm: schema.produto.ncm,
    })
    .from(schema.produto)
    .where(where)
    .orderBy(asc(schema.produto.nome))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  const totalPag = Math.max(1, Math.ceil(Number(stats?.qtd ?? 0) / PAGE_SIZE));
  const hrefPag = (p: number) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    if (q) qs.set('q', q);
    if (p > 0) qs.set('page', String(p));
    return `/cadastros/produtos?${qs.toString()}`;
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Produtos</h1>
        <p className="mt-1 text-sm text-slate-600">
          {int(Number(stats?.qtd ?? 0))} produto(s) cadastrado(s) na {filialSelecionada.nome}.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/cadastros/produtos?filialId=${f.id}`}
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

        <form method="GET" className="mt-4 flex items-center gap-2">
          <input type="hidden" name="filialId" value={filialSelecionada.id} />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Buscar por nome, descrição ou código..."
            className="w-80 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Buscar
          </button>
          {q && (
            <Link
              href={`/cadastros/produtos?filialId=${filialSelecionada.id}`}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Limpar
            </Link>
          )}
        </form>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Código</th>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2 text-right">Preço venda</th>
                <th className="px-4 py-2 text-right">Custo</th>
                <th className="px-4 py-2 text-right">Margem</th>
                <th className="px-4 py-2 text-right">Estoque</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {produtos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-500">
                    {q ? 'Nenhum produto com esse filtro.' : 'Aguardando sincronização do agente.'}
                  </td>
                </tr>
              ) : (
                produtos.map((p) => {
                  const venda = Number(p.precoVenda ?? 0);
                  const custo = Number(p.precoCusto ?? 0);
                  const margem = venda > 0 && custo > 0 ? ((venda - custo) / venda) * 100 : null;
                  const estoque = Number(p.estoqueAtual ?? 0);
                  const estoqueMin = Number(p.estoqueMinimo ?? 0);
                  const abaixo = p.estoqueControlado && estoque < estoqueMin;
                  return (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs text-slate-600">
                        {p.codigoPersonalizado || p.codigoExterno}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-800">
                        {p.nome ?? `#${p.codigoExterno}`}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
                        {brl(venda)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {custo > 0 ? brl(custo) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-xs">
                        {margem !== null ? (
                          <span
                            className={`font-mono ${
                              margem >= 50
                                ? 'text-emerald-700'
                                : margem >= 20
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                            }`}
                          >
                            {margem.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {p.estoqueControlado ? (
                          <span className={abaixo ? 'text-rose-700 font-semibold' : 'text-slate-700'}>
                            {p.itemPorKg ? estoque.toFixed(3) : estoque.toFixed(0)}
                            {abaixo && <span className="ml-1">⚠</span>}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {p.descontinuado ? (
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800">
                            Descontinuado
                          </span>
                        ) : (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                            Ativo
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {totalPag > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs">
              <span className="text-slate-600">
                Página {page + 1} de {totalPag} · {int(Number(stats?.qtd ?? 0))} total
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

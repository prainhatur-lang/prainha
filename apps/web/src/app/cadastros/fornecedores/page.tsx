import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, count, desc, eq, ilike, isNull, sql, sum } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int, maskCnpj } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  q?: string;
  page?: string;
}

const PAGE_SIZE = 50;

export default async function FornecedoresPage(props: { searchParams: Promise<SP> }) {
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
    eq(schema.fornecedor.filialId, filialSelecionada.id),
    isNull(schema.fornecedor.dataDelete),
    q
      ? sql`(${ilike(schema.fornecedor.nome, `%${q}%`)} OR ${ilike(
          schema.fornecedor.razaoSocial,
          `%${q}%`,
        )} OR ${ilike(schema.fornecedor.cnpjOuCpf, `%${q.replace(/\D/g, '')}%`)})`
      : undefined,
  );

  const [stats] = await db
    .select({
      qtd: count(),
    })
    .from(schema.fornecedor)
    .where(where);

  const fornecedores = await db
    .select({
      id: schema.fornecedor.id,
      codigoExterno: schema.fornecedor.codigoExterno,
      nome: schema.fornecedor.nome,
      razaoSocial: schema.fornecedor.razaoSocial,
      cnpjOuCpf: schema.fornecedor.cnpjOuCpf,
      cidade: schema.fornecedor.cidade,
      uf: schema.fornecedor.uf,
      email: schema.fornecedor.email,
      fonePrincipal: schema.fornecedor.fonePrincipal,
    })
    .from(schema.fornecedor)
    .where(where)
    .orderBy(asc(schema.fornecedor.nome))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  // Total em contas a pagar por fornecedor (em aberto)
  const abertas = await db
    .select({
      fornecedorId: schema.contaPagar.fornecedorId,
      qtd: count(),
      total: sum(schema.contaPagar.valor),
    })
    .from(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.filialId, filialSelecionada.id),
        isNull(schema.contaPagar.dataDelete),
        isNull(schema.contaPagar.dataPagamento),
      ),
    )
    .groupBy(schema.contaPagar.fornecedorId);
  const abertasByFornecedor = new Map<string, { qtd: number; total: number }>();
  for (const a of abertas) {
    if (a.fornecedorId) abertasByFornecedor.set(a.fornecedorId, { qtd: Number(a.qtd), total: Number(a.total ?? 0) });
  }

  const totalPag = Math.max(1, Math.ceil(Number(stats?.qtd ?? 0) / PAGE_SIZE));
  const hrefPag = (p: number) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    if (q) qs.set('q', q);
    if (p > 0) qs.set('page', String(p));
    return `/cadastros/fornecedores?${qs.toString()}`;
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Fornecedores</h1>
        <p className="mt-1 text-sm text-slate-600">
          {int(Number(stats?.qtd ?? 0))} fornecedor(es) ativo(s) na {filialSelecionada.nome}.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/cadastros/fornecedores?filialId=${f.id}`}
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
            placeholder="Buscar por nome, razão social ou CNPJ..."
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
              href={`/cadastros/fornecedores?filialId=${filialSelecionada.id}`}
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
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">Razão Social</th>
                <th className="px-4 py-2">CNPJ / CPF</th>
                <th className="px-4 py-2">Cidade/UF</th>
                <th className="px-4 py-2">Contato</th>
                <th className="px-4 py-2 text-right">Em aberto</th>
              </tr>
            </thead>
            <tbody>
              {fornecedores.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-xs text-slate-500">
                    {q ? 'Nenhum fornecedor com esse filtro.' : 'Aguardando sincronização do agente.'}
                  </td>
                </tr>
              ) : (
                fornecedores.map((f) => {
                  const aberto = abertasByFornecedor.get(f.id);
                  return (
                    <tr key={f.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium text-slate-900">{f.nome ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-slate-600">{f.razaoSocial ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">
                        {f.cnpjOuCpf ? (f.cnpjOuCpf.length === 14 ? maskCnpj(f.cnpjOuCpf) : f.cnpjOuCpf) : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-600">
                        {f.cidade ? `${f.cidade}${f.uf ? '/' + f.uf : ''}` : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-600">
                        {[f.email, f.fonePrincipal].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {aberto ? (
                          <Link
                            href={`/financeiro?filialId=${filialSelecionada.id}&status=abertas`}
                            className="inline-block text-xs"
                          >
                            <span className="font-mono font-medium text-slate-900">
                              {brl(aberto.total)}
                            </span>
                            <span className="ml-1 text-slate-500">({aberto.qtd})</span>
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
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

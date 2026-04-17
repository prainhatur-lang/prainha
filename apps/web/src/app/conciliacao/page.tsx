import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { desc, inArray } from 'drizzle-orm';
import { LogoutButton } from '../dashboard/logout-button';
import { ConciliacaoForm } from './form';
import { brl, formatDateTime, int } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ConciliacaoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);

  const execucoes = filialIds.length
    ? await db
        .select()
        .from(schema.execucaoConciliacao)
        .where(inArray(schema.execucaoConciliacao.filialId, filialIds))
        .orderBy(desc(schema.execucaoConciliacao.iniciadoEm))
        .limit(20)
    : [];

  const filMap = new Map(filiais.map((f) => [f.id, f.nome]));

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-semibold text-slate-900">
              concilia
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
                Dashboard
              </Link>
              <Link href="/sync" className="text-slate-600 hover:text-slate-900">
                Sincronização
              </Link>
              <Link href="/upload" className="text-slate-600 hover:text-slate-900">
                Upload
              </Link>
              <Link href="/conciliacao" className="font-medium text-slate-900">
                Conciliação
              </Link>
              <Link href="/excecoes" className="text-slate-600 hover:text-slate-900">
                Exceções
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Conciliação</h1>
        <p className="mt-1 text-sm text-slate-600">
          Cruza pagamentos do PDV com vendas Cielo e lançamentos do banco. Identifica o que ficou sem rastreamento.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <ConciliacaoForm
            filiais={filiais.map((f) => ({
              id: f.id,
              nome: f.nome,
              dataInicioConciliacao: f.dataInicioConciliacao,
            }))}
          />

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Últimas execuções</h2>
            {execucoes.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">Nenhuma execução ainda.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {execucoes.map((e) => {
                  const r = e.resumo as
                    | {
                        totalPagamentos: number;
                        completos: number;
                        excecoes: number;
                        valorTotal: number;
                        valorRastreado: number;
                      }
                    | null;
                  const pct = r && r.valorTotal > 0 ? (r.valorRastreado / r.valorTotal) * 100 : 0;
                  return (
                    <div
                      key={e.id}
                      className="rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{filMap.get(e.filialId) ?? e.filialId}</p>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                            e.status === 'OK'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : e.status === 'ERRO'
                                ? 'border-rose-200 bg-rose-50 text-rose-700'
                                : 'border-amber-200 bg-amber-50 text-amber-700'
                          }`}
                        >
                          {e.status}
                        </span>
                      </div>
                      {r && (
                        <div className="mt-2 space-y-1 text-xs text-slate-600">
                          <p>
                            {int(r.totalPagamentos)} pagamentos · {int(r.completos)} OK · {int(r.excecoes)} exceções
                          </p>
                          <p>
                            Rastreado: {brl(r.valorRastreado)} de {brl(r.valorTotal)} ({pct.toFixed(1)}%)
                          </p>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full bg-emerald-500 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {e.erro && <p className="mt-2 text-xs text-rose-600">{e.erro}</p>}
                      <p className="mt-1.5 text-[11px] text-slate-400">
                        {formatDateTime(e.iniciadoEm)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

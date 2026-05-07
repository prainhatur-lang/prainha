// Lista de folhas semanais por filial.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { desc, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { labelSemana, semanaAnterior } from '@/lib/folha/semana';
import { NovaFolhaButton } from './nova-folha-button';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function FolhasPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  // Folhas existentes da filial
  const folhas = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.filialId, filialSelecionada.id))
    .orderBy(desc(schema.folhaSemana.dataInicio))
    .limit(30);

  // Sugestão de "próxima folha": semana anterior à atual (típico ciclo seg-dom).
  const semanaSugerida = semanaAnterior();
  const jaTemSugerida = folhas.some(
    (f) => f.dataInicio === semanaSugerida.inicio,
  );

  // Tem config?
  const [config] = await db
    .select({ filialId: schema.folhaConfig.filialId })
    .from(schema.folhaConfig)
    .where(eq(schema.folhaConfig.filialId, filialSelecionada.id))
    .limit(1);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Folhas semanais</h1>
            <p className="mt-1 text-sm text-slate-600">
              Cada folha cobre uma semana (segunda a domingo) e gera lançamentos automáticos no contas a pagar.
            </p>
          </div>
        </div>

        {/* Selector filial */}
        {filiais.length > 1 && (
          <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
            <label className="text-xs font-medium text-slate-500">Filial</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {filiais.map((f) => {
                const active = f.id === filialSelecionada.id;
                return (
                  <a
                    key={f.id}
                    href={`?filialId=${f.id}`}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {f.nome}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {!config && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            ⚠ Esta filial ainda não foi configurada.{' '}
            <Link
              href={`/folha-equipe/configuracao?filialId=${filialSelecionada.id}`}
              className="underline font-medium"
            >
              Configurar agora
            </Link>{' '}
            (% empresa/gerente, taxa diarista, categorias, etc.) — necessário antes de criar folha.
          </div>
        )}

        {/* Sugestão "Nova folha" */}
        {config && !jaTemSugerida && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-900">
                  Próxima folha sugerida
                </p>
                <p className="mt-0.5 text-base text-blue-700">
                  {labelSemana(semanaSugerida.inicio, semanaSugerida.fim)} (semana anterior)
                </p>
              </div>
              <NovaFolhaButton
                filialId={filialSelecionada.id}
                inicio={semanaSugerida.inicio}
                fim={semanaSugerida.fim}
              />
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs">
              <tr>
                <th className="px-5 py-3 text-left font-medium text-slate-500">Semana</th>
                <th className="px-5 py-3 text-left font-medium text-slate-500">Status</th>
                <th className="px-5 py-3 text-right font-medium text-slate-500">10% total</th>
                <th className="px-5 py-3 text-left font-medium text-slate-500">Criada em</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {folhas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">
                    Nenhuma folha criada ainda.
                  </td>
                </tr>
              ) : (
                folhas.map((f) => {
                  const dezPct = (f.dezPctPorDia as Record<string, number>) ?? {};
                  const totalDezPct = Object.values(dezPct).reduce((a, b) => a + (b ?? 0), 0);
                  return (
                    <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-900">
                        {labelSemana(f.dataInicio, f.dataFim)}
                      </td>
                      <td className="px-5 py-3">
                        {f.status === 'aberta' && (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            ● aberta
                          </span>
                        )}
                        {f.status === 'fechada' && (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            ✓ fechada
                          </span>
                        )}
                        {f.status === 'cancelada' && (
                          <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
                            ✗ cancelada
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-slate-700">
                        {totalDezPct.toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        })}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">
                        {f.criadoEm.toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Link
                          href={`/folha-equipe/folhas/${f.id}`}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          Abrir →
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
    </main>
  );
}

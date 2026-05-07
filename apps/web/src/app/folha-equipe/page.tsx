// Pagina raiz do modulo folha-equipe.
// Lista as filiais e mostra atalhos pra configuracao, cadastro de pessoas
// e folhas semanais.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { eq, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

export default async function FolhaEquipePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const filiaisIds = filiais.map((f) => f.id);

  // Stats por filial: tem config? quantas pessoas cadastradas?
  const configs =
    filiaisIds.length > 0
      ? await db
          .select()
          .from(schema.folhaConfig)
          .where(inArray(schema.folhaConfig.filialId, filiaisIds))
      : [];
  const configByFilial = new Map(configs.map((c) => [c.filialId, c]));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Folha da equipe</h1>
          <p className="mt-1 text-sm text-slate-600">
            Calcula a folha semanal dos garçons / diaristas / gerente. Lança automaticamente
            no contas a pagar.
          </p>
        </div>

        {filiais.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
            Nenhuma filial disponível.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filiais.map((f) => {
              const cfg = configByFilial.get(f.id);
              const configurado = !!cfg;
              return (
                <article
                  key={f.id}
                  className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <header className="mb-4">
                    <h2 className="text-base font-semibold text-slate-900">{f.nome}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {configurado ? (
                        <span className="text-emerald-700">✓ Configurada</span>
                      ) : (
                        <span className="text-amber-700">⚠ Sem configuração — comece por aqui</span>
                      )}
                    </p>
                  </header>

                  {configurado && cfg && (
                    <div className="mb-4 grid grid-cols-3 gap-2 rounded bg-slate-50 p-3 text-xs">
                      <div>
                        <div className="text-slate-500">Empresa</div>
                        <div className="font-mono font-semibold">{cfg.ppEmpresa}pp</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Gerente</div>
                        <div className="font-mono font-semibold">{cfg.ppGerente}pp</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Funcionários</div>
                        <div className="font-mono font-semibold">{cfg.ppFuncionarios}pp</div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <Link
                      href={`/folha-equipe/configuracao?filialId=${f.id}`}
                      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-center text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      ⚙️ Configurar
                    </Link>
                    <Link
                      href={`/folha-equipe/pessoas?filialId=${f.id}`}
                      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-center text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      👥 Pessoas
                    </Link>
                    <Link
                      href={`/folha-equipe/folhas?filialId=${f.id}`}
                      className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-center text-xs font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      📋 Folhas
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="mt-8 rounded border border-blue-200 bg-blue-50 p-4 text-xs text-blue-800">
          <p className="mb-2 font-semibold">Como começar:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Abra <strong>⚙️ Configurar</strong> da filial e defina a divisão dos 10% (empresa/gerente/funcionários), taxa diarista, transporte e categorias do plano de contas</li>
            <li>Em <strong>👥 Pessoas</strong>, vincule cada pessoa que recebe folha (fornecedor com CPF) e defina o papel (funcionário/diarista/gerente)</li>
            <li>Em <strong>📋 Folhas</strong>, crie a folha da semana, suba o espelho de ponto, revise descontos/acréscimos e fecha — gera os lançamentos no contas a pagar</li>
          </ol>
        </div>
      </section>
    </main>
  );
}

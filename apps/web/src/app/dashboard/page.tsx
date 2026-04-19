import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario, syncStats } from '@/lib/filiais';
import { brl, int, relativeTime, statusFromPing } from '@/lib/format';
import { LogoutButton } from './logout-button';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const statsList = await Promise.all(filiais.map((f) => syncStats(f.id)));

  const totalPagamentos = statsList.reduce((s, x) => s + x.totalPagamentos, 0);
  const totalValor = statsList.reduce((s, x) => s + Number(x.valorTotal), 0);
  const filiaisOnline = filiais.filter((f) => statusFromPing(f.ultimoPing) === 'online').length;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-semibold text-slate-900">
              concilia
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="font-medium text-slate-900">
                Dashboard
              </Link>
              <Link href="/sync" className="text-slate-600 hover:text-slate-900">
                Sincronização
              </Link>
              <Link href="/upload" className="text-slate-600 hover:text-slate-900">
                Upload
              </Link>
              <Link href="/conciliacao" className="text-slate-600 hover:text-slate-900">
                Conciliação
              </Link>
              <Link href="/relatorio" className="text-slate-600 hover:text-slate-900">
                Relatório
              </Link>
              <Link href="/excecoes" className="text-slate-600 hover:text-slate-900">
                Exceções
              </Link>
              <Link href="/fechamento" className="text-slate-600 hover:text-slate-900">
                Fechamento
              </Link>
              <Link href="/configuracoes" className="text-slate-600 hover:text-slate-900">
                Configurações
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
        <h1 className="text-2xl font-bold text-slate-900">Visão geral</h1>
        <p className="mt-1 text-sm text-slate-600">
          Resumo das suas {filiais.length} {filiais.length === 1 ? 'filial' : 'filiais'}
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard label="Pagamentos sincronizados" value={int(totalPagamentos)} />
          <KpiCard label="Total movimentado" value={brl(totalValor)} />
          <KpiCard
            label="Filiais online"
            value={`${filiaisOnline} / ${filiais.length}`}
            tone={filiaisOnline === filiais.length ? 'green' : 'amber'}
          />
        </div>

        <h2 className="mt-10 text-lg font-semibold text-slate-900">Filiais</h2>
        <div className="mt-4 grid grid-cols-1 gap-3">
          {filiais.map((f) => {
            const s = statsList.find((x) => x.filialId === f.id)!;
            const status = statusFromPing(f.ultimoPing);
            return (
              <Link
                key={f.id}
                href="/sync"
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-slate-300"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      status === 'online'
                        ? 'bg-emerald-500'
                        : status === 'warn'
                          ? 'bg-amber-500'
                          : status === 'offline'
                            ? 'bg-rose-500'
                            : 'bg-slate-400'
                    }`}
                  />
                  <div>
                    <p className="font-medium text-slate-900">{f.nome}</p>
                    <p className="text-xs text-slate-500">
                      último ping {relativeTime(f.ultimoPing)} · {int(s.totalPagamentos)} pgtos · {brl(s.valorTotal)}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-slate-400">→</span>
              </Link>
            );
          })}
        </div>

        <div className="mt-12 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Roadmap</h3>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <RoadmapCard title="Fase 1" desc="Agente local + ingestão" status="ok" />
            <RoadmapCard title="Fase 2" desc="Upload Cielo + CNAB" status="ok" />
            <RoadmapCard title="Fase 3" desc="Engine de conciliação" status="atual" />
          </div>
        </div>
      </section>
    </main>
  );
}

function KpiCard({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: string;
  tone?: 'slate' | 'green' | 'amber';
}) {
  const tones = {
    slate: 'bg-white border-slate-200',
    green: 'bg-emerald-50 border-emerald-200',
    amber: 'bg-amber-50 border-amber-200',
  } as const;
  return (
    <div className={`rounded-xl border p-5 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function RoadmapCard({ title, desc, status }: { title: string; desc: string; status?: string }) {
  const isAtual = status === 'atual';
  const isOk = status === 'ok';
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        isAtual
          ? 'border-slate-900 bg-slate-900 text-white'
          : isOk
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-slate-200 bg-slate-50'
      }`}
    >
      <p
        className={`text-xs font-semibold uppercase tracking-wide ${
          isAtual ? 'text-slate-300' : isOk ? 'text-emerald-700' : 'text-slate-500'
        }`}
      >
        {title} {status && <span className="ml-1 normal-case">({isOk ? '✓ pronto' : status})</span>}
      </p>
      <p className={`mt-1 text-sm ${isAtual ? 'text-white' : 'text-slate-700'}`}>{desc}</p>
    </div>
  );
}

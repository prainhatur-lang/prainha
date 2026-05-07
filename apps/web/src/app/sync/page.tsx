import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario, syncStats } from '@/lib/filiais';
import { brl, formatDateTime, int, maskCnpj, relativeTime, statusFromPing } from '@/lib/format';
import { AppHeader } from '@/components/app-header';
import { VERSAO_RELEASE } from '../api/agente-release/route';

// Sempre executa em runtime (nao prerender) - Supabase + DB
export const dynamic = 'force-dynamic';

export default async function SyncPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const statsList = await Promise.all(filiais.map((f) => syncStats(f.id)));
  const stats = new Map(statsList.map((s) => [s.filialId, s]));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Sincronização das filiais</h1>
            <p className="mt-1 text-sm text-slate-600">
              Status do agente local de cada restaurante.{' '}
              <span className="text-xs text-slate-400">
                Auto-refresh: recarregue a página para ver atualizações.
              </span>
            </p>
          </div>
          <span className="text-xs text-slate-500">Versão atual: <strong>v{VERSAO_RELEASE}</strong></span>
        </div>

        <details className="mb-8 rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm shadow-sm" open>
          <summary className="cursor-pointer font-semibold text-blue-900">
            🚀 Como instalar/atualizar o agente em 1 clique
          </summary>
          <ol className="mt-4 space-y-2 pl-5 text-slate-700 list-decimal">
            <li>
              Em cada card de filial abaixo, clique em <strong>📦 Baixar instalador</strong> —
              baixa um arquivo <code className="rounded bg-white px-1.5 py-0.5 text-xs">.bat</code> com o token da filial já embutido.
            </li>
            <li>
              Conecta no PC da filial via Chrome Remote Desktop e copia o <code>.bat</code> pra lá (Downloads, Desktop, etc).
            </li>
            <li>
              <strong>Duplo-clique no .bat</strong> → aceita o UAC (privilégio de Admin) → espera ~1 min.
            </li>
            <li>
              Em até 15 min a filial aparece como <span className="font-medium text-emerald-700">online</span> aqui.
            </li>
          </ol>
          <p className="mt-3 text-xs text-blue-800">
            O instalador é idempotente — funciona pra <strong>instalar do zero</strong>, <strong>atualizar versão</strong> ou <strong>reparar instalação quebrada</strong>. Preserva checkpoint do sync.
          </p>
        </details>

        {filiais.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
            Você não tem acesso a nenhuma filial ainda.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filiais.map((f) => {
              const s = stats.get(f.id)!;
              const status = statusFromPing(f.ultimoPing);
              return <FilialCard key={f.id} filial={f} stats={s} status={status} />;
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function FilialCard({
  filial,
  stats,
  status,
}: {
  filial: Awaited<ReturnType<typeof filiaisDoUsuario>>[0];
  stats: Awaited<ReturnType<typeof syncStats>>;
  status: ReturnType<typeof statusFromPing>;
}) {
  const statusColors = {
    online: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
    offline: 'bg-rose-50 text-rose-700 border-rose-200',
    never: 'bg-slate-100 text-slate-600 border-slate-200',
  } as const;
  const statusLabels = {
    online: '● online',
    warn: '● atrasado',
    offline: '● offline',
    never: '○ nunca pingou',
  } as const;

  const dotClass = {
    online: 'bg-emerald-500',
    warn: 'bg-amber-500',
    offline: 'bg-rose-500',
    never: 'bg-slate-400',
  } as const;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{filial.nome}</h2>
          <p className="mt-0.5 text-xs text-slate-500">CNPJ {maskCnpj(filial.cnpj)}</p>
          <p className="mt-0.5 text-xs text-slate-500">{filial.organizacaoNome}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusColors[status]}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dotClass[status]}`} />
          {statusLabels[status].replace('● ', '').replace('○ ', '')}
        </span>
      </header>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <Stat label="Último ping" value={relativeTime(filial.ultimoPing)} sub={formatDateTime(filial.ultimoPing)} />
        <Stat label="Última sync" value={relativeTime(stats.ultimaSincronizacao)} sub={formatDateTime(stats.ultimaSincronizacao)} />
        <Stat label="Pagamentos no DB" value={int(stats.totalPagamentos)} />
        <Stat label="Total movimentado" value={brl(stats.valorTotal)} />
        <Stat label="Último CODIGO sync" value={int(stats.ultimoCodigo)} />
        <Stat label="Total enviado pelo agente" value={int(stats.totalSincronizados)} />
      </dl>

      {stats.diasComMovimento.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Movimento últimos 14 dias
          </p>
          <Sparkbar dias={stats.diasComMovimento} />
        </div>
      )}

      <div className="mt-6 flex items-center gap-2">
        <a
          href={`/api/agente-release/instalar.bat?filial=${filial.id}`}
          download
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
          title="Baixa um .bat com o token da filial embutido. Duplo-clique no PC pra instalar/atualizar."
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Baixar instalador
        </a>
        <span className="text-xs text-slate-500">
          .bat com token. Duplo-clique no PC da filial.
        </span>
      </div>

      <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">
          Token do agente (raw — só pra debug)
        </summary>
        <pre className="mt-2 overflow-x-auto rounded bg-white p-2 font-mono text-[11px] text-slate-700">
          {filial.agenteToken}
        </pre>
      </details>
    </article>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-slate-900">{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-slate-400">{sub}</dd>}
    </div>
  );
}

function Sparkbar({ dias }: { dias: { data: string; qtd: number; valor: string }[] }) {
  // Preenche os ultimos 14 dias com zeros
  const map = new Map(dias.map((d) => [d.data, d]));
  const hoje = new Date();
  const buckets: { data: string; qtd: number; valor: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const item = map.get(iso);
    buckets.push({
      data: iso,
      qtd: item?.qtd ?? 0,
      valor: item ? Number(item.valor) : 0,
    });
  }

  const maxValor = Math.max(1, ...buckets.map((b) => b.valor));

  return (
    <div className="mt-2 flex h-20 items-end gap-1">
      {buckets.map((b) => {
        const h = Math.max(2, Math.round((b.valor / maxValor) * 80));
        const dia = b.data.slice(8, 10);
        const isHoje = b.data === hoje.toISOString().slice(0, 10);
        return (
          <div key={b.data} className="group relative flex flex-1 flex-col items-center gap-1">
            <div
              className={`w-full rounded-t ${b.valor > 0 ? 'bg-slate-900' : 'bg-slate-200'} ${isHoje ? 'opacity-100' : 'opacity-80'}`}
              style={{ height: `${h}px` }}
              title={`${b.data}: ${b.qtd} pgto, ${brl(b.valor)}`}
            />
            <span className="text-[9px] text-slate-400">{dia}</span>
          </div>
        );
      })}
    </div>
  );
}

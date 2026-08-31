// /rh/clima — dashboard de clima organizacional (eNPS). Supressão
// k-anônima (k=3): competência com menos de 3 respostas não mostra
// distribuição nem comentários.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { QrSvg } from '@/components/qr-svg';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { dashboardClima } from '@/lib/clima/dashboard';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

function KPI({ label, valor, cor = 'text-slate-900', sub }: { label: string; valor: string; cor?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${cor}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function fmtCompetencia(c: string): string {
  const [ano, mes] = c.split('-');
  const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${MESES[Number(mes)]}/${ano.slice(2)}`;
}

function corEnps(enps: number): string {
  if (enps >= 50) return 'text-emerald-700';
  if (enps >= 0) return 'text-amber-700';
  return 'text-rose-700';
}

export default async function ClimaPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'clima.read');
  const podeVerComentarios = await podeUsuario(user.id, 'clima.comentarios');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial = await escolherFilial(filiais, sp.filialId);

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-4xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }

  const [meses, [filialToken]] = await Promise.all([
    dashboardClima(filial.id, 6),
    db.select({ climaToken: schema.filial.climaToken }).from(schema.filial).where(eq(schema.filial.id, filial.id)),
  ]);
  const mesAtual = meses[meses.length - 1];

  const h = await headers();
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const linkClima = filialToken?.climaToken ? `${base}/clima/${filialToken.climaToken}` : null;

  const maxTotal = Math.max(1, ...meses.map((m) => m.total));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Clima organizacional</h1>
          <p className="mt-0.5 text-xs text-slate-500">{filial.nome} · eNPS anônimo — respostas com menos de 3 pessoas ficam ocultas</p>
        </div>

        {filiais.length > 1 && (
          <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/rh/clima?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${f.id === filial.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KPI
            label={`eNPS ${fmtCompetencia(mesAtual.competencia)}`}
            valor={mesAtual.enps != null ? String(mesAtual.enps) : '—'}
            cor={mesAtual.enps != null ? corEnps(mesAtual.enps) : 'text-slate-400'}
            sub={mesAtual.total < 3 ? 'poucas respostas, oculto' : `${mesAtual.total} respostas`}
          />
          <KPI label="Promotores (9-10)" valor={mesAtual.enps != null ? String(mesAtual.promotores) : '—'} cor="text-emerald-700" />
          <KPI label="Neutros (7-8)" valor={mesAtual.enps != null ? String(mesAtual.neutros) : '—'} />
          <KPI label="Detratores (0-6)" valor={mesAtual.enps != null ? String(mesAtual.detratores) : '—'} cor="text-rose-700" />
        </div>

        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Série (últimos 6 meses)</h2>
          <div className="flex items-end gap-3" style={{ height: 140 }}>
            {meses.map((m) => (
              <div key={m.competencia} className="flex flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[11px] font-medium text-slate-600">{m.enps != null ? m.enps : '—'}</span>
                <div className="flex w-full items-end justify-center" style={{ height: 90 }}>
                  <div
                    className={`w-6 rounded-t ${m.enps == null ? 'bg-slate-200' : m.enps >= 50 ? 'bg-emerald-500' : m.enps >= 0 ? 'bg-amber-500' : 'bg-rose-500'}`}
                    style={{ height: `${Math.max(4, (m.total / maxTotal) * 100)}%` }}
                    title={`${m.total} respostas`}
                  />
                </div>
                <span className="text-[10px] text-slate-500">{fmtCompetencia(m.competencia)}</span>
              </div>
            ))}
          </div>
        </div>

        {linkClima && (
          <details className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">📱 QR / link da pesquisa</summary>
            <div className="mt-3 flex items-center gap-4">
              <QrSvg content={linkClima} size={130} />
              <div className="min-w-0 flex-1">
                <p className="break-all font-mono text-[10px] text-slate-500">{linkClima}</p>
                <p className="mt-2 text-[11px] text-slate-400">
                  Fica aberta nos primeiros dias de cada mês. Imprima junto com o QR da ouvidoria.
                </p>
              </div>
            </div>
          </details>
        )}

        {mesAtual.total >= 3 && podeVerComentarios && mesAtual.comentarios && mesAtual.comentarios.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Comentários — {fmtCompetencia(mesAtual.competencia)}</h2>
            <ul className="space-y-2">
              {mesAtual.comentarios.map((c, i) => (
                <li key={i} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <span className={`mr-2 font-semibold ${corEnps(c.nota >= 9 ? 100 : c.nota <= 6 ? -100 : 0)}`}>{c.nota}</span>
                  <span className="text-slate-700">{c.comentario}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

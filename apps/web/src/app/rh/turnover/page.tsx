// Turnover / rotatividade — admissões, desligamentos, tempo de casa, quebra
// por setor e motivo. Zero schema novo: tudo já existe em `funcionario`
// desde a Fase 1 (dataAdmissao/dataDesligamento/motivoDesligamento/setor).

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  ano?: string;
  mes?: string;
}

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
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

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{titulo}</h2>
      {children}
    </section>
  );
}

export default async function TurnoverPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'funcionario.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial = await escolherFilial(filiais, sp.filialId);

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }

  const [hojeAno, hojeMes] = hojeBr().split('-').map(Number);
  const ano = sp.ano ? Number(sp.ano) : hojeAno;
  const mes = sp.mes ? Number(sp.mes) : hojeMes;
  const mm = String(mes).padStart(2, '0');
  const inicio = `${ano}-${mm}-01`;
  const fim = `${ano}-${mm}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`;

  const [admitidos, desligados, ativosInicio, ativosFim, porSetor, porMotivo] = await Promise.all([
    db
      .select()
      .from(schema.funcionario)
      .where(and(eq(schema.funcionario.filialId, filial.id), sql`${schema.funcionario.dataAdmissao} BETWEEN ${inicio} AND ${fim}`))
      .orderBy(schema.funcionario.dataAdmissao),
    db
      .select()
      .from(schema.funcionario)
      .where(and(eq(schema.funcionario.filialId, filial.id), sql`${schema.funcionario.dataDesligamento} BETWEEN ${inicio} AND ${fim}`))
      .orderBy(schema.funcionario.dataDesligamento),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.funcionario)
      .where(
        and(
          eq(schema.funcionario.filialId, filial.id),
          sql`(${schema.funcionario.dataAdmissao} IS NULL OR ${schema.funcionario.dataAdmissao} <= ${inicio})`,
          sql`(${schema.funcionario.dataDesligamento} IS NULL OR ${schema.funcionario.dataDesligamento} >= ${inicio})`,
        ),
      )
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.funcionario)
      .where(
        and(
          eq(schema.funcionario.filialId, filial.id),
          sql`(${schema.funcionario.dataAdmissao} IS NULL OR ${schema.funcionario.dataAdmissao} <= ${fim})`,
          sql`(${schema.funcionario.dataDesligamento} IS NULL OR ${schema.funcionario.dataDesligamento} >= ${fim})`,
        ),
      )
      .then((r) => r[0]?.n ?? 0),
    db
      .select({
        setor: schema.funcionario.setor,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.funcionario)
      .where(and(eq(schema.funcionario.filialId, filial.id), sql`${schema.funcionario.dataDesligamento} BETWEEN ${inicio} AND ${fim}`))
      .groupBy(schema.funcionario.setor),
    db
      .select({
        motivo: schema.funcionario.motivoDesligamento,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.funcionario)
      .where(and(eq(schema.funcionario.filialId, filial.id), sql`${schema.funcionario.dataDesligamento} BETWEEN ${inicio} AND ${fim}`))
      .groupBy(schema.funcionario.motivoDesligamento),
  ]);

  const mediaAtivos = (ativosInicio + ativosFim) / 2;
  const taxaTurnover = mediaAtivos > 0 ? (desligados.length / mediaAtivos) * 100 : 0;

  const temposCasa = desligados
    .filter((f) => f.dataAdmissao && f.dataDesligamento)
    .map((f) => {
      const dias = (new Date(f.dataDesligamento! + 'T12:00:00').getTime() - new Date(f.dataAdmissao! + 'T12:00:00').getTime()) / 86400000;
      return dias;
    });
  const tempoMedioCasaDias = temposCasa.length ? temposCasa.reduce((a, b) => a + b, 0) / temposCasa.length : null;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Turnover</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {filial.nome} · {MESES[mes]}/{ano} · admissões, desligamentos e rotatividade
            </p>
          </div>
        </div>

        <div className="mb-5 space-y-2">
          {filiais.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500">Filial:</span>
              {filiais.map((f) => (
                <a
                  key={f.id}
                  href={`/rh/turnover?filialId=${f.id}&ano=${ano}&mes=${mes}`}
                  className={`rounded-md border px-3 py-1 text-xs ${f.id === filial.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {f.nome}
                </a>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Mês:</span>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <a
                key={m}
                href={`/rh/turnover?filialId=${filial.id}&ano=${ano}&mes=${m}`}
                className={`rounded-md border px-2.5 py-1 text-xs ${m === mes ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {MESES[m].slice(0, 3)}
              </a>
            ))}
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KPI label="Admissões" valor={String(admitidos.length)} cor="text-emerald-600" />
          <KPI label="Desligamentos" valor={String(desligados.length)} cor="text-rose-600" />
          <KPI
            label="Taxa de turnover"
            valor={`${taxaTurnover.toFixed(1).replace('.', ',')}%`}
            sub={`${desligados.length} de ~${mediaAtivos.toFixed(0)} ativos`}
          />
          <KPI
            label="Tempo médio de casa"
            valor={tempoMedioCasaDias != null ? `${Math.round(tempoMedioCasaDias / 30)} meses` : '—'}
            sub={tempoMedioCasaDias != null ? `${Math.round(tempoMedioCasaDias)} dias` : 'sem desligamentos no período'}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Secao titulo={`Admissões (${admitidos.length})`}>
            {admitidos.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhuma admissão no período.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {admitidos.map((f) => (
                  <li key={f.id} className="flex items-center justify-between py-1.5">
                    <span className="text-slate-800">{f.nome}</span>
                    <span className="text-xs text-slate-500">{fmtData(f.dataAdmissao)} · {f.cargo ?? '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <Secao titulo={`Desligamentos (${desligados.length})`}>
            {desligados.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum desligamento no período.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {desligados.map((f) => (
                  <li key={f.id} className="py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-800">{f.nome}</span>
                      <span className="text-xs text-slate-500">{fmtData(f.dataDesligamento)}</span>
                    </div>
                    {f.motivoDesligamento && <p className="text-xs text-slate-400">{f.motivoDesligamento}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <Secao titulo="Desligamentos por setor">
            {porSetor.length === 0 ? (
              <p className="text-xs text-slate-400">Sem dados no período.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {porSetor.map((s) => (
                  <li key={s.setor ?? '—'} className="flex items-center justify-between">
                    <span className="text-slate-700">{s.setor ?? '(sem setor)'}</span>
                    <span className="font-medium text-slate-900">{s.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <Secao titulo="Desligamentos por motivo">
            {porMotivo.length === 0 ? (
              <p className="text-xs text-slate-400">Sem dados no período.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {porMotivo.map((s) => (
                  <li key={s.motivo ?? '—'} className="flex items-center justify-between">
                    <span className="text-slate-700">{s.motivo ?? '(sem motivo registrado)'}</span>
                    <span className="font-medium text-slate-900">{s.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
        </div>
      </div>
    </main>
  );
}

// /rh/metas/[id] — detalhe de uma meta. Se status='aberta', mede a métrica
// ao vivo (nada gravado). Se avaliada/vinculada, mostra os valores
// congelados no momento da avaliação + o rateio por pessoa.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { medirMetrica, METRICA_LABEL, type Metrica } from '@/lib/metas/metricas';
import { AcoesMeta } from './acoes-meta';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  aberta: 'Em andamento',
  avaliada: 'Avaliada',
  vinculada: 'Vinculada à folha',
  cancelada: 'Cancelada',
};

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
  const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${MESES[Number(mes)]}/${ano}`;
}

function fmtValor(metrica: string, v: number): string {
  if (metrica === 'pedidos') return v.toLocaleString('pt-BR');
  if (metrica === 'avaliacao_media') return v.toFixed(2).replace('.', ',');
  return brl(v);
}

export default async function MetaDetalhePage(props: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'meta.read');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [meta] = await db.select().from(schema.metaEquipe).where(eq(schema.metaEquipe.id, id)).limit(1);
  if (!meta) notFound();

  const filiais = await filiaisDoUsuario(user.id);
  const filial = filiais.find((f) => f.id === meta.filialId);
  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-4xl px-6 py-10 text-sm text-slate-500">Sem acesso a essa filial.</p>
      </main>
    );
  }

  let valorRealizado: number;
  let bateuMeta: boolean;
  let rateio: Array<{ fornecedorId: string; pessoaNome: string; minutosTrabalhados: number; valorRateado: string }> = [];

  if (meta.status === 'aberta') {
    const [ano, mes] = meta.competencia.split('-').map(Number);
    valorRealizado = await medirMetrica(meta.filialId, meta.metrica as Metrica, ano, mes);
    bateuMeta = valorRealizado >= Number(meta.valorAlvo);
  } else {
    valorRealizado = meta.valorRealizado != null ? Number(meta.valorRealizado) : 0;
    bateuMeta = meta.bateuMeta ?? false;
    rateio = await db.select().from(schema.metaEquipeRateio).where(eq(schema.metaEquipeRateio.metaEquipeId, id));
  }

  const valorAlvo = Number(meta.valorAlvo);
  const pct = valorAlvo > 0 ? Math.min(100, (valorRealizado / valorAlvo) * 100) : 0;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="mb-4">
          <Link href={`/rh/metas?filialId=${filial.id}`} className="text-xs text-slate-500 hover:underline">
            ← Metas
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">{meta.nome}</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · {fmtCompetencia(meta.competencia)} · {METRICA_LABEL[meta.metrica as Metrica] ?? meta.metrica} · {STATUS_LABEL[meta.status] ?? meta.status}
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KPI label="Alvo" valor={fmtValor(meta.metrica, valorAlvo)} />
          <KPI
            label={meta.status === 'aberta' ? 'Realizado (ao vivo)' : 'Realizado (congelado)'}
            valor={fmtValor(meta.metrica, valorRealizado)}
            cor={bateuMeta ? 'text-emerald-700' : 'text-slate-900'}
            sub={`${pct.toFixed(0)}% do alvo`}
          />
          <KPI label="Premiação" valor={brl(Number(meta.premiacaoTotal))} sub={bateuMeta ? 'a distribuir' : 'não se aplica'} />
          <KPI
            label="Resultado"
            valor={meta.status === 'aberta' ? (bateuMeta ? 'Batendo 🎯' : 'Em progresso') : bateuMeta ? 'Bateu ✅' : 'Não bateu'}
            cor={bateuMeta ? 'text-emerald-700' : 'text-slate-500'}
          />
        </div>

        <div className="mb-5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${bateuMeta ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${Math.max(2, pct)}%` }} />
        </div>

        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Ações</h2>
          <AcoesMeta metaId={meta.id} status={meta.status} bateuMeta={meta.bateuMeta} />
          {meta.status === 'aberta' && (
            <p className="mt-3 text-[11px] text-slate-400">
              Avaliação é manual — os dados de fechamento do mês podem mudar por alguns dias após o mês
              fechar, então confira antes de avaliar.
            </p>
          )}
          {meta.status === 'vinculada' && (
            <p className="mt-3 text-[11px] text-slate-400">
              Premiação já entrou como ajuste na folha semanal — confira em Folhas semanais.
            </p>
          )}
        </div>

        {rateio.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Rateio por pessoa ({rateio.length})</h2>
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-2 py-1.5 text-left font-medium">Pessoa</th>
                  <th className="px-2 py-1.5 text-right font-medium">Minutos</th>
                  <th className="px-2 py-1.5 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {rateio
                  .slice()
                  .sort((a, b) => Number(b.valorRateado) - Number(a.valorRateado))
                  .map((r) => (
                    <tr key={r.fornecedorId} className="border-b border-slate-50">
                      <td className="px-2 py-1.5 text-slate-800">{r.pessoaNome}</td>
                      <td className="px-2 py-1.5 text-right text-slate-500">{Math.round(r.minutosTrabalhados / 60)}h</td>
                      <td className="px-2 py-1.5 text-right font-medium text-slate-900">{brl(Number(r.valorRateado))}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

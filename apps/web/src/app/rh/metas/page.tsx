// /rh/metas — lista de metas de equipe/filial (sem progresso ao vivo, que
// é calculado só no detalhe — evita rodar dashboardFechamento N vezes aqui).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { db, schema } from '@concilia/db';
import { desc, eq } from 'drizzle-orm';
import { NovaMetaForm } from './nova-meta-form';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

const METRICA_LABEL: Record<string, string> = {
  faturamento: 'Faturamento',
  faturamento_liquido: 'Faturamento líquido',
  ticket_medio: 'Ticket médio',
  servico: 'Serviço (10%)',
  pedidos: 'Pedidos',
  avaliacao_media: 'Avaliação média',
};

const STATUS_BADGE: Record<string, string> = {
  aberta: 'bg-sky-50 text-sky-700 border-sky-200',
  avaliada: 'bg-amber-50 text-amber-700 border-amber-200',
  vinculada: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelada: 'bg-slate-100 text-slate-500 border-slate-200',
};

const STATUS_LABEL: Record<string, string> = {
  aberta: 'Em andamento',
  avaliada: 'Avaliada',
  vinculada: 'Vinculada à folha',
  cancelada: 'Cancelada',
};

function fmtCompetencia(c: string): string {
  const [ano, mes] = c.split('-');
  const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${MESES[Number(mes)]}/${ano}`;
}

export default async function MetasPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'meta.read');

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

  const metas = await db
    .select()
    .from(schema.metaEquipe)
    .where(eq(schema.metaEquipe.filialId, filial.id))
    .orderBy(desc(schema.metaEquipe.competencia));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Metas e premiação</h1>
            <p className="mt-0.5 text-xs text-slate-500">{filial.nome} · meta de equipe/filial, avaliada manualmente</p>
          </div>
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/rh/metas?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${f.id === filial.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        <div className="mb-5">
          <NovaMetaForm filialId={filial.id} />
        </div>

        {metas.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            Nenhuma meta cadastrada ainda.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Meta</th>
                  <th className="px-3 py-2 text-left font-medium">Competência</th>
                  <th className="px-3 py-2 text-left font-medium">Métrica</th>
                  <th className="px-3 py-2 text-right font-medium">Alvo</th>
                  <th className="px-3 py-2 text-right font-medium">Premiação</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {metas.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link href={`/rh/metas/${m.id}`} className="font-medium text-sky-700 hover:underline">
                        {m.nome}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{fmtCompetencia(m.competencia)}</td>
                    <td className="px-3 py-2 text-slate-600">{METRICA_LABEL[m.metrica] ?? m.metrica}</td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {m.metrica === 'pedidos' ? Number(m.valorAlvo).toLocaleString('pt-BR') : brl(Number(m.valorAlvo))}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">{brl(Number(m.premiacaoTotal))}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[m.status] ?? ''}`}>
                        {STATUS_LABEL[m.status] ?? m.status}
                      </span>
                    </td>
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

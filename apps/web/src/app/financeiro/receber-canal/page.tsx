// /financeiro/receber-canal — dinheiro que um canal (iFood etc.) já cobrou do
// cliente e ainda vai repassar. Nasce sozinho quando o ingest recebe um
// pedido desse canal (ver api/ingest/pdv/conta-receber-canal.ts).
//
// Hoje o valor é sempre o BRUTO: a leitura automática do líquido depende da
// API financeira do canal, que ainda não está ligada (ver memória
// ifood-integracao-propria). A baixa é manual: o financeiro bate o repasse
// que caiu no banco contra os lançamentos abertos do período.

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDateTime } from '@/lib/format';
import { LinhaReceberCanal } from './linha';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  status?: 'aberto' | 'recebido' | 'cancelado' | 'todos';
}

const CANAL_LABEL: Record<string, string> = { ifood: 'iFood' };

export default async function ReceberCanalPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_receber.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial = await escolherFilial(filiais, sp.filialId);
  const status = sp.status ?? 'aberto';

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const fid = filial.id;

  const lancamentos = await db
    .select()
    .from(schema.contaReceberCanal)
    .where(and(
      eq(schema.contaReceberCanal.filialId, fid),
      status === 'todos' ? sql`true` : eq(schema.contaReceberCanal.status, status),
    ))
    .orderBy(desc(schema.contaReceberCanal.dataPedido))
    .limit(300);

  const [resumo] = await db
    .select({
      abertoN: sql<number>`count(*) FILTER (WHERE status='aberto')::int`,
      abertoV: sql<string>`COALESCE(SUM(valor_bruto) FILTER (WHERE status='aberto'), 0)`,
      recebidoMesN: sql<number>`count(*) FILTER (WHERE status='recebido' AND data_recebimento >= date_trunc('month', now()))::int`,
      recebidoMesV: sql<string>`COALESCE(SUM(valor_recebido) FILTER (WHERE status='recebido' AND data_recebimento >= date_trunc('month', now())), 0)`,
    })
    .from(schema.contaReceberCanal)
    .where(eq(schema.contaReceberCanal.filialId, fid));

  const abas: { v: SP['status']; label: string }[] = [
    { v: 'aberto', label: 'Em aberto' },
    { v: 'recebido', label: 'Recebidos' },
    { v: 'cancelado', label: 'Cancelados' },
    { v: 'todos', label: 'Todos' },
  ];

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">A receber de canais</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Pedido de canal que já cobra do cliente (iFood…) — o dinheiro está com o canal, não é dívida do cliente.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-amber-700">Em aberto</div>
            <div className="mt-1 text-2xl font-bold text-amber-900">{brl(resumo?.abertoV ?? 0)}</div>
            <div className="text-xs text-amber-700">{resumo?.abertoN ?? 0} pedido(s)</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">Recebido este mês</div>
            <div className="mt-1 text-2xl font-bold text-emerald-900">{brl(resumo?.recebidoMesV ?? 0)}</div>
            <div className="text-xs text-emerald-700">{resumo?.recebidoMesN ?? 0} pedido(s)</div>
          </div>
        </div>

        <div className="mt-5 flex gap-1 border-b border-slate-200">
          {abas.map((a) => (
            <a
              key={a.v}
              href={`?filialId=${fid}&status=${a.v}`}
              className={`rounded-t-lg px-3 py-2 text-sm font-medium ${
                status === a.v
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {a.label}
            </a>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2.5">Canal</th>
                <th className="px-4 py-2.5">Pedido</th>
                <th className="px-4 py-2.5">Cliente</th>
                <th className="px-4 py-2.5">Data</th>
                <th className="px-4 py-2.5 text-right">Bruto</th>
                <th className="px-4 py-2.5 text-right">Recebido</th>
                <th className="px-4 py-2.5">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lancamentos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    Nada por aqui.
                  </td>
                </tr>
              ) : (
                lancamentos.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700">
                      {CANAL_LABEL[l.canal] ?? l.canal}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      #{l.pedidoCodigoExterno}
                      {l.pedidoNumero ? ` · mesa ${l.pedidoNumero}` : ' · entrega'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{l.nomeCliente || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{formatDateTime(l.dataPedido)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-800">{brl(l.valorBruto)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {l.valorRecebido ? brl(l.valorRecebido) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <LinhaReceberCanal id={l.id} status={l.status} valorBruto={Number(l.valorBruto)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

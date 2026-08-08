// Orçamentos de eventos — lista por filial, com atalho pra criar e imprimir.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { desc, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDate } from '@/lib/format';
import {
  calcularTotais,
  diaSemanaBr,
  numeroOrcamento,
  STATUS_ORCAMENTO,
  type StatusOrcamento,
} from '@/lib/orcamentos';

export const dynamic = 'force-dynamic';

export default async function OrcamentosPage(props: {
  searchParams: Promise<{ f?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'orcamento.read');
  const podeCriar = await podeUsuario(user.id, 'orcamento.create');

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  const { f } = await props.searchParams;
  const filialFiltro = f && filialIds.includes(f) ? f : null;
  const escopo = filialFiltro ? [filialFiltro] : filialIds;

  const linhas =
    escopo.length === 0
      ? []
      : await db
          .select({
            id: schema.orcamentoEvento.id,
            numero: schema.orcamentoEvento.numero,
            filialId: schema.orcamentoEvento.filialId,
            local: schema.orcamentoEvento.local,
            clienteNome: schema.orcamentoEvento.clienteNome,
            dataEvento: schema.orcamentoEvento.dataEvento,
            hora: schema.orcamentoEvento.hora,
            pessoas: schema.orcamentoEvento.pessoas,
            valorPessoa: schema.orcamentoEvento.valorPessoa,
            taxaEspaco: schema.orcamentoEvento.taxaEspaco,
            taxaExclusividade: schema.orcamentoEvento.taxaExclusividade,
            status: schema.orcamentoEvento.status,
          })
          .from(schema.orcamentoEvento)
          .where(inArray(schema.orcamentoEvento.filialId, escopo))
          .orderBy(desc(schema.orcamentoEvento.criadoEm))
          .limit(200);

  const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));
  const num = (v: string | null) => (v == null ? null : Number(v));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Orçamentos de eventos</h1>
            <p className="text-sm text-slate-500">
              Monte o orçamento do grupo e gere o PDF prontinho pra mandar pro cliente.
            </p>
          </div>
          {podeCriar && (
            <Link
              href="/orcamentos/novo"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              + Novo orçamento
            </Link>
          )}
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2">
            <Link
              href="/orcamentos"
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                !filialFiltro
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              Todas
            </Link>
            {filiais.map((fil) => (
              <Link
                key={fil.id}
                href={`/orcamentos?f=${fil.id}`}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  filialFiltro === fil.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
                }`}
              >
                {fil.nome}
              </Link>
            ))}
          </div>
        )}

        {linhas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            Nenhum orçamento ainda.
            {podeCriar && (
              <>
                {' '}
                <Link href="/orcamentos/novo" className="text-blue-600 underline hover:no-underline">
                  Criar o primeiro
                </Link>
                .
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Nº</th>
                  <th className="px-3 py-2 font-medium">Local</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Evento</th>
                  <th className="px-3 py-2 text-right font-medium">Pessoas</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((o) => {
                  const totais = calcularTotais({
                    pessoas: o.pessoas,
                    valorPessoa: num(o.valorPessoa),
                    taxaEspaco: num(o.taxaEspaco),
                    taxaExclusividade: num(o.taxaExclusividade),
                  });
                  const st =
                    STATUS_ORCAMENTO[(o.status as StatusOrcamento) ?? 'aberto'] ??
                    STATUS_ORCAMENTO.aberto;
                  return (
                    <tr key={o.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-500">
                        {numeroOrcamento(o.numero)}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">
                        {o.local ?? nomeFilial.get(o.filialId) ?? '—'}
                        {o.local && (
                          <span className="block text-[10px] text-slate-400">
                            {nomeFilial.get(o.filialId)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-900">{o.clienteNome}</td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {formatDate(o.dataEvento)}{' '}
                        <span className="text-xs text-slate-400">
                          ({diaSemanaBr(o.dataEvento)}){o.hora ? ` · ${o.hora}` : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{o.pessoas}</td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {totais.total != null ? (
                          brl(totais.total)
                        ) : (
                          <span className="text-slate-400">a combinar</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cor}`}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link
                          href={`/orcamentos/${o.id}`}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          Abrir →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

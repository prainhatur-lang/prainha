import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, count, desc, eq, gte, isNotNull, isNull, lte, sql, sum } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { NovaOpButton } from './nova-op';

export const dynamic = 'force-dynamic';

type StatusFiltro = 'TODAS' | 'RASCUNHO' | 'PRA_REVISAR' | 'CONCLUIDA' | 'CANCELADA';

interface SP {
  filialId?: string;
  status?: StatusFiltro;
  responsavel?: string;
  dataIni?: string;
  dataFim?: string;
  page?: string;
}

const PAGE_SIZE = 50;

const BADGE_STATUS: Record<string, { label: string; cls: string }> = {
  RASCUNHO: { label: 'Em aberto', cls: 'bg-amber-100 text-amber-800' },
  CONCLUIDA: { label: 'Concluída', cls: 'bg-emerald-100 text-emerald-800' },
  CANCELADA: { label: 'Cancelada', cls: 'bg-rose-100 text-rose-800' },
};

export default async function ProducaoPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;
  const status = (sp.status ?? 'TODAS') as StatusFiltro;
  const responsavelFiltro = (sp.responsavel ?? '').trim();
  const dataIni = sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(90);
  const dataFim = sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim) ? sp.dataFim : hojeBr();
  const page = Math.max(0, Number(sp.page ?? '0') || 0);

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const dtIni = new Date(dataIni + 'T00:00:00-03:00');
  const dtFim = new Date(dataFim + 'T23:59:59-03:00');

  const where = and(
    eq(schema.ordemProducao.filialId, filialSelecionada.id),
    gte(schema.ordemProducao.dataHora, dtIni),
    lte(schema.ordemProducao.dataHora, dtFim),
    // PRA_REVISAR = RASCUNHO + cozinheiro marcou pronta. Esse é um sub-filtro
    // virtual (não é status real no banco).
    status === 'PRA_REVISAR'
      ? and(
          eq(schema.ordemProducao.status, 'RASCUNHO'),
          isNotNull(schema.ordemProducao.marcadaProntaEm),
        )
      : status !== 'TODAS'
        ? eq(schema.ordemProducao.status, status)
        : undefined,
    responsavelFiltro
      ? eq(schema.ordemProducao.responsavel, responsavelFiltro)
      : undefined,
  );

  const [stats] = await db
    .select({ qtd: count(), custo: sum(schema.ordemProducao.custoTotalEntradas) })
    .from(schema.ordemProducao)
    .where(where);

  // Templates ativos pra o botão "Nova OP a partir de template"
  const templates = await db
    .select({
      id: schema.templateOp.id,
      nome: schema.templateOp.nome,
      vezesUsado: schema.templateOp.vezesUsado,
    })
    .from(schema.templateOp)
    .where(
      and(
        eq(schema.templateOp.filialId, filialSelecionada.id),
        eq(schema.templateOp.ativo, true),
      ),
    )
    .orderBy(desc(schema.templateOp.vezesUsado), schema.templateOp.nome);

  // Lista de cozinheiros pro filtro (apenas com OPs no período pra evitar
  // poluição de cadastros antigos sem uso recente)
  const cozinheirosFiltro = await db.execute<{ nome: string; qtd: number }>(sql`
    SELECT responsavel AS nome, COUNT(*)::int AS qtd
    FROM ${schema.ordemProducao}
    WHERE filial_id = ${filialSelecionada.id}
      AND data_hora >= ${dtIni.toISOString()}
      AND data_hora <= ${dtFim.toISOString()}
      AND responsavel IS NOT NULL
      AND TRIM(responsavel) <> ''
    GROUP BY responsavel
    ORDER BY qtd DESC, responsavel ASC
  `);

  // KPI: comprometido em rascunho — soma valor das entradas em OPs RASCUNHO
  // (não filtra por período, pra garantir visibilidade total de pendências).
  const [rascunhoStats] = await db.execute<{ qtd: number; valor: string }>(sql`
    SELECT
      COUNT(DISTINCT op.id)::int AS qtd,
      COALESCE(
        SUM(
          COALESCE(${schema.ordemProducaoEntrada.valorTotal}, 0)
        ),
        0
      )::text AS valor
    FROM ${schema.ordemProducao} op
    LEFT JOIN ${schema.ordemProducaoEntrada}
      ON ${schema.ordemProducaoEntrada.ordemProducaoId} = op.id
    WHERE op.filial_id = ${filialSelecionada.id}
      AND op.status = 'RASCUNHO'
  `);

  // KPI: OPs aguardando revisão — RASCUNHO + cozinheiro marcou pronta
  const [revisaoStats] = await db
    .select({ qtd: count() })
    .from(schema.ordemProducao)
    .where(
      and(
        eq(schema.ordemProducao.filialId, filialSelecionada.id),
        eq(schema.ordemProducao.status, 'RASCUNHO'),
        isNotNull(schema.ordemProducao.marcadaProntaEm),
      ),
    );

  const ops = await db
    .select({
      id: schema.ordemProducao.id,
      descricao: schema.ordemProducao.descricao,
      responsavel: schema.ordemProducao.responsavel,
      dataHora: schema.ordemProducao.dataHora,
      status: schema.ordemProducao.status,
      custoTotalEntradas: schema.ordemProducao.custoTotalEntradas,
      divergenciaPercentual: schema.ordemProducao.divergenciaPercentual,
      concluidaEm: schema.ordemProducao.concluidaEm,
      marcadaProntaEm: schema.ordemProducao.marcadaProntaEm,
      qtdEntradas: sql<number>`(SELECT COUNT(*)::int FROM ${schema.ordemProducaoEntrada} WHERE ${schema.ordemProducaoEntrada.ordemProducaoId} = ${schema.ordemProducao.id})`,
      qtdSaidas: sql<number>`(SELECT COUNT(*)::int FROM ${schema.ordemProducaoSaida} WHERE ${schema.ordemProducaoSaida.ordemProducaoId} = ${schema.ordemProducao.id})`,
    })
    .from(schema.ordemProducao)
    .where(where)
    .orderBy(desc(schema.ordemProducao.dataHora))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  const totalPag = Math.max(1, Math.ceil(Number(stats?.qtd ?? 0) / PAGE_SIZE));
  const hrefPreserva = (override: Partial<SP>) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    const nextStatus = override.status !== undefined ? override.status : status;
    const nextResp =
      override.responsavel !== undefined ? override.responsavel : responsavelFiltro;
    const nextPage = override.page !== undefined ? override.page : String(page);
    if (dataIni) qs.set('dataIni', dataIni);
    if (dataFim) qs.set('dataFim', dataFim);
    if (nextStatus && nextStatus !== 'TODAS') qs.set('status', nextStatus);
    if (nextResp) qs.set('responsavel', nextResp);
    if (nextPage && nextPage !== '0') qs.set('page', nextPage);
    return `/movimento/producao?${qs.toString()}`;
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Ordens de produção</h1>
            <p className="mt-1 text-sm text-slate-600">
              Transformação de insumos brutos em produtos. Ex: 3kg filé mignon →
              2kg medalhão + 500g grelha + 300g aparas + 200g perda.
            </p>
          </div>
          <NovaOpButton filialId={filialSelecionada.id} templates={templates} />
        </div>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/movimento/producao?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === filialSelecionada.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              OPs no período
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {int(Number(stats?.qtd ?? 0))}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Custo total insumos
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {brl(Number(stats?.custo ?? 0))}
            </p>
          </div>
          <Link
            href={hrefPreserva({ status: 'PRA_REVISAR', page: '0' })}
            className={`rounded-xl border p-4 transition ${
              Number(revisaoStats?.qtd ?? 0) > 0
                ? 'border-emerald-400 bg-emerald-50 hover:bg-emerald-100'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <p
              className={`text-[11px] font-medium uppercase tracking-wide ${
                Number(revisaoStats?.qtd ?? 0) > 0 ? 'text-emerald-700' : 'text-slate-500'
              }`}
            >
              ⏳ Aguardando revisão
            </p>
            <p
              className={`mt-1 text-2xl font-bold ${
                Number(revisaoStats?.qtd ?? 0) > 0 ? 'text-emerald-900' : 'text-slate-900'
              }`}
            >
              {int(Number(revisaoStats?.qtd ?? 0))}
            </p>
            <p
              className={`mt-0.5 text-[10px] ${
                Number(revisaoStats?.qtd ?? 0) > 0 ? 'text-emerald-700' : 'text-slate-500'
              }`}
            >
              cozinheiro marcou pronta — revise e conclua
            </p>
          </Link>
          <Link
            href={hrefPreserva({ status: 'RASCUNHO', page: '0' })}
            className={`rounded-xl border p-4 transition ${
              Number(rascunhoStats?.qtd ?? 0) > 0
                ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <p
              className={`text-[11px] font-medium uppercase tracking-wide ${
                Number(rascunhoStats?.qtd ?? 0) > 0 ? 'text-amber-700' : 'text-slate-500'
              }`}
            >
              Comprometido em aberto
            </p>
            <p
              className={`mt-1 text-2xl font-bold ${
                Number(rascunhoStats?.qtd ?? 0) > 0 ? 'text-amber-900' : 'text-slate-900'
              }`}
            >
              {brl(Number(rascunhoStats?.valor ?? 0))}
            </p>
            <p
              className={`mt-0.5 text-[10px] ${
                Number(rascunhoStats?.qtd ?? 0) > 0 ? 'text-amber-700' : 'text-slate-500'
              }`}
            >
              {int(Number(rascunhoStats?.qtd ?? 0))} OP(s) abertas
            </p>
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">Status:</span>
          {(['TODAS', 'RASCUNHO', 'PRA_REVISAR', 'CONCLUIDA', 'CANCELADA'] as const).map((s) => {
            const label =
              s === 'TODAS'
                ? 'Todas'
                : s === 'PRA_REVISAR'
                  ? '⏳ Pra revisar'
                  : BADGE_STATUS[s]?.label ?? s;
            const ehRevisar = s === 'PRA_REVISAR';
            const ativo = status === s;
            return (
              <Link
                key={s}
                href={hrefPreserva({ status: s, page: '0' })}
                className={`rounded-md border px-2.5 py-1 ${
                  ativo
                    ? ehRevisar
                      ? 'border-emerald-700 bg-emerald-700 text-white'
                      : 'border-slate-900 bg-slate-900 text-white'
                    : ehRevisar
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {cozinheirosFiltro.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Cozinheiro:</span>
            <Link
              href={hrefPreserva({ responsavel: '', page: '0' })}
              className={`rounded-md border px-2.5 py-1 ${
                !responsavelFiltro
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Todos
            </Link>
            {cozinheirosFiltro.slice(0, 8).map((c) => (
              <Link
                key={c.nome}
                href={hrefPreserva({ responsavel: c.nome, page: '0' })}
                className={`rounded-md border px-2.5 py-1 ${
                  responsavelFiltro === c.nome
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {c.nome}
                <span className="ml-1 text-[10px] opacity-60">{c.qtd}</span>
              </Link>
            ))}
            {cozinheirosFiltro.length > 8 && (
              <span className="text-[10px] text-slate-400">
                +{cozinheirosFiltro.length - 8}
              </span>
            )}
          </div>
        )}

        <form method="GET" className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="filialId" value={filialSelecionada.id} />
          {status !== 'TODAS' && <input type="hidden" name="status" value={status} />}
          <label className="text-xs text-slate-600">
            De
            <input
              type="date"
              name="dataIni"
              defaultValue={dataIni}
              className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Até
            <input
              type="date"
              name="dataFim"
              defaultValue={dataFim}
              className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Filtrar
          </button>
        </form>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Data</th>
                <th className="px-4 py-2">Descrição</th>
                <th className="px-4 py-2">Responsável</th>
                <th className="px-4 py-2 text-center">Entradas</th>
                <th className="px-4 py-2 text-center">Saídas</th>
                <th className="px-4 py-2 text-right">Custo</th>
                <th className="px-4 py-2 text-right">Diverg.</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {ops.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                    Nenhuma ordem de produção no período. Clique em "+ Nova OP" pra criar.
                  </td>
                </tr>
              ) : (
                ops.map((op) => {
                  const badge = BADGE_STATUS[op.status] ?? { label: op.status, cls: 'bg-slate-100' };
                  const div = op.divergenciaPercentual ? Number(op.divergenciaPercentual) : null;
                  const aguardandoRevisao =
                    op.status === 'RASCUNHO' && op.marcadaProntaEm;
                  return (
                    <tr key={op.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">
                        {op.dataHora ? new Date(op.dataHora).toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <Link
                          href={`/movimento/producao/${op.id}`}
                          className="text-slate-800 hover:text-slate-900 hover:underline"
                        >
                          {op.descricao ?? <span className="text-slate-400">(sem descrição)</span>}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-700">
                        {op.responsavel ?? (
                          <span className="text-slate-400 italic">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center font-mono text-xs text-slate-700">
                        {op.qtdEntradas}
                      </td>
                      <td className="px-4 py-2 text-center font-mono text-xs text-slate-700">
                        {op.qtdSaidas}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-medium">
                        {op.custoTotalEntradas ? brl(op.custoTotalEntradas) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {div !== null ? (
                          <span
                            className={
                              Math.abs(div) < 1
                                ? 'text-slate-500'
                                : Math.abs(div) < 5
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                            }
                          >
                            {div.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {aguardandoRevisao ? (
                          <span
                            className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800"
                            title={`Marcada pronta em ${op.marcadaProntaEm ? new Date(op.marcadaProntaEm).toLocaleString('pt-BR') : ''}`}
                          >
                            ⏳ Pra revisar
                          </span>
                        ) : (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {totalPag > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs">
              <span className="text-slate-600">
                Página {page + 1} de {totalPag} · {int(Number(stats?.qtd ?? 0))} total
              </span>
              <div className="flex gap-2">
                {page > 0 ? (
                  <Link href={hrefPreserva({ page: String(page - 1) })} className="rounded-md border border-slate-300 bg-white px-2 py-1">
                    ← Anterior
                  </Link>
                ) : (
                  <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">← Anterior</span>
                )}
                {page < totalPag - 1 ? (
                  <Link href={hrefPreserva({ page: String(page + 1) })} className="rounded-md border border-slate-300 bg-white px-2 py-1">
                    Próxima →
                  </Link>
                ) : (
                  <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">Próxima →</span>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

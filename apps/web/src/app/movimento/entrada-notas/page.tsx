import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, count, desc, eq, gte, ilike, lte, sql, sum } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int, maskCnpj } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { UploadNotasForm } from './upload-form';
import { ManifestarBtn } from './manifestar-btn';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  q?: string;
  dataIni?: string;
  dataFim?: string;
  origem?: string;
  page?: string;
}

type OrigemFiltro = 'TODAS' | 'UPLOAD' | 'SEFAZ_DFE' | 'SEFAZ_DFE_RESUMO' | 'SEFAZ_DFE_RESUMO_CIENTE';

const ORIGEM_LABEL: Record<string, { label: string; curto: string; cls: string }> = {
  UPLOAD: {
    label: 'Upload manual',
    curto: 'Manual',
    cls: 'bg-slate-100 text-slate-700',
  },
  SEFAZ_DFE: {
    label: 'SEFAZ DF-e (completa)',
    curto: 'SEFAZ',
    cls: 'bg-sky-100 text-sky-800',
  },
  SEFAZ_DFE_RESUMO: {
    label: 'SEFAZ DF-e (resumo — precisa ciência)',
    curto: 'Resumo',
    cls: 'bg-amber-100 text-amber-800',
  },
  SEFAZ_DFE_RESUMO_CIENTE: {
    label: 'Ciência enviada — aguardando XML completo',
    curto: 'Aguard.',
    cls: 'bg-violet-100 text-violet-800',
  },
};

const PAGE_SIZE = 50;

export default async function EntradaNotasPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;
  const q = (sp.q ?? '').trim();
  // Filtro padrao 365 dias — cobre praticamente todas as NFes do ano fiscal.
  // 90 dias era curto demais: notas atrasadas (Manifesto SEFAZ, fornecedor que
  // demorou pra entregar, NFe de devolucao antiga) sumiam da grade.
  const dataIni = sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(365);
  const dataFim = sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim) ? sp.dataFim : hojeBr();
  const origem = (sp.origem ?? 'TODAS') as OrigemFiltro;
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
    eq(schema.notaCompra.filialId, filialSelecionada.id),
    gte(schema.notaCompra.dataEmissao, dtIni),
    lte(schema.notaCompra.dataEmissao, dtFim),
    origem !== 'TODAS' ? eq(schema.notaCompra.origemImportacao, origem) : undefined,
    q
      ? sql`(${ilike(schema.notaCompra.emitNome, `%${q}%`)} OR ${ilike(
          schema.notaCompra.emitCnpj,
          `%${q.replace(/\D/g, '')}%`,
        )} OR ${ilike(schema.notaCompra.chave, `%${q.replace(/\D/g, '')}%`)})`
      : undefined,
  );

  // Contador de resumos AINDA não manifestados (precisa ação manual).
  // SEFAZ_DFE_RESUMO_CIENTE já foi manifestado — aguarda XML completo chegar na próxima consulta.
  const [resumosPendentes] = await db
    .select({ qtd: count() })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, filialSelecionada.id),
        gte(schema.notaCompra.dataEmissao, dtIni),
        lte(schema.notaCompra.dataEmissao, dtFim),
        eq(schema.notaCompra.origemImportacao, 'SEFAZ_DFE_RESUMO'),
      ),
    );

  const [stats] = await db
    .select({
      qtd: count(),
      total: sum(schema.notaCompra.valorTotal),
    })
    .from(schema.notaCompra)
    .where(where);

  const notas = await db
    .select({
      id: schema.notaCompra.id,
      chave: schema.notaCompra.chave,
      serie: schema.notaCompra.serie,
      numero: schema.notaCompra.numero,
      dataEmissao: schema.notaCompra.dataEmissao,
      emitNome: schema.notaCompra.emitNome,
      emitCnpj: schema.notaCompra.emitCnpj,
      emitUf: schema.notaCompra.emitUf,
      valorTotal: schema.notaCompra.valorTotal,
      valorProdutos: schema.notaCompra.valorProdutos,
      situacao: schema.notaCompra.situacao,
      origemImportacao: schema.notaCompra.origemImportacao,
    })
    .from(schema.notaCompra)
    .where(where)
    .orderBy(desc(schema.notaCompra.dataEmissao))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  // Top fornecedores no período
  const topFornecedores = await db
    .select({
      emitNome: schema.notaCompra.emitNome,
      emitCnpj: schema.notaCompra.emitCnpj,
      qtd: sql<number>`COUNT(*)::int`,
      total: sql<string>`COALESCE(SUM(${schema.notaCompra.valorTotal}), 0)::text`,
    })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, filialSelecionada.id),
        gte(schema.notaCompra.dataEmissao, dtIni),
        lte(schema.notaCompra.dataEmissao, dtFim),
      ),
    )
    .groupBy(schema.notaCompra.emitNome, schema.notaCompra.emitCnpj)
    .orderBy(sql`4 DESC`)
    .limit(10);

  const totalPag = Math.max(1, Math.ceil(Number(stats?.qtd ?? 0) / PAGE_SIZE));
  const hrefPag = (p: number) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    if (q) qs.set('q', q);
    if (dataIni) qs.set('dataIni', dataIni);
    if (dataFim) qs.set('dataFim', dataFim);
    if (origem !== 'TODAS') qs.set('origem', origem);
    if (p > 0) qs.set('page', String(p));
    return `/movimento/entrada-notas?${qs.toString()}`;
  };

  const hrefOrigem = (o: OrigemFiltro) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    if (q) qs.set('q', q);
    if (dataIni) qs.set('dataIni', dataIni);
    if (dataFim) qs.set('dataFim', dataFim);
    if (o !== 'TODAS') qs.set('origem', o);
    return `/movimento/entrada-notas?${qs.toString()}`;
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Entrada de notas fiscais</h1>
        <p className="mt-1 text-sm text-slate-600">
          Controle histórico de compras. Via upload de XML manual ou{' '}
          <Link href="/configuracoes/certificados" className="text-sky-700 underline-offset-2 hover:underline">
            SEFAZ automático (Distribuição DF-e)
          </Link>
          .
        </p>

        {Number(resumosPendentes?.qtd ?? 0) > 0 && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-semibold">
              ⚠ {int(Number(resumosPendentes?.qtd ?? 0))} nota(s) estão como resumo
            </p>
            <p className="mt-1 text-amber-800">
              A SEFAZ só devolve XML completo depois que você der ciência da operação. Enquanto isso,
              você tem chave + fornecedor + valor, mas sem itens/impostos detalhados. Dar ciência
              não compromete a empresa.{' '}
              <Link href={hrefOrigem('SEFAZ_DFE_RESUMO')} className="underline">
                Ver só os resumos →
              </Link>
            </p>
            <ManifestarBtn filialId={filialSelecionada.id} />
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
          {/* Coluna esquerda: upload + filtro */}
          <div className="space-y-4">
            <UploadNotasForm
              filialId={filialSelecionada.id}
              filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
            />

            {topFornecedores.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">Top fornecedores</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {dataIni.split('-').reverse().join('/')} a {dataFim.split('-').reverse().join('/')}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {topFornecedores.map((f, i) => (
                    <li key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate pr-2 text-slate-700">{f.emitNome ?? '—'}</span>
                      <span className="shrink-0 font-mono font-medium text-slate-900">
                        {brl(Number(f.total))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Coluna direita: busca + lista */}
          <div className="space-y-4">
            {filiais.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-500">Filial:</span>
                {filiais.map((f) => (
                  <Link
                    key={f.id}
                    href={`/movimento/entrada-notas?filialId=${f.id}`}
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

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
                  Notas no período
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {int(Number(stats?.qtd ?? 0))}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
                  Total comprado
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {brl(Number(stats?.total ?? 0))}
                </p>
              </div>
            </div>

            {/* Tabs de origem */}
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="mr-1 text-slate-500">Origem:</span>
              {(['TODAS', 'UPLOAD', 'SEFAZ_DFE', 'SEFAZ_DFE_RESUMO', 'SEFAZ_DFE_RESUMO_CIENTE'] as const).map((o) => {
                const ativo = o === origem;
                const label =
                  o === 'TODAS'
                    ? 'Todas'
                    : ORIGEM_LABEL[o]?.curto ?? o;
                return (
                  <Link
                    key={o}
                    href={hrefOrigem(o)}
                    className={`rounded-md border px-2 py-1 ${
                      ativo
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>

            {/* Filtros */}
            <form method="GET" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="filialId" value={filialSelecionada.id} />
              {origem !== 'TODAS' && <input type="hidden" name="origem" value={origem} />}
              <label className="text-xs text-slate-600">
                Busca
                <input
                  type="text"
                  name="q"
                  defaultValue={q}
                  placeholder="Fornecedor, CNPJ ou chave..."
                  className="ml-2 w-72 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
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

            {/* Lista */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Emissão</th>
                    <th className="px-4 py-2">Nº / Série</th>
                    <th className="px-4 py-2">Fornecedor</th>
                    <th className="px-4 py-2">CNPJ</th>
                    <th className="px-4 py-2 text-right">Valor</th>
                    <th className="px-4 py-2">Situação</th>
                    <th className="px-4 py-2">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {notas.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">
                        {q ? 'Nenhuma nota com esse filtro.' : 'Nenhuma nota no período. Faça upload de um XML pra começar.'}
                      </td>
                    </tr>
                  ) : (
                    notas.map((n) => (
                      <tr key={n.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">
                          {n.dataEmissao ? new Date(n.dataEmissao).toLocaleDateString('pt-BR') : '—'}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">
                          <Link
                            href={`/movimento/entrada-notas/${n.id}`}
                            className="hover:text-slate-900 hover:underline"
                          >
                            {n.numero ?? '—'}/{n.serie ?? '—'}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-800">
                          <Link
                            href={`/movimento/entrada-notas/${n.id}`}
                            className="hover:text-slate-900 hover:underline"
                          >
                            {n.emitNome ?? '—'}
                          </Link>
                          {n.emitUf && (
                            <span className="ml-1 text-[10px] text-slate-400">{n.emitUf}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">
                          {n.emitCnpj ? maskCnpj(n.emitCnpj) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
                          {brl(n.valorTotal)}
                        </td>
                        <td className="px-4 py-2">
                          {n.situacao === 'AUTORIZADA' ? (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                              ✓ Autorizada
                            </span>
                          ) : n.situacao === 'CANCELADA' || n.situacao === 'DENEGADA' ? (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800">
                              {n.situacao}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">{n.situacao ?? '—'}</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {(() => {
                            const cfg = ORIGEM_LABEL[n.origemImportacao ?? 'UPLOAD'];
                            if (!cfg) {
                              return (
                                <span className="text-[10px] text-slate-400">
                                  {n.origemImportacao ?? '—'}
                                </span>
                              );
                            }
                            return (
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cfg.cls}`}
                                title={cfg.label}
                              >
                                {cfg.curto}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {totalPag > 1 && (
                <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs">
                  <span className="text-slate-600">
                    Página {page + 1} de {totalPag} · {int(Number(stats?.qtd ?? 0))} notas
                  </span>
                  <div className="flex gap-2">
                    {page > 0 ? (
                      <Link href={hrefPag(page - 1)} className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-white">
                        ← Anterior
                      </Link>
                    ) : (
                      <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">← Anterior</span>
                    )}
                    {page < totalPag - 1 ? (
                      <Link href={hrefPag(page + 1)} className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-white">
                        Próxima →
                      </Link>
                    ) : (
                      <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">Próxima →</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

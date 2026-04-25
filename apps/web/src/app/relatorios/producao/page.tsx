// Relatório analítico de produção: comparação de % de perda por
// tipo de operação e por responsável (cozinheiro). Útil pra identificar
// quem está desperdiçando mais fazendo o mesmo corte.
//
// Considera apenas OPs CONCLUIDAS no período.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  dataIni?: string;
  dataFim?: string;
}

function corDePerda(perc: number): string {
  if (perc < 5) return 'text-emerald-700';
  if (perc < 12) return 'text-amber-700';
  return 'text-rose-700';
}

function bgDePerda(perc: number): string {
  if (perc < 5) return 'bg-emerald-50 border-emerald-200';
  if (perc < 12) return 'bg-amber-50 border-amber-200';
  return 'bg-rose-50 border-rose-200';
}

export default async function RelatorioProducaoPage(props: {
  searchParams: Promise<SP>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;
  const dataIni =
    sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(90);
  const dataFim =
    sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim) ? sp.dataFim : hojeBr();

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

  const dtIni = new Date(dataIni + 'T00:00:00-03:00').toISOString();
  const dtFim = new Date(dataFim + 'T23:59:59-03:00').toISOString();
  const fid = filialSelecionada.id;

  // Stats agregados por OP no período (concluídas)
  // Usa a fórmula real: % perda = SUM(qtd das saídas tipo PERDA) / SUM(qtd entradas)
  const opsAgregadas = await db.execute<{
    op_id: string;
    descricao: string | null;
    responsavel: string | null;
    concluida_em: string;
    qtd_entradas: string;
    qtd_perda: string;
    custo_total: string;
    perda_perc: string;
  }>(sql`
    SELECT
      op.id AS op_id,
      op.descricao,
      op.responsavel,
      op.concluida_em,
      COALESCE(e.qtd, 0)::text AS qtd_entradas,
      COALESCE(s.qtd_perda, 0)::text AS qtd_perda,
      COALESCE(op.custo_total_entradas, 0)::text AS custo_total,
      CASE
        WHEN COALESCE(e.qtd, 0) > 0
          THEN (COALESCE(s.qtd_perda, 0) / e.qtd * 100)::text
        ELSE '0'
      END AS perda_perc
    FROM ${schema.ordemProducao} op
    LEFT JOIN (
      SELECT ordem_producao_id, SUM(quantidade) AS qtd
      FROM ${schema.ordemProducaoEntrada}
      GROUP BY ordem_producao_id
    ) e ON e.ordem_producao_id = op.id
    LEFT JOIN (
      SELECT ordem_producao_id, SUM(quantidade) AS qtd_perda
      FROM ${schema.ordemProducaoSaida}
      WHERE tipo = 'PERDA'
      GROUP BY ordem_producao_id
    ) s ON s.ordem_producao_id = op.id
    WHERE op.filial_id = ${fid}
      AND op.status = 'CONCLUIDA'
      AND op.concluida_em >= ${dtIni}
      AND op.concluida_em <= ${dtFim}
    ORDER BY op.concluida_em DESC
  `);

  // KPIs gerais
  const totalOps = opsAgregadas.length;
  const totalCusto = opsAgregadas.reduce((s, o) => s + Number(o.custo_total), 0);
  const totalEntrada = opsAgregadas.reduce((s, o) => s + Number(o.qtd_entradas), 0);
  const totalPerda = opsAgregadas.reduce((s, o) => s + Number(o.qtd_perda), 0);
  const perdaMediaGeral = totalEntrada > 0 ? (totalPerda / totalEntrada) * 100 : 0;
  const opsSemResponsavel = opsAgregadas.filter((o) => !o.responsavel).length;

  // Agrupa por descrição (tipo de operação)
  const porTipo = new Map<
    string,
    {
      descricao: string;
      qtdOps: number;
      qtdEntrada: number;
      qtdPerda: number;
      custoTotal: number;
      perdas: number[]; // % de cada OP
    }
  >();

  for (const op of opsAgregadas) {
    const desc = (op.descricao ?? '(sem descrição)').trim();
    const cur = porTipo.get(desc) ?? {
      descricao: desc,
      qtdOps: 0,
      qtdEntrada: 0,
      qtdPerda: 0,
      custoTotal: 0,
      perdas: [],
    };
    cur.qtdOps++;
    cur.qtdEntrada += Number(op.qtd_entradas);
    cur.qtdPerda += Number(op.qtd_perda);
    cur.custoTotal += Number(op.custo_total);
    cur.perdas.push(Number(op.perda_perc));
    porTipo.set(desc, cur);
  }

  const tiposArr = Array.from(porTipo.values())
    .map((t) => {
      const perdaMedia = t.qtdEntrada > 0 ? (t.qtdPerda / t.qtdEntrada) * 100 : 0;
      const perdaMin = t.perdas.length ? Math.min(...t.perdas) : 0;
      const perdaMax = t.perdas.length ? Math.max(...t.perdas) : 0;
      return { ...t, perdaMedia, perdaMin, perdaMax };
    })
    .sort((a, b) => b.qtdOps - a.qtdOps);

  // Agrupa por responsável (só OPs com responsável informado)
  const porResp = new Map<
    string,
    {
      responsavel: string;
      qtdOps: number;
      qtdEntrada: number;
      qtdPerda: number;
      custoTotal: number;
      perdas: number[];
    }
  >();

  for (const op of opsAgregadas) {
    if (!op.responsavel) continue;
    const r = op.responsavel.trim();
    const cur = porResp.get(r) ?? {
      responsavel: r,
      qtdOps: 0,
      qtdEntrada: 0,
      qtdPerda: 0,
      custoTotal: 0,
      perdas: [],
    };
    cur.qtdOps++;
    cur.qtdEntrada += Number(op.qtd_entradas);
    cur.qtdPerda += Number(op.qtd_perda);
    cur.custoTotal += Number(op.custo_total);
    cur.perdas.push(Number(op.perda_perc));
    porResp.set(r, cur);
  }

  const respsArr = Array.from(porResp.values())
    .map((r) => {
      const perdaMedia = r.qtdEntrada > 0 ? (r.qtdPerda / r.qtdEntrada) * 100 : 0;
      const custoPerda = r.qtdEntrada > 0 ? (r.qtdPerda / r.qtdEntrada) * r.custoTotal : 0;
      return { ...r, perdaMedia, custoPerda };
    })
    .sort((a, b) => b.perdaMedia - a.perdaMedia);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Relatório de produção</h1>
        <p className="mt-1 text-sm text-slate-600">
          Análise comparativa: % de perda por tipo de corte e por responsável.
          Identifica quem desperdiça mais fazendo a mesma operação.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/relatorios/producao?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === fid
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        {/* Filtro de período */}
        <form method="GET" className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="filialId" value={fid} />
          <label className="text-xs text-slate-600">
            De
            <input
              type="date"
              name="dataIni"
              defaultValue={dataIni}
              className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Até
            <input
              type="date"
              name="dataFim"
              defaultValue={dataFim}
              className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Filtrar
          </button>
        </form>

        {/* KPIs gerais */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Total OPs concluídas
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{int(totalOps)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Custo total processado
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{brl(totalCusto)}</p>
          </div>
          <div className={`rounded-xl border p-4 ${bgDePerda(perdaMediaGeral)}`}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-700">
              Perda média geral
            </p>
            <p className={`mt-1 text-2xl font-bold ${corDePerda(perdaMediaGeral)}`}>
              {perdaMediaGeral.toFixed(2)}%
            </p>
            <p className="mt-0.5 text-[10px] text-slate-600">
              {totalPerda.toFixed(2)} de {totalEntrada.toFixed(2)} (un. de entrada)
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Sem responsável
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-700">{int(opsSemResponsavel)}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              OPs sem cozinheiro registrado
            </p>
          </div>
        </div>

        {/* Por tipo de operação */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-slate-900">Por tipo de operação</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Agrupado pela descrição da OP. Mostra range min-max da perda — diferenças
            grandes sugerem variação no padrão de execução entre profissionais.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Descrição</th>
                  <th className="px-4 py-2 text-center">OPs</th>
                  <th className="px-4 py-2 text-right">Entrada total</th>
                  <th className="px-4 py-2 text-right">Perda total</th>
                  <th className="px-4 py-2 text-right">% perda média</th>
                  <th className="px-4 py-2 text-right">Min / Max</th>
                  <th className="px-4 py-2 text-right">Custo</th>
                </tr>
              </thead>
              <tbody>
                {tiposArr.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">
                      Nenhuma OP concluída no período.
                    </td>
                  </tr>
                ) : (
                  tiposArr.map((t) => {
                    const range = t.perdaMax - t.perdaMin;
                    return (
                      <tr key={t.descricao} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-xs text-slate-800">{t.descricao}</td>
                        <td className="px-4 py-2 text-center font-mono text-xs">
                          {t.qtdOps}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                          {t.qtdEntrada.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                          {t.qtdPerda.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-mono text-xs font-semibold ${corDePerda(t.perdaMedia)}`}
                        >
                          {t.perdaMedia.toFixed(2)}%
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-[11px] text-slate-500">
                          {t.qtdOps > 1 ? (
                            <span title={`Variação: ${range.toFixed(2)}pp`}>
                              {t.perdaMin.toFixed(1)}% – {t.perdaMax.toFixed(1)}%
                              {range > 5 && (
                                <span className="ml-1 text-amber-700">⚠</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                          {brl(t.custoTotal)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Por responsável */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-slate-900">Por responsável (cozinheiro)</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Ordenado por % de perda média. Quem está em cima é candidato a treinamento.
            {opsSemResponsavel > 0 && (
              <span className="ml-1 text-amber-700">
                {opsSemResponsavel} OP(s) sem responsável foram excluídas.
              </span>
            )}
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Cozinheiro</th>
                  <th className="px-4 py-2 text-center">OPs</th>
                  <th className="px-4 py-2 text-right">Entrada total</th>
                  <th className="px-4 py-2 text-right">Perda total</th>
                  <th className="px-4 py-2 text-right">% perda média</th>
                  <th className="px-4 py-2 text-right">Custo perdido</th>
                </tr>
              </thead>
              <tbody>
                {respsArr.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                      Nenhum responsável informado nas OPs do período.
                    </td>
                  </tr>
                ) : (
                  respsArr.map((r) => (
                    <tr key={r.responsavel} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-xs font-medium text-slate-800">
                        {r.responsavel}
                      </td>
                      <td className="px-4 py-2 text-center font-mono text-xs">{r.qtdOps}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {r.qtdEntrada.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {r.qtdPerda.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono text-xs font-semibold ${corDePerda(r.perdaMedia)}`}
                      >
                        {r.perdaMedia.toFixed(2)}%
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                        {brl(r.custoPerda)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Detalhe por OP — últimas 30 */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-slate-900">Histórico detalhado</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Últimas 30 OPs concluídas no período.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Data</th>
                  <th className="px-4 py-2">Descrição</th>
                  <th className="px-4 py-2">Responsável</th>
                  <th className="px-4 py-2 text-right">Entrada</th>
                  <th className="px-4 py-2 text-right">Perda</th>
                  <th className="px-4 py-2 text-right">% perda</th>
                  <th className="px-4 py-2 text-right">Custo</th>
                </tr>
              </thead>
              <tbody>
                {opsAgregadas.slice(0, 30).map((op) => {
                  const perda = Number(op.perda_perc);
                  return (
                    <tr key={op.op_id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs text-slate-600">
                        {op.concluida_em
                          ? new Date(op.concluida_em).toLocaleDateString('pt-BR')
                          : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-800">
                        <Link
                          href={`/movimento/producao/${op.op_id}`}
                          className="hover:underline"
                        >
                          {op.descricao ?? '(sem descrição)'}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-700">
                        {op.responsavel ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {Number(op.qtd_entradas).toLocaleString('pt-BR', {
                          maximumFractionDigits: 3,
                        })}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {Number(op.qtd_perda).toLocaleString('pt-BR', {
                          maximumFractionDigits: 3,
                        })}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono text-xs font-semibold ${corDePerda(perda)}`}
                      >
                        {perda.toFixed(2)}%
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                        {brl(Number(op.custo_total))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

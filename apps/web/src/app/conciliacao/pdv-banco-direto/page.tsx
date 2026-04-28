import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, notInArray, or, sql, sum } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDateTime, int, maskCnpj } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { FormRodar } from './form';
import { MatchManualPdvBancoDireto } from './match-manual';
import { FiltroPeriodoConciliacao } from '@/components/filtro-periodo-conciliacao';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  dataInicio?: string;
  dataFim?: string;
}

export default async function PdvBancoDiretoPage(props: {
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

  // Histórico
  const filialIds = filiais.map((f) => f.id);
  const execucoes = await db
    .select()
    .from(schema.execucaoConciliacao)
    .where(
      and(
        inArray(schema.execucaoConciliacao.filialId, filialIds),
        eq(schema.execucaoConciliacao.processo, 'PDV_BANCO_DIRETO'),
      ),
    )
    .orderBy(desc(schema.execucaoConciliacao.iniciadoEm))
    .limit(10);

  // Última execução OK pra default do filtro
  const [ultimaOk] = await db
    .select()
    .from(schema.execucaoConciliacao)
    .where(
      and(
        eq(schema.execucaoConciliacao.filialId, filialSelecionada.id),
        eq(schema.execucaoConciliacao.processo, 'PDV_BANCO_DIRETO'),
        eq(schema.execucaoConciliacao.status, 'OK'),
      ),
    )
    .orderBy(desc(schema.execucaoConciliacao.finalizadoEm))
    .limit(1);

  const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  const ultimaInicioIso = isoDate(ultimaOk?.dataInicio);
  const ultimaFimIso = isoDate(ultimaOk?.dataFim);

  const dataInicioEfetiva = sp.dataInicio ?? ultimaInicioIso;
  const dataFimEfetiva = sp.dataFim ?? ultimaFimIso;
  const filtroExplicito = !!(sp.dataInicio || sp.dataFim);
  const dtIni = dataInicioEfetiva ? new Date(dataInicioEfetiva + 'T00:00:00-03:00') : null;
  const dtFim = dataFimEfetiva ? new Date(dataFimEfetiva + 'T23:59:59-03:00') : null;

  const resumoUltima = (ultimaOk?.resumo as
    | {
        matched: number;
        matchedNivel1: number;
        matchedNivel2: number;
        pdvSemBanco: number;
        bancoSemPdv: number;
        valorMatched: number;
        valorPdvSemBanco: number;
        valorBancoSemPdv: number;
      }
    | null
    | undefined) ?? null;

  // Lista de matches do periodo (PDV ↔ banco)
  const matches = dtIni && dtFim
    ? await db
        .select({
          id: schema.matchPdvBanco.id,
          nivelMatch: schema.matchPdvBanco.nivelMatch,
          autoRevogavel: schema.matchPdvBanco.autoRevogavel,
          criadoPor: schema.matchPdvBanco.criadoPor,
          pagamentoId: schema.matchPdvBanco.pagamentoId,
          lancamentoBancoId: schema.matchPdvBanco.lancamentoBancoId,
          pagamentoValor: schema.pagamento.valor,
          pagamentoData: schema.pagamento.dataPagamento,
          pagamentoForma: schema.pagamento.formaPagamento,
          pagamentoCodPedido: schema.pagamento.codigoPedidoExterno,
          lancamentoData: schema.lancamentoBanco.dataMovimento,
          lancamentoDescricao: schema.lancamentoBanco.descricao,
          lancamentoValor: schema.lancamentoBanco.valor,
        })
        .from(schema.matchPdvBanco)
        .innerJoin(schema.pagamento, eq(schema.pagamento.id, schema.matchPdvBanco.pagamentoId))
        .innerJoin(
          schema.lancamentoBanco,
          eq(schema.lancamentoBanco.id, schema.matchPdvBanco.lancamentoBancoId),
        )
        .where(
          and(
            eq(schema.matchPdvBanco.filialId, filialSelecionada.id),
            gte(schema.pagamento.dataPagamento, dtIni),
            lte(schema.pagamento.dataPagamento, dtFim),
          ),
        )
        .orderBy(desc(schema.pagamento.dataPagamento))
        .limit(200)
    : [];

  // PDV-DIRETO sem match no periodo
  const matchesIds = await db
    .select({ id: schema.matchPdvBanco.pagamentoId })
    .from(schema.matchPdvBanco)
    .where(eq(schema.matchPdvBanco.filialId, filialSelecionada.id));
  const idsCasados = matchesIds.map((m) => m.id);

  const pdvSemBanco = dtIni && dtFim
    ? await db
        .select({
          id: schema.pagamento.id,
          valor: schema.pagamento.valor,
          dataPagamento: schema.pagamento.dataPagamento,
          formaPagamento: schema.pagamento.formaPagamento,
          codigoPedido: schema.pagamento.codigoPedidoExterno,
        })
        .from(schema.pagamento)
        .innerJoin(
          schema.formaPagamentoCanal,
          and(
            eq(schema.formaPagamentoCanal.filialId, filialSelecionada.id),
            eq(schema.formaPagamentoCanal.formaPagamento, schema.pagamento.formaPagamento),
            eq(schema.formaPagamentoCanal.canal, 'DIRETO'),
          ),
        )
        .where(
          and(
            eq(schema.pagamento.filialId, filialSelecionada.id),
            gte(schema.pagamento.dataPagamento, dtIni),
            lte(schema.pagamento.dataPagamento, dtFim),
            idsCasados.length > 0
              ? notInArray(schema.pagamento.id, idsCasados)
              : undefined,
          ),
        )
        .orderBy(desc(schema.pagamento.dataPagamento))
        .limit(100)
    : [];

  // Banco sem PDV (créditos PIX/TED/DOC sem origem) — heurística por descrição
  const matchesBancoIds = await db
    .select({ id: schema.matchPdvBanco.lancamentoBancoId })
    .from(schema.matchPdvBanco)
    .where(eq(schema.matchPdvBanco.filialId, filialSelecionada.id));
  const idsLanCasados = matchesBancoIds.map((m) => m.id);

  const bancoSemPdv = dtIni && dtFim && dataInicioEfetiva && dataFimEfetiva
    ? await db
        .select({
          id: schema.lancamentoBanco.id,
          valor: schema.lancamentoBanco.valor,
          dataMovimento: schema.lancamentoBanco.dataMovimento,
          descricao: schema.lancamentoBanco.descricao,
        })
        .from(schema.lancamentoBanco)
        .innerJoin(
          schema.contaBancaria,
          eq(schema.contaBancaria.id, schema.lancamentoBanco.contaBancariaId),
        )
        .where(
          and(
            eq(schema.contaBancaria.filialId, filialSelecionada.id),
            eq(schema.lancamentoBanco.tipo, 'C'),
            gte(schema.lancamentoBanco.dataMovimento, dataInicioEfetiva),
            lte(schema.lancamentoBanco.dataMovimento, dataFimEfetiva),
            sql`(${schema.lancamentoBanco.descricao} ~* '\\b(pix|ted|doc|transfer[êe]ncia)\\b')`,
            idsLanCasados.length > 0
              ? notInArray(schema.lancamentoBanco.id, idsLanCasados)
              : undefined,
          ),
        )
        .orderBy(desc(schema.lancamentoBanco.dataMovimento))
        .limit(100)
    : [];

  const totalPdvSemBancoValor = pdvSemBanco.reduce((s, p) => s + Number(p.valor), 0);
  const totalBancoSemPdvValor = bancoSemPdv.reduce((s, b) => s + Number(b.valor), 0);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">
          Conciliação PDV ↔ Banco direto
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Pagamentos que vão direto pra conta bancária sem passar por adquirente —{' '}
          <strong>Pix Manual, TED, DOC</strong>. Configurados como{' '}
          <Link href="/configuracoes/formas-pagamento" className="text-sky-700 hover:underline">
            canal DIRETO
          </Link>
          .
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
          {/* Coluna esquerda: form + historico */}
          <div className="space-y-6">
            <FormRodar filialId={filialSelecionada.id} />

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Últimas execuções</h2>
              {execucoes.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">Nenhuma execução ainda.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {execucoes.map((e) => {
                    const r = e.resumo as
                      | { matched?: number; pdvSemBanco?: number; bancoSemPdv?: number }
                      | null
                      | undefined;
                    return (
                      <li key={e.id} className="rounded-lg border border-slate-200 p-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-800">
                            {formatDateTime(e.iniciadoEm)}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              e.status === 'OK'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {e.status}
                          </span>
                        </div>
                        {r && (
                          <p className="mt-1 text-slate-500">
                            {int(r.matched ?? 0)} casados · {int((r.pdvSemBanco ?? 0) + (r.bancoSemPdv ?? 0))} sobras
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Coluna direita: resultado */}
          <div className="space-y-6">
            {filiais.length > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">Filial:</span>
                {filiais.map((f) => (
                  <Link
                    key={f.id}
                    href={`/conciliacao/pdv-banco-direto?filialId=${f.id}`}
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

            <FiltroPeriodoConciliacao
              basePath="/conciliacao/pdv-banco-direto"
              filialId={filialSelecionada.id}
              dataInicio={dataInicioEfetiva}
              dataFim={dataFimEfetiva}
              filtroExplicito={filtroExplicito}
              ultimaInicio={ultimaInicioIso}
              ultimaFim={ultimaFimIso}
            />

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
                  Casados
                </p>
                <p className="mt-1.5 text-2xl font-bold text-slate-900">
                  {int(resumoUltima?.matched ?? matches.length)}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {brl(resumoUltima?.valorMatched ?? matches.reduce((s, m) => s + Number(m.pagamentoValor ?? 0), 0))}
                </p>
                {resumoUltima && (
                  <p className="mt-1 text-[10px] text-slate-500">
                    {resumoUltima.matchedNivel1} firme · {resumoUltima.matchedNivel2} sugestão
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
                  PDV sem Banco
                </p>
                <p className="mt-1.5 text-2xl font-bold text-slate-900">
                  {int(pdvSemBanco.length)}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">{brl(totalPdvSemBancoValor)}</p>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
                  Banco sem PDV
                </p>
                <p className="mt-1.5 text-2xl font-bold text-slate-900">
                  {int(bancoSemPdv.length)}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">{brl(totalBancoSemPdvValor)}</p>
              </div>
            </div>

            {/* Tabela: matches */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-emerald-700">
                  Casados <span className="font-normal text-slate-500">· {matches.length}</span>
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Pagamento PDV (canal DIRETO) ↔ crédito no banco. Nível 1 = firme;
                  nível 2 = sugestão (auto-revogável).
                </p>
              </div>
              {matches.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-slate-500">
                  Nenhum match no período.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Data PDV</th>
                      <th className="px-3 py-2">Pedido</th>
                      <th className="px-3 py-2">Forma</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                      <th className="px-3 py-2">Data banco</th>
                      <th className="px-3 py-2">Descrição banco</th>
                      <th className="px-3 py-2">Nível</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((m) => (
                      <tr key={m.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">
                          {m.pagamentoData
                            ? new Date(m.pagamentoData).toLocaleDateString('pt-BR')
                            : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">
                          {m.pagamentoCodPedido ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          {m.pagamentoForma ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-medium">
                          {brl(m.pagamentoValor)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">
                          {m.lancamentoData
                            ? new Date(m.lancamentoData + 'T00:00:00').toLocaleDateString('pt-BR')
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          <span className="block max-w-xs truncate" title={m.lancamentoDescricao ?? ''}>
                            {m.lancamentoDescricao ?? '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {Number(m.nivelMatch) === 1 ? (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                              firme
                            </span>
                          ) : (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                              sugestão
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* PDV sem banco */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-rose-700">
                  PDV sem Banco <span className="font-normal text-slate-500">· {pdvSemBanco.length}</span>
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Pagamentos canal DIRETO no PDV que não casaram com nenhum
                  crédito no banco. Pode ser: extrato bancário não importado,
                  cliente ainda não pagou, ou erro de cadastro de canal.
                </p>
              </div>
              {pdvSemBanco.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-slate-500">
                  Nenhuma sobra — todos casados.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Pedido</th>
                      <th className="px-3 py-2">Forma</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                      <th className="px-3 py-2 w-32"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pdvSemBanco.map((p) => (
                      <tr key={p.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">
                          {p.dataPagamento
                            ? new Date(p.dataPagamento).toLocaleDateString('pt-BR', {
                                timeZone: 'America/Sao_Paulo',
                              })
                            : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">
                          {p.codigoPedido ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          {p.formaPagamento ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-medium">
                          {brl(p.valor)}
                        </td>
                        <td className="px-3 py-2">
                          <MatchManualPdvBancoDireto
                            pagamentoId={p.id}
                            pagamentoValor={Number(p.valor)}
                            pagamentoData={
                              p.dataPagamento
                                ? new Date(p.dataPagamento).toLocaleDateString('pt-BR', {
                                    timeZone: 'America/Sao_Paulo',
                                  })
                                : '—'
                            }
                            pagamentoForma={p.formaPagamento ?? '—'}
                            pedidoExterno={p.codigoPedido}
                            creditosDisponiveis={bancoSemPdv.map((b) => ({
                              id: b.id,
                              data: b.dataMovimento ?? '',
                              valor: Number(b.valor),
                              descricao: b.descricao ?? '',
                            }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Banco sem PDV */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-rose-700">
                  Banco sem PDV <span className="font-normal text-slate-500">· {bancoSemPdv.length}</span>
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Créditos PIX/TED/DOC no banco que não bateram com nenhum
                  pagamento canal DIRETO no PDV. Filtra por descrição contendo
                  PIX/TED/DOC/Transferência.
                </p>
              </div>
              {bancoSemPdv.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-slate-500">
                  Nenhum crédito sem origem PDV.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Descrição</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bancoSemPdv.map((b) => (
                      <tr key={b.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">
                          {b.dataMovimento
                            ? new Date(b.dataMovimento + 'T00:00:00').toLocaleDateString('pt-BR')
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          <span className="block max-w-md truncate" title={b.descricao ?? ''}>
                            {b.descricao ?? '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-medium">
                          {brl(b.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

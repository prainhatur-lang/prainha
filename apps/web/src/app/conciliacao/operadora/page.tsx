import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDateTime, int } from '@/lib/format';
import { OperadoraForm } from './form';
import { ExcecaoRow } from './excecao-row';
import { AceitarTodosBtn } from './aceitar-todos';
import { MOTIVO_LABEL } from './motivos';
import { PROCESSO_OPERADORA, TIPO_OPERADORA } from '@/lib/conciliacao-operadora';
import { FiltroPeriodoConciliacao } from '@/components/filtro-periodo-conciliacao';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  dataInicio?: string;
  dataFim?: string;
  pDiv?: string; // page de divergencia
  pPdv?: string; // page de PDV sem Cielo
  pCielo?: string; // page de Cielo sem PDV
}

const PAGE_SIZE = 50;

function paginaAtual(raw: string | undefined): number {
  const n = Number(raw ?? '0');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export default async function OperadoraPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;

  // Historico (todas filiais do usuario, processo OPERADORA)
  const filialIds = filiais.map((f) => f.id);
  const execucoes = filialIds.length
    ? await db
        .select()
        .from(schema.execucaoConciliacao)
        .where(
          and(
            inArray(schema.execucaoConciliacao.filialId, filialIds),
            eq(schema.execucaoConciliacao.processo, PROCESSO_OPERADORA),
          ),
        )
        .orderBy(desc(schema.execucaoConciliacao.iniciadoEm))
        .limit(10)
    : [];

  // Page por secao
  const pageDiv = paginaAtual(sp.pDiv);
  const pagePdv = paginaAtual(sp.pPdv);
  const pageCielo = paginaAtual(sp.pCielo);

  // Resumo da última execução OK (precisa carregar antes pra usar o período como
  // default do filtro de visualização quando o usuário não explicitar dataInicio/Fim).
  const [ultimaOk] = filialSelecionada
    ? await db
        .select()
        .from(schema.execucaoConciliacao)
        .where(
          and(
            eq(schema.execucaoConciliacao.filialId, filialSelecionada.id),
            eq(schema.execucaoConciliacao.processo, PROCESSO_OPERADORA),
            eq(schema.execucaoConciliacao.status, 'OK'),
          ),
        )
        .orderBy(desc(schema.execucaoConciliacao.finalizadoEm))
        .limit(1)
    : [];

  const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  const ultimaInicioIso = isoDate(ultimaOk?.dataInicio);
  const ultimaFimIso = isoDate(ultimaOk?.dataFim);

  // Filtro de data da transacao para a VISUALIZAÇÃO (independente do "rodar conciliação").
  // Default = período da última execução OK (se houver).
  // - SP.dataInicio/dataFim sobrescrevem o default.
  // - Para DIVERGENCIA_VALOR e PDV_SEM_CIELO filtra por pagamento.dataPagamento.
  // - Para CIELO_SEM_PDV filtra por vendaAdquirente.dataVenda.
  // Usa BRT (-03:00) para bater com a engine.
  const dataInicioEfetiva = sp.dataInicio ?? ultimaInicioIso;
  const dataFimEfetiva = sp.dataFim ?? ultimaFimIso;
  const filtroExplicito = !!(sp.dataInicio || sp.dataFim);
  const dtIni = dataInicioEfetiva ? new Date(dataInicioEfetiva + 'T00:00:00-03:00') : null;
  const dtFim = dataFimEfetiva ? new Date(dataFimEfetiva + 'T23:59:59-03:00') : null;

  function filtroData(tipo: string) {
    if (!dtIni || !dtFim) return undefined;
    if (tipo === TIPO_OPERADORA.CIELO_SEM_PDV) {
      // dataVenda é string YYYY-MM-DD
      return and(
        gte(schema.vendaAdquirente.dataVenda, dataInicioEfetiva!),
        lte(schema.vendaAdquirente.dataVenda, dataFimEfetiva!),
      );
    }
    // DIVERGENCIA_VALOR e PDV_SEM_CIELO usam pagamento.dataPagamento
    return and(
      gte(schema.pagamento.dataPagamento, dtIni),
      lte(schema.pagamento.dataPagamento, dtFim),
    );
  }

  // Helper pra carregar uma secao paginada (count + rows)
  async function carregarSecao(tipo: string, page: number) {
    if (!filialSelecionada) {
      return {
        rows: [] as Awaited<ReturnType<typeof queryRows>>,
        total: 0,
        totalValor: 0,
        porSeveridade: { BAIXA: 0, MEDIA: 0, ALTA: 0 },
      };
    }
    const dataCond = filtroData(tipo);
    const whereCond = and(
      eq(schema.excecao.filialId, filialSelecionada!.id),
      eq(schema.excecao.processo, PROCESSO_OPERADORA),
      eq(schema.excecao.tipo, tipo),
      isNull(schema.excecao.aceitaEm),
      dataCond,
    );
    async function queryRows() {
      return db
        .select({
          id: schema.excecao.id,
          tipo: schema.excecao.tipo,
          severidade: schema.excecao.severidade,
          descricao: schema.excecao.descricao,
          valor: schema.excecao.valor,
          detectadoEm: schema.excecao.detectadoEm,
          pagamentoNsu: schema.pagamento.nsuTransacao,
          pagamentoFormaPagamento: schema.pagamento.formaPagamento,
          pagamentoDataPagamento: schema.pagamento.dataPagamento,
          vendaNsu: schema.vendaAdquirente.nsu,
          vendaDataVenda: schema.vendaAdquirente.dataVenda,
          vendaBandeira: schema.vendaAdquirente.bandeira,
          pagamentoValor: schema.pagamento.valor,
          vendaValorBruto: schema.vendaAdquirente.valorBruto,
        })
        .from(schema.excecao)
        .leftJoin(schema.pagamento, eq(schema.pagamento.id, schema.excecao.pagamentoId))
        .leftJoin(
          schema.vendaAdquirente,
          eq(schema.vendaAdquirente.id, schema.excecao.vendaAdquirenteId),
        )
        .where(whereCond)
        .orderBy(desc(schema.excecao.detectadoEm))
        .limit(PAGE_SIZE)
        .offset(page * PAGE_SIZE);
    }
    async function queryTotal() {
      return db
        .select({
          n: sql<number>`COUNT(*)::int`,
          v: sql<string>`COALESCE(SUM(${schema.excecao.valor}), 0)::text`,
          nBaixa: sql<number>`COUNT(*) FILTER (WHERE ${schema.excecao.severidade} = 'BAIXA')::int`,
          nMedia: sql<number>`COUNT(*) FILTER (WHERE ${schema.excecao.severidade} = 'MEDIA')::int`,
          nAlta: sql<number>`COUNT(*) FILTER (WHERE ${schema.excecao.severidade} = 'ALTA')::int`,
        })
        .from(schema.excecao)
        .leftJoin(schema.pagamento, eq(schema.pagamento.id, schema.excecao.pagamentoId))
        .leftJoin(
          schema.vendaAdquirente,
          eq(schema.vendaAdquirente.id, schema.excecao.vendaAdquirenteId),
        )
        .where(whereCond);
    }
    const [rows, [totalRow]] = await Promise.all([queryRows(), queryTotal()]);
    return {
      rows,
      total: Number(totalRow?.n ?? 0),
      totalValor: Number(totalRow?.v ?? 0),
      porSeveridade: {
        BAIXA: Number(totalRow?.nBaixa ?? 0),
        MEDIA: Number(totalRow?.nMedia ?? 0),
        ALTA: Number(totalRow?.nAlta ?? 0),
      },
    };
  }

  const [secaoDiv, secaoPdv, secaoCielo] = await Promise.all([
    carregarSecao(TIPO_OPERADORA.DIVERGENCIA_VALOR, pageDiv),
    carregarSecao(TIPO_OPERADORA.PDV_SEM_CIELO, pagePdv),
    carregarSecao(TIPO_OPERADORA.CIELO_SEM_PDV, pageCielo),
  ]);

  // Conta quantas formas de pagamento da filial ainda não foram confirmadas
  // (canal foi sugerido por heurística mas user nunca confirmou).
  const [{ qtdNaoConfirmadas }] = filialSelecionada
    ? await db
        .select({ qtdNaoConfirmadas: sql<number>`COUNT(*)::int` })
        .from(schema.formaPagamentoCanal)
        .where(
          and(
            eq(schema.formaPagamentoCanal.filialId, filialSelecionada.id),
            sql`${schema.formaPagamentoCanal.confirmadoEm} IS NULL`,
          ),
        )
    : [{ qtdNaoConfirmadas: 0 }];

  // Conta matches auto-revogaveis (niveis 4-5) — sao matches de proximidade
  // que podem quebrar quando aparecer NSU em rodada futura. Util pro user
  // saber que parte dos matches "firmes na UI" sao na verdade fragiles.
  const [{ qtdRevogaveis }] = filialSelecionada
    ? await db
        .select({ qtdRevogaveis: sql<number>`COUNT(*)::int` })
        .from(schema.matchPdvCielo)
        .where(
          and(
            eq(schema.matchPdvCielo.filialId, filialSelecionada.id),
            sql`${schema.matchPdvCielo.autoRevogavel} IS NOT NULL`,
          ),
        )
    : [{ qtdRevogaveis: 0 }];

  // Total acumulado de matches firmes da filial no período do filtro.
  // Conta TODOS os matches persistidos (não apenas os da última rodada).
  // Filtra pela data_pagamento do PDV pra respeitar o filtro de visualização.
  const [{ qtdMatchesPeriodo, valorMatchesPeriodo, qtdMatchesRevogaveisPeriodo }] =
    filialSelecionada && dtIni && dtFim
      ? await db
          .select({
            qtdMatchesPeriodo: sql<number>`COUNT(*)::int`,
            valorMatchesPeriodo: sql<string>`COALESCE(SUM(${schema.pagamento.valor}), 0)::text`,
            qtdMatchesRevogaveisPeriodo: sql<number>`COUNT(*) FILTER (WHERE ${schema.matchPdvCielo.autoRevogavel} IS NOT NULL)::int`,
          })
          .from(schema.matchPdvCielo)
          .innerJoin(
            schema.pagamento,
            eq(schema.pagamento.id, schema.matchPdvCielo.pagamentoId),
          )
          .where(
            and(
              eq(schema.matchPdvCielo.filialId, filialSelecionada.id),
              gte(schema.pagamento.dataPagamento, dtIni),
              lte(schema.pagamento.dataPagamento, dtFim),
            ),
          )
      : [{ qtdMatchesPeriodo: 0, valorMatchesPeriodo: '0', qtdMatchesRevogaveisPeriodo: 0 }];

  // Agregado de exceções aceitas por motivo no período do filtro.
  // Permite identificar padrões: quanto $$ por mês passa fora do TEF,
  // quantas vendas da casa a Tabuara registra, etc.
  const aceitasPorMotivo =
    filialSelecionada && dtIni && dtFim
      ? await db
          .select({
            motivo: schema.excecao.motivo,
            qtd: sql<number>`COUNT(*)::int`,
            valor: sql<string>`COALESCE(SUM(${schema.excecao.valor}), 0)::text`,
          })
          .from(schema.excecao)
          .where(
            and(
              eq(schema.excecao.filialId, filialSelecionada.id),
              eq(schema.excecao.processo, PROCESSO_OPERADORA),
              gte(schema.excecao.aceitaEm, dtIni),
              lte(schema.excecao.aceitaEm, dtFim),
            ),
          )
          .groupBy(schema.excecao.motivo)
      : [];

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Conciliação Operadora</h1>
        <p className="mt-1 text-sm text-slate-600">
          Cruza os pagamentos da loja com o arquivo de Vendas da Cielo. O que não bate vira exceção.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
          {/* Coluna esquerda: form + historico */}
          <div className="space-y-6">
            {Number(qtdRevogaveis) > 0 && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                <p className="font-semibold">
                  ℹ {Number(qtdRevogaveis)} match(es) por proximidade (auto-revogáveis)
                </p>
                <p className="mt-1 text-sky-800">
                  Casados sem NSU — podem ser quebrados na próxima rodada se
                  aparecer um NSU mais forte. Conferir uma vez e aceitar manualmente
                  pra travar.
                </p>
              </div>
            )}

            {Number(qtdNaoConfirmadas) > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">
                  ⚠ {Number(qtdNaoConfirmadas)} forma(s) de pagamento sem
                  classificação confirmada
                </p>
                <p className="mt-1 text-amber-800">
                  A engine usa o canal sugerido por heurística — confirme em{' '}
                  <Link
                    href="/configuracoes/formas-pagamento"
                    className="underline underline-offset-2"
                  >
                    Formas de pagamento
                  </Link>{' '}
                  pra a conciliação ficar mais precisa.
                </p>
              </div>
            )}

            <OperadoraForm
              filiais={filiais.map((f) => ({
                id: f.id,
                nome: f.nome,
                dataInicioConciliacao: f.dataInicioConciliacao,
              }))}
            />

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Últimas execuções</h2>
              {execucoes.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">Nenhuma execução ainda.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {execucoes.map((e) => {
                    const r = e.resumo as
                      | {
                          conciliados?: { qtd: number };
                          divergenciaValor?: { qtd: number };
                          pdvSemCielo?: { qtd: number };
                          cieloSemPdv?: { qtd: number };
                        }
                      | null
                      | undefined;
                    const excs =
                      (r?.divergenciaValor?.qtd ?? 0) +
                      (r?.pdvSemCielo?.qtd ?? 0) +
                      (r?.cieloSemPdv?.qtd ?? 0);
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
                                : e.status === 'ERRO'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {e.status}
                          </span>
                        </div>
                        {r && (
                          <p className="mt-1 text-slate-500">
                            {int(r.conciliados?.qtd ?? 0)} conciliados · {int(excs)} exceções
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
            {filialSelecionada && (
              <FilialSelector
                filiais={filiais}
                selecionada={filialSelecionada.id}
              />
            )}

            <FiltroPeriodoConciliacao
              basePath="/conciliacao/operadora"
              filialId={filialSelecionada.id}
              dataInicio={dataInicioEfetiva}
              dataFim={dataFimEfetiva}
              filtroExplicito={filtroExplicito}
              ultimaInicio={ultimaInicioIso}
              ultimaFim={ultimaFimIso}
            />

            {/* 4 cards de resumo */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ResumoCard
                label="Conciliados"
                qtd={Number(qtdMatchesPeriodo)}
                valor={Number(valorMatchesPeriodo)}
                tom="emerald"
                hint={
                  Number(qtdMatchesRevogaveisPeriodo) > 0
                    ? `${Number(qtdMatchesRevogaveisPeriodo)} por proximidade`
                    : 'no filtro'
                }
              />
              <ResumoCard
                label="Divergência de valor"
                qtd={secaoDiv.total}
                valor={secaoDiv.totalValor}
                tom="amber"
                hint={filtroExplicito ? 'no filtro' : undefined}
              />
              <ResumoCard
                label="PDV sem Cielo"
                qtd={secaoPdv.total}
                valor={secaoPdv.totalValor}
                tom="rose"
                hint={filtroExplicito ? 'no filtro' : undefined}
              />
              <ResumoCard
                label="Cielo sem PDV"
                qtd={secaoCielo.total}
                valor={secaoCielo.totalValor}
                tom="rose"
                hint={filtroExplicito ? 'no filtro' : undefined}
              />
            </div>

            {aceitasPorMotivo.length > 0 && (
              <AceitasPorMotivoCard rows={aceitasPorMotivo} />
            )}

            {/* Tabelas por tipo — com paginacao server-side */}
            <SecaoExcecoes
              titulo="Divergência de valor"
              descricao="Valor difere entre PDV e Cielo (gorjeta, desconto, couvert, ou match sem NSU por proximidade). Aceite pra confirmar como match, ou rejeite pra separar em 2 exceções."
              tom="amber"
              excecoes={secaoDiv.rows}
              total={secaoDiv.total}
              page={pageDiv}
              pageParam="pDiv"
              sp={sp}
              tipo={TIPO_OPERADORA.DIVERGENCIA_VALOR}
              filialId={filialSelecionada.id}
              acoesDivergencia
              porSeveridade={secaoDiv.porSeveridade}
            />
            <SecaoExcecoes
              titulo="No PDV, sem match na Cielo"
              descricao="Pagamento registrado na loja que não apareceu no arquivo da Cielo."
              tom="rose"
              excecoes={secaoPdv.rows}
              total={secaoPdv.total}
              page={pagePdv}
              pageParam="pPdv"
              sp={sp}
              tipo={TIPO_OPERADORA.PDV_SEM_CIELO}
              filialId={filialSelecionada.id}
              candidatosMatchManual={secaoCielo.rows.map((e) => ({
                id: e.id,
                data: e.vendaDataVenda ?? '',
                valor: Number(e.valor ?? 0),
                descricao: `Cielo NSU ${e.vendaNsu ?? '—'} ${e.vendaBandeira ?? ''}`,
              }))}
            />
            <SecaoExcecoes
              titulo="Na Cielo, sem match no PDV"
              descricao="Venda no arquivo da Cielo que a loja não registrou."
              tom="rose"
              excecoes={secaoCielo.rows}
              total={secaoCielo.total}
              page={pageCielo}
              pageParam="pCielo"
              sp={sp}
              tipo={TIPO_OPERADORA.CIELO_SEM_PDV}
              filialId={filialSelecionada.id}
              candidatosMatchManual={secaoPdv.rows.map((e) => ({
                id: e.id,
                data: e.pagamentoDataPagamento
                  ? new Date(e.pagamentoDataPagamento).toISOString()
                  : '',
                valor: Number(e.valor ?? 0),
                descricao: `PDV ${e.pagamentoFormaPagamento ?? ''} NSU ${e.pagamentoNsu ?? '—'}`,
              }))}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function FilialSelector({
  filiais,
  selecionada,
}: {
  filiais: { id: string; nome: string }[];
  selecionada: string;
}) {
  if (filiais.length <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">Filial:</span>
      {filiais.map((f) => (
        <Link
          key={f.id}
          href={`/conciliacao/operadora?filialId=${f.id}`}
          className={`rounded-md border px-3 py-1 text-xs ${
            f.id === selecionada
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          {f.nome}
        </Link>
      ))}
    </div>
  );
}

function AceitasPorMotivoCard({
  rows,
}: {
  rows: Array<{ motivo: string | null; qtd: number; valor: string }>;
}) {
  const total = rows.reduce((s, r) => s + r.qtd, 0);
  const totalValor = rows.reduce((s, r) => s + Number(r.valor), 0);
  // Ordena: motivo conhecido por qtd desc, sem motivo (null) por último
  const ordenado = [...rows].sort((a, b) => {
    if (a.motivo === null && b.motivo !== null) return 1;
    if (a.motivo !== null && b.motivo === null) return -1;
    return b.qtd - a.qtd;
  });
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-900">
          Aceitas no período · por motivo
        </h3>
        <span className="text-xs text-slate-500">
          {int(total)} · {brl(totalValor)}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        Categorização das exceções aceitas. Útil pra rastrear padrões (ex:
        quanto $$/mês passa fora do TEF).
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {ordenado.map((r) => {
          const m = r.motivo;
          const label = m ? MOTIVO_LABEL[m as keyof typeof MOTIVO_LABEL] ?? m : 'Sem motivo';
          const valor = Number(r.valor);
          const pct = totalValor > 0 ? ((valor / totalValor) * 100).toFixed(0) : '0';
          return (
            <div
              key={m ?? '_'}
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2"
            >
              <p className="text-[11px] font-medium text-slate-700">{label}</p>
              <p className="mt-0.5 text-base font-bold text-slate-900">{int(r.qtd)}</p>
              <p className="text-[10px] text-slate-500">
                {brl(valor)} · {pct}%
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResumoCard({
  label,
  qtd,
  valor,
  tom,
  hint,
}: {
  label: string;
  qtd: number;
  valor: number;
  tom: 'emerald' | 'amber' | 'rose';
  hint?: string;
}) {
  const cor = {
    emerald: 'border-emerald-200 bg-emerald-50',
    amber: 'border-amber-200 bg-amber-50',
    rose: 'border-rose-200 bg-rose-50',
  }[tom];
  return (
    <div className={`rounded-xl border p-4 ${cor}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
        {hint && (
          <span className="rounded bg-white/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-500">
            {hint}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-2xl font-bold text-slate-900">{int(qtd)}</p>
      <p className="mt-0.5 text-xs text-slate-600">{brl(valor)}</p>
    </div>
  );
}

function SecaoExcecoes({
  titulo,
  descricao,
  tom,
  excecoes,
  total,
  page,
  pageParam,
  sp,
  tipo,
  filialId,
  acoesDivergencia = false,
  candidatosMatchManual,
  porSeveridade,
}: {
  titulo: string;
  descricao: string;
  tom: 'amber' | 'rose';
  excecoes: Array<{
    id: string;
    valor: string | null;
    descricao: string;
    detectadoEm: Date;
    pagamentoNsu: string | null;
    pagamentoFormaPagamento: string | null;
    pagamentoDataPagamento: Date | null;
    vendaNsu: string | null;
    vendaDataVenda: string | null;
    vendaBandeira: string | null;
    pagamentoValor?: string | null;
    vendaValorBruto?: string | null;
  }>;
  total: number;
  page: number;
  pageParam: 'pDiv' | 'pPdv' | 'pCielo';
  sp: SP;
  tipo: string;
  filialId: string;
  acoesDivergencia?: boolean;
  candidatosMatchManual?: Array<{ id: string; data: string; valor: number; descricao: string }>;
  porSeveridade?: { BAIXA: number; MEDIA: number; ALTA: number };
}) {
  const corHeader = tom === 'rose' ? 'text-rose-700' : 'text-amber-700';
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hrefComPagina = (p: number) => {
    const qs = new URLSearchParams();
    if (sp.filialId) qs.set('filialId', sp.filialId);
    if (sp.dataInicio) qs.set('dataInicio', sp.dataInicio);
    if (sp.dataFim) qs.set('dataFim', sp.dataFim);
    if (sp.pDiv) qs.set('pDiv', sp.pDiv);
    if (sp.pPdv) qs.set('pPdv', sp.pPdv);
    if (sp.pCielo) qs.set('pCielo', sp.pCielo);
    if (p === 0) qs.delete(pageParam);
    else qs.set(pageParam, String(p));
    return `/conciliacao/operadora?${qs.toString()}`;
  };
  const filtroHref = `/excecoes?processo=OPERADORA&tipo=${tipo}&filialId=${filialId}`;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className={`text-sm font-semibold ${corHeader}`}>
            {titulo} <span className="font-normal text-slate-500">· {int(total)}</span>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">{descricao}</p>
        </div>
        <div className="flex items-center gap-2">
          {acoesDivergencia && total > 0 && (
            <AceitarTodosBtn
              filialId={filialId}
              tipo={tipo}
              qtdTotal={total}
              qtdBaixa={porSeveridade?.BAIXA ?? 0}
              qtdMedia={porSeveridade?.MEDIA ?? 0}
            />
          )}
          <Link
            href={filtroHref}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            Filtros avançados →
          </Link>
        </div>
      </div>
      {excecoes.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-slate-500">Nada a exibir.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2">NSU</th>
              <th className="px-4 py-2">Forma / Bandeira</th>
              <th className="px-4 py-2 text-right">Valor</th>
              <th className="px-4 py-2">Descrição</th>
              <th className="px-4 py-2 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {excecoes.map((e) => (
              <ExcecaoRow
                key={e.id}
                excecao={e}
                acoesDivergencia={acoesDivergencia}
                candidatosMatchManual={candidatosMatchManual}
              />
            ))}
          </tbody>
        </table>
      )}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          <span>
            Página {page + 1} de {totalPaginas} · {int(total)} resultados
          </span>
          <div className="flex gap-2">
            {page > 0 ? (
              <Link
                href={hrefComPagina(page - 1)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-white"
              >
                ← Anterior
              </Link>
            ) : (
              <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">← Anterior</span>
            )}
            {page < totalPaginas - 1 ? (
              <Link
                href={hrefComPagina(page + 1)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-white"
              >
                Próxima →
              </Link>
            ) : (
              <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">Próxima →</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

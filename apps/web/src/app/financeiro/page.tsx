import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, sql, sum } from 'drizzle-orm';
import { LogoutButton } from '../dashboard/logout-button';
import { AppNav } from '@/components/app-nav';
import { brl, formatDate, int } from '@/lib/format';
import { hojeBr, diasAtrasBr, brDateStart, brDateEnd } from '@/lib/datas';

export const dynamic = 'force-dynamic';

type TipoData = 'vencimento' | 'pagamento' | 'lancamento';
type StatusFiltro = 'todas' | 'aberto' | 'pago' | 'atrasado';
type OrigemFiltro = 'todas' | 'CONSUMER' | 'NFE' | 'FOLHA' | 'MANUAL';

interface SP {
  filialId?: string;
  tipoData?: TipoData;
  dataIni?: string;
  dataFim?: string;
  status?: StatusFiltro;
  categoriaId?: string;
  nome?: string;
  origem?: OrigemFiltro;
}

const TIPOS_DATA: { value: TipoData; label: string; coluna: string }[] = [
  { value: 'vencimento', label: 'Vencimento', coluna: 'data_vencimento' },
  { value: 'pagamento', label: 'Pagamento', coluna: 'data_pagamento' },
  { value: 'lancamento', label: 'Lançamento', coluna: 'data_cadastro' },
];

export default async function FinanceiroPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
   await exigirPerm(user.id, 'conta_pagar.read');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;

  const tipoData: TipoData = (['vencimento', 'pagamento', 'lancamento'] as const).includes(
    sp.tipoData as TipoData,
  )
    ? (sp.tipoData as TipoData)
    : 'vencimento';
  const status: StatusFiltro = (['todas', 'aberto', 'pago', 'atrasado'] as const).includes(
    sp.status as StatusFiltro,
  )
    ? (sp.status as StatusFiltro)
    : 'todas';
  const dataIni =
    sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(30);
  const dataFim =
    sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim) ? sp.dataFim : diasAtrasBr(-30); // ate 30 dias adiante
  const categoriaId = sp.categoriaId && /^[0-9a-f-]{36}$/.test(sp.categoriaId) ? sp.categoriaId : null;
  const nomeBusca = (sp.nome ?? '').trim();
  const origemFiltro: OrigemFiltro = (
    ['todas', 'CONSUMER', 'NFE', 'FOLHA', 'MANUAL'] as const
  ).includes(sp.origem as OrigemFiltro)
    ? (sp.origem as OrigemFiltro)
    : 'todas';

  const hoje = hojeBr();

  // Lista de categorias usadas nessa filial (so as que tem conta_pagar) —
  // usadas no select da UI. Ordenadas por descricao.
  const categoriasDisponiveis = filialSelecionada
    ? await db
        .selectDistinct({
          id: schema.categoriaConta.id,
          descricao: schema.categoriaConta.descricao,
        })
        .from(schema.contaPagar)
        .innerJoin(
          schema.categoriaConta,
          eq(schema.categoriaConta.id, schema.contaPagar.categoriaId),
        )
        .where(
          and(
            eq(schema.contaPagar.filialId, filialSelecionada.id),
            isNull(schema.contaPagar.dataDelete),
          ),
        )
        .orderBy(asc(schema.categoriaConta.descricao))
    : [];

  // KPIs ficam fixos (independem do filtro principal — sao informativos
  // sobre o estado total da filial).
  const kpis = filialSelecionada
    ? await (async () => {
        const baseWhere = and(
          eq(schema.contaPagar.filialId, filialSelecionada.id),
          isNull(schema.contaPagar.dataDelete),
        );
        const [emAberto] = await db
          .select({
            qtd: count(),
            total: sum(schema.contaPagar.valor),
          })
          .from(schema.contaPagar)
          .where(and(baseWhere, isNull(schema.contaPagar.dataPagamento)));
        const [vencidas] = await db
          .select({
            qtd: count(),
            total: sum(schema.contaPagar.valor),
          })
          .from(schema.contaPagar)
          .where(
            and(
              baseWhere,
              isNull(schema.contaPagar.dataPagamento),
              sql`${schema.contaPagar.dataVencimento} < ${hoje}`,
            ),
          );
        const [vencehoje] = await db
          .select({
            qtd: count(),
            total: sum(schema.contaPagar.valor),
          })
          .from(schema.contaPagar)
          .where(
            and(
              baseWhere,
              isNull(schema.contaPagar.dataPagamento),
              eq(schema.contaPagar.dataVencimento, hoje),
            ),
          );
        // Pagas no periodo do filtro (so se tipoData=pagamento; senao usa
        // ultimos 30 dias como referencia de "pagas recentes")
        const periodoIni = tipoData === 'pagamento' ? dataIni : diasAtrasBr(30);
        const periodoFim = tipoData === 'pagamento' ? dataFim : hoje;
        const [pagas] = await db
          .select({
            qtd: count(),
            total: sum(schema.contaPagar.valorPago),
          })
          .from(schema.contaPagar)
          .where(
            and(
              baseWhere,
              gte(schema.contaPagar.dataPagamento, periodoIni),
              lte(schema.contaPagar.dataPagamento, periodoFim),
            ),
          );
        return { emAberto, vencidas, vencehoje, pagas };
      })()
    : null;

  // Lista filtrada por tipo+periodo+status
  const contas = filialSelecionada
    ? await db
        .select({
          id: schema.contaPagar.id,
          codigoExterno: schema.contaPagar.codigoExterno,
          parcela: schema.contaPagar.parcela,
          totalParcelas: schema.contaPagar.totalParcelas,
          dataVencimento: schema.contaPagar.dataVencimento,
          dataCadastro: schema.contaPagar.dataCadastro,
          valor: schema.contaPagar.valor,
          dataPagamento: schema.contaPagar.dataPagamento,
          valorPago: schema.contaPagar.valorPago,
          descricao: schema.contaPagar.descricao,
          fornecedorNome: schema.fornecedor.nome,
          fornecedorCnpj: schema.fornecedor.cnpjOuCpf,
          categoriaDescricao: schema.categoriaConta.descricao,
          categoriaTipo: schema.categoriaConta.tipo,
          origem: schema.contaPagar.origem,
          notaCompraId: schema.contaPagar.notaCompraId,
        })
        .from(schema.contaPagar)
        .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
        .leftJoin(
          schema.categoriaConta,
          eq(schema.categoriaConta.id, schema.contaPagar.categoriaId),
        )
        .where(
          (() => {
            const base = and(
              eq(schema.contaPagar.filialId, filialSelecionada.id),
              isNull(schema.contaPagar.dataDelete),
            );

            // Filtro de data — sempre aplicado, varia a coluna
            let dataFilter;
            if (tipoData === 'vencimento') {
              dataFilter = and(
                gte(schema.contaPagar.dataVencimento, dataIni),
                lte(schema.contaPagar.dataVencimento, dataFim),
              );
            } else if (tipoData === 'pagamento') {
              dataFilter = and(
                isNotNull(schema.contaPagar.dataPagamento),
                gte(schema.contaPagar.dataPagamento, dataIni),
                lte(schema.contaPagar.dataPagamento, dataFim),
              );
            } else {
              // lancamento — coluna timestamp, compara com brDateStart/End
              dataFilter = and(
                isNotNull(schema.contaPagar.dataCadastro),
                gte(schema.contaPagar.dataCadastro, brDateStart(dataIni)),
                lte(schema.contaPagar.dataCadastro, brDateEnd(dataFim)),
              );
            }

            // Filtro de status secundario
            let statusFilter;
            if (status === 'aberto') {
              statusFilter = isNull(schema.contaPagar.dataPagamento);
            } else if (status === 'pago') {
              statusFilter = isNotNull(schema.contaPagar.dataPagamento);
            } else if (status === 'atrasado') {
              statusFilter = and(
                isNull(schema.contaPagar.dataPagamento),
                sql`${schema.contaPagar.dataVencimento} < ${hoje}`,
              );
            }

            // Filtros adicionais
            const categoriaFilter = categoriaId
              ? eq(schema.contaPagar.categoriaId, categoriaId)
              : undefined;
            const origemFilter =
              origemFiltro !== 'todas'
                ? eq(schema.contaPagar.origem, origemFiltro)
                : undefined;
            // Busca por nome busca em fornecedor.nome OU descricao da conta
            // (cobre os casos de conta sem fornecedor com texto na descricao,
            //  ex: "Aluguel" sem fornecedor mas reconhecivel pela descricao).
            const nomeFilter = nomeBusca
              ? sql`(
                extensions.unaccent(${schema.fornecedor.nome}) ILIKE extensions.unaccent(${`%${nomeBusca}%`})
                OR extensions.unaccent(${schema.contaPagar.descricao}) ILIKE extensions.unaccent(${`%${nomeBusca}%`})
              )`
              : undefined;

            return and(
              base,
              dataFilter,
              statusFilter,
              categoriaFilter,
              origemFilter,
              nomeFilter,
            );
          })(),
        )
        // Ordena pela data principal do filtro (mais recentes primeiro pra
        // pagamento/lancamento, mais urgentes primeiro pra vencimento)
        .orderBy(
          tipoData === 'vencimento'
            ? asc(schema.contaPagar.dataVencimento)
            : tipoData === 'pagamento'
              ? desc(schema.contaPagar.dataPagamento)
              : desc(schema.contaPagar.dataCadastro),
        )
        .limit(500)
    : [];

  function href(next: Partial<SP>): string {
    const qs = new URLSearchParams();
    if (filialSelecionada) qs.set('filialId', filialSelecionada.id);
    const t = next.tipoData ?? tipoData;
    if (t !== 'vencimento') qs.set('tipoData', t);
    qs.set('dataIni', next.dataIni ?? dataIni);
    qs.set('dataFim', next.dataFim ?? dataFim);
    const s = next.status ?? status;
    if (s !== 'todas') qs.set('status', s);
    const cat = next.categoriaId !== undefined ? next.categoriaId : categoriaId;
    if (cat) qs.set('categoriaId', cat);
    const nm = next.nome !== undefined ? next.nome : nomeBusca;
    if (nm) qs.set('nome', nm);
    const o = next.origem ?? origemFiltro;
    if (o !== 'todas') qs.set('origem', o);
    return `/financeiro?${qs.toString()}`;
  }
  const algumFiltroExtra = !!(categoriaId || nomeBusca || origemFiltro !== 'todas');

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold text-slate-900">
              concilia
            </Link>
            <AppNav />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Financeiro — Contas a pagar</h1>
        <p className="mt-1 text-sm text-slate-600">
          Filtre por período de vencimento, pagamento ou lançamento. Cores na
          tabela: <span className="text-emerald-700 font-medium">verde</span> = pago,{' '}
          <span className="text-rose-700 font-medium">vermelho</span> = atrasado.
        </p>

        {/* Filial selector */}
        {filiais.length > 1 && (
          <div className="mt-4 flex items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/financeiro?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === filialSelecionada?.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        {!filialSelecionada ? (
          <p className="mt-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
        ) : (
          <>
            {/* KPIs */}
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label="Em aberto (total)"
                qtd={Number(kpis?.emAberto?.qtd ?? 0)}
                valor={Number(kpis?.emAberto?.total ?? 0)}
                tom="slate"
                href={href({ status: 'aberto', tipoData: 'vencimento' })}
              />
              <KpiCard
                label="Atrasadas"
                qtd={Number(kpis?.vencidas?.qtd ?? 0)}
                valor={Number(kpis?.vencidas?.total ?? 0)}
                tom="rose"
                href={href({ status: 'atrasado', tipoData: 'vencimento' })}
              />
              <KpiCard
                label="Vence hoje"
                qtd={Number(kpis?.vencehoje?.qtd ?? 0)}
                valor={Number(kpis?.vencehoje?.total ?? 0)}
                tom="amber"
                href={href({
                  tipoData: 'vencimento',
                  dataIni: hoje,
                  dataFim: hoje,
                  status: 'aberto',
                })}
              />
              <KpiCard
                label={
                  tipoData === 'pagamento' ? 'Pagas no período' : 'Pagas (últimos 30d)'
                }
                qtd={Number(kpis?.pagas?.qtd ?? 0)}
                valor={Number(kpis?.pagas?.total ?? 0)}
                tom="emerald"
                href={href({ tipoData: 'pagamento', status: 'pago' })}
              />
            </div>

            {/* Filtro de data — principal */}
            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Tipo de data
                  </label>
                  <div className="mt-1 flex gap-1">
                    {TIPOS_DATA.map((t) => (
                      <Link
                        key={t.value}
                        href={href({ tipoData: t.value })}
                        className={`rounded-md border px-3 py-1.5 text-xs ${
                          tipoData === t.value
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {t.label}
                      </Link>
                    ))}
                  </div>
                </div>

                <form action="/financeiro" method="GET" className="flex flex-wrap items-end gap-2">
                  {filialSelecionada && (
                    <input type="hidden" name="filialId" value={filialSelecionada.id} />
                  )}
                  <input type="hidden" name="tipoData" value={tipoData} />
                  {status !== 'todas' && (
                    <input type="hidden" name="status" value={status} />
                  )}
                  {origemFiltro !== 'todas' && (
                    <input type="hidden" name="origem" value={origemFiltro} />
                  )}
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      De
                    </label>
                    <input
                      type="date"
                      name="dataIni"
                      defaultValue={dataIni}
                      className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Até
                    </label>
                    <input
                      type="date"
                      name="dataFim"
                      defaultValue={dataFim}
                      className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div className="min-w-[180px] flex-1">
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Fornecedor / descrição
                    </label>
                    <input
                      type="text"
                      name="nome"
                      defaultValue={nomeBusca}
                      placeholder="busca por nome ou texto da descrição"
                      className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div className="min-w-[200px]">
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Categoria
                    </label>
                    <select
                      name="categoriaId"
                      defaultValue={categoriaId ?? ''}
                      className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">todas</option>
                      {categoriasDisponiveis.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.descricao ?? '(sem descrição)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Aplicar
                  </button>
                  {algumFiltroExtra && (
                    <Link
                      href={href({
                        categoriaId: '',
                        nome: '',
                        origem: 'todas',
                      })}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Limpar
                    </Link>
                  )}
                </form>

                {/* Presets rapidos */}
                <div className="ml-auto flex flex-wrap items-center gap-1">
                  <span className="text-[11px] uppercase text-slate-500 mr-1">Atalhos:</span>
                  <PresetLink href={href({ dataIni: hoje, dataFim: hoje })} label="Hoje" />
                  <PresetLink
                    href={href({ dataIni: diasAtrasBr(7), dataFim: hoje })}
                    label="7d"
                  />
                  <PresetLink
                    href={href({ dataIni: diasAtrasBr(30), dataFim: hoje })}
                    label="30d"
                  />
                  <PresetLink
                    href={href({
                      dataIni: hoje.slice(0, 7) + '-01',
                      dataFim: hoje,
                    })}
                    label="Este mês"
                  />
                  <PresetLink
                    href={href({
                      dataIni: hoje,
                      dataFim: diasAtrasBr(-30),
                    })}
                    label="Próx 30d"
                  />
                </div>
              </div>

              {/* Pills de status secundario */}
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">Status:</span>
                {(
                  [
                    ['todas', 'Todas'],
                    ['aberto', 'Em aberto'],
                    ['pago', 'Pago'],
                    ['atrasado', 'Atrasado'],
                  ] as Array<[StatusFiltro, string]>
                ).map(([k, label]) => (
                  <Link
                    key={k}
                    href={href({ status: k })}
                    className={`rounded-md border px-3 py-1 ${
                      status === k
                        ? k === 'pago'
                          ? 'border-emerald-700 bg-emerald-700 text-white'
                          : k === 'atrasado'
                            ? 'border-rose-700 bg-rose-700 text-white'
                            : 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </Link>
                ))}
              </div>

              {/* Pills de origem */}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">Origem:</span>
                {(
                  [
                    ['todas', 'Todas', 'slate'],
                    ['CONSUMER', '🖥 PDV', 'slate'],
                    ['NFE', '📄 NFe', 'violet'],
                    ['FOLHA', '👥 Folha', 'amber'],
                    ['MANUAL', '✍ Manual', 'slate'],
                  ] as Array<[OrigemFiltro, string, 'slate' | 'violet' | 'amber']>
                ).map(([k, label, tom]) => {
                  const ativo = origemFiltro === k;
                  const cls = ativo
                    ? tom === 'violet'
                      ? 'border-violet-700 bg-violet-700 text-white'
                      : tom === 'amber'
                        ? 'border-amber-600 bg-amber-600 text-white'
                        : 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50';
                  return (
                    <Link
                      key={k}
                      href={href({ origem: k })}
                      className={`rounded-md border px-3 py-1 ${cls}`}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Tabela */}
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 w-2"></th>
                    <th className="px-4 py-2">Vencimento</th>
                    <th className="px-4 py-2">Lançado em</th>
                    <th className="px-4 py-2">Fornecedor</th>
                    <th className="px-4 py-2">Descrição</th>
                    <th className="px-4 py-2">Categoria</th>
                    <th className="px-4 py-2">Parcela</th>
                    <th className="px-4 py-2 text-right">Valor</th>
                    <th className="px-4 py-2">Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {contas.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-center text-xs text-slate-500">
                        Nenhuma conta nesse filtro.
                      </td>
                    </tr>
                  ) : (
                    contas.map((c) => {
                      const venc = formatDate(c.dataVencimento);
                      const pgto = c.dataPagamento ? formatDate(c.dataPagamento) : '—';
                      const lanc = c.dataCadastro
                        ? new Date(c.dataCadastro).toLocaleDateString('pt-BR', {
                            timeZone: 'America/Sao_Paulo',
                          })
                        : '—';
                      const pago = !!c.dataPagamento;
                      const atrasado = !pago && c.dataVencimento < hoje;
                      const rowBg = pago
                        ? 'bg-emerald-50/40'
                        : atrasado
                          ? 'bg-rose-50/40'
                          : '';
                      const stripe = pago
                        ? 'bg-emerald-500'
                        : atrasado
                          ? 'bg-rose-500'
                          : 'bg-slate-200';
                      return (
                        <tr
                          key={c.id}
                          className={`border-t border-slate-100 ${rowBg}`}
                        >
                          <td className="px-0 py-2">
                            <div className={`h-full w-1 ${stripe}`} style={{ minHeight: '2.25rem' }} />
                          </td>
                          <td
                            className={`px-4 py-2 font-mono text-xs ${
                              atrasado ? 'text-rose-700 font-medium' : 'text-slate-700'
                            }`}
                          >
                            {venc}
                          </td>
                          <td className="px-4 py-2 font-mono text-[11px] text-slate-500">
                            {lanc}
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-800">
                            <div className="flex items-center gap-1.5">
                              <span>
                                {c.fornecedorNome ?? (
                                  <span className="text-slate-400">sem fornecedor</span>
                                )}
                              </span>
                              {c.origem === 'NFE' && (
                                <span
                                  className="rounded bg-violet-100 px-1 py-0.5 text-[9px] font-medium text-violet-800"
                                  title={
                                    c.notaCompraId
                                      ? 'Originada de uma NFe lançada no estoque'
                                      : 'Origem NFe'
                                  }
                                >
                                  NFe
                                </span>
                              )}
                              {c.origem === 'FOLHA' && (
                                <span
                                  className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-800"
                                  title="Lançamento gerado pelo fechamento da folha semanal"
                                >
                                  FOLHA
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-600">
                            {c.notaCompraId ? (
                              <a
                                href={`/movimento/entrada-notas/${c.notaCompraId}`}
                                className="text-violet-700 hover:underline"
                                title="Ver a nota de origem"
                              >
                                {c.descricao ?? '—'}
                              </a>
                            ) : (
                              c.descricao ?? '—'
                            )}
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-600">
                            {c.categoriaDescricao ?? '—'}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-slate-600">
                            {c.parcela && c.totalParcelas
                              ? `${c.parcela}/${c.totalParcelas}`
                              : '—'}
                          </td>
                          <td
                            className={`px-4 py-2 text-right font-mono text-sm font-medium ${
                              pago ? 'text-emerald-700' : 'text-slate-900'
                            }`}
                          >
                            {brl(c.valor)}
                          </td>
                          <td className="px-4 py-2 text-xs">
                            {pago ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-emerald-800">
                                ✓ {pgto} · {brl(c.valorPago)}
                              </span>
                            ) : atrasado ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-rose-800">
                                ⚠ atrasada
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">
                                aberta
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              {contas.length >= 500 && (
                <p className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-center text-xs text-slate-500">
                  Mostrando 500. Refine o período pra ver mais.
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function KpiCard({
  label,
  qtd,
  valor,
  tom,
  href,
}: {
  label: string;
  qtd: number;
  valor: number;
  tom: 'slate' | 'emerald' | 'amber' | 'rose';
  href?: string;
}) {
  const cor = {
    slate: 'border-slate-200 bg-white',
    emerald: 'border-emerald-200 bg-emerald-50',
    amber: 'border-amber-200 bg-amber-50',
    rose: 'border-rose-200 bg-rose-50',
  }[tom];
  const inner = (
    <div className={`rounded-xl border p-4 ${cor} ${href ? 'cursor-pointer hover:shadow-sm' : ''}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{int(qtd)}</p>
      <p className="text-xs text-slate-700">{brl(valor)}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function PresetLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
    >
      {label}
    </Link>
  );
}

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDateTime, int } from '@/lib/format';
import { ExcecoesFiltros } from './filtros';
import { MOTIVO_LABEL } from '../conciliacao/operadora/motivos';

export const dynamic = 'force-dynamic';

const TIPOS = [
  // Operadora
  { valor: 'PDV_SEM_CIELO', label: 'PDV sem Cielo', processo: 'OPERADORA' },
  { valor: 'CIELO_SEM_PDV', label: 'Cielo sem PDV', processo: 'OPERADORA' },
  { valor: 'DIVERGENCIA_VALOR_OPERADORA', label: 'Divergência (operadora)', processo: 'OPERADORA' },
  // Recebíveis
  { valor: 'VENDA_SEM_AGENDA', label: 'Venda sem agenda', processo: 'RECEBIVEIS' },
  { valor: 'AGENDA_SEM_VENDA', label: 'Agenda sem venda', processo: 'RECEBIVEIS' },
  { valor: 'DIVERGENCIA_VALOR_RECEBIVEL', label: 'Divergência (recebível)', processo: 'RECEBIVEIS' },
  // Banco
  { valor: 'CIELO_NAO_PAGO', label: 'Cielo não pagou', processo: 'BANCO' },
  { valor: 'CREDITO_SEM_CIELO', label: 'Crédito sem Cielo', processo: 'BANCO' },
] as const;

const PROCESSOS = ['OPERADORA', 'RECEBIVEIS', 'BANCO'] as const;
const PROCESSO_LABEL: Record<string, string> = {
  OPERADORA: 'Operadora',
  RECEBIVEIS: 'Recebíveis',
  BANCO: 'Banco',
};

const SEVERIDADES = ['ALTA', 'MEDIA', 'BAIXA'] as const;

const TIPO_LABEL: Record<string, string> = Object.fromEntries(
  TIPOS.map((t) => [t.valor, t.label]),
);

const TIPO_COR: Record<string, string> = {
  PDV_SEM_CIELO: 'border-rose-200 bg-rose-50 text-rose-700',
  CIELO_SEM_PDV: 'border-rose-200 bg-rose-50 text-rose-700',
  DIVERGENCIA_VALOR_OPERADORA: 'border-amber-200 bg-amber-50 text-amber-700',
  VENDA_SEM_AGENDA: 'border-rose-200 bg-rose-50 text-rose-700',
  AGENDA_SEM_VENDA: 'border-amber-200 bg-amber-50 text-amber-700',
  DIVERGENCIA_VALOR_RECEBIVEL: 'border-amber-200 bg-amber-50 text-amber-700',
  CIELO_NAO_PAGO: 'border-rose-200 bg-rose-50 text-rose-700',
  CREDITO_SEM_CIELO: 'border-amber-200 bg-amber-50 text-amber-700',
};

const SEVERIDADE_COR: Record<string, string> = {
  ALTA: 'bg-rose-100 text-rose-800',
  MEDIA: 'bg-amber-100 text-amber-800',
  BAIXA: 'bg-slate-100 text-slate-700',
};

interface SP {
  filialId?: string;
  processo?: string;
  tipo?: string;
  severidade?: string;
  dataIni?: string;
  dataFim?: string;
  /** Filtra pela data da TRANSACAO (pagamento.data_pagamento ou venda.data_venda).
   * Formato YYYY-MM-DD, range de um dia. */
  dataTrans?: string;
  /** Busca texto: aplica a NSU, numero do pedido e descricao */
  q?: string;
  valorMin?: string;
  valorMax?: string;
  forma?: string;
  page?: string;
  /** Filtra por motivo da aceitacao (FORA_DO_TEF, FORMA_ERRADA_GARCOM, etc). */
  motivo?: string;
  /** 'true' = mostrar APENAS as ja aceitas. 'false'/undefined = padrao (so abertas). */
  aceitas?: string;
}

const PAGE_SIZE = 50;

export default async function ExcecoesPage(props: {
  searchParams: Promise<SP>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const idsAcessiveis = filiais.map((f) => f.id);

  if (idsAcessiveis.length === 0) {
    return (
      <Layout user={user}>
        <p className="text-sm text-slate-500">Nenhuma filial acessível.</p>
      </Layout>
    );
  }

  // Filtros
  const filialFiltro =
    sp.filialId && idsAcessiveis.includes(sp.filialId) ? [sp.filialId] : idsAcessiveis;
  const page = Math.max(0, Number(sp.page ?? 0));

  const whereBase = [inArray(schema.excecao.filialId, filialFiltro)];
  if (sp.processo && (PROCESSOS as readonly string[]).includes(sp.processo)) {
    whereBase.push(eq(schema.excecao.processo, sp.processo));
  }
  if (sp.severidade && (SEVERIDADES as readonly string[]).includes(sp.severidade)) {
    whereBase.push(eq(schema.excecao.severidade, sp.severidade));
  }
  // Filtro de data: comportamento difere conforme aceitas vs abertas.
  // - Abertas (default): filtra pela data da TRANSACAO (pagamento/venda/recebivel/lancamento)
  //   porque o user quer ver "exceções pendentes do periodo X".
  // - Aceitas: filtra por aceita_em (quando aceitou), porque transacoes podem
  //   ser de meses atras mas ele quer "o que aceitei no periodo X" (auditoria).
  const filtroPorAceita = sp.aceitas === 'true';
  if (sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni)) {
    const dIni = new Date(sp.dataIni + 'T00:00:00-03:00');
    if (filtroPorAceita) {
      whereBase.push(gte(schema.excecao.aceitaEm, dIni));
    } else {
      // Considera as 4 origens possiveis: pagamento (PDV), venda_adquirente
      // (Cielo Vendas), recebivel_adquirente (Cielo Recebiveis), lancamento_banco
      // (CNAB). Sem isso, AGENDA_SEM_VENDA e CREDITO_SEM_CIELO bypassam o filtro.
      const cond = or(
        gte(schema.pagamento.dataPagamento, dIni),
        gte(schema.vendaAdquirente.dataVenda, sp.dataIni),
        gte(schema.recebivelAdquirente.dataPagamento, sp.dataIni),
        gte(schema.lancamentoBanco.dataMovimento, sp.dataIni),
      );
      if (cond) whereBase.push(cond);
    }
  }
  if (sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim)) {
    const dFim = new Date(sp.dataFim + 'T23:59:59-03:00');
    if (filtroPorAceita) {
      whereBase.push(lte(schema.excecao.aceitaEm, dFim));
    } else {
      const cond = or(
        lte(schema.pagamento.dataPagamento, dFim),
        lte(schema.vendaAdquirente.dataVenda, sp.dataFim),
        lte(schema.recebivelAdquirente.dataPagamento, sp.dataFim),
        lte(schema.lancamentoBanco.dataMovimento, sp.dataFim),
      );
      if (cond) whereBase.push(cond);
    }
  }
  if (sp.q && sp.q.trim()) {
    const q = sp.q.trim();
    const like = `%${q}%`;
    const cond = or(
      sql`${schema.pagamento.nsuTransacao} ILIKE ${like}`,
      sql`${schema.pagamento.codigoPedidoExterno}::text = ${q}`,
      sql`${schema.excecao.descricao} ILIKE ${like}`,
    );
    if (cond) whereBase.push(cond);
  }
  const vMin = Number(sp.valorMin);
  if (sp.valorMin && Number.isFinite(vMin)) {
    whereBase.push(gte(schema.excecao.valor, String(vMin)));
  }
  const vMax = Number(sp.valorMax);
  if (sp.valorMax && Number.isFinite(vMax)) {
    whereBase.push(lte(schema.excecao.valor, String(vMax)));
  }
  if (sp.forma && sp.forma.trim()) {
    whereBase.push(eq(schema.pagamento.formaPagamento, sp.forma.trim()));
  }
  if (sp.motivo && sp.motivo.trim()) {
    whereBase.push(eq(schema.excecao.motivo, sp.motivo.trim()));
  }
  if (sp.dataTrans && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataTrans)) {
    const d = sp.dataTrans;
    const dIni = new Date(d + 'T00:00:00-03:00');
    const dFim = new Date(d + 'T23:59:59-03:00');
    // Usa helpers do drizzle (gte/lte/eq) em vez de sql`` template — drizzle
    // faz binding correto pro tipo da coluna (timestamp tz vs date). O BETWEEN
    // com 2 Date binders manuais via sql`` quebrou o SSR em prod.
    const cond = or(
      and(
        gte(schema.pagamento.dataPagamento, dIni),
        lte(schema.pagamento.dataPagamento, dFim),
      ),
      eq(schema.vendaAdquirente.dataVenda, d),
      eq(schema.recebivelAdquirente.dataPagamento, d),
      eq(schema.lancamentoBanco.dataMovimento, d),
    );
    if (cond) whereBase.push(cond);
  }
  // Filtro de status: 'true' mostra APENAS aceitas, default mostra so abertas.
  // Util pro fluxo "ver o que ja aceitei com determinado motivo".
  if (sp.aceitas === 'true') {
    whereBase.push(sql`${schema.excecao.aceitaEm} IS NOT NULL`);
  } else {
    whereBase.push(isNull(schema.excecao.aceitaEm));
  }

  // Contagens por tipo (sem filtro de tipo). Join com pagamento pra filtros
  // que referenciam campos do pagamento (forma, nsu, pedido).
  const contagens = await db
    .select({
      tipo: schema.excecao.tipo,
      qtd: sql<number>`COUNT(*)::int`,
      valor: sql<string>`COALESCE(SUM(${schema.excecao.valor}), 0)::text`,
    })
    .from(schema.excecao)
    .leftJoin(schema.pagamento, eq(schema.pagamento.id, schema.excecao.pagamentoId))
    .leftJoin(
      schema.vendaAdquirente,
      eq(schema.vendaAdquirente.id, schema.excecao.vendaAdquirenteId),
    )
    .leftJoin(
      schema.recebivelAdquirente,
      eq(schema.recebivelAdquirente.id, schema.excecao.recebivelAdquirenteId),
    )
    .leftJoin(
      schema.lancamentoBanco,
      eq(schema.lancamentoBanco.id, schema.excecao.lancamentoBancoId),
    )
    .where(and(...whereBase))
    .groupBy(schema.excecao.tipo);

  const contagemMap = new Map(contagens.map((c) => [c.tipo, c]));
  const totalQtd = contagens.reduce((s, c) => s + Number(c.qtd), 0);
  const totalValor = contagens.reduce((s, c) => s + Number(c.valor), 0);

  // Lista (aplica tipo tb)
  const whereList = [...whereBase];
  if (sp.tipo && TIPO_LABEL[sp.tipo]) {
    whereList.push(eq(schema.excecao.tipo, sp.tipo));
  }

  const [totalFiltradoRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(schema.excecao)
    .leftJoin(schema.pagamento, eq(schema.pagamento.id, schema.excecao.pagamentoId))
    .leftJoin(
      schema.vendaAdquirente,
      eq(schema.vendaAdquirente.id, schema.excecao.vendaAdquirenteId),
    )
    .leftJoin(
      schema.recebivelAdquirente,
      eq(schema.recebivelAdquirente.id, schema.excecao.recebivelAdquirenteId),
    )
    .leftJoin(
      schema.lancamentoBanco,
      eq(schema.lancamentoBanco.id, schema.excecao.lancamentoBancoId),
    )
    .where(and(...whereList));
  const totalFiltrado = Number(totalFiltradoRow?.n ?? 0);

  const excecoes = await db
    .select({
      id: schema.excecao.id,
      filialId: schema.excecao.filialId,
      tipo: schema.excecao.tipo,
      severidade: schema.excecao.severidade,
      descricao: schema.excecao.descricao,
      valor: schema.excecao.valor,
      detectadoEm: schema.excecao.detectadoEm,
      motivo: schema.excecao.motivo,
      aceitaEm: schema.excecao.aceitaEm,
      observacao: schema.excecao.observacao,
      pagamentoNsu: schema.pagamento.nsuTransacao,
      pagamentoFormaPagamento: schema.pagamento.formaPagamento,
      pagamentoDataPagamento: schema.pagamento.dataPagamento,
      vendaDataVenda: schema.vendaAdquirente.dataVenda,
      vendaNsu: schema.vendaAdquirente.nsu,
      vendaForma: schema.vendaAdquirente.formaPagamento,
      recebivelDataPagamento: schema.recebivelAdquirente.dataPagamento,
      recebivelNsu: schema.recebivelAdquirente.nsu,
      lancamentoData: schema.lancamentoBanco.dataMovimento,
      filialNome: schema.filial.nome,
    })
    .from(schema.excecao)
    .leftJoin(schema.pagamento, eq(schema.pagamento.id, schema.excecao.pagamentoId))
    .leftJoin(
      schema.vendaAdquirente,
      eq(schema.vendaAdquirente.id, schema.excecao.vendaAdquirenteId),
    )
    .leftJoin(
      schema.recebivelAdquirente,
      eq(schema.recebivelAdquirente.id, schema.excecao.recebivelAdquirenteId),
    )
    .leftJoin(
      schema.lancamentoBanco,
      eq(schema.lancamentoBanco.id, schema.excecao.lancamentoBancoId),
    )
    .innerJoin(schema.filial, eq(schema.filial.id, schema.excecao.filialId))
    .where(and(...whereList))
    .orderBy(desc(schema.excecao.detectadoEm))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  const totalPaginas = Math.ceil(totalFiltrado / PAGE_SIZE);

  return (
    <Layout user={user}>
      <h1 className="text-2xl font-bold text-slate-900">Exceções</h1>
      <p className="mt-1 text-sm text-slate-600">
        Pagamentos que não conseguiram fechar a cadeia PDV → Cielo → Banco.
      </p>

      {/* Contadores por tipo (filtrado por processo se houver) */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {TIPOS.filter((t) => !sp.processo || t.processo === sp.processo).map((t) => {
          const c = contagemMap.get(t.valor);
          const qtd = Number(c?.qtd ?? 0);
          const valor = Number(c?.valor ?? 0);
          const ativo = sp.tipo === t.valor;
          const href = makeHref(sp, { tipo: ativo ? undefined : t.valor, page: undefined });
          return (
            <Link
              key={t.valor}
              href={href}
              className={`rounded-xl border p-3 shadow-sm transition hover:shadow ${
                ativo
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-900'
              }`}
            >
              <p className={`text-[10px] font-medium uppercase tracking-wide ${ativo ? 'text-slate-400' : 'text-slate-400'}`}>
                {PROCESSO_LABEL[t.processo]}
              </p>
              <p className={`mt-0.5 text-xs font-medium ${ativo ? 'text-slate-200' : 'text-slate-600'}`}>
                {t.label}
              </p>
              <p className="mt-1.5 text-xl font-bold">{int(qtd)}</p>
              <p className={`text-[11px] ${ativo ? 'text-slate-300' : 'text-slate-500'}`}>
                {brl(valor)}
              </p>
            </Link>
          );
        })}
      </div>

      {/* Resumo total + filtros */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">{int(totalQtd)}</span>{' '}
          {sp.aceitas === 'true' ? 'exceções aceitas' : 'exceções abertas'} ·{' '}
          {brl(totalValor)}{sp.aceitas === 'true' ? '' : ' em risco'}
          {sp.tipo && (
            <span className="ml-2 text-slate-500">
              · filtrando por <span className="font-medium text-slate-700">{TIPO_LABEL[sp.tipo]}</span>
            </span>
          )}
        </div>
        <ExcecoesFiltros
          filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          sp={sp}
        />
      </div>

      {/* Tabela */}
      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Filial</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">NSU</th>
              <th className="px-4 py-3">Forma</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Severidade</th>
              <th className="px-4 py-3">Motivo / Obs</th>
              <th className="px-4 py-3">{sp.aceitas === 'true' ? 'Aceita em' : 'Detectado em'}</th>
            </tr>
          </thead>
          <tbody>
            {excecoes.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-500">
                  Nenhuma exceção com os filtros atuais.
                </td>
              </tr>
            ) : (
              excecoes.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs text-slate-600">{e.filialNome}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                    {(() => {
                      // Fallback de data por tipo de excecao. Cada tipo tem
                      // a data relevante numa tabela diferente.
                      const dataIso =
                        e.pagamentoDataPagamento
                          ? new Date(e.pagamentoDataPagamento)
                              .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                          : e.vendaDataVenda
                            ? new Date(e.vendaDataVenda + 'T00:00:00-03:00')
                                .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                            : e.recebivelDataPagamento
                              ? new Date(e.recebivelDataPagamento + 'T00:00:00-03:00')
                                  .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                              : e.lancamentoData
                                ? new Date(e.lancamentoData + 'T00:00:00-03:00')
                                    .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                                : '—';
                      return dataIso;
                    })()}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                    {e.pagamentoNsu ?? e.vendaNsu ?? e.recebivelNsu ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-700">
                    {e.pagamentoFormaPagamento ?? e.vendaForma ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-medium text-slate-900">
                    {brl(e.valor)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                        TIPO_COR[e.tipo] ?? 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      {TIPO_LABEL[e.tipo] ?? e.tipo}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        SEVERIDADE_COR[e.severidade] ?? 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {e.severidade}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {e.motivo ? (
                      <span
                        className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800"
                        title={e.observacao ?? ''}
                      >
                        {MOTIVO_LABEL[e.motivo as keyof typeof MOTIVO_LABEL] ?? e.motivo}
                      </span>
                    ) : e.observacao ? (
                      <span
                        className="text-[11px] text-slate-500"
                        title={e.observacao}
                      >
                        {e.observacao.length > 30
                          ? e.observacao.slice(0, 30) + '…'
                          : e.observacao}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {formatDateTime(e.aceitaEm ?? e.detectadoEm)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Paginacao */}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <span>
              Página {page + 1} de {totalPaginas} · {int(totalFiltrado)} resultados
            </span>
            <div className="flex gap-2">
              {page > 0 && (
                <Link
                  href={makeHref(sp, { page: String(page - 1) })}
                  className="rounded-md border border-slate-300 px-3 py-1 hover:bg-white"
                >
                  Anterior
                </Link>
              )}
              {page < totalPaginas - 1 && (
                <Link
                  href={makeHref(sp, { page: String(page + 1) })}
                  className="rounded-md border border-slate-300 px-3 py-1 hover:bg-white"
                >
                  Próxima
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function makeHref(sp: SP, override: Partial<Record<keyof SP, string | undefined>>): string {
  const merged: Record<string, string | undefined> = { ...sp, ...override };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== '') qs.set(k, v);
  }
  const str = qs.toString();
  return str ? `/excecoes?${str}` : '/excecoes';
}

function Layout({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { email?: string };
}) {
  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-6xl px-6 py-10">{children}</section>
    </main>
  );
}

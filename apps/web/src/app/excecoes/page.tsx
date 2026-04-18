import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { LogoutButton } from '../dashboard/logout-button';
import { brl, formatDateTime, int } from '@/lib/format';
import { ExcecoesFiltros } from './filtros';

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
  /** Busca texto: aplica a NSU, numero do pedido e descricao */
  q?: string;
  valorMin?: string;
  valorMax?: string;
  forma?: string;
  page?: string;
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
  if (sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni)) {
    whereBase.push(gte(schema.excecao.detectadoEm, new Date(sp.dataIni + 'T00:00:00')));
  }
  if (sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim)) {
    whereBase.push(lte(schema.excecao.detectadoEm, new Date(sp.dataFim + 'T23:59:59')));
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
  whereBase.push(isNull(schema.excecao.aceitaEm));

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
      pagamentoNsu: schema.pagamento.nsuTransacao,
      pagamentoFormaPagamento: schema.pagamento.formaPagamento,
      pagamentoDataPagamento: schema.pagamento.dataPagamento,
      filialNome: schema.filial.nome,
    })
    .from(schema.excecao)
    .leftJoin(schema.pagamento, eq(schema.pagamento.id, schema.excecao.pagamentoId))
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
          <span className="font-medium text-slate-900">{int(totalQtd)}</span> exceções abertas ·{' '}
          {brl(totalValor)} em risco
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
              <th className="px-4 py-3">Data pgto</th>
              <th className="px-4 py-3">NSU</th>
              <th className="px-4 py-3">Forma</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Severidade</th>
              <th className="px-4 py-3">Detectado em</th>
            </tr>
          </thead>
          <tbody>
            {excecoes.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-500">
                  Nenhuma exceção com os filtros atuais.
                </td>
              </tr>
            ) : (
              excecoes.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs text-slate-600">{e.filialNome}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                    {e.pagamentoDataPagamento
                      ? new Date(e.pagamentoDataPagamento).toLocaleDateString('pt-BR')
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                    {e.pagamentoNsu ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-700">
                    {e.pagamentoFormaPagamento ?? '—'}
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
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {formatDateTime(e.detectadoEm)}
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
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-semibold text-slate-900">
              concilia
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
                Dashboard
              </Link>
              <Link href="/sync" className="text-slate-600 hover:text-slate-900">
                Sincronização
              </Link>
              <Link href="/upload" className="text-slate-600 hover:text-slate-900">
                Upload
              </Link>
              <Link href="/conciliacao" className="text-slate-600 hover:text-slate-900">
                Conciliação
              </Link>
              <Link href="/relatorio" className="text-slate-600 hover:text-slate-900">
                Relatório
              </Link>
              <Link href="/excecoes" className="font-medium text-slate-900">
                Exceções
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-6 py-10">{children}</section>
    </main>
  );
}

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { Calendario } from './calendario';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  processo?: string;
  mes?: string; // YYYY-MM
}

type Processo = 'OPERADORA' | 'RECEBIVEIS' | 'BANCO';
const PROCESSOS: Processo[] = ['OPERADORA', 'RECEBIVEIS', 'BANCO'];

function mesAtualIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function primeiroUltimoDoMes(mes: string): { ini: string; fim: string } {
  const [y, m] = mes.split('-').map(Number);
  const d1 = new Date(Date.UTC(y!, m! - 1, 1));
  const d2 = new Date(Date.UTC(y!, m!, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { ini: iso(d1), fim: iso(d2) };
}

export default async function FechamentoPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;
  const processo: Processo = (sp.processo as Processo) ?? 'OPERADORA';
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : mesAtualIso();
  const { ini, fim } = primeiroUltimoDoMes(mes);
  const isAdmin =
    filialSelecionada
      ? filiais.find((f) => f.id === filialSelecionada.id)?.role === 'DONO'
      : false;

  // Carrega estado do mes: fechamentos + stats por dia
  const fechamentosAtuais = filialSelecionada
    ? await db
        .select({ data: schema.fechamentoConciliacao.data })
        .from(schema.fechamentoConciliacao)
        .where(
          and(
            eq(schema.fechamentoConciliacao.filialId, filialSelecionada.id),
            eq(schema.fechamentoConciliacao.processo, processo),
            gte(schema.fechamentoConciliacao.data, ini),
            lte(schema.fechamentoConciliacao.data, fim),
          ),
        )
    : [];
  const diasFechadosSet = new Set(fechamentosAtuais.map((f) => f.data));

  // Agregacoes por dia: contagem de excecoes abertas pra visualizar status
  const statsPorDia = new Map<string, { qtd: number; valor: number }>();
  if (filialSelecionada) {
    const campoDataJoin =
      processo === 'RECEBIVEIS'
        ? sql<string>`TO_CHAR(${schema.vendaAdquirente.dataVenda}, 'YYYY-MM-DD')`
        : sql<string>`TO_CHAR(${schema.pagamento.dataPagamento} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`;

    if (processo === 'RECEBIVEIS') {
      const rows = await db
        .select({
          dia: campoDataJoin,
          qtd: sql<number>`COUNT(*)::int`,
          valor: sql<string>`COALESCE(SUM(${schema.excecao.valor}), 0)::text`,
        })
        .from(schema.excecao)
        .leftJoin(
          schema.vendaAdquirente,
          eq(schema.vendaAdquirente.id, schema.excecao.vendaAdquirenteId),
        )
        .where(
          and(
            eq(schema.excecao.filialId, filialSelecionada.id),
            eq(schema.excecao.processo, processo),
            isNull(schema.excecao.aceitaEm),
            gte(schema.vendaAdquirente.dataVenda, ini),
            lte(schema.vendaAdquirente.dataVenda, fim),
          ),
        )
        .groupBy(campoDataJoin);
      for (const r of rows) {
        if (r.dia) statsPorDia.set(r.dia, { qtd: Number(r.qtd), valor: Number(r.valor) });
      }
    } else {
      const rows = await db
        .select({
          dia: campoDataJoin,
          qtd: sql<number>`COUNT(*)::int`,
          valor: sql<string>`COALESCE(SUM(${schema.excecao.valor}), 0)::text`,
        })
        .from(schema.excecao)
        .leftJoin(schema.pagamento, eq(schema.pagamento.id, schema.excecao.pagamentoId))
        .where(
          and(
            eq(schema.excecao.filialId, filialSelecionada.id),
            eq(schema.excecao.processo, processo),
            isNull(schema.excecao.aceitaEm),
            gte(
              schema.pagamento.dataPagamento,
              new Date(ini + 'T00:00:00-03:00'),
            ),
            lte(
              schema.pagamento.dataPagamento,
              new Date(fim + 'T23:59:59-03:00'),
            ),
          ),
        )
        .groupBy(campoDataJoin);
      for (const r of rows) {
        if (r.dia) statsPorDia.set(r.dia, { qtd: Number(r.qtd), valor: Number(r.valor) });
      }
    }
  }

  const hrefMes = (novoMes: string) => {
    const qs = new URLSearchParams();
    if (filialSelecionada) qs.set('filialId', filialSelecionada.id);
    qs.set('processo', processo);
    qs.set('mes', novoMes);
    return `/fechamento?${qs.toString()}`;
  };
  const hrefFilial = (filialId: string) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialId);
    qs.set('processo', processo);
    qs.set('mes', mes);
    return `/fechamento?${qs.toString()}`;
  };
  const hrefProcesso = (p: Processo) => {
    const qs = new URLSearchParams();
    if (filialSelecionada) qs.set('filialId', filialSelecionada.id);
    qs.set('processo', p);
    qs.set('mes', mes);
    return `/fechamento?${qs.toString()}`;
  };

  function mesPrevNext(m: string, delta: number): string {
    const [y, mm] = m.split('-').map(Number);
    const d = new Date(Date.UTC(y!, mm! - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Fechamento de período</h1>
        <p className="mt-1 text-sm text-slate-600">
          Trave dias depois de revisar. Exceções de dias fechados ficam read-only e conciliações futuras não mexem neles.
          {!isAdmin && <span className="ml-2 text-amber-700">(Somente dono da filial pode fechar/reabrir)</span>}
        </p>

        {/* KPIs do mes */}
        {filialSelecionada && (() => {
          const totalDias = primeiroUltimoDoMes(mes).fim.slice(-2);
          const nDias = Number(totalDias);
          const nFechados = diasFechadosSet.size;
          const nComExcecao = Array.from(statsPorDia.entries())
            .filter(([d, s]) => s.qtd > 0 && !diasFechadosSet.has(d)).length;
          const valorExcecoes = Array.from(statsPorDia.entries())
            .filter(([d]) => !diasFechadosSet.has(d))
            .reduce((s, [, v]) => s + v.valor, 0);
          const nOk = nDias - nFechados - nComExcecao;
          const pctPronto = nDias > 0 ? Math.round((nFechados / nDias) * 100) : 0;
          return (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">Sem exceção</p>
                <p className="mt-1 text-2xl font-bold text-emerald-900">{nOk}</p>
                <p className="text-[10px] text-emerald-700">prontos pra fechar</p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-amber-700">Com exceção</p>
                <p className="mt-1 text-2xl font-bold text-amber-900">{nComExcecao}</p>
                <p className="text-[10px] text-amber-700">
                  R$ {valorExcecoes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="rounded-lg border border-slate-300 bg-slate-100 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-600">Fechados</p>
                <p className="mt-1 text-2xl font-bold text-slate-800">{nFechados}</p>
                <p className="text-[10px] text-slate-600">🔒 travados</p>
              </div>
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-sky-700">Progresso</p>
                <p className="mt-1 text-2xl font-bold text-sky-900">{pctPronto}%</p>
                <p className="text-[10px] text-sky-700">{nFechados} de {nDias} dias</p>
              </div>
            </div>
          );
        })()}

        {/* Seletores */}
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={hrefFilial(f.id)}
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
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-slate-500">Processo:</span>
            {PROCESSOS.map((p) => (
              <Link
                key={p}
                href={hrefProcesso(p)}
                className={`rounded-md border px-3 py-1 text-xs ${
                  p === processo
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {p === 'OPERADORA' ? 'Operadora' : p === 'RECEBIVEIS' ? 'Recebíveis' : 'Banco'}
              </Link>
            ))}
          </div>
        </div>

        {/* Navegacao do mes */}
        <div className="mt-4 flex items-center justify-between">
          <Link
            href={hrefMes(mesPrevNext(mes, -1))}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            ← {mesPrevNext(mes, -1)}
          </Link>
          <h2 className="text-lg font-semibold text-slate-900">{mes}</h2>
          <Link
            href={hrefMes(mesPrevNext(mes, 1))}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            {mesPrevNext(mes, 1)} →
          </Link>
        </div>

        {/* Calendario */}
        {filialSelecionada && (
          <div className="mt-4">
            <Calendario
              mes={mes}
              filialId={filialSelecionada.id}
              processo={processo}
              isAdmin={isAdmin}
              diasFechados={Array.from(diasFechadosSet)}
              stats={Object.fromEntries(statsPorDia)}
            />
          </div>
        )}
      </section>
    </main>
  );
}

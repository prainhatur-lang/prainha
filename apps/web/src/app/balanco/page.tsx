// BALANÇO DO DIA — o que está acontecendo (e o que deu errado) em cada casa,
// a partir da foto que o vendas-local manda de 10 em 10 min (balanco_loja) +
// o que só a nuvem sabe (avaliações, reservas, lista de espera).
//
// Hoje: a última foto de cada casa, recarregando sozinha a cada 60s.
// Dia passado: a última foto daquele dia = o balanço final.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { exigirPerm } from '@/lib/exigir-perm';
import { AppHeader } from '@/components/app-header';
import { brDateEnd, brDateStart, hojeBr } from '@/lib/datas';
import { brl, formatDate, int, relativeTime } from '@/lib/format';
import type { BalancoDados } from '@/lib/balanco';
import { AutoRefresh, BotaoAtualizar } from './balanco-client';

export const dynamic = 'force-dynamic';

interface SP {
  dia?: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function somaDias(ymd: string, n: number): string {
  return new Date(new Date(ymd + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
}

function horaBr(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

function Delta({ pct, invertido = false }: { pct: number | null | undefined; invertido?: boolean }) {
  if (pct == null || Number.isNaN(pct)) return null;
  const bom = invertido ? pct <= 0 : pct >= 0;
  const cls = pct === 0 ? 'text-slate-500' : bom ? 'text-emerald-700' : 'text-rose-700';
  return (
    <span className={`text-xs font-medium ${cls}`}>
      {pct > 0 ? '+' : ''}
      {pct}%
    </span>
  );
}

function Kpi({
  titulo,
  valor,
  sub,
  tom = 'neutro',
}: {
  titulo: string;
  valor: React.ReactNode;
  sub?: React.ReactNode;
  tom?: 'neutro' | 'bom' | 'ruim' | 'alerta';
}) {
  const borda =
    tom === 'ruim'
      ? 'border-rose-200 bg-rose-50/60'
      : tom === 'alerta'
        ? 'border-amber-200 bg-amber-50/60'
        : tom === 'bom'
          ? 'border-emerald-200 bg-emerald-50/60'
          : 'border-slate-200 bg-white';
  return (
    <div className={`rounded-lg border p-3 ${borda}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{titulo}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{valor}</div>
      {sub && <div className="mt-1 text-xs leading-snug text-slate-600">{sub}</div>}
    </div>
  );
}

type Evento = { quando: string; tipo: string; icone: string; texto: string; detalhe: string | null; ruim: boolean };

function eventosDoDia(d: BalancoDados): Evento[] {
  const ev: Evento[] = [];
  for (const c of d.cancelamentos?.lista ?? []) {
    const produzido = !!c.status_item && c.status_item !== 'a_produzir' && c.status_item !== 'pedido';
    const inteiro = c.status_item === 'pedido';
    ev.push({
      quando: c.quando,
      tipo: 'cancelamento',
      icone: '🗑',
      texto: `${inteiro ? 'Pedido inteiro' : 'Item'} cancelado · mesa ${c.numero ?? '?'}${c.nome ? ` · ${c.nome}` : ''}${c.valor != null ? ` · ${brl(c.valor)}` : ''}`,
      detalhe: [c.motivo, c.login ? `por ${c.login}` : null, c.gerente && c.gerente !== c.login ? `autorizou ${c.gerente}` : null, produzido ? 'JÁ PRODUZIDO' : null]
        .filter(Boolean)
        .join(' · ') || null,
      ruim: produzido || inteiro,
    });
  }
  for (const e of d.estornos?.lista ?? []) {
    ev.push({
      quando: e.quando,
      tipo: 'estorno',
      icone: '↩',
      texto: `Estorno de pagamento · mesa ${e.numero ?? '?'}${e.forma ? ` · ${e.forma}` : ''}${e.valor != null ? ` · ${brl(e.valor)}` : ''}`,
      detalhe: [e.motivo, e.login ? `por ${e.login}` : null].filter(Boolean).join(' · ') || null,
      ruim: true,
    });
  }
  for (const r of d.reaberturas?.lista ?? []) {
    ev.push({
      quando: r.quando,
      tipo: 'reabertura',
      icone: '🔓',
      texto: `Conta reaberta · mesa ${r.numero ?? '?'}`,
      detalhe: [r.login ? `por ${r.login}` : null, r.fechada_em ? `tinha fechado às ${horaBr(r.fechada_em)}` : null].filter(Boolean).join(' · ') || null,
      ruim: false,
    });
  }
  for (const l of d.liberacoes?.lista ?? []) {
    ev.push({
      quando: l.quando,
      tipo: 'liberacao',
      icone: l.status === 'negada' ? '⛔' : '✅',
      texto: `Liberação ${l.status} · ${l.tipo} · mesa ${l.numero}${l.nome ? ` · ${l.nome}` : ''}${l.valor != null ? ` · ${brl(l.valor)}` : ''}`,
      detalhe: [l.motivo, `pediu ${l.login}`, l.decidido_por ? `decidiu ${l.decidido_por}` : null, l.resposta].filter(Boolean).join(' · ') || null,
      ruim: l.status === 'negada',
    });
  }
  for (const c of d.reclamacoes?.lista ?? []) {
    ev.push({
      quando: c.criado_em,
      tipo: 'reclamacao',
      icone: '⚠️',
      texto: `Reclamação · mesa ${c.mesa ?? '?'}${c.nota != null ? ` · nota ${c.nota}` : ''}${c.assunto ? ` · ${c.assunto}` : ''}`,
      detalhe: [c.texto, c.atendido_em ? `atendida ${horaBr(c.atendido_em)}${c.atendido_por ? ` por ${c.atendido_por}` : ''}` : 'AINDA ABERTA'].filter(Boolean).join(' · ') || null,
      ruim: !c.atendido_em,
    });
  }
  ev.sort((a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime());
  return ev.slice(0, 60);
}

export default async function BalancoPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'dashboard.read');

  const sp = await props.searchParams;
  const hoje = hojeBr();
  const dia = sp.dia && YMD.test(sp.dia) && sp.dia <= hoje ? sp.dia : hoje;
  const ehHoje = dia === hoje;
  const filiais = await filiaisDoUsuario(user.id);

  const b = schema.balancoLoja;
  const casas = await Promise.all(
    filiais.map(async (f) => {
      const [ultimo] = await db
        .select({ id: b.id, capturadoEm: b.capturadoEm, versao: b.versao, dados: b.dados })
        .from(b)
        .where(and(eq(b.filialId, f.id), eq(b.dia, dia)))
        .orderBy(desc(b.capturadoEm))
        .limit(1);
      const linha = await db
        .select({
          capturadoEm: b.capturadoEm,
          comandas: sql<number | null>`(${b.dados}#>>'{fluxo,hoje_ate,n}')::int`,
          pessoas: sql<number | null>`(${b.dados}#>>'{fluxo,hoje_ate,pes}')::int`,
          ocupadas: sql<number | null>`(${b.dados}#>>'{mesas,ocupadas}')::int`,
          mesasTotal: sql<number | null>`(${b.dados}#>>'{mesas,total}')::int`,
          atrasadas: sql<number | null>`(${b.dados}#>>'{atrasos,total_atrasadas}')::int`,
          criticas: sql<number | null>`(${b.dados}#>>'{atrasos,total_criticas}')::int`,
          cancelamentos: sql<number | null>`(${b.dados}#>>'{cancelamentos,n}')::int`,
          estornos: sql<number | null>`(${b.dados}#>>'{estornos,n}')::int`,
          reclamacoes: sql<number | null>`(${b.dados}#>>'{reclamacoes,hoje}')::int`,
          recebido: sql<number | null>`(${b.dados}#>>'{caixa,total}')::float8`,
        })
        .from(b)
        .where(and(eq(b.filialId, f.id), eq(b.dia, dia)))
        .orderBy(asc(b.capturadoEm));

      const ini = brDateStart(dia);
      const fim = brDateEnd(dia);
      const [av] = await db
        .select({
          n: sql<number>`count(*)::int`,
          ruins: sql<number>`count(*) filter (where ${schema.avaliacao.nota} <= 3)::int`,
          abertas: sql<number>`count(*) filter (where ${schema.avaliacao.nota} <= 3 and ${schema.avaliacao.status} = 'novo')::int`,
          media: sql<number | null>`round(avg(${schema.avaliacao.nota})::numeric, 1)::float8`,
        })
        .from(schema.avaliacao)
        .where(and(eq(schema.avaliacao.filialId, f.id), gte(schema.avaliacao.criadoEm, ini), lte(schema.avaliacao.criadoEm, fim)));
      const [rs] = await db
        .select({
          n: sql<number>`count(*)::int`,
          pessoas: sql<number>`coalesce(sum(${schema.reserva.pessoas}),0)::int`,
          sentadas: sql<number>`count(*) filter (where ${schema.reserva.status} in ('sentada','concluida'))::int`,
          noShow: sql<number>`count(*) filter (where ${schema.reserva.status} = 'no_show')::int`,
          canceladas: sql<number>`count(*) filter (where ${schema.reserva.status} = 'cancelada')::int`,
          porVir: sql<number>`count(*) filter (where ${schema.reserva.status} in ('pendente','confirmada'))::int`,
        })
        .from(schema.reserva)
        .where(and(eq(schema.reserva.filialId, f.id), eq(schema.reserva.data, dia)));
      const [es] = await db
        .select({
          n: sql<number>`count(*)::int`,
          sentados: sql<number>`count(*) filter (where ${schema.listaEspera.sentadoEm} is not null)::int`,
          naFila: sql<number>`count(*) filter (where ${schema.listaEspera.status} in ('aguardando','chamado'))::int`,
          esperaMin: sql<number | null>`round(avg(extract(epoch from (${schema.listaEspera.sentadoEm} - ${schema.listaEspera.criadoEm})) / 60) filter (where ${schema.listaEspera.sentadoEm} is not null))::float8`,
        })
        .from(schema.listaEspera)
        .where(and(eq(schema.listaEspera.filialId, f.id), gte(schema.listaEspera.criadoEm, ini), lte(schema.listaEspera.criadoEm, fim)));

      return {
        filial: f,
        ultimo: ultimo ? { ...ultimo, dados: ultimo.dados as BalancoDados } : null,
        linha,
        av,
        rs,
        es,
      };
    }),
  );

  const hrefDia = (d: string) => `/balanco?dia=${d}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      {ehHoje && <AutoRefresh segundos={60} />}
      <section className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Balanço do dia</h1>
            <p className="mt-1 text-sm text-slate-600">
              O que está acontecendo em cada casa: movimento, ocupação, atrasos e o que deu errado (cancelamentos, estornos,
              reaberturas, reclamações). A loja manda uma foto a cada 10 minutos
              {ehHoje ? ' e esta página recarrega sozinha a cada minuto.' : '; num dia passado, a última foto é o balanço final.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={hrefDia(somaDias(dia, -1))} className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              ‹
            </Link>
            <form className="flex items-center gap-2" action="/balanco" method="get">
              <input type="date" name="dia" defaultValue={dia} max={hoje} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                Ver
              </button>
            </form>
            {ehHoje ? (
              <span className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-sm text-slate-400">›</span>
            ) : (
              <Link href={hrefDia(somaDias(dia, 1))} className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                ›
              </Link>
            )}
            {!ehHoje && (
              <Link href="/balanco" className="text-sm text-sky-700 hover:underline">
                hoje
              </Link>
            )}
            {ehHoje && <BotaoAtualizar />}
          </div>
        </div>

        {casas.length === 0 && <p className="mt-10 text-sm text-slate-500">Nenhuma filial disponível.</p>}

        {casas.map(({ filial, ultimo, linha, av, rs, es }) => {
          const d = ultimo?.dados;
          const idadeMin = ultimo ? Math.round((Date.now() - ultimo.capturadoEm.getTime()) / 60000) : null;
          const velho = ehHoje && idadeMin != null && idadeMin > 25;
          const fx = d?.fluxo ?? null;
          const ms = d?.mesas ?? null;
          const at = d?.atrasos ?? null;
          const cx = d?.caixa ?? null;
          const ca = d?.cancelamentos;
          const et = d?.estornos;
          const re = d?.reaberturas;
          const li = d?.liberacoes;
          const rc = d?.reclamacoes;
          const eventos = d ? eventosDoDia(d) : [];
          const horasComMovimento = fx
            ? fx.hoje.map((h, i) => ({ h: i, hoje: h.n, ontem: fx.ontem[i]?.n ?? 0, semana: fx.semana[i]?.n ?? 0 })).filter((x, i) => x.hoje || x.ontem || x.semana || (ehHoje && i === fx.hora))
            : [];
          const maxHora = Math.max(1, ...horasComMovimento.map((x) => Math.max(x.hoje, x.ontem, x.semana)));
          // Evolução do dia: no máximo ~14 linhas, amostrando a cada N fotos (a última sempre entra).
          const passo = Math.max(1, Math.ceil(linha.length / 14));
          const evolucao = linha.filter((_, i) => i % passo === 0 || i === linha.length - 1);

          return (
            <article key={filial.id} className="mt-8 rounded-xl border border-slate-200 bg-white shadow-sm">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">{filial.nome}</h2>
                  {d && (
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${d.online ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                      <span className={`h-2 w-2 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      {d.online ? 'PDV online' : 'PDV fora'}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  {ultimo ? (
                    <span className={velho ? 'font-medium text-amber-700' : ''}>
                      {ehHoje ? 'foto' : 'última foto'} das {horaBr(ultimo.capturadoEm)}
                      {ehHoje ? ` (${relativeTime(ultimo.capturadoEm)})` : ''}
                      {velho ? ' · a loja parou de mandar?' : ''}
                      {' · '}
                      {linha.length} foto{linha.length === 1 ? '' : 's'} no dia
                      {d?.fonte ? ` · ${d.fonte === 'local' ? 'PDV próprio' : 'Consumer'}` : ''}
                      {ultimo.versao ? ` · v${ultimo.versao}` : ''}
                    </span>
                  ) : (
                    <span>sem foto {ehHoje ? 'hoje' : `em ${formatDate(dia)}`}</span>
                  )}
                  {ehHoje && <BotaoAtualizar filialId={filial.id} />}
                </div>
              </header>

              {!d ? (
                <p className="px-5 py-6 text-sm text-slate-500">
                  {ehHoje
                    ? 'A loja ainda não mandou o balanço de hoje. Ela manda sozinha a cada 10 minutos quando o vendas-local está atualizado e ligado — ou clique em "Atualizar agora".'
                    : 'Não há balanço guardado pra esse dia nesta casa.'}
                </p>
              ) : (
                <div className="px-5 py-4">
                  {/* KPIs */}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <Kpi
                      titulo={ehHoje ? 'Comandas até agora' : 'Comandas no dia'}
                      valor={fx ? int(fx.hoje_ate.n) : '—'}
                      sub={
                        fx && (
                          <>
                            ontem {int(fx.ontem_ate.n)} <Delta pct={fx.delta_ontem_pct} /> · sem. passada {int(fx.semana_ate.n)}{' '}
                            <Delta pct={fx.delta_semana_pct} />
                          </>
                        )
                      }
                    />
                    <Kpi
                      titulo="Pessoas"
                      valor={fx ? int(fx.hoje_ate.pes) : '—'}
                      sub={
                        fx && (
                          <>
                            sem. passada {int(fx.semana_ate.pes)} <Delta pct={fx.delta_pessoas_semana_pct} />
                            {fx.hoje_ate.valor > 0 && <> · {brl(fx.hoje_ate.valor)} em comandas</>}
                          </>
                        )
                      }
                    />
                    <Kpi
                      titulo="Recebido no caixa"
                      valor={cx ? brl(cx.total) : '—'}
                      sub={
                        cx && (
                          <>
                            {int(cx.lancamentos)} lançamento{cx.lancamentos === 1 ? '' : 's'}
                            {cx.formas.slice(0, 3).map((f) => (
                              <span key={String(f.codigo)}>
                                {' · '}
                                {f.nome} {brl(f.valor)}
                              </span>
                            ))}
                            {cx.caixas_abertos > 0 && <> · {cx.caixas_abertos} caixa{cx.caixas_abertos === 1 ? '' : 's'} aberto{cx.caixas_abertos === 1 ? '' : 's'}</>}
                          </>
                        )
                      }
                    />
                    <Kpi
                      titulo={ehHoje ? 'Ocupação agora' : 'Ocupação na última foto'}
                      valor={ms ? `${ms.pct}%` : '—'}
                      sub={
                        ms && (
                          <>
                            {ms.ocupadas}/{ms.total} mesas · {int(ms.pessoas)} pessoas na casa · {ms.fechando} fechando conta
                            {ms.cartoes > 0 && <> · {ms.cartoes} cartões</>}
                            {ms.areas.filter((a) => !a.fora).length > 0 && (
                              <div className="mt-0.5 text-slate-500">
                                {ms.areas
                                  .filter((a) => !a.fora)
                                  .map((a) => `${a.nome} ${a.ocupadas}/${a.total}`)
                                  .join(' · ')}
                              </div>
                            )}
                          </>
                        )
                      }
                      tom={ms && ms.pct >= 90 ? 'alerta' : 'neutro'}
                    />
                    <Kpi
                      titulo={ehHoje ? 'Atrasos agora' : 'Atrasos na última foto'}
                      valor={at ? int(at.total_atrasadas) : '—'}
                      sub={
                        at && (
                          <>
                            {at.total_criticas} crítica{at.total_criticas === 1 ? '' : 's'} (2× o prazo) · {at.passe_parados} parado{at.passe_parados === 1 ? '' : 's'} no passe
                            {at.entrega_min ? ` · entrega em ${at.entrega_min} min` : ''}
                          </>
                        )
                      }
                      tom={at && at.total_criticas > 0 ? 'ruim' : at && at.total_atrasadas > 0 ? 'alerta' : 'neutro'}
                    />
                    <Kpi
                      titulo="Cancelamentos"
                      valor={ca ? int(ca.n) : '—'}
                      sub={
                        ca && (
                          <>
                            {brl(ca.valor)} · {ca.produzidos} já produzido{ca.produzidos === 1 ? '' : 's'} ({brl(ca.valor_produzidos)}) · {ca.pedidos} pedido{ca.pedidos === 1 ? '' : 's'} inteiro{ca.pedidos === 1 ? '' : 's'}
                            {ca.devolucoes > 0 && <> · {ca.devolucoes} devolução{ca.devolucoes === 1 ? '' : 'ões'}</>}
                          </>
                        )
                      }
                      tom={ca && ca.produzidos > 0 ? 'ruim' : ca && ca.n > 0 ? 'alerta' : 'neutro'}
                    />
                    <Kpi
                      titulo="Estornos"
                      valor={et ? int(et.n) : '—'}
                      sub={et && <>{brl(et.valor)} estornados no caixa</>}
                      tom={et && et.n > 0 ? 'ruim' : 'neutro'}
                    />
                    <Kpi
                      titulo="Contas reabertas"
                      valor={re ? int(re.n) : '—'}
                      sub="conta fechada que voltou a abrir"
                      tom={re && re.n > 0 ? 'alerta' : 'neutro'}
                    />
                    <Kpi
                      titulo="Liberações do gerente"
                      valor={li ? `${li.aprovadas + li.negadas}` : '—'}
                      sub={
                        li && (
                          <>
                            {li.aprovadas} aprovada{li.aprovadas === 1 ? '' : 's'} · {li.negadas} negada{li.negadas === 1 ? '' : 's'}
                            {li.expiradas > 0 && <> · {li.expiradas} sem resposta</>}
                            {li.pendentes > 0 && <span className="font-medium text-amber-700"> · {li.pendentes} esperando AGORA</span>}
                          </>
                        )
                      }
                      tom={li && li.pendentes > 0 ? 'alerta' : 'neutro'}
                    />
                    <Kpi
                      titulo="Reclamações"
                      valor={rc ? int(rc.hoje) : '—'}
                      sub={
                        rc && (
                          <>
                            {rc.abertas > 0 ? <span className="font-medium text-rose-700">{rc.abertas} sem atender</span> : 'todas atendidas'} · garçom chamado {rc.garcom}×
                            {rc.atendimento_min > 0 && <> · atende em {rc.atendimento_min} min</>}
                          </>
                        )
                      }
                      tom={rc && rc.abertas > 0 ? 'ruim' : rc && rc.hoje > 0 ? 'alerta' : 'neutro'}
                    />
                    <Kpi
                      titulo="Avaliações (QR)"
                      valor={av.n ? `${av.media ?? '—'}★` : '—'}
                      sub={
                        av.n ? (
                          <>
                            {av.n} avaliação{av.n === 1 ? '' : 'ões'} · {av.ruins} ruim{av.ruins === 1 ? '' : 's'} (≤3)
                            {av.abertas > 0 && <span className="font-medium text-rose-700"> · {av.abertas} sem contato</span>}
                          </>
                        ) : (
                          'nenhuma no dia'
                        )
                      }
                      tom={av.abertas > 0 ? 'ruim' : av.ruins > 0 ? 'alerta' : 'neutro'}
                    />
                    <Kpi
                      titulo="Reservas e espera"
                      valor={int(rs.n)}
                      sub={
                        <>
                          {rs.pessoas} pessoas · {rs.sentadas} sentada{rs.sentadas === 1 ? '' : 's'} · {rs.porVir} por vir
                          {rs.noShow > 0 && <span className="font-medium text-rose-700"> · {rs.noShow} no-show</span>}
                          {rs.canceladas > 0 && <> · {rs.canceladas} cancelada{rs.canceladas === 1 ? '' : 's'}</>}
                          <div className="mt-0.5 text-slate-500">
                            lista de espera: {es.n} grupo{es.n === 1 ? '' : 's'}
                            {es.naFila > 0 && ehHoje ? ` · ${es.naFila} na fila agora` : ''}
                            {es.esperaMin != null ? ` · esperou ${Math.round(es.esperaMin)} min em média` : ''}
                          </div>
                        </>
                      }
                      tom={rs.noShow > 0 ? 'alerta' : 'neutro'}
                    />
                  </div>

                  {/* Fluxo por hora */}
                  {horasComMovimento.length > 0 && fx && (
                    <div className="mt-5">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Comandas abertas por hora · <span className="text-slate-900">hoje</span> × <span className="text-slate-400">ontem</span> ×{' '}
                        <span className="text-sky-500">semana passada ({formatDate(fx.semana_dia)})</span>
                      </h3>
                      <div className="mt-2 flex h-24 items-end gap-1 overflow-x-auto">
                        {horasComMovimento.map((x) => (
                          <div key={x.h} className="flex min-w-[34px] flex-1 flex-col items-center gap-0.5" title={`${x.h}h: hoje ${x.hoje} · ontem ${x.ontem} · semana ${x.semana}`}>
                            <div className="flex h-20 w-full items-end justify-center gap-px">
                              <div className="w-1/3 rounded-t bg-slate-900" style={{ height: `${Math.round((x.hoje / maxHora) * 100)}%` }} />
                              <div className="w-1/3 rounded-t bg-slate-300" style={{ height: `${Math.round((x.ontem / maxHora) * 100)}%` }} />
                              <div className="w-1/3 rounded-t bg-sky-300" style={{ height: `${Math.round((x.semana / maxHora) * 100)}%` }} />
                            </div>
                            <div className={`text-[10px] tabular-nums ${ehHoje && x.h === fx.hora ? 'font-bold text-slate-900' : 'text-slate-500'}`}>{x.h}h</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    {/* Atrasos por praça */}
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{ehHoje ? 'Atrasos por praça (agora)' : 'Atrasos por praça (última foto)'}</h3>
                      {at && at.areas.filter((a) => a.comandas > 0 || a.passe_n > 0).length > 0 ? (
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                                <th className="py-1 pr-2 font-medium">Praça</th>
                                <th className="py-1 pr-2 text-right font-medium">Na fila</th>
                                <th className="py-1 pr-2 text-right font-medium">Atrasadas</th>
                                <th className="py-1 pr-2 text-right font-medium">Críticas</th>
                                <th className="py-1 pr-2 text-right font-medium">Maior</th>
                                <th className="py-1 text-right font-medium">Passe</th>
                              </tr>
                            </thead>
                            <tbody>
                              {at.areas
                                .filter((a) => a.comandas > 0 || a.passe_n > 0)
                                .map((a) => (
                                  <tr key={a.codigo} className="border-t border-slate-100">
                                    <td className="py-1 pr-2 text-slate-800">{a.nome}</td>
                                    <td className="py-1 pr-2 text-right tabular-nums">{a.comandas}</td>
                                    <td className={`py-1 pr-2 text-right tabular-nums ${a.atrasadas ? 'font-medium text-amber-700' : ''}`}>{a.atrasadas}</td>
                                    <td className={`py-1 pr-2 text-right tabular-nums ${a.criticas ? 'font-semibold text-rose-700' : ''}`}>{a.criticas}</td>
                                    <td className="py-1 pr-2 text-right tabular-nums text-slate-600">
                                      {a.maior_min} min{a.prazo_min ? ` / ${a.prazo_min}` : ''}
                                    </td>
                                    <td className={`py-1 text-right tabular-nums ${a.passe_parados ? 'font-medium text-amber-700' : 'text-slate-600'}`}>
                                      {a.passe_n}
                                      {a.passe_parados ? ` (${a.passe_parados} parados)` : ''}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                          {at.lista.length > 0 && (
                            <p className="mt-2 text-xs text-slate-600">
                              Mesas esperando:{' '}
                              {at.lista.map((x, i) => (
                                <span key={`${x.numero}-${i}`} className={x.critico ? 'font-semibold text-rose-700' : 'text-amber-700'}>
                                  {i > 0 ? ' · ' : ''}
                                  {x.numero} ({x.espera_min} min{x.area ? `, ${x.area}` : ''})
                                </span>
                              ))}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-slate-500">Nada na fila da cozinha.</p>
                      )}
                    </div>

                    {/* Setores */}
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Produção por setor no dia</h3>
                      {d.setores && d.setores.setores.length > 0 ? (
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                                <th className="py-1 pr-2 font-medium">Setor</th>
                                <th className="py-1 pr-2 text-right font-medium">Itens</th>
                                <th className="py-1 pr-2 text-right font-medium">Comandas</th>
                                <th className="py-1 pr-2 text-right font-medium">Valor</th>
                                <th className="py-1 text-right font-medium">Na fila</th>
                              </tr>
                            </thead>
                            <tbody>
                              {d.setores.setores.map((s) => (
                                <tr key={s.codigo} className="border-t border-slate-100">
                                  <td className="py-1 pr-2 text-slate-800">{s.nome}</td>
                                  <td className="py-1 pr-2 text-right tabular-nums">{int(s.hoje_itens)}</td>
                                  <td className="py-1 pr-2 text-right tabular-nums">{int(s.hoje_comandas)}</td>
                                  <td className="py-1 pr-2 text-right tabular-nums">{brl(s.hoje_valor)}</td>
                                  <td className="py-1 text-right tabular-nums text-slate-600">
                                    {s.a_produzir}
                                    {s.pronto ? ` + ${s.pronto} no passe` : ''}
                                  </td>
                                </tr>
                              ))}
                              <tr className="border-t border-slate-200 font-semibold">
                                <td className="py-1 pr-2">Total</td>
                                <td className="py-1 pr-2 text-right tabular-nums">{int(d.setores.hoje_itens)}</td>
                                <td />
                                <td className="py-1 pr-2 text-right tabular-nums">{brl(d.setores.hoje_total)}</td>
                                <td />
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-slate-500">Sem produção registrada.</p>
                      )}
                    </div>
                  </div>

                  {/* O que deu errado */}
                  <div className="mt-5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      O que deu errado no dia{' '}
                      <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-white">{eventos.length}</span>
                    </h3>
                    {li && li.pendentes_lista.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {li.pendentes_lista.map((p) => (
                          <li key={`p${p.id}`} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900">
                            ⏳ Esperando o gerente há {p.ha_min} min · {p.tipo} · mesa {p.numero}
                            {p.nome ? ` · ${p.nome}` : ''}
                            {p.valor != null ? ` · ${brl(p.valor)}` : ''}
                            {p.motivo ? ` · ${p.motivo}` : ''} · pediu {p.login}
                          </li>
                        ))}
                      </ul>
                    )}
                    {eventos.length === 0 ? (
                      <p className="mt-2 text-sm text-emerald-700">Nada registrado: sem cancelamento, estorno, reabertura ou reclamação.</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
                        {eventos.map((e, i) => (
                          <li key={`${e.tipo}-${i}`} className={`flex gap-3 px-3 py-2 text-sm ${e.ruim ? 'bg-rose-50/40' : ''}`}>
                            <span className="w-11 shrink-0 tabular-nums text-slate-500">{horaBr(e.quando)}</span>
                            <span className="shrink-0">{e.icone}</span>
                            <span className="min-w-0">
                              <span className="text-slate-900">{e.texto}</span>
                              {e.detalhe && <span className="block text-xs text-slate-500">{e.detalhe}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Evolução do dia */}
                  {evolucao.length > 1 && (
                    <div className="mt-5">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evolução do dia (fotos da loja)</h3>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                              <th className="py-1 pr-2 font-medium">Hora</th>
                              <th className="py-1 pr-2 text-right font-medium">Comandas</th>
                              <th className="py-1 pr-2 text-right font-medium">Pessoas</th>
                              <th className="py-1 pr-2 text-right font-medium">Ocupação</th>
                              <th className="py-1 pr-2 text-right font-medium">Atrasadas</th>
                              <th className="py-1 pr-2 text-right font-medium">Cancel.</th>
                              <th className="py-1 pr-2 text-right font-medium">Estornos</th>
                              <th className="py-1 pr-2 text-right font-medium">Reclam.</th>
                              <th className="py-1 text-right font-medium">Recebido</th>
                            </tr>
                          </thead>
                          <tbody>
                            {evolucao.map((l) => (
                              <tr key={l.capturadoEm.toISOString()} className="border-t border-slate-100">
                                <td className="py-1 pr-2 tabular-nums text-slate-700">{horaBr(l.capturadoEm)}</td>
                                <td className="py-1 pr-2 text-right tabular-nums">{l.comandas ?? '—'}</td>
                                <td className="py-1 pr-2 text-right tabular-nums">{l.pessoas ?? '—'}</td>
                                <td className="py-1 pr-2 text-right tabular-nums">
                                  {l.ocupadas != null && l.mesasTotal ? `${l.ocupadas}/${l.mesasTotal}` : '—'}
                                </td>
                                <td className={`py-1 pr-2 text-right tabular-nums ${l.criticas ? 'text-rose-700' : l.atrasadas ? 'text-amber-700' : ''}`}>
                                  {l.atrasadas ?? '—'}
                                  {l.criticas ? ` (${l.criticas} crít.)` : ''}
                                </td>
                                <td className="py-1 pr-2 text-right tabular-nums">{l.cancelamentos ?? '—'}</td>
                                <td className="py-1 pr-2 text-right tabular-nums">{l.estornos ?? '—'}</td>
                                <td className="py-1 pr-2 text-right tabular-nums">{l.reclamacoes ?? '—'}</td>
                                <td className="py-1 text-right tabular-nums">{l.recebido != null ? brl(l.recebido) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}

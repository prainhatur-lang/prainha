// /marketing/anuncios — anúncios da Meta de cada casa: saldo da conta, quanto
// gastou, o que comprou (alcance, conversas, cliques), campanhas (pausar/ligar),
// gasto × venda do PDV por dia e impulsionar post do Instagram pelo sistema.
// Tudo lido AO VIVO da Meta; só a ligação fica no banco (anuncios-ligacao.ts).

import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { db } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { brDateEnd, brDateStart, diasAtrasBr, hojeBr } from '@/lib/datas';
import { chaveDeOutraCasa, ligacaoAnuncios, CENTRO_CASA } from '@/lib/marketing/anuncios-ligacao';
import {
  campanhas as lerCampanhas,
  contasInstagramDaConta,
  NOME_OBJETIVO,
  numerosPeriodo,
  numerosPorDia,
  resultado,
  resumoConta,
  STATUS_CONTA,
  type Campanha,
  type Numeros,
} from '@/lib/marketing/meta-ads';
import { chaveValida } from '@/lib/marketing/chave';
import { postsInstagram } from '@/lib/marketing/instagram';
import { ConectarAnuncios } from './conectar';
import { DesconectarAnuncios, StatusCampanha } from './acoes';
import { Impulsionar, type InstagramDaConta, type PostParaImpulsionar } from './impulsionar';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PERIODOS = [7, 30, 90] as const;

const brl = (n: number | null | undefined) =>
  typeof n === 'number' ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
const num = (n: number | null | undefined) => (typeof n === 'number' ? Math.round(n).toLocaleString('pt-BR') : '—');
const pct = (n: number | null | undefined, casas = 1) =>
  typeof n === 'number' && Number.isFinite(n) ? `${n.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas })}%` : '—';
const diaCurto = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const dataBr = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' }) : '';

function proximoDia(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function diasEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let d = de; d <= ate && out.length < 400; d = proximoDia(d)) out.push(d);
  return out;
}

/** Venda fechada do PDV por dia (BRT). */
async function vendasPorDia(filialId: string, de: string, ate: string): Promise<Map<string, number>> {
  const linhas = (await db.execute(sql`
    SELECT (data_fechamento AT TIME ZONE 'America/Sao_Paulo')::date::text AS dia,
           coalesce(sum(valor_total), 0)::float8 AS valor
      FROM pedido
     WHERE filial_id = ${filialId}
       AND data_delete IS NULL
       AND data_fechamento >= ${brDateStart(de).toISOString()}::timestamptz
       AND data_fechamento <= ${brDateEnd(ate).toISOString()}::timestamptz
     GROUP BY 1
  `)) as unknown as Array<{ dia: string; valor: number }>;
  return new Map(linhas.map((l) => [l.dia, Number(l.valor) || 0]));
}

function Kpi({ rotulo, valor, sub }: { rotulo: string; valor: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className="text-lg font-semibold text-slate-900">{valor}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function Variacao({ atual, antes }: { atual: number; antes: number }) {
  if (!antes) return <span className="text-slate-400">sem base</span>;
  const v = ((atual - antes) / antes) * 100;
  return <span className={v >= 0 ? 'text-emerald-700' : 'text-red-700'}>{`${v >= 0 ? '+' : ''}${pct(v)}`}</span>;
}

/** Barras = gasto em anúncio (escala da esquerda); linha = venda do PDV (escala da direita). */
function Grafico({ dias, gasto, venda }: { dias: string[]; gasto: Map<string, number>; venda: Map<string, number> }) {
  const L = 760;
  const A = 240;
  const m = { e: 56, d: 64, t: 12, b: 28 };
  const w = L - m.e - m.d;
  const h = A - m.t - m.b;
  const maxG = Math.max(1, ...dias.map((d) => gasto.get(d) ?? 0));
  const maxV = Math.max(1, ...dias.map((d) => venda.get(d) ?? 0));
  const passo = w / Math.max(1, dias.length);
  const larg = Math.max(2, passo * 0.6);
  const x = (i: number) => m.e + passo * i + passo / 2;
  const yG = (v: number) => m.t + h - (v / maxG) * h;
  const yV = (v: number) => m.t + h - (v / maxV) * h;
  const linha = dias.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yV(venda.get(d) ?? 0).toFixed(1)}`).join(' ');
  const cadaRotulo = Math.ceil(dias.length / 10);
  const curto = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : num(n));
  return (
    <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img" aria-label="Gasto em anúncio e venda por dia">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={m.e} x2={L - m.d} y1={m.t + h - f * h} y2={m.t + h - f * h} stroke="#e2e8f0" />
          <text x={m.e - 6} y={m.t + h - f * h + 4} textAnchor="end" fontSize="10" fill="#2563eb">
            {curto(maxG * f)}
          </text>
          <text x={L - m.d + 6} y={m.t + h - f * h + 4} fontSize="10" fill="#059669">
            {curto(maxV * f)}
          </text>
        </g>
      ))}
      {dias.map((d, i) => {
        const g = gasto.get(d) ?? 0;
        return (
          <g key={d}>
            {g > 0 && (
              <rect x={x(i) - larg / 2} y={yG(g)} width={larg} height={m.t + h - yG(g)} fill="#93c5fd" rx="1">
                <title>{`${diaCurto(d)} · anúncio ${brl(g)} · venda ${brl(venda.get(d) ?? 0)}`}</title>
              </rect>
            )}
            {i % cadaRotulo === 0 && (
              <text x={x(i)} y={A - 8} textAnchor="middle" fontSize="10" fill="#64748b">
                {diaCurto(d)}
              </text>
            )}
          </g>
        );
      })}
      <path d={linha} fill="none" stroke="#059669" strokeWidth="2" />
      {dias.map((d, i) => (
        <circle key={d} cx={x(i)} cy={yV(venda.get(d) ?? 0)} r={dias.length > 40 ? 1.5 : 2.5} fill="#059669">
          <title>{`${diaCurto(d)} · venda ${brl(venda.get(d) ?? 0)} · anúncio ${brl(gasto.get(d) ?? 0)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

const STATUS_CAMP: Record<string, { t: string; c: string }> = {
  ACTIVE: { t: 'Rodando', c: 'bg-emerald-100 text-emerald-800' },
  PAUSED: { t: 'Pausada', c: 'bg-slate-100 text-slate-600' },
  CAMPAIGN_PAUSED: { t: 'Pausada', c: 'bg-slate-100 text-slate-600' },
  ADSET_PAUSED: { t: 'Conjunto pausado', c: 'bg-slate-100 text-slate-600' },
  IN_PROCESS: { t: 'Processando', c: 'bg-sky-100 text-sky-800' },
  WITH_ISSUES: { t: 'Com problema', c: 'bg-red-100 text-red-800' },
  PENDING_REVIEW: { t: 'Em análise', c: 'bg-amber-100 text-amber-800' },
  DISAPPROVED: { t: 'Reprovada', c: 'bg-red-100 text-red-800' },
  ARCHIVED: { t: 'Arquivada', c: 'bg-slate-100 text-slate-500' },
  DELETED: { t: 'Apagada', c: 'bg-slate-100 text-slate-500' },
};

function erroTexto(r: PromiseSettledResult<unknown>): string | null {
  return r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : null;
}

export default async function AnunciosPage(props: { searchParams: Promise<{ filialId?: string; p?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'atendimento.read');
  const podeMexer = await podeUsuario(user.id, 'atendimento.config');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm text-slate-500">Nenhuma casa disponível.</p>
        </section>
      </main>
    );
  }
  const filial = escolhida;
  const periodo = PERIODOS.find((p) => String(p) === sp.p) ?? 30;
  const ate = hojeBr();
  const de = diasAtrasBr(periodo - 1);
  const ateAnt = diasAtrasBr(periodo);
  const deAnt = diasAtrasBr(periodo * 2 - 1);

  const lig = await ligacaoAnuncios(filial.id).catch(() => null);
  const temOutraCasa = podeMexer && !lig ? !!(await chaveDeOutraCasa(filiais.map((f) => f.id), filial.id).catch(() => null)) : false;

  const cabecalho = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs text-slate-500">
          <a href={`/marketing?filialId=${filial.id}`} className="hover:underline">
            Marketing
          </a>{' '}
          ›
        </p>
        <h1 className="text-xl font-semibold text-slate-900">Anúncios da Meta</h1>
        <p className="text-sm text-slate-500">Saldo, gasto, resultados e venda de cada casa, lidos ao vivo da Meta.</p>
      </div>
      <nav className="flex flex-wrap gap-1">
        {filiais.map((f) => (
          <a
            key={f.id}
            href={`/marketing/anuncios?filialId=${f.id}&p=${periodo}`}
            className={`rounded-md px-3 py-1.5 text-sm ${f.id === filial.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100'}`}
          >
            {f.nome}
          </a>
        ))}
      </nav>
    </div>
  );

  if (!lig?.contaId) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-6xl space-y-4 px-4 py-6">
          {cabecalho}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 font-semibold text-slate-900">Conectar a conta de anúncios da {filial.nome}</h2>
            {podeMexer ? (
              <>
                <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
                  <li>
                    No <a className="text-blue-700 underline" href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer">Gerenciador de Negócios → Usuários do sistema</a>, crie (ou use) um usuário do sistema <b>Admin</b>.
                  </li>
                  <li>Em “Atribuir ativos”, dê a ele as contas de anúncio das casas, as Páginas e os Instagrams (controle total).</li>
                  <li>“Gerar novo token” → escolha o app, validade <b>Nunca</b>, marque <b>ads_read</b>, <b>ads_management</b>, <b>pages_show_list</b>, <b>pages_read_engagement</b>, <b>instagram_basic</b>, <b>business_management</b>.</li>
                  <li>Cole o token abaixo. A mesma chave serve pras 3 casas (nas outras é só “usar a chave já colada”).</li>
                </ol>
                <ConectarAnuncios filialId={filial.id} temOutraCasa={temOutraCasa} />
              </>
            ) : (
              <p className="text-sm text-slate-500">Esta casa ainda não tem conta de anúncios conectada. Quem tem a permissão de configurar o atendimento conecta aqui.</p>
            )}
          </div>
        </section>
      </main>
    );
  }

  const token = lig.accessToken;
  const [rConta, rNum, rNumAnt, rDia, rCamp, rVendas, rPosts, rIgs] = await Promise.allSettled([
    resumoConta(token, lig.contaId),
    numerosPeriodo(token, lig.contaId, de, ate),
    numerosPeriodo(token, lig.contaId, deAnt, ateAnt),
    numerosPorDia(token, lig.contaId, deAnt, ate),
    lerCampanhas(token, lig.contaId, de, ate),
    vendasPorDia(filial.id, deAnt, ate),
    podeMexer
      ? chaveValida(filial.id, 'instagram').then((l) => (l ? postsInstagram(l.accessToken, 18) : []))
      : Promise.resolve([]),
    podeMexer ? contasInstagramDaConta(token, lig.contaId) : Promise.resolve([]),
  ]);

  const conta = rConta.status === 'fulfilled' ? rConta.value : null;
  const n: Numeros | null = rNum.status === 'fulfilled' ? rNum.value : null;
  const nAnt: Numeros | null = rNumAnt.status === 'fulfilled' ? rNumAnt.value : null;
  const camps: Campanha[] = rCamp.status === 'fulfilled' ? rCamp.value : [];
  const vendas = rVendas.status === 'fulfilled' ? rVendas.value : new Map<string, number>();
  const gastoDia = new Map<string, number>();
  if (rDia.status === 'fulfilled') for (const d of rDia.value) gastoDia.set(d.dia, d.gasto);
  const erroMeta = erroTexto(rConta) ?? erroTexto(rNum) ?? erroTexto(rCamp);

  const dias = diasEntre(de, ate);
  const diasAnt = diasEntre(deAnt, ateAnt);
  const soma = (ds: string[], m: Map<string, number>) => ds.reduce((s, d) => s + (m.get(d) ?? 0), 0);
  const vendaPeriodo = soma(dias, vendas);
  const vendaAnt = soma(diasAnt, vendas);
  const gastoPeriodo = n?.gasto ?? soma(dias, gastoDia);
  const gastoAnt = nAnt?.gasto ?? soma(diasAnt, gastoDia);

  // dia com anúncio × sem anúncio (só dias que já passaram e tiveram venda)
  const passados = dias.filter((d) => d < ate && (vendas.get(d) ?? 0) > 0);
  const comAnuncio = passados.filter((d) => (gastoDia.get(d) ?? 0) > 0);
  const semAnuncio = passados.filter((d) => (gastoDia.get(d) ?? 0) === 0);
  const media = (ds: string[]) => (ds.length ? soma(ds, vendas) / ds.length : 0);
  const mediaCom = media(comAnuncio);
  const mediaSem = media(semAnuncio);

  // resultados somados por tipo (cada campanha compra uma coisa)
  const resultados = new Map<string, { valor: number; gasto: number }>();
  for (const c of camps) {
    if (c.numeros.gasto <= 0) continue;
    const r = resultado(c.objetivo, c.numeros);
    const atual = resultados.get(r.nome) ?? { valor: 0, gasto: 0 };
    atual.valor += r.valor;
    atual.gasto += c.numeros.gasto;
    resultados.set(r.nome, atual);
  }

  const posts: PostParaImpulsionar[] =
    rPosts.status === 'fulfilled'
      ? rPosts.value.map((p) => ({ id: p.id, imagem: p.imagem, legenda: p.legenda, quando: p.quando, link: p.link }))
      : [];
  const igs: InstagramDaConta[] = rIgs.status === 'fulfilled' ? rIgs.value.map((i) => ({ igId: i.igId, usuario: i.usuario })) : [];
  const actNum = lig.contaId.replace('act_', '');
  const ativas = camps.filter((c) => c.statusEfetivo === 'ACTIVE');

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        {cabecalho}

        {erroMeta && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">A Meta não respondeu tudo: {erroMeta}</p>}

        {/* conta + saldo */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-900">{conta?.nome || lig.contaNome}</h2>
              <p className="text-xs text-slate-500">
                Conta {actNum} · {conta ? (STATUS_CONTA[conta.status] ?? `situação ${conta.status}`) : '—'}
                {conta?.prePaga ? ' · pré-paga' : conta ? ' · pós-paga (cartão/boleto)' : ''}
                {lig.usuario ? ` · chave de ${lig.usuario}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://business.facebook.com/billing_hub/payment_settings/?asset_id=${actNum}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white"
              >
                Pagamentos / adicionar saldo
              </a>
              <a
                href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${actNum}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                Abrir no Gerenciador
              </a>
              {podeMexer && <ConectarAnuncios filialId={filial.id} temOutraCasa={false} trocar />}
              {podeMexer && <DesconectarAnuncios filialId={filial.id} />}
            </div>
          </div>
          {conta && conta.status !== 1 && (
            <p className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-800">
              A conta está “{STATUS_CONTA[conta.status] ?? conta.status}”: os anúncios não rodam até resolver no Gerenciador.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {conta?.prePaga ? (
              <Kpi rotulo="Saldo disponível" valor={conta.saldoDisponivel !== null ? brl(conta.saldoDisponivel) : '—'} sub={conta.formaPagamento ?? 'a Meta não informou'} />
            ) : (
              <Kpi rotulo="A cobrar (próxima fatura)" valor={conta ? brl(conta.aPagarCent / 100) : '—'} sub={conta?.formaPagamento ?? undefined} />
            )}
            <Kpi rotulo="Gasto na vida da conta" valor={conta ? brl(conta.gastoTotalCent / 100) : '—'} />
            <Kpi
              rotulo="Limite de gasto"
              valor={conta?.limiteCent ? brl(conta.limiteCent / 100) : 'sem limite'}
              sub={conta?.limiteCent ? `resta ${brl(Math.max(0, conta.limiteCent - conta.gastoTotalCent) / 100)}` : undefined}
            />
            <Kpi
              rotulo="Campanhas rodando"
              valor={String(ativas.length)}
              sub={ativas.length ? `${brl(ativas.reduce((s, c) => s + (c.orcamentoDia ?? 0), 0))}/dia de orçamento` : undefined}
            />
          </div>
        </div>

        {/* período */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">Período:</span>
          {PERIODOS.map((p) => (
            <a
              key={p}
              href={`/marketing/anuncios?filialId=${filial.id}&p=${p}`}
              className={`rounded-md px-3 py-1 text-sm ${p === periodo ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}
            >
              {p} dias
            </a>
          ))}
          <span className="text-xs text-slate-500">
            {diaCurto(de)} a {diaCurto(ate)} · comparando com {diaCurto(deAnt)} a {diaCurto(ateAnt)}
          </span>
        </div>

        {/* números do período */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-semibold text-slate-900">O que o anúncio entregou</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi rotulo="Gasto" valor={brl(gastoPeriodo)} sub={nAnt ? `antes ${brl(gastoAnt)}` : undefined} />
            <Kpi rotulo="Pessoas alcançadas" valor={num(n?.alcance)} sub={n?.alcance ? `${brl((n.gasto / n.alcance) * 1000)} por mil` : undefined} />
            <Kpi rotulo="Impressões" valor={num(n?.impressoes)} sub={n?.alcance ? `${(n.impressoes / n.alcance).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× por pessoa` : undefined} />
            <Kpi rotulo="Cliques" valor={num(n?.cliques)} sub={n?.impressoes ? `CTR ${pct((n.cliques / n.impressoes) * 100, 2)}` : undefined} />
            <Kpi rotulo="Cliques no link" valor={num(n?.cliquesLink)} sub={n?.cliquesLink ? `${brl(n.gasto / n.cliquesLink)} cada` : undefined} />
            <Kpi rotulo="Custo por clique" valor={n?.cliques ? brl(n.gasto / n.cliques) : '—'} />
          </div>
          {resultados.size > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {[...resultados].map(([nome, r]) => (
                <div key={nome} className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-blue-700">Resultado · {nome}</p>
                  <p className="text-lg font-semibold text-slate-900">{num(r.valor)}</p>
                  <p className="text-[11px] text-slate-600">
                    {r.valor > 0 ? `${brl(r.gasto / r.valor)} cada` : 'sem resultado'} · gasto {brl(r.gasto)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* gráfico */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">Anúncio × venda por dia</h2>
            <p className="flex gap-3 text-xs text-slate-600">
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-blue-300" />Gasto em anúncio (esq.)</span>
              <span><span className="mr-1 inline-block h-0.5 w-3 bg-emerald-600 align-middle" />Venda fechada no PDV (dir.)</span>
            </p>
          </div>
          <Grafico dias={dias} gasto={gastoDia} venda={vendas} />
        </div>

        {/* aumento de venda */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-semibold text-slate-900">Aumento de venda</h2>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Kpi rotulo={`Venda nos ${periodo} dias`} valor={brl(vendaPeriodo)} sub={`antes ${brl(vendaAnt)}`} />
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Venda × período anterior</p>
              <p className="text-lg font-semibold">
                <Variacao atual={vendaPeriodo} antes={vendaAnt} />
              </p>
              <p className="text-[11px] text-slate-500">
                anúncio <Variacao atual={gastoPeriodo} antes={gastoAnt} />
              </p>
            </div>
            <Kpi
              rotulo="Média/dia com anúncio"
              valor={comAnuncio.length ? brl(mediaCom) : '—'}
              sub={`${comAnuncio.length} dias · sem anúncio ${semAnuncio.length ? brl(mediaSem) : '—'} (${semAnuncio.length} dias)`}
            />
            <Kpi rotulo="Anúncio sobre a venda" valor={vendaPeriodo ? pct((gastoPeriodo / vendaPeriodo) * 100, 2) : '—'} sub="quanto da venda foi pro anúncio" />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Comparação simples: venda depende de feriado, tempo, temporada e evento. Use como sinal, não como prova de que o anúncio trouxe a venda.
            {comAnuncio.length && semAnuncio.length
              ? ` Dias com anúncio venderam em média ${pct(((mediaCom - mediaSem) / (mediaSem || 1)) * 100)} ${mediaCom >= mediaSem ? 'a mais' : 'a menos'} que os sem.`
              : ''}
          </p>
        </div>

        {/* campanhas */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-semibold text-slate-900">Campanhas</h2>
          {camps.length === 0 ? (
            <p className="text-sm text-slate-500">{rCamp.status === 'rejected' ? 'Não deu pra ler as campanhas.' : 'Nenhuma campanha nesta conta.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-1 pr-2">Campanha</th>
                    <th className="py-1 pr-2">Situação</th>
                    <th className="py-1 pr-2 text-right">Orçamento</th>
                    <th className="py-1 pr-2 text-right">Gasto</th>
                    <th className="py-1 pr-2 text-right">Alcance</th>
                    <th className="py-1 pr-2">Resultado</th>
                    <th className="py-1 pr-2 text-right">Custo/resultado</th>
                    {podeMexer && <th className="py-1" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {camps.map((c) => {
                    const r = resultado(c.objetivo, c.numeros);
                    const st = STATUS_CAMP[c.statusEfetivo] ?? { t: c.statusEfetivo, c: 'bg-slate-100 text-slate-600' };
                    const mexivel = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED'].includes(c.statusEfetivo) || c.status === 'ACTIVE' || c.status === 'PAUSED';
                    return (
                      <tr key={c.id} className={c.numeros.gasto <= 0 && c.statusEfetivo !== 'ACTIVE' ? 'text-slate-400' : ''}>
                        <td className="py-1.5 pr-2">
                          <p className="font-medium">{c.nome}</p>
                          <p className="text-[11px] text-slate-500">
                            {NOME_OBJETIVO[c.objetivo] ?? c.objetivo}
                            {c.inicio ? ` · desde ${dataBr(c.inicio)}` : ''}
                            {c.fim ? ` · até ${dataBr(c.fim)}` : ''}
                          </p>
                        </td>
                        <td className="py-1.5 pr-2">
                          <span className={`rounded px-1.5 py-0.5 text-[11px] ${st.c}`}>{st.t}</span>
                        </td>
                        <td className="py-1.5 pr-2 text-right text-xs">
                          {c.orcamentoDia ? `${brl(c.orcamentoDia)}/dia` : c.orcamentoTotal ? `${brl(c.orcamentoTotal)} total` : '—'}
                        </td>
                        <td className="py-1.5 pr-2 text-right">{brl(c.numeros.gasto)}</td>
                        <td className="py-1.5 pr-2 text-right">{num(c.numeros.alcance)}</td>
                        <td className="py-1.5 pr-2">
                          {num(r.valor)} <span className="text-[11px] text-slate-500">{r.nome.toLowerCase()}</span>
                        </td>
                        <td className="py-1.5 pr-2 text-right">{r.valor > 0 ? brl(c.numeros.gasto / r.valor) : '—'}</td>
                        {podeMexer && (
                          <td className="py-1.5 text-right">
                            {mexivel && c.status !== 'ARCHIVED' && (
                              <StatusCampanha filialId={filial.id} campanhaId={c.id} ativa={c.status === 'ACTIVE'} nome={c.nome} />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* impulsionar */}
        {podeMexer && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-1 font-semibold text-slate-900">Impulsionar um post do Instagram</h2>
            <p className="mb-3 text-xs text-slate-500">
              Cria a campanha direto na conta de anúncios da {filial.nome}, com o público em volta da casa
              {CENTRO_CASA[filial.id] ? '' : ' (casa sem localização: não dá pra impulsionar)'}. Aparece na tabela acima como “Concilia · …”.
            </p>
            {!lig.igId && igs.length === 0 ? (
              <p className="text-sm text-amber-800">
                A conta de anúncios não enxerga nenhum Instagram. No Gerenciador de Negócios, atribua o Instagram da casa ao usuário do sistema e à conta de anúncios.
              </p>
            ) : (
              <Impulsionar filialId={filial.id} casa={filial.nome} posts={posts} instagrams={igs} igPadrao={lig.igId} />
            )}
          </div>
        )}
      </section>
    </main>
  );
}

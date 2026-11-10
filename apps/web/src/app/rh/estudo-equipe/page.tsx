// Estudo de equipe (pedido do dono 10/11/2026): venda × produção × horas do
// ponto, hora a hora, por casa e por mês — base pro gerente decidir se reduz,
// mantém, muda escala ou regime (diarista, intermitente, 12x36). A conta está
// em lib/rh/estudo-equipe.ts; a análise da IA e a decisão do mês ficam em
// rh_estudo_equipe. Só leitura: não mexe em escala nem cadastro.

import { redirect } from 'next/navigation';
import { desc, eq, and, lt } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import {
  montarEstudoEquipe,
  mesesDisponiveis,
  DOW,
  NOME_GRUPO,
  GRUPOS,
  horaDoSlot,
  CUSTO_HORA_ESTIMADO,
  type PessoaEstudo,
  type ResumoMes,
} from '@/lib/rh/estudo-equipe';
import { PainelIa } from './painel-ia';
import { SecaoEscala } from './secao-escala';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  mes?: string;
  meta?: string;
  metaCoz?: string;
  min?: string;
}

const n0 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const n1 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const num = (s?: string) => {
  const v = Number(String(s ?? '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
};

const REGIME: Record<PessoaEstudo['regime'], string> = {
  clt: 'CLT',
  intermitente: 'Intermitente',
  diarista: 'Diarista',
  sem_regime: 'Sem regime',
};

const COR_SINAL: Record<string, string> = {
  virar_clt: 'bg-amber-100 text-amber-800',
  hora_extra: 'bg-red-100 text-red-700',
  acima_10h: 'bg-red-100 text-red-700',
  sobra_escala: 'bg-orange-100 text-orange-800',
  fim_de_semana: 'bg-sky-100 text-sky-800',
  diarista_2dias: 'bg-sky-100 text-sky-800',
  doze_36: 'bg-violet-100 text-violet-800',
  sem_valor: 'bg-slate-100 text-slate-600',
};

function Variacao({ atual, antes, inverter }: { atual: number; antes: number | undefined; inverter?: boolean }) {
  if (antes === undefined || !antes) return null;
  const d = (atual - antes) / antes;
  if (Math.abs(d) < 0.01) return <span className="text-xs text-slate-400"> = </span>;
  const bom = inverter ? d < 0 : d > 0;
  return (
    <span className={`ml-1 text-xs ${bom ? 'text-emerald-600' : 'text-red-600'}`}>
      {d > 0 ? '▲' : '▼'} {pct(Math.abs(d))}
    </span>
  );
}

export default async function EstudoEquipePage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'folha_equipe.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const sel = await escolherFilial(filiais, sp.filialId);
  if (!sel) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = sel;
  const hoje = hojeBr();
  const meses = mesesDisponiveis(filial.id, hoje);
  const mes = sp.mes && meses.includes(sp.mes) ? sp.mes : meses[0];
  const meta = num(sp.meta);
  const metaCoz = num(sp.metaCoz);
  const min = num(sp.min);

  const link = (extra: Partial<SP>) => {
    const q = new URLSearchParams();
    q.set('filialId', extra.filialId ?? filial.id);
    const m = 'mes' in extra ? extra.mes : mes;
    if (m) q.set('mes', m);
    if (!('filialId' in extra)) {
      if (meta) q.set('meta', String(meta));
      if (metaCoz) q.set('metaCoz', String(metaCoz));
      if (min) q.set('min', String(min));
    }
    return `?${q.toString()}`;
  };

  const cabecalho = (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">Estudo de equipe — escala × venda × produção</h1>
        <p className="mt-1 text-sm text-slate-600">
          {filial.nome} · horas pelo ponto, venda pelos pedidos, pratos pelo KDS · dia operacional começa às 05:00
        </p>
      </div>
      {filiais.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {filiais.map((f) => (
            <a
              key={f.id}
              href={link({ filialId: f.id, mes: undefined })}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                f.id === filial.id ? 'border-blue-500 bg-blue-50 font-medium text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f.nome}
            </a>
          ))}
        </div>
      )}
      <div className="mb-6 flex flex-wrap gap-2">
        {meses.map((m) => (
          <a
            key={m}
            href={link({ mes: m })}
            className={`rounded-md border px-3 py-1 text-sm ${
              m === mes ? 'border-blue-500 bg-blue-50 font-medium text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {nomeMes(m)}
          </a>
        ))}
      </div>
    </>
  );

  const e = mes ? await montarEstudoEquipe(filial.id, mes, hoje, { metaAtend: meta, metaCoz, minAtend: min }) : null;
  if (!e || !mes) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-[1600px] px-4 py-8">
          {cabecalho}
          <p className="text-sm text-slate-500">Sem dados de ponto próprio para esta casa neste mês.</p>
        </section>
      </main>
    );
  }

  const T = schema.rhEstudoEquipe;
  const [atual] = await db
    .select()
    .from(T)
    .where(and(eq(T.filialId, filial.id), eq(T.competencia, mes)))
    .limit(1);
  const historico = await db
    .select({ competencia: T.competencia, decisao: T.decisao, decisaoEm: T.decisaoEm, decisaoPor: T.decisaoPor, analiseEm: T.analiseEm })
    .from(T)
    .where(and(eq(T.filialId, filial.id), lt(T.competencia, mes)))
    .orderBy(desc(T.competencia))
    .limit(12);

  const r = e.resumo;
  const ant: ResumoMes | undefined = e.anteriores[0];
  const cartoes: { t: string; v: string; sub?: string; atual: number; antes?: number; inverter?: boolean }[] = [
    { t: 'Venda', v: brl(r.venda), sub: `${r.dias} dias${r.parcial ? ' (parcial)' : ''} · ${n0(r.pedidos)} pedidos`, atual: r.venda, antes: ant?.venda },
    { t: 'Horas de atendimento', v: `${n0(r.hAtend)} h`, sub: 'salão + bar + caixa', atual: r.hAtend, antes: ant?.hAtend, inverter: true },
    { t: 'Venda por hora de atendimento', v: brl(r.vendaPorHAtend), sub: `meta usada: ${brl(e.metas.atend)}`, atual: r.vendaPorHAtend, antes: ant?.vendaPorHAtend },
    { t: 'Sobra × falta (atendimento)', v: `+${n0(r.sobraAtend)} h / −${n0(r.faltaAtend)} h`, sub: `necessário ${n0(r.hNecAtend)} h`, atual: r.sobraAtend, antes: ant?.sobraAtend, inverter: true },
    { t: 'Cozinha', v: `${n0(r.h.cozinha)} h`, sub: `${n0(r.hCozServico)} h serviço · ${n0(r.hCozProducao)} h produção · ${n1(r.itensPorHCoz)} pratos/h`, atual: r.h.cozinha, antes: ant?.h.cozinha, inverter: true },
    { t: 'Custo da equipe', v: brl(r.custo), sub: `${pct(r.custoPctVenda)} da venda · ${r.pessoas} pessoas`, atual: r.custoPctVenda, antes: ant?.custoPctVenda, inverter: true },
  ];

  const temCustoEstimado = e.pessoas.some((p) => p.custoEstimado);
  const ordemGrupo = (g: string) => GRUPOS.indexOf(g as (typeof GRUPOS)[number]);
  const pessoas = [...e.pessoas].sort((a, b) => ordemGrupo(a.grupo) - ordemGrupo(b.grupo) || b.hCasa - a.hCasa);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-[1600px] px-4 py-8">
        {cabecalho}

        {/* Resumo */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {cartoes.map((c) => (
            <div key={c.t} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs uppercase text-slate-500">{c.t}</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {c.v}
                <Variacao atual={c.atual} antes={c.antes} inverter={c.inverter} />
              </div>
              {c.sub && <div className="mt-0.5 text-xs text-slate-500">{c.sub}</div>}
            </div>
          ))}
        </div>

        {/* Meses anteriores */}
        {e.anteriores.length > 0 && (
          <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Mês</th>
                  <th className="px-3 py-2 text-right">Dias</th>
                  <th className="px-3 py-2 text-right">Venda</th>
                  <th className="px-3 py-2 text-right">H atend.</th>
                  <th className="px-3 py-2 text-right">R$/h atend.</th>
                  <th className="px-3 py-2 text-right">Sobra / falta</th>
                  <th className="px-3 py-2 text-right">H cozinha</th>
                  <th className="px-3 py-2 text-right">Pratos/h</th>
                  <th className="px-3 py-2 text-right">Custo</th>
                  <th className="px-3 py-2 text-right">% venda</th>
                  <th className="px-3 py-2 text-right">Pessoas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[r, ...e.anteriores].map((m, i) => (
                  <tr key={m.mes} className={i === 0 ? 'bg-blue-50/40 font-medium' : ''}>
                    <td className="px-3 py-1.5">{nomeMes(m.mes)}{m.parcial ? ' *' : ''}</td>
                    <td className="px-3 py-1.5 text-right">{m.dias}</td>
                    <td className="px-3 py-1.5 text-right">{brl(m.venda)}</td>
                    <td className="px-3 py-1.5 text-right">{n0(m.hAtend)}</td>
                    <td className="px-3 py-1.5 text-right">{brl(m.vendaPorHAtend)}</td>
                    <td className="px-3 py-1.5 text-right">+{n0(m.sobraAtend)} / −{n0(m.faltaAtend)}</td>
                    <td className="px-3 py-1.5 text-right">{n0(m.h.cozinha)}</td>
                    <td className="px-3 py-1.5 text-right">{n1(m.itensPorHCoz)}</td>
                    <td className="px-3 py-1.5 text-right">{brl(m.custo)}</td>
                    <td className="px-3 py-1.5 text-right">{pct(m.custoPctVenda)}</td>
                    <td className="px-3 py-1.5 text-right">{m.pessoas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-1.5 text-xs text-slate-400">* mês parcial (só os dias com ponto próprio ou até ontem)</p>
          </div>
        )}

        {/* Achados */}
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
            <h2 className="mb-2 text-base font-semibold text-slate-800">O que os números dizem</h2>
            {e.achados.length ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                {e.achados.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">Nada fora do padrão.</p>
            )}
            {e.avisos.length > 0 && (
              <div className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
                {e.avisos.map((a, i) => (
                  <p key={i}>⚠ {a}</p>
                ))}
              </div>
            )}
          </div>
          {/* Simulação */}
          <form method="get" className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <h2 className="mb-1 text-base font-semibold text-slate-800">Régua do cálculo</h2>
            <p className="mb-3 text-xs text-slate-500">
              {e.metas.padrao ? 'Usando o padrão (P75 da própria casa).' : 'Usando a régua digitada.'} Mude e recalcule para simular.
            </p>
            <input type="hidden" name="filialId" value={filial.id} />
            <input type="hidden" name="mes" value={mes} />
            <label className="mb-2 block">
              <span className="text-xs text-slate-600">
                Venda por pessoa/hora no atendimento (R$) — P50 {n0(e.metas.atendP50)} · P75 {n0(e.metas.atendP75)} · P90 {n0(e.metas.atendP90)}
              </span>
              <input name="meta" defaultValue={meta ?? ''} placeholder={n0(e.metas.atend)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
            </label>
            <label className="mb-2 block">
              <span className="text-xs text-slate-600">
                Pratos por cozinheiro/hora — P50 {n1(e.metas.cozP50)} · P75 {n1(e.metas.cozP75)} · P90 {n1(e.metas.cozP90)}
              </span>
              <input name="metaCoz" defaultValue={metaCoz ?? ''} placeholder={n1(e.metas.coz)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
            </label>
            <label className="mb-3 block">
              <span className="text-xs text-slate-600">Mínimo de pessoas no atendimento com a casa aberta</span>
              <input name="min" defaultValue={min ?? ''} placeholder={n0(e.metas.minAtend)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
            </label>
            <div className="flex gap-2">
              <button className="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700">Recalcular</button>
              <a href={`?filialId=${filial.id}&mes=${mes}`} className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-600">
                Padrão
              </a>
            </div>
          </form>
        </div>

        {/* Dia da semana */}
        <h2 className="mb-2 text-base font-semibold text-slate-800">Por dia da semana (média do dia típico)</h2>
        <div className="mb-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Dia</th>
                <th className="px-3 py-2 text-right">Dias</th>
                <th className="px-3 py-2 text-right">Venda média</th>
                <th className="px-3 py-2 text-right">H atend. real</th>
                <th className="px-3 py-2 text-right">H necessário</th>
                <th className="px-3 py-2 text-right">Diferença</th>
                <th className="px-3 py-2 text-right">Pico (pessoas)</th>
                <th className="px-3 py-2 text-right">Pratos</th>
                <th className="px-3 py-2 text-right">Cozinha serviço</th>
                <th className="px-3 py-2 text-right">Cozinha produção</th>
                <th className="px-3 py-2 text-right">Limpeza</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {e.dows.map((d) => {
                const dif = d.hAtend - d.hNecAtend;
                return (
                  <tr key={d.dow}>
                    <td className="px-3 py-1.5 font-medium">{DOW[d.dow]}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">
                      {d.dias}
                      {d.diasTodos > d.dias ? ` de ${d.diasTodos}` : ''}
                    </td>
                    <td className="px-3 py-1.5 text-right">{brl(d.venda)}</td>
                    <td className="px-3 py-1.5 text-right">{n1(d.hAtend)}</td>
                    <td className="px-3 py-1.5 text-right">{n1(d.hNecAtend)}</td>
                    <td className={`px-3 py-1.5 text-right font-medium ${dif > 4 ? 'text-amber-700' : dif < -2 ? 'text-red-600' : 'text-slate-600'}`}>
                      {dif > 0 ? '+' : ''}
                      {n1(dif)} h
                    </td>
                    <td className="px-3 py-1.5 text-right">{n1(d.picoAtend)}</td>
                    <td className="px-3 py-1.5 text-right">{n0(d.itensCoz)}</td>
                    <td className="px-3 py-1.5 text-right">{n1(d.hCozServico)}</td>
                    <td className="px-3 py-1.5 text-right">{n1(d.hCozProducao)}</td>
                    <td className="px-3 py-1.5 text-right">{n1(d.hLimpeza)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Necessário = venda da hora ÷ régua, nunca abaixo do mínimo com a casa aberta. Feriado e dia de venda fora da curva (evento) não entram na média.
          Cozinha fora do horário de venda conta como produção, não como sobra.
        </p>

        {/* Escala sugerida (botão da IA) */}
        <SecaoEscala
          e={e}
          filialId={filial.id}
          mes={mes}
          meta={meta}
          metaCoz={metaCoz}
          min={min}
          escala={atual?.escalaSugerida ?? null}
          escalaEm={atual?.escalaEm ? atual.escalaEm.toISOString() : null}
          escalaPor={atual?.escalaPor ?? null}
        />

        {/* Hora a hora */}
        <div className="mb-8 space-y-2">
          {e.dows.map((d) => (
            <details key={d.dow} className="rounded-lg border border-slate-200 bg-white">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">Hora a hora — {DOW[d.dow]}</summary>
              <div className="overflow-x-auto px-3 pb-3">
                <table className="min-w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1 pr-2 text-left">Hora</th>
                      <th className="px-2 py-1 text-right">Venda</th>
                      <th className="px-2 py-1 text-right">Atend. real</th>
                      <th className="px-2 py-1 text-right">Atend. nec.</th>
                      <th className="px-2 py-1 text-right">Pratos</th>
                      <th className="px-2 py-1 text-right">Cozinha</th>
                      <th className="px-2 py-1 text-right">Coz. nec.</th>
                      <th className="px-2 py-1 text-right">Limpeza</th>
                      <th className="px-2 py-1 text-right">Outros</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.slots
                      .filter((s) => s.venda > 0 || s.atend + s.cozinha + s.limpeza + s.outros > 0.05)
                      .map((s) => {
                        const cor =
                          s.servico && s.atend < s.necAtend - 0.5
                            ? 'bg-red-50 text-red-700'
                            : s.atend > s.necAtend + 1
                              ? 'bg-amber-50 text-amber-800'
                              : '';
                        const corCoz = s.servico && s.cozinha < s.necCoz - 0.5 ? 'text-red-700' : '';
                        return (
                          <tr key={s.slot} className="border-t border-slate-100">
                            <td className="py-1 pr-2">{String(horaDoSlot(s.slot)).padStart(2, '0')}h</td>
                            <td className="px-2 py-1 text-right">{s.venda ? brl(s.venda) : '—'}</td>
                            <td className={`px-2 py-1 text-right ${cor}`}>{n1(s.atend)}</td>
                            <td className="px-2 py-1 text-right text-slate-500">{n1(s.necAtend)}</td>
                            <td className="px-2 py-1 text-right">{s.itensCoz ? n1(s.itensCoz) : '—'}</td>
                            <td className={`px-2 py-1 text-right ${corCoz}`}>
                              {n1(s.cozinha)}
                              {!s.servico && s.cozinha > 0.05 ? <span className="ml-1 text-slate-400">produção</span> : null}
                            </td>
                            <td className="px-2 py-1 text-right text-slate-500">{s.servico ? n1(s.necCoz) : '—'}</td>
                            <td className="px-2 py-1 text-right">{n1(s.limpeza)}</td>
                            <td className="px-2 py-1 text-right">{n1(s.outros)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                <p className="mt-1 text-[11px] text-slate-400">
                  Pessoas em média naquela hora. Vermelho = menos gente que o necessário; âmbar = mais de 1 pessoa acima.
                </p>
              </div>
            </details>
          ))}
        </div>

        {/* Dias */}
        <details className="mb-8 rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">Dia a dia ({e.dias.length} dias)</summary>
          <div className="overflow-x-auto px-3 pb-3">
            <table className="min-w-full text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-2 text-left">Dia</th>
                  <th className="px-2 py-1 text-right">Venda</th>
                  <th className="px-2 py-1 text-right">Pedidos</th>
                  <th className="px-2 py-1 text-right">Pratos</th>
                  {GRUPOS.map((g) => (
                    <th key={g} className="px-2 py-1 text-right">
                      H {NOME_GRUPO[g]}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right">Nec. atend.</th>
                  <th className="px-2 py-1 text-right">Sobra</th>
                  <th className="px-2 py-1 text-right">Falta</th>
                  <th className="px-2 py-1 text-right">Pessoas</th>
                </tr>
              </thead>
              <tbody>
                {e.dias.map((d) => (
                  <tr key={d.dia} className={`border-t border-slate-100 ${d.feriado || d.atipico ? 'bg-slate-50 text-slate-500' : ''}`}>
                    <td className="py-1 pr-2">
                      {DOW[d.dow]} {ddmm(d.dia)}
                      {d.feriado ? <span className="ml-1 text-violet-600">{d.feriado}</span> : d.atipico ? <span className="ml-1 text-violet-600">fora da curva</span> : null}
                    </td>
                    <td className="px-2 py-1 text-right">{brl(d.venda)}</td>
                    <td className="px-2 py-1 text-right">{d.pedidos}</td>
                    <td className="px-2 py-1 text-right">{n0(d.itensCoz)}</td>
                    {GRUPOS.map((g) => (
                      <td key={g} className="px-2 py-1 text-right">
                        {d.h[g] ? n1(d.h[g]) : '—'}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right">{n1(d.hNecAtend)}</td>
                    <td className="px-2 py-1 text-right text-amber-700">{d.sobraAtend ? n1(d.sobraAtend) : ''}</td>
                    <td className="px-2 py-1 text-right text-red-600">{d.faltaAtend ? n1(d.faltaAtend) : ''}</td>
                    <td className="px-2 py-1 text-right">{d.pessoas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {/* Pessoas */}
        <h2 className="mb-2 text-base font-semibold text-slate-800">Pessoas e regime</h2>
        <div className="mb-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Pessoa</th>
                <th className="px-3 py-2 text-left">Setor</th>
                <th className="px-3 py-2 text-left">Regime</th>
                <th className="px-3 py-2 text-right">H aqui</th>
                <th className="px-3 py-2 text-right">Dias</th>
                <th className="px-3 py-2 text-right">Dias/sem</th>
                <th className="px-3 py-2 text-right">H/dia</th>
                <th className="px-3 py-2 text-right">Fim de semana</th>
                <th className="px-3 py-2 text-right">≥10h</th>
                <th className="px-3 py-2 text-right">H/mês (todas)</th>
                <th className="px-3 py-2 text-right">Custo aqui</th>
                <th className="px-3 py-2 text-left">Sinais</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pessoas.map((p) => (
                <tr key={p.id} className="align-top">
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-slate-800">{p.nome}</div>
                    {p.cargo && <div className="text-xs text-slate-500">{p.cargo}</div>}
                    {!p.daCasa && <div className="text-xs text-violet-600">de outra casa</div>}
                  </td>
                  <td className="px-3 py-1.5">{NOME_GRUPO[p.grupo]}</td>
                  <td className="px-3 py-1.5">
                    {REGIME[p.regime]}
                    {p.valor ? (
                      <div className="text-xs text-slate-500">{p.regime === 'clt' ? brl(p.valor) : `${brl(p.valor)}/h`}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 text-right">{n0(p.hCasa)}</td>
                  <td className="px-3 py-1.5 text-right">{p.dias}</td>
                  <td className="px-3 py-1.5 text-right">{n1(p.diasSemana)}</td>
                  <td className="px-3 py-1.5 text-right">{n1(p.hDia)}</td>
                  <td className="px-3 py-1.5 text-right">{pct(p.pctFds)}</td>
                  <td className="px-3 py-1.5 text-right">{p.diasLongos || ''}</td>
                  <td className="px-3 py-1.5 text-right">{n0(p.horasMes30)}</td>
                  <td className="px-3 py-1.5 text-right">
                    {brl(p.custo)}
                    {p.custoEstimado ? <span className="text-slate-400"> *</span> : null}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex max-w-md flex-col gap-1">
                      {p.sinais.map((s, i) => (
                        <span key={i} className={`rounded px-2 py-0.5 text-xs ${COR_SINAL[s.tipo] ?? 'bg-slate-100 text-slate-600'}`}>
                          {s.texto}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mb-8 text-xs text-slate-500">
          Regime e valor vêm do nosso cadastro. {temCustoEstimado ? `* sem valor no cadastro: custo estimado a ${brl(CUSTO_HORA_ESTIMADO)}/h. ` : ''}
          Sinais são perguntas para o gerente, não ordens: a decisão leva em conta o que a tela não vê (férias, treinamento, evento).
        </p>

        <PainelIa
          key={`${filial.id}-${mes}`}
          filialId={filial.id}
          mes={mes}
          meta={meta}
          metaCoz={metaCoz}
          min={min}
          analise={atual?.analise ?? null}
          analiseEm={atual?.analiseEm ? atual.analiseEm.toISOString() : null}
          decisao={atual?.decisao ?? null}
          decisaoEm={atual?.decisaoEm ? atual.decisaoEm.toISOString() : null}
          decisaoPor={atual?.decisaoPor ?? null}
        />

        {/* Histórico */}
        <h2 className="mb-2 text-base font-semibold text-slate-800">Decisões dos meses anteriores</h2>
        {historico.filter((h) => h.decisao).length ? (
          <div className="space-y-2">
            {historico
              .filter((h) => h.decisao)
              .map((h) => (
                <div key={h.competencia} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between">
                    <a href={link({ mes: h.competencia })} className="font-medium text-blue-700 hover:underline">
                      {nomeMes(h.competencia)}
                    </a>
                    <span className="text-xs text-slate-400">{h.decisaoPor ?? ''}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-slate-700">{h.decisao}</p>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Nenhuma decisão registrada antes deste mês.</p>
        )}
      </section>
    </main>
  );
}

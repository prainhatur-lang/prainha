// Horas por regime (pedido do dono 20/10/2026): semana a semana, quanto o CLT
// ficou abaixo da jornada × quantas horas foram pagas a intermitente, com a
// venda da casa. Conta em lib/rh/horas-regime.ts. Só leitura.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { montarHorasRegime, diasNaSemanaAtual, semanaDoPontoAgora, type PessoaHoras } from '@/lib/rh/horas-regime';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { TravarTodos, TravaPessoa } from './limite-semana';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  semanas?: string;
}

const h = (min: number) => (min ? (min / 60).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '—');
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

const REGIME_LABEL: Record<PessoaHoras['regime'], string> = {
  clt: 'CLT',
  intermitente: 'Intermitente',
  sem_registro: 'Sem folha',
};

export default async function HorasRegimePage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'folha_equipe.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada = await escolherFilial(filiais, sp.filialId);
  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = filialSelecionada;

  const n = Math.min(16, Math.max(2, Number(sp.semanas) || 8));
  const hoje = hojeBr();
  const dados = await montarHorasRegime(filial.id, hoje, n);
  const { semanas, pessoas, resumo } = dados;
  // Trava de dias/semana no ponto (dono 20/10/2026: sem registro só 2 vezes).
  const semRegistro = pessoas.filter((p) => p.regime === 'sem_registro');
  const [podeTravar, diasAgora] = await Promise.all([
    podeUsuario(user.id, 'ponto.corrigir'),
    diasNaSemanaAtual(semRegistro.map((p) => p.id)),
  ]);
  const diaPonto = semanaDoPontoAgora().hoje;
  const ncompletas = semanas.filter((s) => !s.parcial).length || 1;

  const media = (p: PessoaHoras, campo: 'minTotal' | 'minCasa' | 'dias') => {
    let s = 0;
    semanas.forEach((w, i) => {
      if (!w.parcial) s += p.semanas[i][campo];
    });
    return s / ncompletas;
  };

  const alerta = (p: PessoaHoras): string | null => {
    if (p.regime === 'intermitente' && media(p, 'minTotal') >= 40 * 60 && media(p, 'dias') >= 4.5)
      return 'trabalha como fixo';
    if (p.regime === 'clt' && p.daCasa) {
      let prev = 0;
      let trab = 0;
      semanas.forEach((w, i) => {
        if (!w.parcial) {
          prev += p.semanas[i].previstoMin;
          trab += p.semanas[i].minTotal;
        }
      });
      if (prev > 0 && trab < prev * 0.9) return 'abaixo da jornada';
      if (prev > 0 && trab > prev * 1.15) return 'acima da jornada';
    }
    if (p.regime === 'sem_registro' && p.semanas.some((x) => x.minCasa > 0))
      return 'bateu ponto sem folha';
    return null;
  };

  const link = (extra: Partial<SP>) => {
    const q = new URLSearchParams({ filialId: extra.filialId ?? filial.id, semanas: String(extra.semanas ?? n) });
    return `?${q.toString()}`;
  };

  const grupos: { regime: PessoaHoras['regime']; titulo: string; nota: string }[] = [
    { regime: 'clt', titulo: 'CLT', nota: 'horas em qualquer casa × jornada do cadastro (sem escala fixa = 44 h/semana)' },
    { regime: 'intermitente', titulo: 'Intermitente', nota: 'horas batidas nesta casa' },
    { regime: 'sem_registro', titulo: 'Sem folha do contador', nota: 'bateram ponto aqui e não estão no último contracheque importado' },
  ];

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-[1600px] px-4 py-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Horas por regime — CLT × intermitente</h1>
            <p className="mt-1 text-sm text-slate-600">
              {filial.nome} · semanas de segunda a domingo · regime pelo contracheque
              {dados.competenciaFolha ? ` (último importado: ${dados.competenciaFolha.slice(0, 7)})` : ''} · horas pelo
              ponto (Stelanto antes da virada)
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {[4, 8, 12].map((k) => (
              <a
                key={k}
                href={link({ semanas: String(k) })}
                className={`rounded-md border px-3 py-1.5 ${
                  k === n ? 'border-blue-500 bg-blue-50 font-medium text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {k} semanas
              </a>
            ))}
          </div>
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {filiais.map((f) => (
              <a
                key={f.id}
                href={link({ filialId: f.id })}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  f.id === filial.id
                    ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </a>
            ))}
          </div>
        )}

        <div className="mb-8 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Semana</th>
                <th className="px-3 py-2 text-right">Venda</th>
                <th className="px-3 py-2 text-right">Horas na casa</th>
                <th className="px-3 py-2 text-right">Venda / hora</th>
                <th className="px-3 py-2 text-right">CLT previsto</th>
                <th className="px-3 py-2 text-right">CLT trabalhou</th>
                <th className="px-3 py-2 text-right">CLT faltou</th>
                <th className="px-3 py-2 text-right">Intermitente (h)</th>
                <th className="px-3 py-2 text-right">Custo intermitente*</th>
                <th className="px-3 py-2 text-right">Interm. como fixo</th>
                <th className="px-3 py-2 text-right">Sem folha (h)</th>
              </tr>
            </thead>
            <tbody>
              {semanas.map((s, i) => {
                const r = resumo[i];
                return (
                  <tr key={s.inicio} className="border-t border-slate-100">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {ddmm(s.inicio)}–{ddmm(s.fim)}
                      {s.parcial && <span className="ml-1 text-xs text-amber-600">(parcial)</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{r.venda ? brl(r.venda) : '—'}</td>
                    <td className="px-3 py-2 text-right">{h(r.minTotalCasa)}</td>
                    <td className="px-3 py-2 text-right">{r.minTotalCasa ? brl(r.venda / (r.minTotalCasa / 60)) : '—'}</td>
                    <td className="px-3 py-2 text-right">{h(r.cltPrevistoMin)}</td>
                    <td className="px-3 py-2 text-right">{h(r.cltTrabMin)}</td>
                    <td className={`px-3 py-2 text-right ${r.cltFaltaMin > 0 ? 'font-medium text-rose-600' : ''}`}>{h(r.cltFaltaMin)}</td>
                    <td className="px-3 py-2 text-right">{h(r.intMin)}</td>
                    <td className="px-3 py-2 text-right">{r.intCusto ? brl(r.intCusto) : '—'}</td>
                    <td className={`px-3 py-2 text-right ${r.intComoFixo > 0 ? 'font-medium text-amber-700' : ''}`}>
                      {s.parcial ? '—' : r.intComoFixo || '—'}
                    </td>
                    <td className={`px-3 py-2 text-right ${r.semRegMin > 0 ? 'font-medium text-rose-600' : ''}`}>{h(r.semRegMin)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            * hora × valor do contracheque × 1,39 (DSR, férias + 1/3 e 13º pagos no mês) × FGTS 8%. &ldquo;Interm. como
            fixo&rdquo; = intermitente com 5+ dias e 40+ h na semana. Venda pelo dia operacional (virada às 05:00); conta
            ainda aberta só entra quando fecha.
          </p>
        </div>

        {grupos.map((g) => {
          const lista = pessoas.filter((p) => p.regime === g.regime);
          if (!lista.length) return null;
          return (
            <div key={g.regime} className="mb-8">
              <h2 className="mb-1 text-lg font-semibold text-slate-900">
                {g.titulo} <span className="text-sm font-normal text-slate-500">({lista.length})</span>
              </h2>
              <p className="mb-2 text-xs text-slate-500">{g.nota}</p>
              {g.regime === 'sem_registro' && (
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-100 bg-rose-50/50 px-3 py-2 text-xs text-slate-600">
                  <span>
                    Trava no ponto facial: com limite, o tablet recusa a entrada de um dia novo quando a pessoa já bateu
                    ponto nesse número de dias da semana (seg a dom, somando as casas). O gerente libera um dia por vez em
                    &ldquo;liberar hoje&rdquo;.
                  </span>
                  {podeTravar && (
                    <TravarTodos
                      ids={lista.map((p) => p.id)}
                      jaTravados={lista.filter((p) => p.limiteDiasSemana === 2).length}
                      dias={2}
                    />
                  )}
                </div>
              )}
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Pessoa</th>
                      {semanas.map((s) => (
                        <th key={s.inicio} className="px-2 py-2 text-right whitespace-nowrap">
                          {ddmm(s.inicio)}
                          {s.parcial ? '*' : ''}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right">Média h/sem</th>
                      <th className="px-3 py-2 text-right">Dias/sem</th>
                      <th className="px-3 py-2">Situação</th>
                      {g.regime === 'sem_registro' && <th className="px-3 py-2">Trava</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((p) => {
                      const a = alerta(p);
                      const campo = g.regime === 'clt' && p.daCasa ? 'minTotal' : 'minCasa';
                      return (
                        <tr key={p.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">{p.nome}</div>
                            <div className="text-xs text-slate-500">
                              {p.cargo ?? ''}
                              {!p.daCasa && ' · cadastro de outra casa'}
                              {p.semFolha && p.regimeCadastro && ` · cadastro: ${p.regimeCadastro}`}
                              {p.regime === 'intermitente' && p.valor ? ` · ${brl(p.valor)}/h` : ''}
                            </div>
                          </td>
                          {semanas.map((s, i) => {
                            const x = p.semanas[i];
                            const falta = g.regime === 'clt' && p.daCasa && !s.parcial && x.previstoMin > 0 && x.minTotal < x.previstoMin * 0.9;
                            const muito = g.regime !== 'clt' && x[campo] >= 44 * 60;
                            return (
                              <td
                                key={s.inicio}
                                className={`px-2 py-2 text-right ${falta ? 'text-rose-600' : muito ? 'text-amber-700' : 'text-slate-700'}`}
                                title={g.regime === 'clt' ? `previsto ${h(x.previstoMin)} h · ${x.dias} dias` : `${x.dias} dias`}
                              >
                                {h(x[campo])}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-right font-medium">{h(Math.round(media(p, campo)))}</td>
                          <td className="px-3 py-2 text-right">{media(p, 'dias').toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                          <td className="px-3 py-2 text-xs">
                            {a && (
                              <span
                                className={`rounded px-2 py-0.5 ${
                                  a === 'trabalha como fixo' || a === 'acima da jornada'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-rose-100 text-rose-700'
                                }`}
                              >
                                {a}
                              </span>
                            )}
                          </td>
                          {g.regime === 'sem_registro' && (
                            <td className="px-3 py-2">
                              <TravaPessoa
                                id={p.id}
                                limite={p.limiteDiasSemana}
                                liberadoHoje={p.limiteLiberadoDia === diaPonto}
                                diasSemanaAtual={diasAgora.get(p.id) ?? 0}
                                podeEditar={podeTravar}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        <p className="text-xs text-slate-500">
          Média e dias/semana contam só as semanas completas. CLT com escala combinada diferente da cadastrada (ex.: só
          sexta a domingo) aparece &ldquo;abaixo da jornada&rdquo; até a escala do cadastro ser corrigida em RH → Ponto.
        </p>
      </section>
    </main>
  );
}

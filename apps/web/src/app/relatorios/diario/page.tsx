// /relatorios/diario — Relatório diário das casas: movimento, equipe pelo
// ponto, cancelamentos por demora, avaliações e pontos de atenção de cada casa
// num dia operacional (05:00 → 05:00). É o mesmo relatório que vai todo dia às
// 07:00 pro WhatsApp do dono; aqui embaixo ele cadastra quem recebe.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { db, schema } from '@concilia/db';
import { inArray } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';
import { dateToBrYmd } from '@/lib/datas';
import {
  montarRelatorioFiliais,
  rotuloDia,
  somaDias,
  ultimoDiaFechado,
  type CaixaDia,
  type RelatorioCasa,
} from '@/lib/relatorio-diario';
import {
  estadoDoModelo,
  lerConfig,
  organizacoesDoDono,
  TEXTO_MODELO,
  ultimosEnvios,
} from '@/lib/relatorio-diario-envio';
import { EnvioCard } from './envio-card';

/** "1 mesa", "2 mesas". */
function pl(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface SP {
  dia?: string;
}

function horas(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function KPI({ label, valor, sub, cor = 'text-slate-900' }: { label: string; valor: string; sub?: string; cor?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${cor}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function Bloco({ titulo, children, nota }: { titulo: string; children: React.ReactNode; nota?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</h3>
      <div className="mt-2 text-sm text-slate-700">{children}</div>
      {nota && <p className="mt-2 text-[11px] text-slate-400">{nota}</p>}
    </div>
  );
}

/** Tem o que mostrar do caixa (ou a loja não respondeu — isso também se mostra). */
function temCaixa(cx: CaixaDia | null): cx is CaixaDia {
  if (!cx) return false;
  if (!cx.ok) return true;
  return cx.gavetas.length > 0 || cx.saidas.length > 0 || cx.entradas.length > 0 || (cx.maquininhas?.length ?? 0) > 0;
}

/** Gavetas, saídas de dinheiro (quem levou, pra quê, quem lançou) e maquininhas sem fechar. */
function CaixaDoDia({ cx }: { cx: CaixaDia }) {
  if (!cx.ok) {
    return (
      <Bloco titulo="Caixa e saídas de dinheiro">
        <p className="text-amber-700">
          A loja não respondeu agora ({cx.erro ?? 'sem resposta'}). Recarregue a página em alguns minutos — a gaveta e as
          saídas são lidas direto do servidor da loja.
        </p>
      </Bloco>
    );
  }
  const maq = cx.maquininhas;
  return (
    <Bloco
      titulo="Caixa e saídas de dinheiro"
      nota="Lido direto do servidor da loja. Maquininha não recebe dinheiro: gaveta é só o caixa do balcão. Entradas e saídas da gaveta contam o caixa inteiro, do abrir ao fechar; a lista de saídas abaixo é só a do dia."
    >
      {cx.gavetas.length === 0 ? (
        <p className="text-slate-500">Nenhuma gaveta aberta nesse dia.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 pr-3 font-medium">Gaveta</th>
                <th className="py-1 pr-3 font-medium">Abriu</th>
                <th className="py-1 pr-3 font-medium">Fechou</th>
                <th className="py-1 pr-3 text-right font-medium">Fundo</th>
                <th className="py-1 pr-3 text-right font-medium">Dinheiro</th>
                <th className="py-1 pr-3 text-right font-medium">Entradas</th>
                <th className="py-1 pr-3 text-right font-medium">Saídas</th>
                <th className="py-1 pr-3 text-right font-medium">Esperado</th>
                <th className="py-1 pr-3 text-right font-medium">Contado</th>
                <th className="py-1 text-right font-medium">Diferença</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cx.gavetas.map((g) => (
                <tr key={g.codigo}>
                  <td className="py-1.5 pr-3 font-medium text-slate-900">{g.quem}</td>
                  <td className="py-1.5 pr-3 text-slate-500">{g.abertoEm}</td>
                  <td className="py-1.5 pr-3">
                    {g.fechadoEm ? (
                      <span className="text-slate-500">{g.fechadoEm}</span>
                    ) : (
                      <span className={g.diasAberta >= 2 ? 'font-medium text-rose-700' : 'text-amber-700'}>
                        aberta{g.diasAberta >= 1 ? ` há ${pl(g.diasAberta, 'dia', 'dias')}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{brl(g.fundo)}</td>
                  <td className="py-1.5 pr-3 text-right">{brl(g.dinheiro)}</td>
                  <td className="py-1.5 pr-3 text-right">{g.entradas ? brl(g.entradas) : '—'}</td>
                  <td className="py-1.5 pr-3 text-right">{g.saidas ? brl(g.saidas) : '—'}</td>
                  <td className="py-1.5 pr-3 text-right">{g.esperado != null ? brl(g.esperado) : '—'}</td>
                  <td className="py-1.5 pr-3 text-right">{g.contado != null ? brl(g.contado) : '—'}</td>
                  <td className="py-1.5 text-right">
                    {g.diferenca == null ? (
                      '—'
                    ) : Math.abs(g.diferenca) < 0.01 ? (
                      <span className="text-emerald-700">bateu</span>
                    ) : (
                      <span className="font-medium text-rose-700">
                        {g.diferenca < 0 ? '−' : '+'}
                        {brl(Math.abs(g.diferenca))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Saídas de dinheiro{cx.saidas.length ? ` — ${brl(cx.totalSaidas)} em ${cx.saidas.length}` : ''}
      </h4>
      {cx.saidas.length === 0 ? (
        <p className="mt-1 text-slate-500">Nenhuma saída de dinheiro da gaveta nesse dia.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">
            Por pessoa: {cx.porPessoa.map((p) => `${p.nome} ${brl(p.valor)} (${p.n}x)`).join(' · ')}
          </p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1 pr-3 font-medium">Hora</th>
                  <th className="py-1 pr-3 text-right font-medium">Valor</th>
                  <th className="py-1 pr-3 font-medium">Quem levou</th>
                  <th className="py-1 pr-3 font-medium">Motivo</th>
                  <th className="py-1 pr-3 font-medium">Lançou</th>
                  <th className="py-1 font-medium">Gaveta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cx.saidas.map((x, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3 text-slate-500">{x.hora}</td>
                    <td className="py-1.5 pr-3 text-right font-medium text-slate-900">{brl(x.valor)}</td>
                    <td className="py-1.5 pr-3">{x.levou ?? <span className="text-slate-400">despesa do caixa</span>}</td>
                    <td className="py-1.5 pr-3">{x.motivo}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{x.lancou ?? '—'}</td>
                    <td className="py-1.5 text-slate-500">{x.caixaDe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {cx.entradas.length > 0 && (
        <>
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Entradas na gaveta — {brl(cx.totalEntradas)} em {cx.entradas.length}
          </h4>
          <ul className="mt-1 space-y-1">
            {cx.entradas.map((x, i) => (
              <li key={i}>
                <span className="text-slate-500">{x.hora}</span> · <span className="font-medium">{brl(x.valor)}</span> —{' '}
                {x.motivo}
                {x.lancou ? <span className="text-slate-500"> (lançou {x.lancou})</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Maquininhas ainda abertas (situação de agora)
      </h4>
      {maq == null ? (
        <p className="mt-1 text-amber-700">A conferência da loja não respondeu agora.</p>
      ) : maq.length === 0 ? (
        <p className="mt-1 text-slate-500">Nenhuma — todos os caixas de maquininha até esse dia estão fechados.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {maq.map((m) => (
            <li key={m.codigo} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span>
                <span className="font-medium text-slate-900">{m.quem}</span>{' '}
                <span className="text-slate-500">
                  desde {m.desde} · {pl(m.pagamentos, 'pagamento', 'pagamentos')} · {brl(m.total)}
                  {m.canal > 0 ? ` · iFood Online ${brl(m.canal)} fora da conferência` : ''}
                </span>
              </span>
              <span
                className={
                  m.fecharia ? 'text-emerald-700' : m.travada ? 'font-medium text-rose-700' : 'text-amber-700'
                }
              >
                {m.fecharia ? 'confere — fecha sozinha na madrugada' : (m.motivo ?? 'não confere')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}

function Casa({ c }: { c: RelatorioCasa }) {
  if (!c.temMovimento) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">{c.nome}</h2>
        <p className="mt-1 text-sm text-slate-500">
          Sem movimento nesse dia
          {c.equipe.total > 0 ? ` — ${c.equipe.total} pessoas bateram ponto.` : '.'}
        </p>
        {temCaixa(c.caixa) && (
          <div className="mt-3">
            <CaixaDoDia cx={c.caixa} />
          </div>
        )}
      </section>
    );
  }

  const semana = c.semanaPassada.total;
  const variacao = semana > 0 ? ((c.movimento.total - semana) / semana) * 100 : null;
  const maiorHora = Math.max(1, ...c.porHora.map((h) => h.total));
  const pracasComTempo = c.kds.cobertura >= 0.5;

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{c.nome}</h2>
        <p className="text-xs text-slate-500">
          {c.equipe.total} no ponto · {int(c.movimento.contas)} contas
          {c.movimento.permanenciaMedianaMin != null ? ` · permanência ${horas(c.movimento.permanenciaMedianaMin)}` : ''}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI
          label="Faturamento"
          valor={brl(c.movimento.total)}
          sub={
            variacao == null
              ? 'sem movimento na semana passada'
              : `${variacao >= 0 ? '+' : ''}${variacao.toFixed(0)}% × semana passada (${brl(semana)})`
          }
          cor={variacao != null && variacao < -30 ? 'text-rose-700' : 'text-slate-900'}
        />
        <KPI label="Ticket por conta" valor={brl(c.movimento.ticket)} sub={`serviço ${brl(c.movimento.servico)}`} />
        <KPI
          label="Cancelado por demora"
          valor={c.cancelamentos.demora.itens ? pl(c.cancelamentos.demora.itens, 'item', 'itens') : 'nenhum'}
          sub={
            c.cancelamentos.demora.itens
              ? `${brl(c.cancelamentos.demora.valor)} em ${pl(c.cancelamentos.demora.mesas, 'mesa', 'mesas')}, ${c.cancelamentos.demora.de}–${c.cancelamentos.demora.ate}`
              : `${pl(c.cancelamentos.itens, 'cancelamento', 'cancelamentos')} no dia (${brl(c.cancelamentos.valor)})`
          }
          cor={c.cancelamentos.demora.itens ? 'text-rose-700' : 'text-emerald-700'}
        />
        <KPI
          label="Avaliações"
          valor={c.avaliacoes.media != null ? c.avaliacoes.media.toFixed(1).replace('.', ',') : '—'}
          sub={`${c.avaliacoes.total} no dia${c.avaliacoes.baixas.length ? ` · ${c.avaliacoes.baixas.length} com nota até 3` : ''}`}
          cor={c.avaliacoes.baixas.length ? 'text-amber-700' : 'text-slate-900'}
        />
      </div>

      {c.atencao.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800">Pontos de atenção</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {c.atencao.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Bloco titulo="Movimento por período">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="pb-1 font-medium">Período</th>
                <th className="pb-1 text-right font-medium">Contas</th>
                <th className="pb-1 text-right font-medium">Vendido</th>
                <th className="pb-1 text-right font-medium">Pico</th>
                <th className="pb-1 text-right font-medium">Garçons</th>
                <th className="pb-1 text-right font-medium">Cozinha</th>
              </tr>
            </thead>
            <tbody>
              {c.periodos
                .filter((p) => p.contas > 0)
                .map((p) => (
                  <tr key={p.nome} className="border-t border-slate-100">
                    <td className="py-1">{p.nome}</td>
                    <td className="py-1 text-right">{p.contas}</td>
                    <td className="py-1 text-right">{brl(p.total)}</td>
                    <td className="py-1 text-right">{p.pico ? `${pl(p.pico, 'mesa', 'mesas')}${p.picoHora ? ` ${p.picoHora}` : ''}` : '—'}</td>
                    <td className="py-1 text-right">{p.garconsNoPico}</td>
                    <td className="py-1 text-right">{p.cozinhaNoPico}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-400">
            Pico = mesas e comandas abertas ao mesmo tempo. Garçons e cozinha = quem estava com o ponto batido naquela
            hora.
          </p>
          <div className="mt-3 flex h-16 items-end gap-1">
            {c.porHora.map((h) => (
              <div key={h.hora} className="flex flex-1 flex-col items-center gap-1" title={`${h.hora}h — ${pl(h.contas, 'conta', 'contas')}, ${brl(h.total)}`}>
                <div className="w-full rounded-sm bg-sky-500/70" style={{ height: `${Math.max(3, (h.total / maiorHora) * 48)}px` }} />
                <span className="text-[9px] text-slate-400">{h.hora}</span>
              </div>
            ))}
          </div>
        </Bloco>

        <Bloco
          titulo={`Equipe no ponto (${c.equipe.total})`}
          nota={
            c.equipe.semCargo > 0
              ? `${pl(c.equipe.semCargo, 'pessoa', 'pessoas')} sem cargo no cadastro — preencha o cargo em RH pra entrarem na função certa. Só aparece quem bateu ponto.`
              : 'Só aparece quem bateu ponto.'
          }
        >
          {c.equipe.total === 0 ? (
            <p className="text-slate-400">Ninguém bateu ponto nesse dia.</p>
          ) : (
            <ul className="space-y-2">
              {c.equipe.funcoes.map((f) => (
                <li key={f.chave}>
                  <span className="font-medium text-slate-900">
                    {f.rotulo} ({f.pessoas.length})
                  </span>
                  <span className="block text-xs text-slate-500">
                    {f.pessoas
                      .map(
                        (p) =>
                          `${p.nome.split(' ')[0]} ${p.entrada ?? '?'}–${p.semSaida ? 'sem saída' : (p.saida ?? '?')}${p.minutos != null ? ` (${horas(p.minutos)})` : ''}`,
                      )
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Bloco>

        <Bloco titulo={`Cancelamentos (${pl(c.cancelamentos.itens, 'item', 'itens')} · ${brl(c.cancelamentos.valor)})`}>
          {c.cancelamentos.itens === 0 ? (
            <p className="text-slate-400">Nenhum item cancelado.</p>
          ) : (
            <>
              <ul className="space-y-1">
                {c.cancelamentos.porMotivo.map((m) => (
                  <li key={m.motivo} className="flex justify-between gap-3">
                    <span>{m.motivo}</span>
                    <span className="shrink-0 text-slate-500">
                      {pl(m.itens, 'item', 'itens')} · {brl(m.valor)} · {pl(m.mesas, 'mesa', 'mesas')}
                    </span>
                  </li>
                ))}
              </ul>
              {c.cancelamentos.mesasQueDesistiram.length > 0 && (
                <p className="mt-3 text-xs text-rose-700">
                  Foram embora sem o pedido:{' '}
                  {c.cancelamentos.mesasQueDesistiram
                    .map((m) => `mesa ${m.numero} às ${m.hora} (${brl(m.cancelado)} cancelado, pagou ${brl(m.pago ?? 0)})`)
                    .join(' · ')}
                </p>
              )}
              {c.cancelamentos.maiores.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-slate-500">
                  {c.cancelamentos.maiores.map((m, i) => (
                    <li key={i}>
                      {m.lancado ? `lançado ${m.lancado} · cancelado ${m.hora}` : `cancelado ${m.hora}`} · mesa {m.numero ?? '—'} · {m.nome} ·{' '}
                      {brl(m.valor)} · {m.motivo}
                      {m.quem ? ` · ${m.quem}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Bloco>

        <Bloco
          titulo="Praças"
          nota={
            pracasComTempo
              ? `Tempo medido em ${Math.round(c.kds.cobertura * 100)}% dos itens.`
              : `Tempo de preparo ainda não entra: o KDS da loja só mandou a hora de ${c.kds.medidos} dos ${c.kds.itens} itens. Por enquanto a demora aparece pelos cancelamentos e pelas avaliações.`
          }
        >
          <table className="w-full text-sm">
            <tbody>
              {c.pracas.map((p) => (
                <tr key={p.nome} className="border-t border-slate-100 first:border-t-0">
                  <td className="py-1">{p.nome}</td>
                  <td className="py-1 text-right text-slate-500">{int(p.itens)} itens</td>
                  <td className="py-1 text-right">{brl(p.valor)}</td>
                  {pracasComTempo && (
                    <td className={`py-1 text-right ${p.acimaDaMeta > 0 ? 'text-rose-700' : 'text-slate-500'}`}>
                      {p.medianaMin != null ? `${Math.round(p.medianaMin)} min (meta ${p.metaMin})` : '—'}
                      {p.acimaDaMeta > 0 ? ` · ${p.acimaDaMeta} acima` : ''}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {pracasComTempo && c.kds.piores.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              {c.kds.piores.map((p, i) => (
                <li key={i}>
                  {p.hora} · mesa {p.numero ?? '—'} · {p.nome} · {Math.round(p.min)} min ({p.praca})
                </li>
              ))}
            </ul>
          )}
        </Bloco>

        <Bloco titulo="Recebimentos">
          <ul className="space-y-1">
            {c.pagamentos.map((p) => (
              <li key={p.forma} className="flex justify-between gap-3">
                <span>{p.forma}</span>
                <span className="shrink-0 text-slate-500">
                  {p.qtd}x · {brl(p.valor)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Recebido {brl(c.recebido)} × contas {brl(c.movimento.total)}
            {Math.abs(c.recebido - c.movimento.total) >= 0.01
              ? ` (${c.recebido > c.movimento.total ? '+' : '−'}${brl(Math.abs(c.recebido - c.movimento.total))})`
              : ''}
            {c.movimento.desconto > 0 ? ` · descontos ${brl(c.movimento.desconto)}` : ''}
          </p>
          {c.descontos.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              Desconto alto:{' '}
              {c.descontos.map((d) => `mesa/comanda ${d.numero ?? '—'} ${brl(d.desconto)} (pagou ${brl(d.pago)})`).join(' · ')}
            </p>
          )}
        </Bloco>

        <Bloco titulo="Mais vendidos">
          <ul className="space-y-1">
            {c.top.map((t) => (
              <li key={t.nome} className="flex justify-between gap-3">
                <span className="truncate">{t.nome}</span>
                <span className="shrink-0 text-slate-500">
                  {int(t.qtd)} · {brl(t.valor)}
                </span>
              </li>
            ))}
          </ul>
        </Bloco>
      </div>

      {temCaixa(c.caixa) && (
        <div className="mt-3">
          <CaixaDoDia cx={c.caixa} />
        </div>
      )}

      {(c.avaliacoes.baixas.length > 0 ||
        c.reservas.total > 0 ||
        c.listaEspera > 0 ||
        c.quedas.length > 0 ||
        c.jornadasLongas.length > 0) && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <ul className="space-y-1">
            {c.avaliacoes.baixas.map((a, i) => (
              <li key={`a${i}`}>
                <span className="font-medium text-amber-700">Nota {a.nota}</span> · mesa {a.mesa ?? '—'} às {a.hora}
                {a.comentario ? ` — “${a.comentario}”` : ''}
              </li>
            ))}
            {c.reservas.total > 0 && (
              <li>
                Reservas: {c.reservas.total} ({pl(c.reservas.pessoas, 'pessoa', 'pessoas')}) ·{' '}
                {pl(c.reservas.sentadas, 'veio', 'vieram')} · {pl(c.reservas.noShow, 'faltou', 'faltaram')}
                {c.reservas.canceladas > 0
                  ? ` · ${pl(c.reservas.canceladas, 'cancelada antes', 'canceladas antes')}`
                  : ''}
              </li>
            )}
            {c.listaEspera > 0 && <li>Lista de espera: {pl(c.listaEspera, 'nome', 'nomes')}</li>}
            {c.quedas.map((k, i) => (
              <li key={`q${i}`}>
                Loja fora do ar às {k.hora} por {k.minutos} min
              </li>
            ))}
            {c.jornadasLongas.length > 0 && (
              <li>
                Jornada acima de 11 h: {c.jornadasLongas.map((j) => `${j.nome.split(' ')[0]} ${horas(j.minutos)}`).join(' · ')}
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}

export default async function RelatorioDiarioPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'relatorio.read');

  const sp = await props.searchParams;
  const ultimo = ultimoDiaFechado();
  // dia operacional em andamento (vira às 05:00)
  const emAndamento = dateToBrYmd(new Date(Date.now() - 5 * 3600 * 1000));
  const pedido = sp.dia && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : ultimo;
  const dia = pedido > emAndamento ? emAndamento : pedido;

  const filiais = await filiaisDoUsuario(user.id);
  const ids = filiais.map((f) => f.id);
  const comUrl = ids.length
    ? await db
        .select({ id: schema.filial.id, caixaUrl: schema.filial.caixaUrl })
        .from(schema.filial)
        .where(inArray(schema.filial.id, ids))
    : [];
  const urlPorId = new Map(comUrl.map((f) => [f.id, f.caixaUrl]));

  const [casas, orgsDono] = await Promise.all([
    montarRelatorioFiliais(
      filiais.map((f) => ({ id: f.id, nome: f.nome, caixa_url: urlPorId.get(f.id) ?? null })),
      dia,
    ),
    organizacoesDoDono(user.id),
  ]);
  const orgDono = orgsDono[0] ?? null;
  const [config, envios, modelo] = orgDono
    ? await Promise.all([lerConfig(orgDono.id), ultimosEnvios(orgDono.id), estadoDoModelo()])
    : [null, [], null];

  const total = casas.reduce((s, c) => s + c.movimento.total, 0);
  const contas = casas.reduce((s, c) => s + c.movimento.contas, 0);
  const semana = casas.reduce((s, c) => s + c.semanaPassada.total, 0);
  const demoraItens = casas.reduce((s, c) => s + c.cancelamentos.demora.itens, 0);
  const demoraValor = casas.reduce((s, c) => s + c.cancelamentos.demora.valor, 0);
  const noPonto = casas.reduce((s, c) => s + c.equipe.total, 0);
  const avTotal = casas.reduce((s, c) => s + c.avaliacoes.total, 0);
  const avMedia = avTotal
    ? casas.reduce((s, c) => s + (c.avaliacoes.media ?? 0) * c.avaliacoes.total, 0) / avTotal
    : null;
  const variacao = semana > 0 ? ((total - semana) / semana) * 100 : null;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-7xl space-y-5 px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Relatório diário das casas</h1>
            <p className="mt-1 text-sm text-slate-500">
              {rotuloDia(dia)} — do dia às 05:00 até as 05:00 do dia seguinte
              {dia === emAndamento ? ' (dia em andamento, números parciais)' : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href={`/relatorios/diario?dia=${somaDias(dia, -1)}`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50"
            >
              ← Dia anterior
            </Link>
            <form action="/relatorios/diario" className="flex items-center gap-2">
              <input
                type="date"
                name="dia"
                defaultValue={dia}
                max={emAndamento}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700"
              />
              <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-700">
                Ver
              </button>
            </form>
            {dia < emAndamento && (
              <Link
                href={`/relatorios/diario?dia=${somaDias(dia, 1)}`}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50"
              >
                Dia seguinte →
              </Link>
            )}
          </div>
        </div>

        {casas.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma casa disponível.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <KPI
                label="Faturamento das casas"
                valor={brl(total)}
                sub={
                  variacao == null
                    ? undefined
                    : `${variacao >= 0 ? '+' : ''}${variacao.toFixed(0)}% × semana passada (${brl(semana)})`
                }
              />
              <KPI label="Contas" valor={int(contas)} sub={contas ? `ticket ${brl(total / contas)}` : undefined} />
              <KPI label="Equipe no ponto" valor={int(noPonto)} sub="quem bateu ponto no dia" />
              <KPI
                label="Cancelado por demora"
                valor={demoraItens ? pl(demoraItens, 'item', 'itens') : 'nenhum'}
                sub={demoraItens ? brl(demoraValor) : undefined}
                cor={demoraItens ? 'text-rose-700' : 'text-emerald-700'}
              />
              <KPI
                label="Avaliações"
                valor={avMedia != null ? avMedia.toFixed(1).replace('.', ',') : '—'}
                sub={`${avTotal} no dia`}
              />
            </div>

            {casas.map((c) => (
              <Casa key={c.filialId} c={c} />
            ))}
          </>
        )}

        {orgDono && config && modelo && (
          <EnvioCard
            organizacaoId={orgDono.id}
            ativo={config.ativo}
            telefones={config.telefones}
            envios={envios}
            dia={dia}
            diaRotulo={rotuloDia(dia)}
            modelo={modelo}
            textoModelo={TEXTO_MODELO}
          />
        )}
      </section>
    </main>
  );
}

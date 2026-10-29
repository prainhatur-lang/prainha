// /relatorios/folha-faturamento — Folha ÷ faturamento por casa e somado,
// mês corrente (parcial) + 6 meses anteriores. Regra do dono (29/10/2026):
// abaixo de 17% verde, 17–20% amarelo, acima de 20% vermelho.
// Só lê; as contas estão em lib/folha-faturamento.ts.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { hojeBr } from '@/lib/datas';
import { mesValido, rotuloMes, somaMeses } from '@/lib/faturamento-meses';
import {
  FAIXA_AMARELO_ATE,
  FAIXA_VERDE_ATE,
  calcularFolhaFaturamento,
  somarCasas,
  type Faixa,
  type FolhaFaturamentoMes,
} from '@/lib/folha-faturamento';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  mes?: string;
}

const MESES_PARA_TRAS = 6;

// Ordem 01 Bar, 02 Tabuará, 03 Mar.
const ORDEM_CASAS = [
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9',
  'fde37b95-7c7e-4b41-a618-2aba1fbc0de7',
  'e899dae2-38bf-4f3f-9149-7effd059fab8',
];

function fmtPct(p: number | null): string {
  return p == null ? '—' : `${p.toFixed(1).replace('.', ',')}%`;
}

function fmtData(ymd: string | null): string {
  if (!ymd) return '—';
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

const COR: Record<Faixa, string> = {
  verde: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  amarelo: 'bg-amber-50 text-amber-800 border-amber-200',
  vermelho: 'bg-rose-50 text-rose-800 border-rose-200',
};

function corDe(f: Faixa | null): string {
  return f ? COR[f] : 'bg-slate-50 text-slate-500 border-slate-200';
}

function Linha({ rotulo, valor, sub, forte }: { rotulo: string; valor: number; sub?: string; forte?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-0.5 ${forte ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
      <span>
        {rotulo}
        {sub && <span className="ml-1 text-xs font-normal text-slate-500">{sub}</span>}
      </span>
      <span className="tabular-nums">{brl(valor)}</span>
    </div>
  );
}

export default async function FolhaFaturamentoPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'relatorio.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const ativa = await escolherFilial(filiais, sp.filialId);

  if (!ativa) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <div className="mx-auto max-w-5xl p-6 text-sm text-slate-600">Nenhuma casa liberada pra você.</div>
      </main>
    );
  }
  const filialAtiva = ativa;

  const casas = [...filiais].sort((a, b) => {
    const ia = ORDEM_CASAS.indexOf(a.id);
    const ib = ORDEM_CASAS.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.nome.localeCompare(b.nome);
  });

  const mesAtual = hojeBr().slice(0, 7);
  const meses = Array.from({ length: MESES_PARA_TRAS + 1 }, (_, i) => somaMeses(mesAtual, -i));
  const mesDetalhe = mesValido(sp.mes) && meses.includes(sp.mes) ? sp.mes : mesAtual;

  // meses × casas, tudo em paralelo
  const grade: FolhaFaturamentoMes[][] = await Promise.all(
    meses.map((m) => Promise.all(casas.map((c) => calcularFolhaFaturamento(c.id, m)))),
  );
  const totais = grade.map((linhas) => somarCasas(linhas));

  const iDet = meses.indexOf(mesDetalhe);
  const detalhe = grade[iDet] ?? [];
  const detAtiva = detalhe.find((l) => l.filialId === filialAtiva.id) ?? detalhe[0];
  const casaDet = casas.find((c) => c.id === detAtiva?.filialId);

  const linkMes = (m: string) => `/relatorios/folha-faturamento?mes=${m}&filialId=${filialAtiva.id}`;
  const linkCasa = (id: string) => `/relatorios/folha-faturamento?mes=${mesDetalhe}&filialId=${id}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <header>
          <h1 className="text-xl font-semibold text-slate-900">Folha ÷ faturamento</h1>
          <p className="mt-1 text-sm text-slate-600">
            Quanto da venda da casa vai pra gente (salário, encargos, diárias, VT). Os 10% de serviço ficam fora
            dos dois lados.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className={`rounded border px-2 py-0.5 ${COR.verde}`}>abaixo de {FAIXA_VERDE_ATE}% — ideal</span>
            <span className={`rounded border px-2 py-0.5 ${COR.amarelo}`}>
              {FAIXA_VERDE_ATE}% a {FAIXA_AMARELO_ATE}% — atenção
            </span>
            <span className={`rounded border px-2 py-0.5 ${COR.vermelho}`}>acima de {FAIXA_AMARELO_ATE}% — alto</span>
          </div>
        </header>

        {/* Tabela mês × casa */}
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Mês</th>
                {casas.map((c) => (
                  <th key={c.id} className="px-3 py-2">
                    {c.nome}
                  </th>
                ))}
                {casas.length > 1 && <th className="px-3 py-2">Total das casas</th>}
              </tr>
            </thead>
            <tbody>
              {meses.map((m, i) => {
                const linhas = grade[i]!;
                const t = totais[i]!;
                const l0 = linhas[0];
                const escolhido = m === mesDetalhe;
                return (
                  <tr key={m} className={`border-t border-slate-100 ${escolhido ? 'bg-sky-50/60' : ''}`}>
                    <td className="px-3 py-2 align-top">
                      <Link href={linkMes(m)} className="font-medium text-sky-700 hover:underline">
                        {rotuloMes(m)}
                      </Link>
                      {l0?.parcial && (
                        <div className="text-xs text-slate-500">
                          parcial {fmtData(l0.ini)}–{fmtData(l0.fim)}
                        </div>
                      )}
                    </td>
                    {linhas.map((l) => (
                      <td key={l.filialId} className="px-3 py-2 align-top">
                        <div className={`inline-block rounded border px-2 py-0.5 font-semibold tabular-nums ${corDe(l.faixa)}`}>
                          {l.semMovimento ? 'sem movimento' : l.semFolhaSemanal ? 'sem folha semanal' : fmtPct(l.pct)}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
                          {brl(l.folha.total)} / {brl(l.faturamento.total)}
                        </div>
                        {l.parcial && casas.length > 1 && l.fim !== l0?.fim && (
                          <div className="text-xs text-slate-400">até {fmtData(l.fim)}</div>
                        )}
                      </td>
                    ))}
                    {casas.length > 1 && (
                      <td className="px-3 py-2 align-top">
                        <div className={`inline-block rounded border px-2 py-0.5 font-semibold tabular-nums ${corDe(t.faixa)}`}>
                          {fmtPct(t.pct)}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
                          {brl(t.folha)} / {brl(t.faturamento)}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            Em cada casa: % e, embaixo, folha / faturamento. Clique no mês pra abrir o detalhe. O total sai das somas
            (não é média dos %). “Sem folha semanal” = mês em que as diárias ainda não passavam pelo sistema; o %
            sairia baixo demais, então não mostramos.
          </p>
        </section>

        {/* Detalhe da casa no mês */}
        {detAtiva && casaDet && (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                {casaDet.nome} — {rotuloMes(detAtiva.mes)}
                {detAtiva.parcial && (
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    parcial, {fmtData(detAtiva.ini)} a {fmtData(detAtiva.fim)} ({detAtiva.diasNoPeriodo} de{' '}
                    {detAtiva.diasNoMes} dias)
                  </span>
                )}
              </h2>
              {casas.length > 1 && (
                <div className="flex flex-wrap gap-1 text-xs">
                  {casas.map((c) => (
                    <Link
                      key={c.id}
                      href={linkCasa(c.id)}
                      className={`rounded border px-2 py-0.5 ${c.id === casaDet.id ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      {c.nome}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Faturamento</h3>
                <Linha rotulo="Vendas do PDV" sub="sem os 10%" valor={detAtiva.faturamento.pdv} />
                <Linha rotulo="Tickets de evento" valor={detAtiva.faturamento.eventos} />
                <Linha rotulo="Total" valor={detAtiva.faturamento.total} forte />
                <p className="mt-2 text-xs text-slate-500">
                  10% de serviço no período: {brl(detAtiva.faturamento.servico10)} (fora da conta).
                </p>
              </div>

              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Folha</h3>
                <Linha
                  rotulo="Contracheques"
                  sub={
                    detAtiva.folha.contracheque.fonte === 'contador'
                      ? '(folha do contador)'
                      : detAtiva.folha.contracheque.fonte === 'estimado'
                        ? `(estimado pelo cadastro, ${detAtiva.folha.contracheque.pessoas} pessoas)`
                        : '(ninguém registrado)'
                  }
                  valor={detAtiva.folha.contracheque.total}
                />
                <div className="ml-3 text-xs">
                  <Linha rotulo="salários/proventos" valor={detAtiva.folha.contracheque.proventos} />
                  <Linha rotulo="FGTS + INSS empresa" valor={detAtiva.folha.contracheque.encargos} />
                  <Linha rotulo="13º e férias (provisão)" valor={detAtiva.folha.contracheque.provisao} />
                </div>
                <Linha rotulo="Folha semanal" valor={detAtiva.folha.semanal.total} />
                <div className="ml-3 text-xs">
                  {(
                    [
                      ['diárias', detAtiva.folha.semanal.diaria],
                      ['gratificação', detAtiva.folha.semanal.gratificacao],
                      ['premiação', detAtiva.folha.semanal.premiacao],
                      ['transporte', detAtiva.folha.semanal.transporte],
                      ['adicional noturno', detAtiva.folha.semanal.noturno],
                      ['pró-labore fixo (gerente)', detAtiva.folha.semanal.proLaboreFixo],
                      ['outros', detAtiva.folha.semanal.outros],
                    ] as const
                  )
                    .filter(([, v]) => Math.abs(v) >= 0.5)
                    .map(([r, v]) => (
                      <Linha key={r} rotulo={r} valor={v} />
                    ))}
                </div>
                <Linha rotulo="Vale-transporte" valor={detAtiva.folha.vt} />
                <Linha rotulo="Total" valor={detAtiva.folha.total} forte />
              </div>

              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Resultado</h3>
                <div className={`rounded-lg border px-3 py-2 text-2xl font-semibold tabular-nums ${corDe(detAtiva.faixa)}`}>
                  {detAtiva.semMovimento
                    ? 'sem movimento'
                    : detAtiva.semFolhaSemanal
                      ? 'sem folha semanal'
                      : fmtPct(detAtiva.pct)}
                </div>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Pago com os 10% (fora da conta)
                </p>
                <Linha rotulo="Comissão" valor={detAtiva.pagoCom10.comissao} />
                <Linha rotulo="Pró-labore dos 10%" valor={detAtiva.pagoCom10.proLabore10} />
                <p className="mt-2 text-xs text-slate-500">
                  Folha semanal lançada até {fmtData(detAtiva.folhaSemanalAte)}.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* O que entra */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <h2 className="mb-2 text-base font-semibold text-slate-900">O que entra em cada número</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <b>Faturamento</b> = vendas do PDV (valor da conta menos os 10% de serviço), por dia operacional (o dia
              vira às 05:00, igual ao resumo diário), mais os tickets de evento encerrados (igual ao VGV).
            </li>
            <li>
              <b>Contracheques</b> = quem é registrado. Com a folha do contador da competência importada (RH → Folha
              do contador): proventos + FGTS + INSS da empresa (RAT e terceiros). Sem ela: estimativa pelo cadastro,
              mesma conta do “Custo de pessoal (CLT)” do Fechamento — mensal = salário pelos dias trabalhados no mês,
              intermitente = valor/hora × horas da folha semanal, mais FGTS 8% e o INSS da empresa (o % de encargos
              da casa) — quem é registrado pela E.B. Serviços leva só o FGTS, porque ela é do Simples e o INSS
              patronal vai no DAS (a folha do contador já mostra assim). Nos dois casos soma a
              provisão de 13º e férias (salário × 1/12 + 1/9; na folha do contador, só dos celetistas mensais).
            </li>
            <li>
              <b>Folha semanal</b> = contas a pagar das semanas lançadas: diárias, gratificação, premiação, transporte,
              adicional noturno e pró-labore fixo por dia. Semana que cruza a virada do mês entra pelos dias que caem
              no mês. <b>Comissão</b> e pró-labore “dos 10%” saem dos 10%, que já não estão no faturamento, então
              ficam fora e aparecem só como informação.
            </li>
            <li>
              <b>Vale-transporte</b> = VT quinzenal pago, pelos dias da quinzena que caem no mês.
            </li>
            <li>
              <b>Mês corrente</b> é parcial: vai até ontem ou até o último dia com folha semanal lançada (o que vier
              antes). Faturamento e folha usam o mesmo período, e salário/contracheque entram proporcionais aos dias.
            </li>
            <li>
              Casa com menos de R$ 10 mil no mês aparece como “sem movimento” (fechada ou abrindo) e não tem %. O custo
              dela ainda entra no total das casas.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}

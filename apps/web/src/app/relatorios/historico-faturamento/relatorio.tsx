// Relatório da aba Histórico de faturamento (VGV): veredito, indicadores,
// gráficos e tabelas. Só desenha — as contas são do motor
// (@/lib/faturamento-historico). Não usa nada do Next, então dá pra renderizar
// fora dele pra conferir.

import type { ReactNode } from 'react';
import {
  type Comparacao,
  type Historico,
  type Resumo,
  type Tendencia,
  type Unidade,
  inicioDoEscopo,
  matriz,
  mesReferencia,
  porAno,
  resumo,
  serie12Meses,
  situacao,
  variacao,
  veredito,
} from '@/lib/faturamento-historico';
import { MESES_CURTOS, partesMes, rotuloMes, rotuloPeriodo, somaMeses } from '@/lib/faturamento-meses';
import { brl } from '@/lib/format';
import { CARTAO } from './estilos';
import { Grafico12Meses, GraficoMesAMes, compacto, corVar, inteiro, pct, type LinhaAno } from './graficos';

/** "A" · "A e B" · "A, B e C" */
export function listaNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

const nMeses = (n: number) => (n === 1 ? '1 mês' : `${n} meses`);

const TITULO = 'text-sm font-semibold text-slate-900';
const SUBTITULO = 'mt-0.5 text-xs text-slate-500';
const CABECA = 'border-b border-slate-200 px-4 py-3';
const THEAD = 'bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500';
const NOTA = 'text-[11px] leading-relaxed text-slate-400';
const NUM = 'px-3 py-2 text-right tabular-nums';

// ---------- Veredito ----------

function CaixaVeredito({ h, r, unidade }: { h: Historico; r: Resumo; unidade: Unidade | null }) {
  const c = r.ultimos12;
  const umaUnidade = unidade !== null;
  const v = veredito(c, umaUnidade);
  const sujeito = unidade ? unidade.nome : 'O VGV';
  const estado: Record<Tendencia, { titulo: string; caixa: string }> = {
    crescendo: { titulo: `${sujeito} está crescendo`, caixa: 'border-emerald-200 bg-emerald-50' },
    caindo: { titulo: `${sujeito} está caindo`, caixa: 'border-rose-200 bg-rose-50' },
    estavel: { titulo: `${sujeito} está estável`, caixa: 'border-slate-200 bg-white' },
    'sem-base': {
      titulo: `Ainda não dá pra dizer se ${unidade ? unidade.nome : 'o VGV'} está crescendo`,
      caixa: 'border-amber-200 bg-amber-50',
    },
  };

  const periodo = rotuloPeriodo(c.meses);
  const quem = unidade ? `${unidade.nome} vendeu` : 'as unidades venderam';
  const emBranco = c.fora.filter((f) => f.motivo === 'em-branco').map((f) => f.nome);
  const novas = c.fora.filter((f) => f.motivo === 'nova').map((f) => f.nome);
  const paradas = c.fora.filter((f) => f.motivo === 'parada').map((f) => f.nome);

  let p1: ReactNode;
  if (v.variacao === null) {
    p1 = (
      <>
        Nos últimos 12 meses fechados ({periodo}) {quem} <b>{brl(c.atual)}</b>, mas não há número nos
        mesmos meses um ano antes pra comparar.
      </>
    );
  } else if (v.base === 'total') {
    p1 = (
      <>
        Nos últimos 12 meses fechados ({periodo}) {quem} <b>{brl(v.atual)}</b>, contra{' '}
        <b>{brl(v.anterior)}</b> nos 12 meses anteriores ({rotuloPeriodo(c.mesesAntes)}).
      </>
    );
  } else if (v.base === 'sem-branco') {
    p1 = (
      <>
        Nos últimos 12 meses fechados ({periodo}) {quem} <b>{brl(v.atual)}</b>, contra{' '}
        <b>{brl(v.anterior)}</b> nos mesmos meses um ano antes. Ficaram de fora dessa conta, dos dois
        lados, {nMeses(c.pendentes)} em branco de {listaNomes(emBranco)} (sem número lançado).
        Contando esses meses como zero, a variação seria {pct(c.variacao)}.
      </>
    );
  } else {
    const inicio = unidade ? (h.inicio.get(unidade.id) ?? null) : null;
    const motivos: string[] = [];
    if (novas.length > 0 && inicio) motivos.push(`começou em ${rotuloMes(inicio)}`);
    if (c.pendentes > 0) motivos.push(`tem ${nMeses(c.pendentes)} em branco`);
    if (paradas.length > 0 && unidade?.encerradaDesde) {
      motivos.push(`parou em ${rotuloMes(unidade.encerradaDesde)}`);
    }
    p1 = (
      <>
        {sujeito} vendeu <b>{brl(c.atual)}</b> nos últimos 12 meses fechados ({periodo}). A comparação
        usa só {c.mb.meses === 1 ? 'o mês' : `os ${c.mb.meses} meses`} que {c.mb.meses === 1 ? 'tem' : 'têm'}{' '}
        número nos dois anos{motivos.length > 0 ? ` (${listaNomes(motivos)})` : ''}: <b>{brl(v.atual)}</b>{' '}
        contra <b>{brl(v.anterior)}</b>.
      </>
    );
  }

  const efeitos: string[] = [];
  if (novas.length > 0) efeitos.push(`casa nova (${listaNomes(novas)})`);
  if (paradas.length > 0) efeitos.push(`casa parada (${listaNomes(paradas)})`);
  const p2 =
    !umaUnidade && efeitos.length > 0 && c.mb.variacao !== null ? (
      <>
        Sem o efeito de {listaNomes(efeitos)} — só unidade e mês com número nos dois anos — a variação
        é <b className={corVar(c.mb.variacao)}>{pct(c.mb.variacao)}</b>: {brl(c.mb.atual)} contra{' '}
        {brl(c.mb.anterior)}.
      </>
    ) : null;

  const vt = veredito(r.trimestre, umaUnidade);
  const vm = veredito(r.ultimoMes, umaUnidade);
  const p3 =
    vt.variacao !== null || vm.variacao !== null ? (
      <>
        Ritmo recente: último trimestre ({rotuloPeriodo(r.trimestre.meses)}){' '}
        <b className={corVar(vt.variacao)}>{pct(vt.variacao)}</b>; {rotuloMes(h.mesFechado)}{' '}
        <b className={corVar(vm.variacao)}>{pct(vm.variacao)}</b> — sempre contra os mesmos meses um ano
        antes.
      </>
    ) : null;

  return (
    <div className={`rounded-xl border p-5 shadow-sm ${estado[v.tendencia].caixa}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-xl font-bold text-slate-900">{estado[v.tendencia].titulo}</h2>
        {v.variacao !== null && (
          <p className={`text-3xl font-bold tabular-nums ${corVar(v.variacao)}`}>{pct(v.variacao)}</p>
        )}
      </div>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-slate-700">
        <p>{p1}</p>
        {p2 && <p>{p2}</p>}
        {p3 && <p>{p3}</p>}
      </div>
    </div>
  );
}

// ---------- Indicadores ----------

function Kpi({ titulo, c, umaUnidade }: { titulo: string; c: Comparacao; umaUnidade: boolean }) {
  const v = veredito(c, umaUnidade);
  let nota: string;
  if (v.variacao === null) {
    nota = 'sem número um ano antes pra comparar';
  } else if (v.base === 'mesma-base') {
    nota = `só ${c.mb.meses === 1 ? 'o mês' : `os ${c.mb.meses} meses`} com número nos dois anos: ${compacto(v.atual)} contra ${compacto(v.anterior)}`;
  } else if (v.base === 'sem-branco') {
    nota = `contra ${compacto(v.anterior)} um ano antes, sem contar ${nMeses(c.pendentes)} em branco`;
  } else {
    nota = `contra ${compacto(v.anterior)} um ano antes`;
  }
  return (
    <div className={`${CARTAO} p-4`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className="text-[11px] text-slate-400">{rotuloPeriodo(c.meses)}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900" title={brl(c.atual)}>
        {compacto(c.atual)}
      </p>
      <p className={`mt-1 text-sm font-semibold tabular-nums ${corVar(v.variacao)}`}>{pct(v.variacao)}</p>
      <p className={`mt-0.5 ${NOTA}`}>{nota}</p>
    </div>
  );
}

// ---------- Curva de 12 meses ----------

function CartaoCurva({
  h,
  ids,
  comEventos,
  temEventos,
}: {
  h: Historico;
  ids: string[];
  comEventos: boolean;
  temEventos: boolean;
}) {
  const serie = serie12Meses(h, ids, comEventos);
  const referencia = comEventos && temEventos ? serie12Meses(h, ids, false) : null;
  let leitura: ReactNode = null;
  if (serie.length >= 2) {
    const ultimo = serie[serie.length - 1];
    const pico = serie.reduce((a, b) => (b.valor > a.valor ? b : a));
    if (pico.mes === ultimo.mes) {
      leitura = <>O acumulado de 12 meses está no ponto mais alto do histórico: {brl(ultimo.valor)}. </>;
    } else if (pico.valor > 0) {
      const abaixo = (1 - ultimo.valor / pico.valor) * 100;
      leitura = (
        <>
          O ponto mais alto foi em {rotuloMes(pico.mes)} ({compacto(pico.valor)}); hoje o acumulado está{' '}
          {abaixo.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
          abaixo dele.{' '}
        </>
      );
    }
  }
  return (
    <div className={CARTAO}>
      <div className={CABECA}>
        <h3 className={TITULO}>VGV acumulado em 12 meses</h3>
        <p className={SUBTITULO}>
          Cada ponto soma os 12 meses até ali — tira o efeito de alta e baixa temporada. Linha subindo =
          crescendo.
        </p>
      </div>
      <div className="p-4">
        <Grafico12Meses serie={serie} referencia={referencia} />
        <p className={`mt-2 ${NOTA}`}>
          {leitura}
          {referencia && 'Linha tracejada: a mesma curva sem eventos e festas. '}
          Mês em branco entra como zero na curva. Pare o mouse num ponto pra ver o valor.
        </p>
      </div>
    </div>
  );
}

// ---------- Ano a ano ----------

function TabelaAnos({
  h,
  ids,
  comEventos,
  ano,
  umaUnidade,
}: {
  h: Historico;
  ids: string[];
  comEventos: boolean;
  /** A comparação do ano corrente (a mesma do cartão), pra explicar a diferença. */
  ano: Comparacao;
  umaUnidade: boolean;
}) {
  const anos = porAno(h, ids, comEventos);
  if (anos.length === 0) return null;
  const ref = mesReferencia(h);
  const mostraRef = ref < 12;
  const mostraEventos = comEventos && anos.some((a) => a.eventos > 0);
  const ini = inicioDoEscopo(h, ids);
  const anoQuebrado = ini !== null && partesMes(ini).mes > 1 ? partesMes(ini).ano : null;
  const rotuloRef = ref === 1 ? 'Janeiro' : `Jan a ${MESES_CURTOS[ref - 1]}`;
  const maior = Math.max(1, ...anos.map((a) => (mostraRef ? a.ateRef : a.total)));
  const vAno = veredito(ano, umaUnidade);
  const avisaBranco = ano.pendentes > 0 && ano.variacao !== null && vAno.variacao !== null && vAno.base !== 'total';

  return (
    <div className={CARTAO}>
      <div className={CABECA}>
        <h3 className={TITULO}>Ano a ano</h3>
        <p className={SUBTITULO}>
          {mostraRef
            ? `"${rotuloRef}" é o mesmo pedaço de cada ano — o jeito justo de comparar ${partesMes(h.mesFechado).ano} (que ainda não acabou) com os anteriores.`
            : 'Todos os anos fechados.'}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className={THEAD}>
            <tr>
              <th className="px-3 py-2 text-left">Ano</th>
              {mostraRef && <th className="px-3 py-2 text-right">{rotuloRef}</th>}
              {mostraRef && <th className="px-3 py-2 text-right">Variação</th>}
              <th className="px-3 py-2 text-right">Ano inteiro</th>
              <th className="px-3 py-2 text-right">Variação</th>
              {mostraEventos && <th className="px-3 py-2 text-right">Eventos e festas</th>}
            </tr>
          </thead>
          <tbody>
            {anos.map((a, i) => {
              const ant = i > 0 ? anos[i - 1] : null;
              const vRef = ant ? variacao(a.ateRef, ant.ateRef) : null;
              const vTot = ant && a.completo ? variacao(a.total, ant.total) : null;
              const marca = anoQuebrado !== null && a.ano === anoQuebrado + 1 ? '*' : '';
              const barra = mostraRef ? a.ateRef : a.total;
              return (
                <tr key={a.ano} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {a.ano}
                    {anoQuebrado === a.ano && '*'}
                    {!a.completo && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">
                        em andamento
                      </span>
                    )}
                    <div className="mt-1 h-1 w-full max-w-[160px] rounded bg-slate-100">
                      <div
                        className={`h-1 rounded ${a.completo ? 'bg-slate-400' : 'bg-slate-900'}`}
                        style={{ width: `${Math.max(0, Math.min(100, (barra / maior) * 100))}%` }}
                      />
                    </div>
                  </td>
                  {mostraRef && <td className={`${NUM} text-slate-900`}>{brl(a.ateRef)}</td>}
                  {mostraRef && (
                    <td className={`${NUM} font-medium ${corVar(vRef)}`}>
                      {pct(vRef)}
                      {vRef !== null && marca}
                    </td>
                  )}
                  <td className={`${NUM} text-slate-900`}>
                    {a.completo ? brl(a.total) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={`${NUM} font-medium ${corVar(vTot)}`}>
                    {pct(vTot)}
                    {vTot !== null && marca}
                  </td>
                  {mostraEventos && (
                    <td className={`${NUM} text-slate-600`}>
                      {a.eventos > 0 ? brl(a.eventos) : <span className="text-slate-300">—</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {anoQuebrado !== null && ini !== null && (
        <p className={`border-t border-slate-100 px-4 py-2 ${NOTA}`}>
          * {anoQuebrado} começou em {rotuloMes(ini)}: não é ano cheio, então a variação de{' '}
          {anoQuebrado + 1} sai maior do que foi.
        </p>
      )}
      {avisaBranco && (
        <p className={`border-t border-slate-100 px-4 py-2 ${NOTA}`}>
          Nesta tabela, mês em branco conta como zero — por isso {partesMes(h.mesFechado).ano} aparece com{' '}
          {pct(ano.variacao)}. Comparando só o que tem número nos dois anos, a variação é {pct(vAno.variacao)}{' '}
          (a do cartão acima).
        </p>
      )}
    </div>
  );
}

// ---------- Mês a mês ----------

const CORES_ANOS = ['#cbd5e1', '#0ea5e9', '#0f172a'];

function MesAMes({ h, ids, comEventos }: { h: Historico; ids: string[]; comEventos: boolean }) {
  const m = matriz(h, ids, comEventos);
  const totais = new Map(porAno(h, ids, comEventos).map((a) => [a.ano, a]));
  const ultimos = m.anos.slice(-3);
  const linhas: LinhaAno[] = ultimos.map((ano, n) => {
    const idx = m.anos.indexOf(ano);
    const linha: LinhaAno = {
      ano,
      cor: CORES_ANOS[CORES_ANOS.length - ultimos.length + n],
      valores: m.linhas.map((l) => {
        const c = l[idx];
        return c.valor === null || c.parcial || c.futuro ? null : c.valor;
      }),
    };
    const iParcial = m.linhas.findIndex((l) => l[idx].parcial && l[idx].valor !== null);
    if (iParcial >= 0) {
      linha.parcial = { indice: iParcial, valor: m.linhas[iParcial][idx].valor ?? 0 };
    }
    return linha;
  });
  const temPendente = m.linhas.some((l) => l.some((c) => c.pendente && !c.parcial));

  return (
    <div className={CARTAO}>
      <div className={CABECA}>
        <h3 className={TITULO}>Mês a mês</h3>
        <p className={SUBTITULO}>
          Cada mês contra o mesmo mês do ano anterior — mostra a temporada e onde o ano está ganhando
          ou perdendo.
        </p>
      </div>
      <div className="p-4">
        <GraficoMesAMes linhas={linhas} />
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          {linhas.map((l) => (
            <span key={l.ano} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-4 rounded-sm" style={{ backgroundColor: l.cor }} />
              {l.ano}
            </span>
          ))}
          {linhas.some((l) => l.parcial) && <span>○ mês em andamento</span>}
        </div>
      </div>
      <div className="overflow-x-auto border-t border-slate-200">
        <table className="w-full text-xs" style={{ minWidth: `${90 + m.anos.length * 92}px` }}>
          <thead className={THEAD}>
            <tr>
              <th className="px-3 py-2 text-left">Mês</th>
              {m.anos.map((a) => (
                <th key={a} className="px-2 py-2 text-right">
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.linhas.map((linha, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-medium capitalize text-slate-700">{MESES_CURTOS[i]}</td>
                {linha.map((c) => (
                  <td key={c.mes} className="px-2 py-1.5 text-right tabular-nums">
                    {c.futuro ? null : c.valor === null ? (
                      c.pendente ? (
                        <span className="text-amber-600" title="Sem número lançado">
                          em branco
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )
                    ) : (
                      <>
                        <span
                          className={c.parcial ? 'text-slate-400' : 'text-slate-900'}
                          title={
                            brl(c.valor) +
                            (c.eventos > 0 ? ` · eventos e festas: ${brl(c.eventos)}` : '') +
                            (c.parcial ? ' · mês em andamento' : '')
                          }
                        >
                          {inteiro(c.valor)}
                          {c.parcial && '…'}
                        </span>
                        {c.pendente && !c.parcial && (
                          <span className="ml-0.5 text-amber-500" title="Tem unidade em branco neste mês">
                            •
                          </span>
                        )}
                        <span className={`block text-[10px] ${corVar(c.variacao)}`}>
                          {c.variacao === null ? ' ' : pct(c.variacao, 0)}
                        </span>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
              <td className="px-3 py-2">Total</td>
              {m.anos.map((a) => {
                const t = totais.get(a);
                return (
                  <td key={a} className="px-2 py-2 text-right tabular-nums" title={t ? brl(t.total) : undefined}>
                    {t ? inteiro(t.total) : '—'}
                    {t && !t.completo && (
                      <span className="block text-[10px] font-normal text-slate-400">
                        até {MESES_CURTOS[mesReferencia(h) - 1]}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className={`border-t border-slate-100 px-4 py-2 ${NOTA}`}>
        Valores em reais, sem centavos (pare o mouse pra ver o valor exato). O número com “…” é o mês em
        andamento e não entra no total.
        {temPendente && ' O ponto laranja marca mês em que alguma unidade está em branco.'}
      </p>
    </div>
  );
}

// ---------- Por unidade (só no escopo "Todas") ----------

function TabelaUnidades({
  h,
  unidades,
  comEventos,
  total12,
  rotuloUnidade,
}: {
  h: Historico;
  unidades: Unidade[];
  comEventos: boolean;
  total12: number;
  rotuloUnidade: (u: Unidade) => ReactNode;
}) {
  const ref = mesReferencia(h);
  let temAsterisco = false;
  const linhas = unidades.map((u) => {
    const ru = resumo(h, [u.id], comEventos);
    const v12 = veredito(ru.ultimos12, true);
    const vAno = veredito(ru.anoAteAgora, true);
    const vMes = veredito(ru.ultimoMes, true);
    if ([v12, vAno, vMes].some((v) => v.variacao !== null && v.base === 'mesma-base')) temAsterisco = true;
    return { u, ru, v12, vAno, vMes };
  });
  const celVar = (v: ReturnType<typeof veredito>) => (
    <td className={`${NUM} font-medium ${corVar(v.variacao)}`}>
      {pct(v.variacao)}
      {v.variacao !== null && v.base === 'mesma-base' && '*'}
    </td>
  );
  // Mês sem número lançado não é "R$ 0,00": em branco é diferente de zero.
  const valorMes = (u: Unidade, valor: number): ReactNode => {
    const s = situacao(h, u, h.mesFechado);
    if (s === 'numero') return brl(valor);
    if (s === 'pendente') return <span className="text-xs font-normal text-amber-700">em branco</span>;
    return <span className="text-slate-300">—</span>;
  };
  return (
    <div className={CARTAO}>
      <div className={CABECA}>
        <h3 className={TITULO}>Por unidade</h3>
        <p className={SUBTITULO}>Quem puxa o VGV pra cima e quem puxa pra baixo. Toque no nome pra abrir só a unidade.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className={THEAD}>
            <tr>
              <th className="px-3 py-2 text-left">Unidade</th>
              <th className="px-3 py-2 text-right">Últimos 12 meses</th>
              <th className="px-3 py-2 text-right">% do VGV</th>
              <th className="px-3 py-2 text-right">Variação</th>
              <th className="px-3 py-2 text-right">
                {partesMes(h.mesFechado).ano} até {MESES_CURTOS[ref - 1]}
              </th>
              <th className="px-3 py-2 text-right">Variação</th>
              <th className="px-3 py-2 text-right">{rotuloMes(h.mesFechado)}</th>
              <th className="px-3 py-2 text-right">Variação</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ u, ru, v12, vAno, vMes }) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  {rotuloUnidade(u)}
                  {u.encerradaDesde && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                      parou em {rotuloMes(u.encerradaDesde)}
                    </span>
                  )}
                </td>
                <td className={`${NUM} text-slate-900`}>{brl(ru.ultimos12.atual)}</td>
                <td className={`${NUM} text-slate-600`}>
                  {total12 > 0
                    ? `${((ru.ultimos12.atual / total12) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
                    : '—'}
                </td>
                {celVar(v12)}
                <td className={`${NUM} text-slate-900`}>{brl(ru.anoAteAgora.atual)}</td>
                {celVar(vAno)}
                <td className={`${NUM} text-slate-900`}>{valorMes(u, ru.ultimoMes.atual)}</td>
                {celVar(vMes)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {temAsterisco && (
        <p className={`border-t border-slate-100 px-4 py-2 ${NOTA}`}>
          * Unidade nova ou com mês em branco: a variação compara só os meses que têm número nos dois
          anos.
        </p>
      )}
    </div>
  );
}

function TabelaUnidadeAno({
  h,
  unidades,
  ids,
  comEventos,
  rotuloUnidade,
}: {
  h: Historico;
  unidades: Unidade[];
  ids: string[];
  comEventos: boolean;
  rotuloUnidade: (u: Unidade) => ReactNode;
}) {
  const geral = porAno(h, ids, comEventos);
  if (geral.length === 0) return null;
  const ref = mesReferencia(h);
  return (
    <div className={CARTAO}>
      <div className={CABECA}>
        <h3 className={TITULO}>Cada unidade, ano a ano</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: `${140 + geral.length * 104}px` }}>
          <thead className={THEAD}>
            <tr>
              <th className="px-3 py-2 text-left">Unidade</th>
              {geral.map((a) => (
                <th key={a.ano} className="px-2 py-2 text-right">
                  {a.ano}
                  {!a.completo && (
                    <span className="block text-[10px] font-normal normal-case">até {MESES_CURTOS[ref - 1]}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {unidades.map((u) => {
              const dela = new Map(porAno(h, [u.id], comEventos).map((a) => [a.ano, a]));
              return (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-sm">{rotuloUnidade(u)}</td>
                  {geral.map((a) => {
                    const x = dela.get(a.ano);
                    return (
                      <td key={a.ano} className="px-2 py-2 text-right tabular-nums text-slate-900" title={x ? brl(x.total) : undefined}>
                        {x && (x.meses > 0 || x.total !== 0) ? inteiro(x.total) : <span className="text-slate-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
              <td className="px-3 py-2 text-sm">VGV</td>
              {geral.map((a) => (
                <td key={a.ano} className="px-2 py-2 text-right tabular-nums" title={brl(a.total)}>
                  {inteiro(a.total)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- De onde vêm os números ----------

function Notas({ h, unidades, comEventos }: { h: Historico; unidades: Unidade[]; comEventos: boolean }) {
  const origem = (u: Unidade): string => {
    const ini = h.inicio.get(u.id) ?? null;
    if (ini === null) return 'ainda sem número';
    const partes: string[] = [];
    if (u.filialId && u.sistemaDesde) {
      if (ini < u.sistemaDesde) {
        partes.push(`planilha de ${rotuloMes(ini)} a ${rotuloMes(somaMeses(u.sistemaDesde, -1))}`);
      }
      partes.push(`PDV do sistema desde ${rotuloMes(u.sistemaDesde)}`);
    } else {
      partes.push(`digitado (planilha) desde ${rotuloMes(ini)}`);
    }
    if (u.encerradaDesde) partes.push(`parou em ${rotuloMes(u.encerradaDesde)}`);
    return partes.join('; ');
  };
  return (
    <div className={`${CARTAO} p-4`}>
      <h3 className={TITULO}>De onde vêm os números</h3>
      <ul className="mt-2 space-y-1 text-xs text-slate-600">
        {unidades.map((u) => (
          <li key={u.id}>
            <b className="font-medium text-slate-800">{u.nome}:</b> {origem(u)}.
          </li>
        ))}
      </ul>
      <ul className={`mt-3 list-disc space-y-0.5 pl-4 ${NOTA}`}>
        <li>PDV = soma das contas fechadas no mês (hora de Brasília), sem as apagadas.</li>
        <li>
          O mês em andamento ({rotuloMes(h.mesAtual)}) aparece na tabela, mas não entra em nenhuma
          comparação.
        </li>
        <li>Toda variação é contra os mesmos meses um ano antes. Entre −3% e +3% conta como estável.</li>
        <li>
          {comEventos
            ? 'Eventos e festas são vendas fora do PDV, lançadas à parte — o filtro "Só operação" tira elas da conta.'
            : 'Você está vendo só a operação: eventos e festas (vendas fora do PDV) estão fora da conta.'}
        </li>
      </ul>
    </div>
  );
}

// ---------- Relatório ----------

export function Relatorio({
  h,
  ids,
  comEventos,
  unidade,
  rotuloUnidade = (u) => u.nome,
}: {
  h: Historico;
  /** Unidades do escopo (todas, ou só a escolhida). */
  ids: string[];
  comEventos: boolean;
  /** Preenchido quando o escopo é uma unidade só. */
  unidade: Unidade | null;
  /** Como desenhar o nome da unidade nas tabelas (a página põe um link). */
  rotuloUnidade?: (u: Unidade) => ReactNode;
}) {
  const unidades = h.unidades.filter((u) => ids.includes(u.id));
  if (inicioDoEscopo(h, ids) === null) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        {unidade ? `${unidade.nome} ainda não tem` : 'Ainda não há'} nenhum mês com número. Lance os valores em
        “Lançar e corrigir”, logo abaixo.
      </p>
    );
  }
  const r = resumo(h, ids, comEventos);
  const umaUnidade = unidade !== null;
  const temEventos = h.lancamentos.some((l) => l.tipo === 'EXTRA' && ids.includes(l.unidadeId));
  const ref = mesReferencia(h);

  return (
    <div className="space-y-6">
      <CaixaVeredito h={h} r={r} unidade={unidade} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Últimos 12 meses" c={r.ultimos12} umaUnidade={umaUnidade} />
        <Kpi
          titulo={`${partesMes(h.mesFechado).ano} até ${MESES_CURTOS[ref - 1]}`}
          c={r.anoAteAgora}
          umaUnidade={umaUnidade}
        />
        <Kpi titulo="Último trimestre" c={r.trimestre} umaUnidade={umaUnidade} />
        <Kpi titulo="Último mês fechado" c={r.ultimoMes} umaUnidade={umaUnidade} />
      </div>
      <CartaoCurva h={h} ids={ids} comEventos={comEventos} temEventos={temEventos} />
      <TabelaAnos h={h} ids={ids} comEventos={comEventos} ano={r.anoAteAgora} umaUnidade={umaUnidade} />
      <MesAMes h={h} ids={ids} comEventos={comEventos} />
      {!umaUnidade && unidades.length > 1 && (
        <>
          <TabelaUnidades
            h={h}
            unidades={unidades}
            comEventos={comEventos}
            total12={r.ultimos12.atual}
            rotuloUnidade={rotuloUnidade}
          />
          <TabelaUnidadeAno
            h={h}
            unidades={unidades}
            ids={ids}
            comEventos={comEventos}
            rotuloUnidade={rotuloUnidade}
          />
        </>
      )}
      <Notas h={h} unidades={unidades} comEventos={comEventos} />
    </div>
  );
}

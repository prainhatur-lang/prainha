'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtHoras, fmtSaldo, folgasDaJornada, lerHoras, minutosSemana } from '@/lib/rh/banco-horas';
import { createClient } from '@/lib/supabase/client';
import { AtestadoCelularPainel } from './atestado-celular-painel';

/** Tipo da pessoa pro filtro (pedido do dono 05/11/2026) — mesma regra do
 *  filtro do /rh/ponto/relatorio. */
export type TipoPessoa = 'clt' | '12x36' | 'intermitente' | 'diarista' | 'outros';
const TIPOS: { id: TipoPessoa; txt: string; dica: string }[] = [
  { id: 'clt', txt: 'CLT', dica: 'carteira assinada, mensalista' },
  { id: '12x36', txt: '12x36', dica: 'jornada com 12x36 no nome' },
  { id: 'intermitente', txt: 'Intermitente', dica: 'carteira assinada, contrato intermitente' },
  { id: 'diarista', txt: 'Diarista', dica: 'papel diarista na folha' },
  { id: 'outros', txt: 'Sem registro / outros', dica: 'não é registrado nem diarista (ex.: sem folha do contador)' },
];

export interface LinhaPessoa {
  id: string;
  nome: string;
  cargo: string | null;
  regime: string | null;
  tipoPessoa?: TipoPessoa;
  jornadaId: string | null;
  jornadaNome: string | null;
  jornadaTipo: string | null;
  jornadaDesde: string | null;
  /** Sem jornada: o banco usa a escala do mês (7h20 por dia de trabalho). */
  escalaMes?: { desde: string; ate: string; diasTrabalho: number; folgas: number } | null;
  /** Saldo que veio do Stelanto na virada; null = não veio saldo. */
  inicialMin: number | null;
  inicialDia: string | null;
  inicialDescricao: string | null;
  acertosMin: number;
  contaDesde: string;
  previstoMin: number;
  trabalhadoMin: number;
  semBatidaDias: number;
  semBatidaMin: number;
  incompletos: number;
  /** Intervalo obrigatório (03/11/2026): dias > 6h sem intervalo, pendentes (contam 0). */
  semIntervaloDias?: number;
  movimentoMin: number;
  saldoMin: number;
  /** Mês escolhido no seletor (05/11/2026): saldo no começo, o que mexeu no mês e saldo no fim. */
  mes?: LinhaMes | null;
  /** Atestado (21/10/2026): minutos abonados no banco e dias cobertos desde a virada. */
  abonadoMin?: number;
  atestadoDias?: number;
  atestados?: AtestadoPessoa[];
  lancamentos: { id: string; dia: string; minutos: number; tipo: string; descricao: string | null }[];
}

export interface LinhaMes {
  ini: string;
  fim: string;
  saldoAntesMin: number;
  acertosMin: number;
  previstoMin: number;
  trabalhadoMin: number;
  abonadoMin: number;
  semBatidaDias: number;
  semBatidaMin: number;
  movimentoMin: number;
  saldoFimMin: number;
}

export interface AtestadoPessoa {
  id: string;
  dataInicio: string;
  dataFim: string;
  descricao: string | null;
  arquivoNome: string | null;
  temArquivo: boolean;
  abona?: boolean;
  origem?: string;
}

interface Jornada {
  id: string;
  nome: string;
  tipo: string;
  minSeg: number;
  minTer: number;
  minQua: number;
  minQui: number;
  minSex: number;
  minSab: number;
  minDom: number;
  origem: string;
  pessoas: number;
}

interface Props {
  /** casa da tela — liga o "📱 Pelo celular" (QR do atestado) */
  filialId?: string;
  hoje: string;
  podeLancar: boolean;
  /** lança/cancela atestado ('ponto.corrigir' ou 'ponto.atestado'); sem isso vale podeLancar */
  podeAtestado?: boolean;
  linhas: LinhaPessoa[];
  jornadas: Jornada[];
  /** Meses que dá pra escolher ('AAAA-MM', mais novo primeiro) e o escolhido. */
  meses?: string[];
  mesSel?: string | null;
  filialNome?: string;
}

const NOME_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function nomeMes(ym: string): string {
  const [a, m] = ym.split('-').map(Number);
  return `${NOME_MES[m - 1]}/${a}`;
}
const TIPO_TXT: Record<TipoPessoa, string> = {
  clt: 'CLT',
  '12x36': '12x36',
  intermitente: 'Intermitente',
  diarista: 'Diarista',
  outros: 'Sem registro / outros',
};

const TIPO_LABEL: Record<string, string> = {
  saldo_inicial: 'Saldo do Stelanto',
  ajuste: 'Acerto',
  pagamento: 'Horas pagas',
  folga: 'Folga compensada',
};
const DIAS = [
  ['minSeg', 'Seg'],
  ['minTer', 'Ter'],
  ['minQua', 'Qua'],
  ['minQui', 'Qui'],
  ['minSex', 'Sex'],
  ['minSab', 'Sáb'],
  ['minDom', 'Dom'],
] as const;

function dmy(ymd: string | null): string {
  return ymd ? ymd.split('-').reverse().join('/') : '—';
}
function corSaldo(min: number): string {
  if (min > 0) return 'text-emerald-700';
  if (min < 0) return 'text-rose-700';
  return 'text-slate-500';
}

async function enviar(body: unknown): Promise<string | null> {
  const res = await fetch('/api/rh/banco-horas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const j = await res.json().catch(() => null);
  return j?.error ?? 'Não deu pra salvar';
}

export function BancoHorasManager({ filialId, hoje, podeLancar, podeAtestado: podeAtestadoProp, linhas, jornadas, meses = [], mesSel = null, filialNome }: Props) {
  const podeAtestado = podeAtestadoProp ?? podeLancar;
  const router = useRouter();
  const [aberta, setAberta] = useState<string | null>(null);
  const [acerto, setAcerto] = useState<LinhaPessoa | null>(null);
  const [escala, setEscala] = useState<LinhaPessoa | null>(null);
  const [novaJornada, setNovaJornada] = useState(false);
  // undefined = fechado; null = aberto sem pessoa escolhida.
  const [atestado, setAtestado] = useState<LinhaPessoa | null | undefined>(undefined);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [celular, setCelular] = useState(false);
  // Filtro por tipo (nenhum marcado = todos).
  const [tiposSel, setTiposSel] = useState<TipoPessoa[]>([]);

  const todosAtestados = linhas
    .flatMap((l) => (l.atestados ?? []).map((a) => ({ ...a, nome: l.nome })))
    .sort((a, b) => (a.dataInicio < b.dataInicio ? 1 : -1));

  async function cancelarAtestado(id: string, nome: string) {
    const motivo = window.prompt(`Cancelar o atestado de ${nome}? Diga o motivo:`);
    if (!motivo) return;
    if (motivo.trim().length < 5) return window.alert('Motivo muito curto (pelo menos 5 letras).');
    setCancelando(id);
    const res = await fetch('/api/rh/atestado', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acao: 'cancelar', id, motivo: motivo.trim() }),
    });
    setCancelando(null);
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      return window.alert(j?.error ?? 'Não deu pra cancelar');
    }
    router.refresh();
  }

  const porTipo = new Map<TipoPessoa, number>();
  for (const l of linhas) {
    const t = l.tipoPessoa ?? 'outros';
    porTipo.set(t, (porTipo.get(t) ?? 0) + 1);
  }
  const filtrando = tiposSel.length > 0 && tiposSel.length < TIPOS.length;
  const visiveis = filtrando ? linhas.filter((l) => tiposSel.includes(l.tipoPessoa ?? 'outros')) : linhas;
  const mensalistas = visiveis.filter((l) => l.jornadaTipo === 'fixa');
  const intermitentes = visiveis.filter((l) => l.jornadaTipo === 'intermitente');
  const semEscala = visiveis.filter((l) => !l.jornadaId && !l.escalaMes);
  const alternarTipo = (t: TipoPessoa) =>
    setTiposSel((at) => (at.includes(t) ? at.filter((x) => x !== t) : [...at, t]));
  const somaSaldo = mensalistas.reduce((s, l) => s + l.saldoMin, 0);
  const somaMes = mensalistas.reduce((s, l) => s + (l.mes?.saldoFimMin ?? 0), 0);
  const [exportando, setExportando] = useState(false);

  function trocarMes(ym: string) {
    const q = new URLSearchParams();
    if (filialId) q.set('filialId', filialId);
    if (ym) q.set('mes', ym);
    router.push(`?${q.toString()}`);
  }

  // Exporta pro Excel o que está na tela (casa, mês e filtro de tipo).
  async function exportar() {
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const tipoDe = (l: LinhaPessoa) => TIPO_TXT[l.tipoPessoa ?? 'outros'];
      const horasDec = (min: number) => Math.round((min / 60) * 100) / 100;
      const banco = mesSel
        ? mensalistas.map((l) => {
            const x = l.mes!;
            return {
              Pessoa: l.nome,
              Cargo: l.cargo ?? '',
              Tipo: tipoDe(l),
              Escala: l.jornadaNome ?? '',
              'Saldo no começo do mês': fmtSaldo(x.saldoAntesMin),
              'Acertos no mês': fmtSaldo(x.acertosMin),
              'Previsto no mês': fmtHoras(x.previstoMin),
              'Batido no mês': fmtHoras(x.trabalhadoMin),
              'Atestado abonado': fmtHoras(x.abonadoMin),
              'Dias sem batida': x.semBatidaDias,
              'Movimento do mês': fmtSaldo(x.movimentoMin),
              'Saldo no fim do mês': fmtSaldo(x.saldoFimMin),
              'Saldo no fim (horas decimais)': horasDec(x.saldoFimMin),
            };
          })
        : mensalistas.map((l) => ({
            Pessoa: l.nome,
            Cargo: l.cargo ?? '',
            Tipo: tipoDe(l),
            Escala: l.jornadaNome ?? '',
            'Veio do Stelanto': l.inicialMin === null ? '' : fmtSaldo(l.inicialMin),
            Acertos: fmtSaldo(l.acertosMin),
            'Conta desde': dmy(l.contaDesde),
            Previsto: fmtHoras(l.previstoMin),
            Batido: fmtHoras(l.trabalhadoMin),
            'Atestado abonado': fmtHoras(l.abonadoMin ?? 0),
            'Dias sem batida': l.semBatidaDias,
            'Desde a virada': fmtSaldo(l.movimentoMin),
            'Saldo hoje': fmtSaldo(l.saldoMin),
            'Saldo hoje (horas decimais)': horasDec(l.saldoMin),
          }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(banco.length ? banco : [{ Pessoa: 'Ninguém' }]), 'Banco de horas');
      if (intermitentes.length) {
        const inter = intermitentes.map((l) => ({
          Pessoa: l.nome,
          Cargo: l.cargo ?? '',
          Tipo: tipoDe(l),
          [mesSel ? 'Horas batidas no mês' : 'Horas batidas desde a virada']: fmtHoras(mesSel ? (l.mes?.trabalhadoMin ?? 0) : l.trabalhadoMin),
          'Horas (decimal)': horasDec(mesSel ? (l.mes?.trabalhadoMin ?? 0) : l.trabalhadoMin),
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inter), 'Intermitentes');
      }
      const casa = (filialNome ?? 'casa').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      XLSX.writeFile(wb, `banco-horas-${casa}-${mesSel ?? `ate-${hoje}`}.xlsx`);
    } catch (e) {
      console.error(e);
      window.alert('Não deu pra gerar a planilha.');
    } finally {
      setExportando(false);
    }
  }

  function feito() {
    setAcerto(null);
    setEscala(null);
    setNovaJornada(false);
    setAtestado(undefined);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      {/* ---------- filtro por tipo ---------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Mostrar</span>
        {TIPOS.map((t) => {
          const marcado = filtrando && tiposSel.includes(t.id);
          const n = porTipo.get(t.id) ?? 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => alternarTipo(t.id)}
              title={t.dica}
              role="checkbox"
              aria-checked={marcado}
              className={`flex items-center gap-1.5 text-sm ${n ? 'text-slate-700' : 'text-slate-400'} hover:text-slate-900`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded border text-[11px] leading-none ${
                  marcado ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
                }`}
              >
                {marcado ? '✓' : ''}
              </span>
              {t.txt} <span className="text-xs text-slate-400">({n})</span>
            </button>
          );
        })}
        {filtrando ? (
          <button type="button" onClick={() => setTiposSel([])} className="text-sm text-blue-600 hover:underline">
            limpar (todos)
          </button>
        ) : (
          <span className="text-xs text-slate-400">nenhum marcado = todos</span>
        )}
      </div>

      {/* ---------- mês e exportar ---------- */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <label className="text-xs font-medium uppercase tracking-wide text-slate-400" htmlFor="bh-mes">
          Ver mês
        </label>
        <select
          id="bh-mes"
          value={mesSel ?? ''}
          onChange={(e) => trocarMes(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
        >
          <option value="">Saldo de hoje (tudo)</option>
          {meses.map((m) => (
            <option key={m} value={m}>
              {nomeMes(m)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportar}
          disabled={exportando}
          className="ml-auto rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
          title="Baixa a planilha do que está na tela (casa, mês e filtro de tipo)"
        >
          {exportando ? 'Gerando…' : '⬇ Exportar Excel'}
        </button>
      </div>

      {mesSel && (
        <div className="rounded-xl border border-indigo-200 bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-indigo-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                📅 Banco de horas de {nomeMes(mesSel)} <span className="font-normal text-slate-500">({mensalistas.length})</span>
              </h2>
              {mensalistas[0]?.mes && (
                <p className="mt-0.5 text-xs text-slate-500">
                  Conta de {dmy(mensalistas[0].mes.ini)} a {dmy(mensalistas[0].mes.fim)}
                  {mesSel === hoje.slice(0, 7) ? ' (mês em andamento: até ontem)' : ''}
                </p>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Soma da casa no fim do mês: <span className={`font-semibold ${corSaldo(somaMes)}`}>{fmtSaldo(somaMes)}</span>
            </p>
          </div>
          {mensalistas.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">Ninguém com banco de horas nesta casa.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Pessoa</th>
                    <th className="px-3 py-2 text-right">Saldo no começo</th>
                    <th className="px-3 py-2 text-right">Acertos no mês</th>
                    <th className="px-3 py-2 text-right">Previsto</th>
                    <th className="px-3 py-2 text-right">Batido</th>
                    <th className="px-3 py-2 text-right">Movimento do mês</th>
                    <th className="px-3 py-2 text-right">Saldo no fim</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mensalistas.map((l) => {
                    const x = l.mes;
                    if (!x) return null;
                    return (
                      <tr key={l.id} className="align-top hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <div className="font-medium text-slate-900">{l.nome}</div>
                          {l.cargo && <div className="text-xs text-slate-500">{l.cargo}</div>}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${corSaldo(x.saldoAntesMin)}`}>{fmtSaldo(x.saldoAntesMin)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${corSaldo(x.acertosMin)}`}>
                          {x.acertosMin === 0 ? <span className="text-slate-300">—</span> : fmtSaldo(x.acertosMin)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtHoras(x.previstoMin)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                          {fmtHoras(x.trabalhadoMin)}
                          {x.semBatidaDias > 0 && (
                            <div className="text-[11px] text-amber-700">
                              {x.semBatidaDias} dia{x.semBatidaDias > 1 ? 's' : ''} sem batida
                            </div>
                          )}
                          {x.abonadoMin > 0 && <div className="text-[11px] text-sky-700">🩺 +{fmtHoras(x.abonadoMin)} abonadas</div>}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${corSaldo(x.movimentoMin)}`}>{fmtSaldo(x.movimentoMin)}</td>
                        <td className={`px-3 py-2 text-right text-base font-semibold tabular-nums ${corSaldo(x.saldoFimMin)}`}>
                          {fmtSaldo(x.saldoFimMin)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {intermitentes.length > 0 && (
            <div className="border-t border-indigo-100 px-4 py-3">
              <p className="mb-1 text-xs text-slate-500">Intermitentes — horas batidas no mês:</p>
              <ul className="grid gap-x-6 text-sm sm:grid-cols-2">
                {intermitentes.map((l) => (
                  <li key={l.id} className="flex justify-between gap-2 border-b border-slate-100 py-1">
                    <span className="truncate text-slate-800">{l.nome}</span>
                    <span className="tabular-nums text-slate-600">{fmtHoras(l.mes?.trabalhadoMin ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ---------- atestados ---------- */}
      <div className="rounded-xl border border-sky-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              🩺 Atestados <span className="font-normal text-slate-500">({todosAtestados.length})</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Dia de atestado conta como cumprido no banco de horas e aparece no ponto e na escala do mês.
            </p>
          </div>
          {podeAtestado && (
            <div className="flex flex-wrap items-center gap-2">
              {filialId && (
                <button
                  type="button"
                  onClick={() => setCelular((v) => !v)}
                  className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-50"
                  title="QR pro celular: tira a foto do atestado e o sistema lê quem é e os dias"
                >
                  📱 Pelo celular
                </button>
              )}
              <button
                type="button"
                onClick={() => setAtestado(null)}
                className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800"
              >
                Lançar atestado
              </button>
            </div>
          )}
        </div>
        {celular && filialId && <AtestadoCelularPainel filialId={filialId} onFechar={() => setCelular(false)} />}
        {todosAtestados.length === 0 ? (
          <p className="px-4 py-3 text-xs text-slate-400">Nenhum atestado lançado no último ano.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {todosAtestados.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div>
                  <span className="font-medium text-slate-900">{a.nome}</span>
                  <span className="ml-2 tabular-nums text-slate-600">
                    {a.dataInicio === a.dataFim ? dmy(a.dataInicio) : `${dmy(a.dataInicio)} a ${dmy(a.dataFim)}`}
                  </span>
                  <span className="ml-1 text-xs text-slate-400">({diasEntre(a.dataInicio, a.dataFim)} dia{diasEntre(a.dataInicio, a.dataFim) > 1 ? 's' : ''})</span>
                  {a.abona === false && (
                    <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">sem abono</span>
                  )}
                  {a.origem === 'inss' && (
                    <span className="ml-2 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-800" title="Afastamento pelo INSS: sai do salário desde o 1º dia">INSS</span>
                  )}
                  {a.origem === 'celular' && (
                    <span className="ml-1 text-[10px] text-slate-400" title="Enviado pelo celular">📱</span>
                  )}
                  {a.descricao && <div className="text-xs text-slate-500">{a.descricao}</div>}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {a.temArquivo ? (
                    <a href={`/api/rh/atestado?id=${a.id}`} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">
                      ver foto
                    </a>
                  ) : (
                    <span className="text-amber-700">sem foto</span>
                  )}
                  {podeAtestado && (
                    <button
                      type="button"
                      disabled={cancelando === a.id}
                      onClick={() => cancelarAtestado(a.id, a.nome)}
                      className="rounded border border-slate-200 px-2 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                    >
                      cancelar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------- mensalistas ---------- */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Mensalistas com banco de horas <span className="font-normal text-slate-500">({mensalistas.length})</span>
          </h2>
          <p className="text-xs text-slate-500">
            Soma da casa: <span className={`font-semibold ${corSaldo(somaSaldo)}`}>{fmtSaldo(somaSaldo)}</span>
            <span className="ml-2">positivo = a casa deve hora · negativo = a pessoa deve</span>
          </p>
        </div>
        {mensalistas.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">Ninguém com escala fixa nesta casa ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Pessoa</th>
                  <th className="px-3 py-2 text-left">Escala</th>
                  <th className="px-3 py-2 text-right">Veio do Stelanto</th>
                  <th className="px-3 py-2 text-right">Acertos</th>
                  <th className="px-3 py-2 text-right">Previsto</th>
                  <th className="px-3 py-2 text-right">Batido</th>
                  <th className="px-3 py-2 text-right">Desde a virada</th>
                  <th className="px-3 py-2 text-right">Saldo hoje</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mensalistas.map((l) => {
                  const j = jornadas.find((x) => x.id === l.jornadaId);
                  return (
                    <Fragment key={l.id}>
                      <tr className="align-top hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => setAberta(aberta === l.id ? null : l.id)}
                            className="text-left font-medium text-slate-900 hover:underline"
                          >
                            {l.nome}
                          </button>
                          {l.cargo && <div className="text-xs text-slate-500">{l.cargo}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          <div className="text-slate-800">{l.jornadaNome}</div>
                          {j && (
                            <div>
                              {fmtHoras(minutosSemana(j))}/semana · {folgasDaJornada(j)}
                            </div>
                          )}
                          {!j && l.escalaMes && (
                            <div>
                              7h20 por dia de trabalho · {dmy(l.escalaMes.desde)} a {dmy(l.escalaMes.ate)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.inicialMin === null ? (
                            <span className="text-xs text-slate-400">não veio</span>
                          ) : (
                            <>
                              <span className={corSaldo(l.inicialMin)}>{fmtSaldo(l.inicialMin)}</span>
                              <div className="text-[11px] text-slate-400">em {dmy(l.inicialDia)}</div>
                            </>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${corSaldo(l.acertosMin)}`}>
                          {l.acertosMin === 0 ? <span className="text-slate-300">—</span> : fmtSaldo(l.acertosMin)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtHoras(l.previstoMin)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                          {fmtHoras(l.trabalhadoMin)}
                          {l.semBatidaDias > 0 && (
                            <div className="text-[11px] text-amber-700">
                              {l.semBatidaDias} dia{l.semBatidaDias > 1 ? 's' : ''} sem batida
                            </div>
                          )}
                          {l.incompletos > 0 && (
                            <div className="text-[11px] text-amber-700">
                              {l.incompletos} dia{l.incompletos > 1 ? 's' : ''} sem saída
                            </div>
                          )}
                          {(l.semIntervaloDias ?? 0) > 0 && (
                            <div className="text-[11px] text-red-700" title="Mais de 6h sem bater o intervalo: o dia conta 0 até lançar o intervalo em RH → Ponto">
                              {l.semIntervaloDias} dia{(l.semIntervaloDias ?? 0) > 1 ? 's' : ''} sem intervalo (pendente)
                            </div>
                          )}
                          {(l.atestadoDias ?? 0) > 0 && (
                            <div className="text-[11px] text-sky-700">
                              🩺 {l.atestadoDias} dia{(l.atestadoDias ?? 0) > 1 ? 's' : ''} de atestado
                              {(l.abonadoMin ?? 0) > 0 && ` (+${fmtHoras(l.abonadoMin ?? 0)} abonadas)`}
                            </div>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${corSaldo(l.movimentoMin)}`}>
                          {fmtSaldo(l.movimentoMin)}
                        </td>
                        <td className={`px-3 py-2 text-right text-base font-semibold tabular-nums ${corSaldo(l.saldoMin)}`}>
                          {fmtSaldo(l.saldoMin)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {podeLancar && (
                            <>
                              <button
                                type="button"
                                onClick={() => setAcerto(l)}
                                className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                              >
                                Acerto
                              </button>
                              <button
                                type="button"
                                onClick={() => setEscala(l)}
                                className="ml-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                              >
                                Escala
                              </button>
                              <button
                                type="button"
                                onClick={() => setAtestado(l)}
                                title="Lançar atestado"
                                className="ml-1 rounded border border-sky-200 px-2 py-1 text-xs text-sky-800 hover:bg-sky-50"
                              >
                                🩺
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {aberta === l.id && (
                        <tr className="bg-slate-50">
                          <td colSpan={9} className="px-4 py-3 text-xs text-slate-600">
                            {l.inicialDescricao && <p className="mb-2">{l.inicialDescricao}</p>}
                            <p className="mb-2">
                              Conta do ponto próprio de {dmy(l.contaDesde)} até ontem: previsto {fmtHoras(l.previstoMin)},
                              batido {fmtHoras(l.trabalhadoMin)}
                              {l.semBatidaDias > 0 &&
                                ` — ${fmtHoras(l.semBatidaMin)} do que falta são ${l.semBatidaDias} dia(s) de escala sem nenhuma batida (folga trocada, falta ou esqueceu de bater: conferir no Ponto da semana)`}
                              {(l.abonadoMin ?? 0) > 0 && ` · atestado abonou ${fmtHoras(l.abonadoMin ?? 0)} em ${l.atestadoDias} dia(s)`}
                              .
                            </p>
                            {l.lancamentos.length === 0 ? (
                              <p className="text-slate-400">Nenhum lançamento.</p>
                            ) : (
                              <table className="w-full max-w-3xl">
                                <tbody>
                                  {l.lancamentos.map((x) => (
                                    <tr key={x.id} className="border-t border-slate-200">
                                      <td className="py-1 pr-3 tabular-nums">{dmy(x.dia)}</td>
                                      <td className="py-1 pr-3">{TIPO_LABEL[x.tipo] ?? x.tipo}</td>
                                      <td className={`py-1 pr-3 text-right tabular-nums ${corSaldo(x.minutos)}`}>
                                        {fmtSaldo(x.minutos)}
                                      </td>
                                      <td className="py-1 text-slate-500">{x.tipo === 'saldo_inicial' ? '' : x.descricao}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------- sem escala ---------- */}
      {semEscala.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50">
          <div className="border-b border-amber-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-amber-900">
              Sem escala definida <span className="font-normal">({semEscala.length})</span>
            </h2>
            <p className="mt-0.5 text-xs text-amber-800">
              Enquanto não tiver escala, o banco de horas dessa pessoa não é contado. Quem tem
              a escala do mês salva em RH → Escala do mês já sai desta lista.
            </p>
          </div>
          <ul className="divide-y divide-amber-100">
            {semEscala.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <div>
                  <span className="font-medium text-slate-900">{l.nome}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {[l.cargo, l.regime === 'clt_mensal' ? 'CLT mensal' : l.regime === 'intermitente_hora' ? 'intermitente' : 'sem regime no cadastro']
                      .filter(Boolean)
                      .join(' · ')}
                    {l.trabalhadoMin > 0 && ` · ${fmtHoras(l.trabalhadoMin)} batidas desde a virada`}
                  </span>
                </div>
                {podeLancar && (
                  <button
                    type="button"
                    onClick={() => setEscala(l)}
                    className="rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                  >
                    Definir escala
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- intermitentes ---------- */}
      {intermitentes.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Intermitentes <span className="font-normal text-slate-500">({intermitentes.length})</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Recebem pela hora trabalhada — não têm banco de horas. Horas batidas no ponto próprio desde a virada:
            </p>
          </div>
          <ul className="grid gap-x-6 px-4 py-2 text-sm sm:grid-cols-2">
            {intermitentes.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5">
                <span className="truncate text-slate-800">{l.nome}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-slate-600">{fmtHoras(l.trabalhadoMin)}</span>
                  {podeLancar && (
                    <button
                      type="button"
                      onClick={() => setEscala(l)}
                      className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                    >
                      Escala
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- escalas ---------- */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Escalas cadastradas</h2>
            <p className="mt-0.5 text-xs text-slate-500">Valem pras três casas. Horas previstas por dia; em branco = folga.</p>
          </div>
          {podeLancar && (
            <button
              type="button"
              onClick={() => setNovaJornada(true)}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
            >
              Nova escala
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Escala</th>
                {DIAS.map(([, rot]) => (
                  <th key={rot} className="px-2 py-2 text-center">
                    {rot}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Semana</th>
                <th className="px-3 py-2 text-right">Pessoas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jornadas.map((j) => (
                <tr key={j.id}>
                  <td className="px-4 py-2 text-slate-800">
                    {j.nome}
                    {j.origem === 'stelanto' && <span className="ml-2 text-[11px] text-slate-400">veio do Stelanto</span>}
                  </td>
                  {DIAS.map(([campo, rot]) => (
                    <td key={rot} className="px-2 py-2 text-center tabular-nums text-slate-600">
                      {j.tipo !== 'fixa' ? '·' : j[campo] > 0 ? fmtHoras(j[campo]) : <span className="text-slate-300">folga</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {j.tipo === 'fixa' ? fmtHoras(minutosSemana(j)) : 'por hora'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{j.pessoas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {acerto && <ModalAcerto pessoa={acerto} hoje={hoje} onFechar={() => setAcerto(null)} onFeito={feito} />}
      {escala && (
        <ModalEscala pessoa={escala} hoje={hoje} jornadas={jornadas} onFechar={() => setEscala(null)} onFeito={feito} />
      )}
      {novaJornada && <ModalNovaJornada onFechar={() => setNovaJornada(false)} onFeito={feito} />}
      {atestado !== undefined && (
        <ModalAtestado pessoas={linhas} inicial={atestado} hoje={hoje} onFechar={() => setAtestado(undefined)} onFeito={feito} />
      )}
    </div>
  );
}

function Modal({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onFechar}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900">{titulo}</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded px-1.5 text-lg leading-none text-slate-400 hover:bg-slate-100">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const CAMPO = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000) + 1;
}

async function chamarAtestado(body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch('/api/rh/atestado', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new Error(String(j?.error ?? 'Não deu pra salvar'));
  return j ?? {};
}

function ModalAtestado({
  pessoas,
  inicial,
  hoje,
  onFechar,
  onFeito,
}: {
  pessoas: LinhaPessoa[];
  inicial: LinhaPessoa | null;
  hoje: string;
  onFechar: () => void;
  onFeito: () => void;
}) {
  const [pessoaId, setPessoaId] = useState(inicial?.id ?? '');
  const [de, setDe] = useState(hoje);
  const [ate, setAte] = useState(hoje);
  const [descricao, setDescricao] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [abona, setAbona] = useState(true);
  const [inss, setInss] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const ordenadas = [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const dias = de && ate && ate >= de ? diasEntre(de, ate) : 0;

  async function salvar() {
    setErro(null);
    if (!pessoaId) return setErro('Escolha a pessoa.');
    if (!de || !ate) return setErro('Diga os dias do atestado.');
    if (ate < de) return setErro('O último dia é antes do primeiro.');
    if (!arquivo && !window.confirm('Lançar sem a foto do atestado? Dá pra cancelar e lançar de novo com a foto depois.')) return;
    try {
      let arquivoPath: string | undefined;
      if (arquivo) {
        setSalvando('enviando a foto…');
        const p = await chamarAtestado({ acao: 'upload_url', funcionarioId: pessoaId, nome: arquivo.name, tamanho: arquivo.size });
        const up = await createClient()
          .storage.from(String(p.bucket))
          .uploadToSignedUrl(String(p.path), String(p.token), arquivo, { contentType: arquivo.type || 'application/octet-stream' });
        if (up.error) throw new Error(`não consegui guardar a foto: ${up.error.message}`);
        arquivoPath = String(p.path);
      }
      setSalvando('salvando…');
      await chamarAtestado({
        acao: 'criar',
        funcionarioId: pessoaId,
        dataInicio: de,
        dataFim: ate,
        descricao: descricao.trim() || undefined,
        arquivoPath,
        arquivoNome: arquivo?.name,
        abona,
        ...(inss ? { inss: true } : {}),
      });
      setSalvando(null);
      onFeito();
    } catch (e) {
      setSalvando(null);
      setErro(e instanceof Error ? e.message : 'Não deu pra salvar');
    }
  }

  return (
    <Modal titulo="🩺 Lançar atestado" onFechar={onFechar}>
      <label className="block text-xs font-medium text-slate-600">
        Pessoa
        <select value={pessoaId} onChange={(e) => setPessoaId(e.target.value)} className={CAMPO}>
          <option value="">— escolha —</option>
          {ordenadas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
              {p.cargo ? ` · ${p.cargo}` : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-slate-600">
          Primeiro dia
          <input
            type="date"
            value={de}
            onChange={(e) => {
              setDe(e.target.value);
              if (!ate || ate < e.target.value) setAte(e.target.value);
            }}
            className={CAMPO}
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Último dia
          <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} className={CAMPO} />
        </label>
      </div>
      {dias > 0 && <p className="mt-1 text-xs text-slate-500">{dias} dia{dias > 1 ? 's' : ''} de atestado</p>}
      <label className="mt-3 block text-xs font-medium text-slate-600">
        Foto do atestado
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:text-slate-700"
        />
      </label>
      <label className="mt-3 block text-xs font-medium text-slate-600">
        Observação (opcional)
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          rows={2}
          className={CAMPO}
          placeholder="Ex.: CID, médico, meio período"
        />
      </label>
      <label className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-700">
        <input type="checkbox" checked={abona} onChange={(e) => setAbona(e.target.checked)} />
        Abonar no banco de horas
      </label>
      <p className="mt-1 text-[11px] text-slate-400">
        {abona
          ? 'No banco de horas, o dia de atestado conta como cumprido (abona o que faltou pra escala do dia).'
          : 'Fica guardado com a foto e aparece no ponto/escala, mas o banco de horas conta o dia normal (sem abonar).'}
      </p>
      <label className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-700">
        <input type="checkbox" checked={inss} onChange={(e) => setInss(e.target.checked)} />
        Afastamento pelo INSS (benefício)
      </label>
      <p className="mt-1 text-[11px] text-slate-400">
        {inss
          ? 'Esses dias saem do salário na folha desde o 1º dia — quem paga é o INSS. Pode passar de 60 dias. A casa paga só o atestado de antes (lance separado).'
          : 'Atestado comum: a casa paga até o 15º dia seguido; do 16º em diante a folha já trata como INSS sozinha.'}
      </p>
      {erro && <p className="mt-2 text-xs text-rose-700">{erro}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          Cancelar
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={!!salvando}
          className="rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          {salvando ?? 'Lançar atestado'}
        </button>
      </div>
    </Modal>
  );
}

function ModalAcerto({ pessoa, hoje, onFechar, onFeito }: { pessoa: LinhaPessoa; hoje: string; onFechar: () => void; onFeito: () => void }) {
  const [tipo, setTipo] = useState<'ajuste' | 'pagamento' | 'folga'>('ajuste');
  const [sentido, setSentido] = useState<'mais' | 'menos'>('mais');
  const [horas, setHoras] = useState('');
  const [dia, setDia] = useState(hoje);
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Hora paga e folga tirada sempre DESCONTAM do banco; só o acerto escolhe o lado.
  const sinal = tipo === 'ajuste' ? (sentido === 'mais' ? 1 : -1) : -1;
  const min = lerHoras(horas);

  async function salvar() {
    if (!min) return setErro('Diga quantas horas (ex.: 7:20 ou 8).');
    if (descricao.trim().length < 10) return setErro('Escreva o motivo (pelo menos 10 letras).');
    setSalvando(true);
    const e = await enviar({ acao: 'lancamento', funcionarioId: pessoa.id, tipo, minutos: sinal * min, dia, descricao: descricao.trim() });
    setSalvando(false);
    if (e) setErro(e);
    else onFeito();
  }

  return (
    <Modal titulo={`Lançar no banco de horas — ${pessoa.nome}`} onFechar={onFechar}>
      <p className="mb-3 text-xs text-slate-500">
        Saldo hoje: <span className={`font-semibold ${corSaldo(pessoa.saldoMin)}`}>{fmtSaldo(pessoa.saldoMin)}</span>
        {min ? (
          <>
            {' '}→ fica <span className={`font-semibold ${corSaldo(pessoa.saldoMin + sinal * min)}`}>{fmtSaldo(pessoa.saldoMin + sinal * min)}</span>
          </>
        ) : null}
      </p>
      <label className="block text-xs font-medium text-slate-600">
        O que é
        <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} className={CAMPO}>
          <option value="ajuste">Acerto (corrigir o saldo)</option>
          <option value="pagamento">Horas pagas em dinheiro (sai do banco)</option>
          <option value="folga">Folga tirada do banco (sai do banco)</option>
        </select>
      </label>
      {tipo === 'ajuste' && (
        <div className="mt-3 flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setSentido('mais')}
            className={`flex-1 rounded-md border px-3 py-2 ${sentido === 'mais' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}
          >
            + a favor da pessoa
          </button>
          <button
            type="button"
            onClick={() => setSentido('menos')}
            className={`flex-1 rounded-md border px-3 py-2 ${sentido === 'menos' ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-200 text-slate-600'}`}
          >
            − desconta da pessoa
          </button>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-slate-600">
          Horas
          <input value={horas} onChange={(e) => setHoras(e.target.value)} placeholder="7:20" inputMode="numeric" className={CAMPO} />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Dia
          <input type="date" value={dia} max={hoje} onChange={(e) => setDia(e.target.value)} className={CAMPO} />
        </label>
      </div>
      <label className="mt-3 block text-xs font-medium text-slate-600">
        Motivo
        <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} className={CAMPO} placeholder="Ex.: dias de escala em que trabalhou sem bater ponto" />
      </label>
      {erro && <p className="mt-2 text-xs text-rose-700">{erro}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          Cancelar
        </button>
        <button type="button" onClick={salvar} disabled={salvando} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {salvando ? 'Salvando…' : 'Lançar'}
        </button>
      </div>
    </Modal>
  );
}

function ModalEscala({ pessoa, hoje, jornadas, onFechar, onFeito }: { pessoa: LinhaPessoa; hoje: string; jornadas: Jornada[]; onFechar: () => void; onFeito: () => void }) {
  const [jornadaId, setJornadaId] = useState(pessoa.jornadaId ?? '');
  const [desde, setDesde] = useState(hoje);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const escolhida = jornadas.find((j) => j.id === jornadaId);

  async function salvar() {
    if (!jornadaId) return setErro('Escolha a escala.');
    setSalvando(true);
    const e = await enviar({ acao: 'atribuir_jornada', funcionarioId: pessoa.id, jornadaId, vigenteDesde: desde });
    setSalvando(false);
    if (e) setErro(e);
    else onFeito();
  }

  return (
    <Modal titulo={`Escala de ${pessoa.nome}`} onFechar={onFechar}>
      <p className="mb-3 text-xs text-slate-500">
        {pessoa.jornadaNome ? `Hoje: ${pessoa.jornadaNome}, desde ${dmy(pessoa.jornadaDesde)}.` : 'Ainda sem escala.'} A escala nova
        vale do dia escolhido em diante; o que já passou continua contado pela escala antiga.
      </p>
      <label className="block text-xs font-medium text-slate-600">
        Escala
        <select value={jornadaId} onChange={(e) => setJornadaId(e.target.value)} className={CAMPO}>
          <option value="">— escolher —</option>
          {jornadas.map((j) => (
            <option key={j.id} value={j.id}>
              {j.nome}
            </option>
          ))}
        </select>
      </label>
      {escolhida && (
        <p className="mt-1 text-xs text-slate-500">
          {escolhida.tipo === 'fixa'
            ? `${fmtHoras(minutosSemana(escolhida))} por semana · ${folgasDaJornada(escolhida)} · conta banco de horas`
            : 'Intermitente: recebe pela hora trabalhada, sem banco de horas'}
        </p>
      )}
      <label className="mt-3 block text-xs font-medium text-slate-600">
        Vale a partir de
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={CAMPO} />
      </label>
      {erro && <p className="mt-2 text-xs text-rose-700">{erro}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          Cancelar
        </button>
        <button type="button" onClick={salvar} disabled={salvando} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {salvando ? 'Salvando…' : 'Salvar escala'}
        </button>
      </div>
    </Modal>
  );
}

function ModalNovaJornada({ onFechar, onFeito }: { onFechar: () => void; onFeito: () => void }) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'fixa' | 'intermitente'>('fixa');
  const [horas, setHoras] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const mins: Record<string, number> = {};
  let invalido = false;
  for (const [campo] of DIAS) {
    const txt = (horas[campo] ?? '').trim();
    const m = txt === '' ? 0 : lerHoras(txt);
    if (m === null) invalido = true;
    mins[campo] = m ?? 0;
  }
  const total = Object.values(mins).reduce((s, m) => s + m, 0);

  async function salvar() {
    if (nome.trim().length < 3) return setErro('Dê um nome pra escala.');
    if (tipo === 'fixa' && invalido) return setErro('Hora em formato errado — use 7:20 ou 8.');
    if (tipo === 'fixa' && total === 0) return setErro('Preencha as horas de pelo menos um dia.');
    setSalvando(true);
    const e = await enviar({ acao: 'criar_jornada', nome: nome.trim(), tipo, ...(tipo === 'fixa' ? mins : {}) });
    setSalvando(false);
    if (e) setErro(e);
    else onFeito();
  }

  return (
    <Modal titulo="Nova escala" onFechar={onFechar}>
      <label className="block text-xs font-medium text-slate-600">
        Nome
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: 12x36 noite · 6x1 folga domingo" className={CAMPO} />
      </label>
      <label className="mt-3 block text-xs font-medium text-slate-600">
        Tipo
        <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} className={CAMPO}>
          <option value="fixa">Fixa — conta banco de horas</option>
          <option value="intermitente">Intermitente — por hora trabalhada</option>
        </select>
      </label>
      {tipo === 'fixa' && (
        <>
          <p className="mt-3 text-xs font-medium text-slate-600">Horas por dia (em branco = folga)</p>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {DIAS.map(([campo, rot]) => (
              <label key={campo} className="text-center text-[11px] text-slate-500">
                {rot}
                <input
                  value={horas[campo] ?? ''}
                  onChange={(e) => setHoras({ ...horas, [campo]: e.target.value })}
                  placeholder="—"
                  className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1.5 text-center text-xs"
                />
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Total da semana: {fmtHoras(total)}. Em 12x36 os dias alternam: use 6:00 em todos os dias (dá 42h por semana, a média do 12x36).
          </p>
        </>
      )}
      {erro && <p className="mt-2 text-xs text-rose-700">{erro}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          Cancelar
        </button>
        <button type="button" onClick={salvar} disabled={salvando} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {salvando ? 'Salvando…' : 'Criar escala'}
        </button>
      </div>
    </Modal>
  );
}

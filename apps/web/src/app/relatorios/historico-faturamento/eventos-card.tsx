'use client';

// Eventos e festas da aba Histórico de faturamento (VGV): venda que não passa
// pelo PDV e entra por cima do mês (o relatório mostra o VGV com e sem ela).

import { useState, type FormEvent } from 'react';
import { rotuloMes } from '@/lib/faturamento-meses';
import { brl, parseValorBr } from '@/lib/format';
import { SeletorMes } from './campos';
import { BOTAO, CAMPO, CARTAO, LINK } from './estilos';
import { useAcao } from './usar-acao';

export interface EventoItem {
  id: string;
  unidade: string;
  /** 'YYYY-MM' */
  mes: string;
  valor: number;
  observacao: string | null;
}

/** Os mesmos tetos da rota. */
const OBS_MAX = 200;
const VALOR_MAX = 999_999_999_999;

export function EventosCard({
  organizacaoId,
  eventos,
  unidades,
  mesAtual,
  anoMin,
  unidadeInicial,
}: {
  organizacaoId: string;
  /** Do mais novo pro mais antigo. */
  eventos: EventoItem[];
  unidades: Array<{ id: string; nome: string }>;
  mesAtual: string;
  anoMin: number;
  unidadeInicial: string;
}) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [escolhida, setEscolhida] = useState(unidadeInicial);
  const unidadeId = unidades.some((u) => u.id === escolhida) ? escolhida : (unidades[0]?.id ?? '');
  const [mes, setMes] = useState(mesAtual);
  const [valor, setValor] = useState('');
  const [obs, setObs] = useState('');
  const total = eventos.reduce((s, e) => s + e.valor, 0);

  async function incluir(e: FormEvent) {
    e.preventDefault();
    const v = parseValorBr(valor);
    if (v === null || !(v > 0) || v > VALOR_MAX) {
      setErro('Informe o valor do evento (maior que zero).');
      return;
    }
    const ok = await rodar('lancamento', {
      organizacaoId,
      acao: 'evento-novo',
      unidadeId,
      mes,
      valor: Math.round(v * 100) / 100,
      observacao: obs.trim(),
    });
    if (ok) {
      setValor('');
      setObs('');
    }
  }

  function excluir(ev: EventoItem) {
    const nome = ev.observacao ? `"${ev.observacao}"` : 'o evento';
    if (!window.confirm(`Excluir ${nome} de ${rotuloMes(ev.mes)} (${ev.unidade}) — ${brl(ev.valor)}?`)) return;
    void rodar('lancamento', { organizacaoId, acao: 'evento-excluir', id: ev.id });
  }

  return (
    <div className={CARTAO}>
      <div className="px-4 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">Eventos e festas</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Venda que não passou pelo PDV — festa fechada, aluguel do espaço, réveillon. Entra por cima do mês; o
          relatório mostra o VGV com e sem ela.
        </p>
      </div>

      <form onSubmit={incluir} className="flex flex-wrap items-end gap-3 px-4 py-4">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Unidade</span>
          <select
            value={unidadeId}
            disabled={ocupado}
            onChange={(e) => setEscolhida(e.target.value)}
            className={`${CAMPO} mt-1 block`}
          >
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="block text-xs font-medium text-slate-600">Mês</span>
          <span className="mt-1 block">
            <SeletorMes valor={mes} onChange={setMes} anoMin={anoMin} max={mesAtual} disabled={ocupado} />
          </span>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Valor</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={valor}
            disabled={ocupado}
            placeholder="0,00"
            onChange={(e) => {
              setErro(null);
              setValor(e.target.value);
            }}
            className={`${CAMPO} mt-1 block w-32 text-right tabular-nums`}
          />
        </label>
        <label className="block min-w-[12rem] flex-1">
          <span className="text-xs font-medium text-slate-600">O que foi (opcional)</span>
          <input
            type="text"
            value={obs}
            maxLength={OBS_MAX}
            disabled={ocupado}
            placeholder="Ex.: casamento, réveillon"
            onChange={(e) => setObs(e.target.value)}
            className={`${CAMPO} mt-1 block w-full`}
          />
        </label>
        <button type="submit" disabled={ocupado || !unidadeId || !valor.trim()} className={BOTAO}>
          {ocupado ? 'Gravando…' : 'Incluir'}
        </button>
      </form>
      {erro && <p className="px-4 pb-3 text-sm font-medium text-rose-700">{erro}</p>}

      {eventos.length === 0 ? (
        <p className="border-t border-slate-100 px-4 py-4 text-sm text-slate-500">Nenhum evento lançado ainda.</p>
      ) : (
        <div className="max-h-96 overflow-auto border-t border-slate-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-2">Mês</th>
                <th className="px-4 py-2">Unidade</th>
                <th className="px-4 py-2">O que foi</th>
                <th className="px-4 py-2 text-right">Valor</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {eventos.map((ev) => (
                <tr key={ev.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-700">{rotuloMes(ev.mes)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-700">{ev.unidade}</td>
                  <td className="px-4 py-2 text-slate-600">{ev.observacao || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-900">{brl(ev.valor)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button type="button" disabled={ocupado} onClick={() => excluir(ev)} className={LINK}>
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-medium text-slate-900">
              <tr>
                <td className="px-4 py-2" colSpan={3}>
                  Total ({eventos.length} {eventos.length === 1 ? 'lançamento' : 'lançamentos'})
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{brl(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

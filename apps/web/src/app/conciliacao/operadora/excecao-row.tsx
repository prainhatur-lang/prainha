'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';
import { MatchManualPicker, type CandidatoMatch } from '@/components/match-manual-picker';

interface Props {
  excecao: {
    id: string;
    tipo?: string;
    valor: string | null;
    descricao: string;
    pagamentoNsu: string | null;
    pagamentoFormaPagamento: string | null;
    pagamentoDataPagamento: Date | null;
    vendaNsu: string | null;
    vendaDataVenda: string | null;
    vendaBandeira: string | null;
    pagamentoValor?: string | null;
    vendaValorBruto?: string | null;
  };
  /** Se true, mostra botoes Aceitar/Rejeitar em vez de Resolver. */
  acoesDivergencia?: boolean;
  /** Candidatos pra match manual. Se passado, mostra o botao "Conciliar manual". */
  candidatosMatchManual?: CandidatoMatch[];
}

export function ExcecaoRow({ excecao: e, acoesDivergencia = false, candidatosMatchManual }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [acao, setAcao] = useState<null | 'aceitar' | 'resolver'>(null);
  const [obs, setObs] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const nsu = e.pagamentoNsu ?? e.vendaNsu ?? '—';
  const data = e.pagamentoDataPagamento
    ? new Date(e.pagamentoDataPagamento).toLocaleDateString('pt-BR')
    : e.vendaDataVenda
      ? new Date(e.vendaDataVenda + 'T00:00:00').toLocaleDateString('pt-BR')
      : '—';
  const forma = e.pagamentoFormaPagamento ?? e.vendaBandeira ?? '—';

  async function aceitarOuResolver() {
    setErr(null);
    const r = await fetch(`/api/excecoes/${e.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obs ? { observacao: obs } : {}),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || `HTTP ${r.status}`);
      return;
    }
    start(() => router.refresh());
  }

  async function rejeitar() {
    setErr(null);
    const r = await fetch(`/api/excecoes/${e.id}/rejeitar`, { method: 'POST' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || `HTTP ${r.status}`);
      return;
    }
    start(() => router.refresh());
  }

  const pdvValor = e.pagamentoValor != null ? Number(e.pagamentoValor) : null;
  const cieloValor = e.vendaValorBruto != null ? Number(e.vendaValorBruto) : null;
  const diff =
    pdvValor != null && cieloValor != null ? +(cieloValor - pdvValor).toFixed(2) : null;

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-4 py-2 font-mono text-xs text-slate-700">{data}</td>
      <td className="px-4 py-2 font-mono text-xs text-slate-700">{nsu}</td>
      <td className="px-4 py-2 text-xs text-slate-700">{forma}</td>
      <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
        {acoesDivergencia && pdvValor != null && cieloValor != null ? (
          <div className="flex flex-col items-end leading-tight">
            <span className="text-[10px] uppercase tracking-wide text-slate-400">PDV</span>
            <span>{brl(pdvValor)}</span>
            <span className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
              Cielo
            </span>
            <span>{brl(cieloValor)}</span>
            {diff !== null && Math.abs(diff) >= 0.01 && (
              <span
                className={`mt-1 rounded px-1.5 py-0.5 text-[11px] font-bold ${
                  diff > 0 ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {diff > 0 ? '+' : ''}
                {brl(diff)}
              </span>
            )}
          </div>
        ) : (
          brl(e.valor)
        )}
      </td>
      <td className="px-4 py-2 text-xs text-slate-600">{e.descricao}</td>
      <td className="px-4 py-2">
        {acao ? (
          <div className="flex flex-col gap-1">
            <input
              type="text"
              placeholder="Observação (opcional)"
              value={obs}
              onChange={(ev) => setObs(ev.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              autoFocus
            />
            <div className="flex gap-1">
              <button
                onClick={aceitarOuResolver}
                disabled={pending}
                className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                Confirmar
              </button>
              <button
                onClick={() => setAcao(null)}
                disabled={pending}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
            {err && <span className="text-[10px] text-rose-600">{err}</span>}
          </div>
        ) : acoesDivergencia ? (
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setAcao('aceitar')}
              className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
            >
              Aceitar valor
            </button>
            <button
              onClick={rejeitar}
              disabled={pending}
              className="rounded border border-rose-300 bg-white px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              Rejeitar
            </button>
            {err && <span className="text-[10px] text-rose-600">{err}</span>}
          </div>
        ) : (
          <div className="flex flex-col items-stretch gap-1">
            {candidatosMatchManual && candidatosMatchManual.length > 0 && (
              <MatchManualPicker
                excecaoId={e.id}
                valorPrincipal={Number(e.valor ?? 0)}
                candidatos={candidatosMatchManual}
                titulo="Match manual"
                subtitulo="Selecione o par correspondente."
                botaoLabel="Conciliar manual"
              />
            )}
            <button
              onClick={() => setAcao('resolver')}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              Resolver
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

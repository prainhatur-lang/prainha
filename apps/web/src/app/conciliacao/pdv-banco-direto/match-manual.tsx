'use client';

// Match manual PDV(canal=DIRETO) ↔ Banco. Modal que mostra creditos do
// extrato disponiveis e o user seleciona um pra casar com o pagamento PDV.
// Ignora tolerancia automatica — match manual e firme nivel 1 sempre.

import { useEffect, useMemo, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

interface CreditoOpt {
  id: string;
  data: string; // YYYY-MM-DD
  valor: number;
  descricao: string;
}

interface Props {
  pagamentoId: string;
  pagamentoValor: number;
  pagamentoData: string; // DD/MM/YYYY (display)
  pagamentoForma: string;
  pedidoExterno: number | null;
  creditosDisponiveis: CreditoOpt[];
}

function formatData(yyyymmdd: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(yyyymmdd)) {
    return yyyymmdd.slice(0, 10).split('-').reverse().join('/');
  }
  return yyyymmdd;
}

export function MatchManualPdvBancoDireto({
  pagamentoId,
  pagamentoValor,
  pagamentoData,
  pagamentoForma,
  pedidoExterno,
  creditosDisponiveis,
}: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  // Ordena candidatos por proximidade de valor + data próxima ao PDV
  const candidatosOrdenados = useMemo(() => {
    return [...creditosDisponiveis].sort((a, b) => {
      const da = Math.abs(a.valor - pagamentoValor);
      const db_ = Math.abs(b.valor - pagamentoValor);
      if (da !== db_) return da - db_;
      return a.data.localeCompare(b.data);
    });
  }, [creditosDisponiveis, pagamentoValor]);

  const sel = candidatosOrdenados.find((c) => c.id === selId) ?? null;
  const diff = sel ? +(sel.valor - pagamentoValor).toFixed(2) : 0;
  const pctDiff = sel && pagamentoValor > 0 ? Math.abs(diff / pagamentoValor) * 100 : 0;

  useEffect(() => {
    if (!aberto) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) setAberto(false);
    }
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [aberto, submitting]);

  async function aplicar() {
    if (!sel) return;
    setErro(null);
    setSubmitting(true);
    try {
      const r = await fetch('/api/conciliacao/pdv-banco-direto/match-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pagamentoId,
          lancamentoBancoId: sel.id,
          observacao: obs || undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(j.error || `HTTP ${r.status}`);
        return;
      }
      setAberto(false);
      start(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
      >
        Conciliar manual
      </button>
    );
  }

  if (typeof window === 'undefined') return null;

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) setAberto(false);
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">
            Match manual — PDV ↔ Banco
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Pedido <strong>#{pedidoExterno ?? '—'}</strong> · {pagamentoForma} ·{' '}
            <strong>{brl(pagamentoValor)}</strong> · {pagamentoData}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Selecione o crédito do extrato que corresponde a este pagamento.
            Diff = taxa Cielo / erro de digitação / etc — match manual ignora
            tolerância.
          </p>
        </div>

        <div className="px-5 py-4">
          {candidatosOrdenados.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
              Nenhum crédito sem origem disponível no banco. Confira se o
              extrato CNAB foi importado pro período.
            </p>
          ) : (
            <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left font-medium text-slate-600">
                  <tr>
                    <th className="px-3 py-2 w-8"></th>
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2 text-right">Diff</th>
                    <th className="px-3 py-2">Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {candidatosOrdenados.map((c) => {
                    const marcado = c.id === selId;
                    const d = +(c.valor - pagamentoValor).toFixed(2);
                    const dPct = pagamentoValor > 0 ? Math.abs(d / pagamentoValor) * 100 : 0;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelId(c.id)}
                        className={`cursor-pointer border-t border-slate-100 ${
                          marcado ? 'bg-emerald-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="radio"
                            name="credito"
                            checked={marcado}
                            onChange={() => setSelId(c.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-700">
                          {formatData(c.data)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-medium text-slate-900">
                          {brl(c.valor)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          <span
                            className={
                              dPct < 1
                                ? 'text-emerald-700'
                                : dPct < 5
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                            }
                          >
                            {d >= 0 ? '+' : ''}
                            {brl(d)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          <span className="block max-w-xs truncate" title={c.descricao}>
                            {c.descricao}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {sel && (
            <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600">PDV:</span>
                <span className="font-mono">{brl(pagamentoValor)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-slate-600">Banco:</span>
                <span className="font-mono">{brl(sel.valor)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                <span className="text-slate-600">Diferença:</span>
                <span
                  className={`font-mono font-semibold ${
                    pctDiff < 1
                      ? 'text-emerald-700'
                      : pctDiff < 5
                        ? 'text-amber-700'
                        : 'text-rose-700'
                  }`}
                >
                  {diff >= 0 ? '+' : ''}
                  {brl(diff)} ({pctDiff.toFixed(2)}%)
                </span>
              </div>
              {Math.abs(pctDiff - 0.49) < 0.05 && (
                <p className="mt-1.5 rounded bg-amber-100 p-1.5 text-[10px] text-amber-900">
                  ℹ Diff bate exato com taxa Cielo Pix (0,49%) — provavelmente
                  garçom marcou forma errada (passou pela maquininha como
                  &quot;Pix Manual&quot;).
                </p>
              )}
            </div>
          )}

          <input
            type="text"
            placeholder="Observação (opcional, ex: 'garçom errou forma')"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            className="mt-3 w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          {erro && <span className="mr-auto text-xs text-rose-600">{erro}</span>}
          <button
            type="button"
            onClick={() => setAberto(false)}
            disabled={submitting}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={aplicar}
            disabled={!sel || submitting || pending}
            className="rounded-md border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? 'Aplicando...' : '✓ Conciliar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

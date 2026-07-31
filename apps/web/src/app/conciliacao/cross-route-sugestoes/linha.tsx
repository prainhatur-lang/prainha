'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

interface Sugestao {
  id: string;
  tipo: string;
  score: number;
  motivo: string;
  pagamento: {
    id: string;
    valor: number;
    data: string | null;
    forma: string | null;
    codigoPedido: number | null;
    nsu: string | null;
  };
  banco: {
    id: string;
    data: string;
    descricao: string;
    valor: number;
  } | null;
  cielo: {
    id: string;
    nsu: string | null;
    data: string;
    valor: number;
    forma: string | null;
  } | null;
}

export function LinhaSugestao({ sugestao: s }: { sugestao: Sugestao }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState<'aceitar' | 'rejeitar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function decidir(acao: 'aceitar' | 'rejeitar') {
    setLoading(acao);
    setErro(null);
    try {
      const r = await fetch(`/api/sugestao-cross-route/${s.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acao }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  const fmtData = (iso: string | null) =>
    iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';

  const tipoBadge =
    s.tipo === 'PDV_ADQUIRENTE_PARA_BANCO'
      ? { label: 'ADQUIRENTE → DIRETO', cls: 'bg-violet-100 text-violet-800' }
      : { label: 'DIRETO → ADQUIRENTE', cls: 'bg-sky-100 text-sky-800' };

  const scoreBadge =
    s.score === 1
      ? { label: 'alta confiança', cls: 'bg-emerald-100 text-emerald-800' }
      : { label: 'média confiança', cls: 'bg-amber-100 text-amber-800' };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tipoBadge.cls}`}>
            {tipoBadge.label}
          </span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${scoreBadge.cls}`}>
            {scoreBadge.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => decidir('rejeitar')}
            disabled={loading !== null || pending}
            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            {loading === 'rejeitar' ? 'Rejeitando...' : 'Rejeitar'}
          </button>
          <button
            type="button"
            onClick={() => decidir('aceitar')}
            disabled={loading !== null || pending}
            className="rounded border border-emerald-700 bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading === 'aceitar' ? 'Aceitando...' : '✓ Aceitar'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 divide-slate-100 md:grid-cols-2 md:divide-x">
        {/* PDV */}
        <div className="p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            PDV (origem)
          </p>
          <div className="mt-1 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Pedido</span>
              <span className="font-mono text-slate-800">{s.pagamento.codigoPedido ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Data</span>
              <span className="font-mono text-slate-800">{fmtData(s.pagamento.data)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Forma</span>
              <span className="text-slate-800">{s.pagamento.forma ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">NSU</span>
              <span className="font-mono text-slate-800">{s.pagamento.nsu ?? '—'}</span>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-1">
              <span className="text-slate-500">Valor</span>
              <span className="font-mono font-semibold text-slate-900">
                {brl(s.pagamento.valor)}
              </span>
            </div>
          </div>
        </div>

        {/* Contraparte */}
        <div className="p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {s.banco ? 'Banco (destino sugerido)' : 'Cielo (destino sugerido)'}
          </p>
          {s.banco ? (
            <div className="mt-1 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Data</span>
                <span className="font-mono text-slate-800">{fmtData(s.banco.data)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="shrink-0 text-slate-500">Descrição</span>
                <span className="truncate text-right text-slate-800" title={s.banco.descricao}>
                  {s.banco.descricao}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-1">
                <span className="text-slate-500">Valor</span>
                <span className="font-mono font-semibold text-slate-900">
                  {brl(s.banco.valor)}
                </span>
              </div>
            </div>
          ) : s.cielo ? (
            <div className="mt-1 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Data venda</span>
                <span className="font-mono text-slate-800">{fmtData(s.cielo.data)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Forma</span>
                <span className="text-slate-800">{s.cielo.forma ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">NSU</span>
                <span className="font-mono text-slate-800">{s.cielo.nsu ?? '—'}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-1">
                <span className="text-slate-500">Valor</span>
                <span className="font-mono font-semibold text-slate-900">
                  {brl(s.cielo.valor)}
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Sem contraparte (estranho).</p>
          )}
        </div>
      </div>

      <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-600">
        <strong>Motivo:</strong> {s.motivo}
      </div>

      {erro && (
        <div className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-800">
          {erro}
        </div>
      )}
    </div>
  );
}

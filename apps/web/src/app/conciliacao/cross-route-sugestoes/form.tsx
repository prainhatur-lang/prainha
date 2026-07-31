'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export function FormRodarCrossRoute({ filialId }: { filialId: string }) {
  const router = useRouter();
  const [dataInicio, setDataInicio] = useState(diasAtrasBr(30));
  const [dataFim, setDataFim] = useState(hojeBr());
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function rodar(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/conciliacao/cross-route', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId, dataInicio, dataFim }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
      } else {
        setMsg({
          tipo: 'ok',
          texto: `✓ ${d.sugestoes} sugestões: ${d.adquirenteParaBanco} ADQ→DIRETO, ${d.diretoParaCielo} DIRETO→ADQ.`,
        });
        start(() => router.refresh());
      }
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={rodar}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-slate-900">Rodar cross-route</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Detecta pagamentos sem match nos canais corretos e tenta cruzar com o
        outro canal (cobre erro de cadastro do garçom).
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Data início
          </span>
          <input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            required
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Data fim
          </span>
          <input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            required
          />
        </label>
      </div>

      {msg && (
        <div
          className={`mt-3 rounded-md px-3 py-2 text-xs ${
            msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
          }`}
        >
          {msg.texto}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || pending}
        className="mt-4 w-full rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {loading ? 'Rodando...' : 'Rodar cross-route'}
      </button>

      <p className="mt-3 text-[10px] text-slate-500">
        Pré-requisito: rode primeiro a conciliação operadora e a PDV↔Banco direto
        no mesmo período pra ter as sobras a cruzar.
      </p>
    </form>
  );
}

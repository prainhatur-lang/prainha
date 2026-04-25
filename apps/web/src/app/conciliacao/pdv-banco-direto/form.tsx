'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export function FormRodar({ filialId }: { filialId: string }) {
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
      const r = await fetch('/api/conciliacao/pdv-banco-direto', {
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
          texto: `✓ ${d.matched} casados (${d.matchedNivel1} firmes + ${d.matchedNivel2} sugestões). ${d.pdvSemBanco} PDV sem banco, ${d.bancoSemPdv} banco sem PDV.`,
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
      <h2 className="text-sm font-semibold text-slate-900">Rodar conciliação</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Cruza pagamentos PDV (canal DIRETO) com créditos PIX/TED/DOC no banco.
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
            msg.tipo === 'ok'
              ? 'bg-emerald-50 text-emerald-800'
              : 'bg-rose-50 text-rose-800'
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
        {loading ? 'Rodando...' : 'Rodar conciliação'}
      </button>
    </form>
  );
}

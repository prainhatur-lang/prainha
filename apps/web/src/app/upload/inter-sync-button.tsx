'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function InterSyncButton({ filialId, filialNome }: { filialId: string; filialNome: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function sincronizar() {
    setLoading(true);
    setMsg(null);
    setErro(null);
    try {
      const r = await fetch('/api/inter/sincronizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId }),
      });
      const data = await r.json();
      if (!r.ok) {
        setErro(data.error ?? `HTTP ${r.status}`);
      } else {
        const res = data.resumo;
        setMsg(
          `lidos ${res.registrosLidos}, novos ${res.registrosInseridos}` +
            (res.periodo ? ` — período ${res.periodo.de} a ${res.periodo.ate}` : ''),
        );
        router.refresh();
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Extrato Inter automático</h2>
      <p className="mt-1 text-sm text-slate-600">
        Busca o extrato direto da API do Inter pra <span className="font-medium">{filialNome}</span> (últimos
        10 dias), sem precisar baixar/subir o CNAB manualmente. Também roda sozinho 2x por dia.
      </p>
      <button
        onClick={sincronizar}
        disabled={loading}
        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {loading ? 'Sincronizando...' : 'Sincronizar agora'}
      </button>
      {msg && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
      {erro && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{erro}</p>}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function FecharEncontroButton({ competencia, hoje }: { competencia: string; hoje: string }) {
  const router = useRouter();
  const [data, setData] = useState(hoje);
  const [busy, setBusy] = useState(false);
  async function fechar() {
    const [y, m] = competencia.split('-');
    if (!confirm(`Fechar o encontro de contas de ${m}/${y}? As contas das transferências são baixadas por compensação e fica 1 conta a pagar com a diferença.`)) return;
    setBusy(true);
    const r = await fetch('/api/transferencias/encontro', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ competencia, data }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      alert(j.error ?? 'Erro ao fechar');
      return;
    }
    router.refresh();
  }
  return (
    <div className="mt-4 flex flex-wrap items-end justify-end gap-3">
      <label className="text-sm">
        <span className="block text-xs text-slate-500">Data da compensação / vencimento da diferença</span>
        <input
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
          className="mt-1 rounded-md border border-slate-300 px-2 py-1.5"
        />
      </label>
      <button
        onClick={fechar}
        disabled={busy}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? 'Fechando…' : '⚖️ Fechar encontro'}
      </button>
    </div>
  );
}

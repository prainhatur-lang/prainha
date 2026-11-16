'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function MarcarChegou({ notaId, rotulo }: { notaId: string; rotulo: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function marcar() {
    if (!confirm(`Confirmar que chegou TUDO de ${rotulo}?\n\nSe veio faltando, cancele e use "Conferir item a item".`)) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}/chegou`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErro(d.error ?? `HTTP ${r.status}`);
      else start(() => router.refresh());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={marcar}
        disabled={enviando || pending}
        className="rounded-lg border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {enviando || pending ? 'Marcando...' : '✓ Chegou'}
      </button>
      {erro && <span className="text-[11px] text-rose-700">{erro}</span>}
    </span>
  );
}

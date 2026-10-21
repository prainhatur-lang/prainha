'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function Desconectar({ filialId, rede, nome }: { filialId: string; rede: string; nome: string }) {
  const router = useRouter();
  const [indo, setIndo] = useState(false);
  async function sair() {
    if (!window.confirm(`Desconectar o ${nome} desta casa? A conta na rede continua igual; só o sistema deixa de ver.`)) return;
    setIndo(true);
    try {
      const r = await fetch(`/api/marketing/${rede}/desconectar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId }),
      });
      if (!r.ok) window.alert((await r.json().catch(() => null))?.error ?? 'Falhou.');
      router.refresh();
    } finally {
      setIndo(false);
    }
  }
  return (
    <button
      type="button"
      onClick={sair}
      disabled={indo}
      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
    >
      {indo ? 'Saindo…' : 'Desconectar'}
    </button>
  );
}

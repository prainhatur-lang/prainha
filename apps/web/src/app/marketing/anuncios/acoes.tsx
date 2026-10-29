'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Pausar / ligar uma campanha na Meta. */
export function StatusCampanha({ filialId, campanhaId, ativa, nome }: { filialId: string; campanhaId: string; ativa: boolean; nome: string }) {
  const router = useRouter();
  const [indo, setIndo] = useState(false);
  async function mudar() {
    if (!window.confirm(ativa ? `Pausar "${nome}"? Para de gastar na hora.` : `Ligar "${nome}" de novo? Volta a gastar o orçamento.`)) return;
    setIndo(true);
    try {
      const r = await fetch('/api/marketing/anuncios/campanha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, campanhaId, ativa: !ativa }),
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
      onClick={mudar}
      disabled={indo}
      className={`rounded-md border px-2 py-0.5 text-xs disabled:opacity-50 ${ativa ? 'border-amber-300 text-amber-800 hover:bg-amber-50' : 'border-emerald-300 text-emerald-800 hover:bg-emerald-50'}`}
    >
      {indo ? '…' : ativa ? 'Pausar' : 'Ligar'}
    </button>
  );
}

export function DesconectarAnuncios({ filialId }: { filialId: string }) {
  const router = useRouter();
  const [indo, setIndo] = useState(false);
  async function sair() {
    if (!window.confirm('Desconectar a conta de anúncios desta casa? Na Meta nada muda; só o sistema deixa de ver.')) return;
    setIndo(true);
    try {
      await fetch('/api/marketing/anuncios/desconectar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId }),
      });
      router.refresh();
    } finally {
      setIndo(false);
    }
  }
  return (
    <button type="button" onClick={sair} disabled={indo} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
      {indo ? 'Saindo…' : 'Desconectar'}
    </button>
  );
}

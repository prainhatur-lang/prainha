'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function BuscarExtrato({ empresa }: { empresa: string }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function buscar() {
    setRodando(true);
    setMsg(null);
    try {
      const res = await fetch('/api/rh/extrato-empresa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa, dias: 120 }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, texto: j.error ?? `Erro ${res.status}` });
      else {
        setMsg({ ok: true, texto: `${j.lidos} lançamentos lidos, ${j.inseridos} novos.` });
        router.refresh();
      }
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message });
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={buscar}
        disabled={rodando}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {rodando ? 'Buscando no Inter…' : 'Buscar extrato agora (120 dias)'}
      </button>
      {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.texto}</span>}
    </div>
  );
}

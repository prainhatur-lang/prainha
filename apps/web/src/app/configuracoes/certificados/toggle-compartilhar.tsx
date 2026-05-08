'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function ToggleCompartilharBtn({
  certId,
  compartilhado,
}: {
  certId: string;
  compartilhado: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  async function alternar() {
    setErro(null);
    try {
      const r = await fetch(`/api/certificados/${certId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ compartilharOrganizacao: !compartilhado }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={alternar}
        disabled={pending}
        className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
          compartilhado
            ? 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
        } disabled:opacity-50`}
        title={
          compartilhado
            ? 'Cert atende todas filiais da org. Clique pra deixar só desta filial.'
            : 'Cert atende só esta filial. Clique pra estender pra todas filiais da org.'
        }
      >
        {pending ? '...' : compartilhado ? '✓ compartilhado' : 'tornar compartilhado'}
      </button>
      {erro && <span className="text-[10px] text-rose-700">{erro}</span>}
    </div>
  );
}

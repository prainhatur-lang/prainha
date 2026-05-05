'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function AprovarButton({ cotacaoId }: { cotacaoId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  async function aprovar() {
    if (!confirm('Confirmar aprovação? Vai gerar 1 pedido por fornecedor vencedor.')) return;
    setErro(null);
    try {
      const r = await fetch(`/api/cotacao/${cotacaoId}/aprovar`, { method: 'POST' });
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
        onClick={aprovar}
        disabled={pending}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? 'Aprovando...' : 'Aprovar e gerar pedidos'}
      </button>
      {erro && <span className="text-xs text-rose-700">{erro}</span>}
    </div>
  );
}

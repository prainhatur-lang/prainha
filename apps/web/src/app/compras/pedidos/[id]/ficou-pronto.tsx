'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Pedido sob encomenda: fornecedor avisou que ficou pronto → parcelas
 *  "quando ficar pronto" passam a vencer hoje. */
export function FicouPronto({ pedidoId }: { pedidoId: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function marcar() {
    if (!confirm('O fornecedor avisou que ficou pronto? O restante passa a vencer hoje.')) return;
    setEnviando(true);
    setErro(null);
    const r = await fetch(`/api/compras/pedidos/${pedidoId}/pronto`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    setEnviando(false);
    if (!r.ok) return setErro(j.error ?? 'erro');
    router.refresh();
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={marcar}
        disabled={enviando}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {enviando ? 'Gravando…' : '✅ Ficou pronto'}
      </button>
      {erro && <span className="text-xs text-rose-700">{erro}</span>}
    </span>
  );
}

'use client';

import { useEffect } from 'react';

/** Botão de imprimir + abre o diálogo sozinho ao carregar (?auto=1). */
export function BotoesImprimir({ auto }: { auto: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
    >
      🖨 Imprimir pedido
    </button>
  );
}

'use client';
// Botão da lista completa: marca/desmarca o produto como combo (combo_marcado).
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function MarcarCombo(props: { filialId: string; varianteCodigo: number; marcado: boolean }) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  async function alternar() {
    setSalvando(true);
    try {
      const r = await fetch('/api/cadastros/combos', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: props.filialId, varianteCodigo: props.varianteCodigo, marcado: !props.marcado }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; erro?: string } | null;
      if (!r.ok || !j?.ok) alert(j?.erro ?? 'Não deu para salvar.');
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }
  return (
    <button
      type="button"
      onClick={alternar}
      disabled={salvando}
      className={`rounded-md border px-2 py-0.5 text-xs ${
        props.marcado
          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
      } disabled:opacity-50`}
      title={props.marcado ? 'Tirar da lista de combos' : 'Marcar como combo'}
    >
      {salvando ? '…' : props.marcado ? '✓ combo' : 'é combo?'}
    </button>
  );
}

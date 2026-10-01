'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CancelarTransfButton({ id, numero, emTransito }: { id: string; numero: number; emTransito?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function cancelar() {
    const msg = emTransito
      ? `Cancelar a transferência #${numero}? Ela ainda não foi recebida: o estoque volta pra casa que enviou.`
      : `Cancelar a transferência #${numero}? O estoque volta pra casa que enviou e a conta a pagar some.`;
    if (!confirm(msg)) return;
    setBusy(true);
    const r = await fetch(`/api/transferencias/${id}/cancelar`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      alert(j.error ?? 'Erro ao cancelar');
      return;
    }
    router.refresh();
  }
  return (
    <button
      onClick={cancelar}
      disabled={busy}
      className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
    >
      {busy ? '…' : 'Cancelar'}
    </button>
  );
}

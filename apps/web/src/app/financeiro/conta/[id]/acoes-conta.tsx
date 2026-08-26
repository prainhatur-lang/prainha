'use client';

// Botões Alterar/Excluir da conta MANUAL. Excluir é soft delete com
// confirmação — a conta some das listas mas fica no banco pra auditoria.

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AcoesConta({ contaId, descricao }: { contaId: string; descricao: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  async function excluir() {
    if (!confirm(`Excluir a conta "${descricao}"?\n\nEla some das listas e dos totais (o histórico fica guardado pra auditoria).`)) {
      return;
    }
    setOcupado(true);
    try {
      const r = await fetch(`/api/financeiro/contas/${contaId}`, { method: 'DELETE' });
      if (!r.ok) {
        alert((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return;
      }
      router.push('/financeiro');
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/financeiro/conta/${contaId}/editar`}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        ✎ Alterar
      </Link>
      <button
        type="button"
        onClick={excluir}
        disabled={ocupado}
        className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
      >
        {ocupado ? 'Excluindo...' : '🗑 Excluir'}
      </button>
    </div>
  );
}

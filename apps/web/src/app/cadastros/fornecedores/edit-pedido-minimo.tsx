'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

export function EditPedidoMinimo({
  fornecedorId,
  valorAtual,
}: {
  fornecedorId: string;
  valorAtual: string | null;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(valorAtual ?? '');
  const [pending, setPending] = useState(false);

  async function salvar() {
    setPending(true);
    try {
      const r = await fetch(`/api/fornecedores/${fornecedorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          valorPedidoMinimo: valor.trim() === '' ? null : valor,
        }),
      });
      if (r.ok) {
        setEditando(false);
        router.refresh();
      } else {
        const d = await r.json().catch(() => ({}));
        alert(`Erro: ${d.error ?? r.status}`);
      }
    } finally {
      setPending(false);
    }
  }

  if (editando) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-slate-400">R$</span>
        <input
          type="text"
          inputMode="decimal"
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onBlur={salvar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') salvar();
            if (e.key === 'Escape') {
              setValor(valorAtual ?? '');
              setEditando(false);
            }
          }}
          placeholder="0,00"
          disabled={pending}
          className="w-20 rounded border border-slate-300 px-1 py-0.5 text-xs"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditando(true)}
      className="rounded border border-transparent px-1 py-0.5 text-xs text-slate-600 hover:border-slate-200 hover:bg-slate-50"
      title="Clique pra editar valor mínimo de pedido"
    >
      {valorAtual ? brl(Number(valorAtual)) : <span className="italic text-slate-400">—</span>}
    </button>
  );
}

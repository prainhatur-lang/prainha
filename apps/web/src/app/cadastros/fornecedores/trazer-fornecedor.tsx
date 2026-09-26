'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Cadastro único: cria nesta casa a linha de um fornecedor das outras casas. */
export function TrazerFornecedor({ fornecedorId, filialId }: { fornecedorId: string; filialId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function trazer() {
    setPending(true);
    setErro(null);
    try {
      const r = await fetch('/api/fornecedores/trazer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fornecedorId, filialId }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setErro(j.error ?? 'falhou');
      else router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={trazer}
        disabled={pending}
        className="rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs text-violet-900 hover:bg-violet-100 disabled:opacity-50"
      >
        {pending ? '…' : '+ usar nesta casa'}
      </button>
      {erro && <span className="text-[10px] text-rose-700">{erro}</span>}
    </span>
  );
}

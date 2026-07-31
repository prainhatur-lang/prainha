'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function BotaoApagarGrupo({ id, nome }: { id: string; nome: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function apagar() {
    if (
      !confirm(
        `Apagar o grupo "${nome}"?\n\nIsso desfaz vínculos com todos os usuários que pertenciam a esse grupo. Não pode ser desfeito.`,
      )
    )
      return;
    setPending(true);
    const r = await fetch(`/api/admin/grupos/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      setPending(false);
      return;
    }
    router.push('/configuracoes/grupos');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={apagar}
      disabled={pending}
      className="rounded border border-rose-300 bg-white px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
    >
      {pending ? 'Apagando...' : 'Apagar grupo'}
    </button>
  );
}

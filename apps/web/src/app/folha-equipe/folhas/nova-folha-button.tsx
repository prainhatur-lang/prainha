'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function NovaFolhaButton({
  filialId,
  inicio,
  fim,
}: {
  filialId: string;
  inicio: string;
  fim: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function criar() {
    start(async () => {
      const r = await fetch('/api/folha-equipe/folhas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, dataInicio: inicio, dataFim: fim }),
      });
      if (r.ok) {
        const data = await r.json();
        router.push(`/folha-equipe/folhas/${data.id}`);
      } else {
        alert('Erro: ' + (await r.text()));
      }
    });
  }

  return (
    <button
      type="button"
      onClick={criar}
      disabled={pending}
      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-400"
    >
      {pending ? 'Criando...' : '➕ Criar folha'}
    </button>
  );
}

'use client';

import { useTransition } from 'react';

interface Resultado {
  ok: boolean;
  diasCalculados?: number;
  linhasFolha?: number;
  semVinculo?: string[];
  erro?: string;
}

export function RecalcularPontoButton({ folhaId }: { folhaId: string }) {
  const [pending, start] = useTransition();

  function recalcular() {
    start(async () => {
      const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/recalcular-ponto`, { method: 'POST' });
      const data = (await r.json()) as Resultado;
      if (!r.ok || !data.ok) {
        alert(data.erro ?? 'Erro ao recalcular horas do ponto.');
        return;
      }
      const aviso = data.semVinculo?.length
        ? `\n\n${data.semVinculo.length} funcionário(s) sem vínculo de folha: ${data.semVinculo.join(', ')}`
        : '';
      alert(`${data.linhasFolha ?? 0} linha(s) de horas atualizadas a partir do ponto próprio.${aviso}`);
      window.location.reload();
    });
  }

  return (
    <button
      type="button"
      onClick={recalcular}
      disabled={pending}
      className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
    >
      {pending ? 'Recalculando…' : '🔄 Recalcular horas do ponto'}
    </button>
  );
}

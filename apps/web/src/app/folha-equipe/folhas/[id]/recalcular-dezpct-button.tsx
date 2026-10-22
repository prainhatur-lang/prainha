'use client';

import { useTransition } from 'react';

interface Mudanca {
  dia: string;
  antes: number;
  depois: number;
}
interface Resultado {
  ok: boolean;
  aplicado?: boolean;
  mudancas?: Mudanca[];
  totalAntes?: number;
  totalDepois?: number;
  erro?: string;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const diaBr = (ymd: string) => {
  const [, m, d] = ymd.split('-');
  const sem = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${ymd}T12:00:00`).getDay()];
  return `${sem} ${d}/${m}`;
};

export function RecalcularDezPctButton({ folhaId }: { folhaId: string }) {
  const [pending, start] = useTransition();

  async function chamar(aplicar: boolean): Promise<Resultado | null> {
    const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/recalcular-dezpct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aplicar }),
    });
    const data = (await r.json().catch(() => ({ ok: false }))) as Resultado;
    if (!r.ok || !data.ok) {
      alert(data.erro ?? 'Erro ao recalcular o 10%.');
      return null;
    }
    return data;
  }

  function recalcular() {
    start(async () => {
      const prev = await chamar(false);
      if (!prev) return;
      const mudancas = prev.mudancas ?? [];
      if (mudancas.length === 0) {
        alert('O 10% da folha já está igual ao das contas lançadas. Nada a mudar.');
        return;
      }
      const linhas = mudancas
        .map((m) => `${diaBr(m.dia)}: ${brl(m.antes)} → ${brl(m.depois)}`)
        .join('\n');
      const ok = confirm(
        `O 10% das contas mudou desde que a folha foi criada:\n\n${linhas}\n\n` +
          `Total da semana: ${brl(prev.totalAntes ?? 0)} → ${brl(prev.totalDepois ?? 0)}\n\n` +
          'Gravar o 10% novo nesta folha?',
      );
      if (!ok) return;
      const r = await chamar(true);
      if (!r) return;
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
      {pending ? 'Conferindo…' : '💰 Recalcular 10%'}
    </button>
  );
}

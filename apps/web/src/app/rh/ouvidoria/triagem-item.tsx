'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  id: string;
  status: string;
  observacaoInicial: string | null;
}

const STATUS_OPCOES = [
  { valor: 'nova', label: 'Nova' },
  { valor: 'lida', label: 'Lida' },
  { valor: 'em_apuracao', label: 'Em apuração' },
  { valor: 'resolvida', label: 'Resolvida' },
  { valor: 'descartada', label: 'Descartada' },
];

export function TriagemItem({ id, status, observacaoInicial }: Props) {
  const router = useRouter();
  const [observacao, setObservacao] = useState(observacaoInicial ?? '');
  const [salvando, setSalvando] = useState(false);

  async function atualizar(body: Record<string, unknown>) {
    setSalvando(true);
    try {
      await fetch(`/api/ouvidoria/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
      <select
        value={status}
        onChange={(e) => atualizar({ status: e.target.value })}
        disabled={salvando}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
      >
        {STATUS_OPCOES.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
        onBlur={() => {
          if (observacao !== (observacaoInicial ?? '')) atualizar({ observacaoInterna: observacao || null });
        }}
        placeholder="Observação interna (opcional)"
        className="min-w-[200px] flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
      />
    </div>
  );
}

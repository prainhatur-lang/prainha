'use client';

// Botão "Conciliar agora": roda a cadeia inteira (Operadora → Recebíveis →
// Banco → baixa) pro período visível e recarrega a página com o resultado.

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  filialId: string;
  dataInicio: string; // YYYY-MM-DD
  dataFim: string;
}

export function ConciliarAgora({ filialId, dataInicio, dataFim }: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar() {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch('/api/conciliacao/automatica', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId, dataInicio, dataFim }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro((d as { error?: string }).error ?? `HTTP ${r.status}`);
        return;
      }
      start(() => router.refresh());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={rodar}
        disabled={loading}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Conciliando…' : '⟳ Conciliar agora'}
      </button>
      {erro && <p className="text-xs text-rose-600">{erro}</p>}
    </div>
  );
}

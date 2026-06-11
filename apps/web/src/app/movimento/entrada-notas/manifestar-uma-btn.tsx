'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Resp {
  ok?: boolean;
  error?: string;
  manifestadas?: number;
  comErro?: number;
  erros?: { chave: string; motivo: string }[];
}

/** Dá ciência (210210) em UMA nota resumo específica (pela chave). */
export function ManifestarUmaBtn({ filialId, chave }: { filialId: string; chave: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function dar() {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch('/api/notas/manifestar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, chaves: [chave] }),
      });
      const d = (await r.json().catch(() => ({}))) as Resp;
      if (!r.ok || !d.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      if (!d.manifestadas) {
        setErro(d.erros?.[0]?.motivo ?? (d.comErro ? 'recusada' : 'sem efeito'));
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
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={dar}
        disabled={loading || pending}
        className="rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
        title="Dar ciência só nesta nota (libera o XML completo na próxima consulta)"
      >
        {loading ? '...' : 'Dar ciência'}
      </button>
      {erro && (
        <span className="max-w-[220px] whitespace-normal break-words text-[10px] leading-tight text-rose-600">
          {erro}
        </span>
      )}
    </span>
  );
}

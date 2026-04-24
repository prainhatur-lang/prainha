'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Resp {
  ok?: boolean;
  error?: string;
  totalTentado?: number;
  manifestadas?: number;
  comErro?: number;
  erros?: { chave: string; motivo: string }[];
}

export function ManifestarBtn({ filialId }: { filialId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function manifestar() {
    if (
      !confirm(
        'Dar ciência da operação nas notas resumo? Isso destrava a SEFAZ pra devolver o XML completo na próxima consulta (não compromete a empresa).',
      )
    )
      return;
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/notas/manifestar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, limite: 50 }),
      });
      const d = (await r.json()) as Resp;
      if (!r.ok || !d.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      const msg =
        d.manifestadas === 0
          ? 'Nenhuma nota resumo pendente.'
          : `✓ ${d.manifestadas}/${d.totalTentado} ciência(s) aceita(s).${
              d.comErro ? ` ${d.comErro} com erro.` : ''
            }`;
      setMsg({ tipo: 'ok', texto: msg });
      start(() => router.refresh());
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 flex items-center gap-3">
      <button
        type="button"
        onClick={manifestar}
        disabled={loading || pending}
        className="rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
      >
        {loading ? 'Enviando...' : 'Dar ciência nos resumos'}
      </button>
      {msg && (
        <span
          className={`text-[11px] ${
            msg.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-700'
          }`}
        >
          {msg.texto}
        </span>
      )}
    </div>
  );
}

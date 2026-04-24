'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface ResumoResp {
  ok?: boolean;
  error?: string;
  lotes?: number;
  docsRecebidos?: number;
  nfesCompletasInseridas?: number;
  nfesResumoInseridas?: number;
  duplicadas?: number;
  eventosIgnorados?: number;
  cStatFinal?: string | null;
  xMotivoFinal?: string | null;
  ultNsu?: string | null;
  maxNsu?: string | null;
  temMais?: boolean;
}

export function ConsultarSefazBtn({ filialId }: { filialId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function consultar() {
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/notas/distribuicao/consultar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, loop: true }),
      });
      const d = (await r.json()) as ResumoResp;
      if (!r.ok || !d.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      const partes: string[] = [];
      if (d.nfesCompletasInseridas) partes.push(`${d.nfesCompletasInseridas} NFe completas`);
      if (d.nfesResumoInseridas) partes.push(`${d.nfesResumoInseridas} resumos`);
      if (d.duplicadas) partes.push(`${d.duplicadas} já existentes`);
      if (d.eventosIgnorados) partes.push(`${d.eventosIgnorados} eventos ignorados`);
      const resumo = partes.length ? partes.join(', ') : 'nada novo';
      const sufixo = d.temMais ? ' (ainda há mais docs — clique novamente)' : '';
      setMsg({
        tipo: 'ok',
        texto: `✓ ${d.lotes} lote(s) / ${d.docsRecebidos} docs: ${resumo}${sufixo}`,
      });
      start(() => router.refresh());
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={consultar}
        disabled={loading || pending}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {loading ? 'Consultando...' : 'Consultar SEFAZ'}
      </button>
      {msg && (
        <span
          className={`max-w-[220px] text-right text-[10px] leading-tight ${
            msg.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-700'
          }`}
        >
          {msg.texto}
        </span>
      )}
    </div>
  );
}

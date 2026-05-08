'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface ManifestarResp {
  ok?: boolean;
  error?: string;
  totalTentado?: number;
  manifestadas?: number;
  comErro?: number;
  filiaisProcessadas?: number;
  erros?: { chave: string; motivo: string }[];
}

/** Dispara manifestacao de ciencia (210200) em todos os resumos pendentes
 *  da filial, sem precisar esperar o cron. Apos manifestar, a proxima
 *  consulta SEFAZ ja vai trazer os XMLs completos. */
export function ManifestarBtn({
  filialId,
  todasFiliais = false,
}: {
  filialId: string;
  todasFiliais?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function manifestar() {
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/notas/manifestar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          limite: 100,
          escopo: todasFiliais ? 'todas-da-org' : 'filial',
        }),
      });
      const d = (await r.json()) as ManifestarResp;
      if (!r.ok || !d.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      const tentado = d.totalTentado ?? 0;
      const filiais = d.filiaisProcessadas && d.filiaisProcessadas > 1
        ? ` (${d.filiaisProcessadas} filiais)` : '';
      if (tentado === 0) {
        setMsg({ tipo: 'ok', texto: `✓ Sem resumos pendentes${filiais}` });
      } else {
        const partes: string[] = [];
        partes.push(`${d.manifestadas ?? 0}/${tentado} manifestadas${filiais}`);
        if (d.comErro) partes.push(`${d.comErro} com erro`);
        setMsg({ tipo: 'ok', texto: `✓ ${partes.join(' · ')}` });
      }
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
        onClick={manifestar}
        disabled={loading || pending}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        title="Dá ciência nos resumos pendentes. Depois Consulte SEFAZ pra puxar os XMLs completos."
      >
        {loading
          ? 'Manifestando...'
          : todasFiliais
            ? 'Manifestar pendentes (todas filiais)'
            : 'Manifestar pendentes'}
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

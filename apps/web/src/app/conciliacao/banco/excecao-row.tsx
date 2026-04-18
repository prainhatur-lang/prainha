'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

interface Props {
  excecao: {
    id: string;
    valor: string | null;
    descricao: string;
    recebivelDataPagamento: Date | string | null;
    lancamentoData: string | null;
  };
}

function formatarData(d: Date | string | null): string {
  if (!d) return '—';
  if (d instanceof Date) return d.toLocaleDateString('pt-BR');
  // string YYYY-MM-DD
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
}

export function ExcecaoRowBanco({ excecao: e }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [resolvendo, setResolvendo] = useState(false);
  const [obs, setObs] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const data = formatarData(e.recebivelDataPagamento ?? e.lancamentoData);

  async function resolver() {
    setErr(null);
    const r = await fetch(`/api/excecoes/${e.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obs ? { observacao: obs } : {}),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || `HTTP ${r.status}`);
      return;
    }
    start(() => router.refresh());
  }

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-4 py-2 font-mono text-xs text-slate-700">{data}</td>
      <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
        {brl(e.valor)}
      </td>
      <td className="px-4 py-2 text-xs text-slate-600">{e.descricao}</td>
      <td className="px-4 py-2">
        {resolvendo ? (
          <div className="flex flex-col gap-1">
            <input
              type="text"
              placeholder="Observação (opcional)"
              value={obs}
              onChange={(ev) => setObs(ev.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              autoFocus
            />
            <div className="flex gap-1">
              <button
                onClick={resolver}
                disabled={pending}
                className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                Confirmar
              </button>
              <button
                onClick={() => setResolvendo(false)}
                disabled={pending}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
            {err && <span className="text-[10px] text-rose-600">{err}</span>}
          </div>
        ) : (
          <button
            onClick={() => setResolvendo(true)}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Resolver
          </button>
        )}
      </td>
    </tr>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

interface Props {
  excecao: {
    id: string;
    valor: string | null;
    descricao: string;
    vendaNsu: string | null;
    vendaDataVenda: string | null;
    vendaBandeira: string | null;
    vendaFormaPagamento: string | null;
    recebivelNsu: string | null;
    recebivelDataPagamento: string | null;
    recebivelFormaPagamento: string | null;
    recebivelValorLiquido: string | null;
  };
}

function isoToBr(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

export function ExcecaoRowRecebiveis({ excecao: e }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [resolvendo, setResolvendo] = useState(false);
  const [obs, setObs] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const nsu = e.vendaNsu ?? e.recebivelNsu ?? '—';
  const dataVenda = isoToBr(e.vendaDataVenda);
  const dataPgto = isoToBr(e.recebivelDataPagamento);
  const forma = e.vendaBandeira ?? e.vendaFormaPagamento ?? e.recebivelFormaPagamento ?? '—';

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
      <td className="px-4 py-2 font-mono text-xs text-slate-700">{dataVenda}</td>
      <td className="px-4 py-2 font-mono text-xs text-slate-700">{dataPgto}</td>
      <td className="px-4 py-2 font-mono text-xs text-slate-700">{nsu}</td>
      <td className="px-4 py-2 text-xs text-slate-700">{forma}</td>
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

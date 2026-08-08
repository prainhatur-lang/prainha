'use client';

// Barra de ações do documento de orçamento (escondida na impressão).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { STATUS_ORCAMENTO, type StatusOrcamento } from '@/lib/orcamentos';

interface Props {
  id: string;
  status: StatusOrcamento;
  podeEditar: boolean;
  podeDeletar: boolean;
}

export function DocActions({ id, status, podeEditar, podeDeletar }: Props) {
  const router = useRouter();
  const [mudando, setMudando] = useState(false);

  async function mudarStatus(novo: StatusOrcamento) {
    if (novo === status || mudando) return;
    setMudando(true);
    try {
      const r = await fetch(`/api/orcamentos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novo }),
      });
      if (r.ok) router.refresh();
    } finally {
      setMudando(false);
    }
  }

  async function excluir() {
    if (!confirm('Excluir este orçamento? Essa ação não tem volta.')) return;
    const r = await fetch(`/api/orcamentos/${id}`, { method: 'DELETE' });
    if (r.ok) router.push('/orcamentos');
    else alert('Não foi possível excluir.');
  }

  return (
    <header className="border-b border-slate-200 bg-slate-50 px-4 py-3 print:hidden">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/orcamentos" className="text-sm text-blue-600 hover:underline">
            ← Orçamentos
          </Link>
          {podeEditar && (
            <div className="flex items-center gap-1">
              {(Object.keys(STATUS_ORCAMENTO) as StatusOrcamento[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={mudando}
                  onClick={() => mudarStatus(s)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                    s === status
                      ? STATUS_ORCAMENTO[s].cor + ' ring-1 ring-slate-300'
                      : 'text-slate-400 hover:bg-slate-100'
                  }`}
                  title={`Marcar como ${STATUS_ORCAMENTO[s].label.toLowerCase()}`}
                >
                  {STATUS_ORCAMENTO[s].label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {podeDeletar && (
            <button
              type="button"
              onClick={excluir}
              className="rounded-md px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50"
            >
              Excluir
            </button>
          )}
          {podeEditar && (
            <Link
              href={`/orcamentos/${id}/editar`}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              ✏️ Editar
            </Link>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            🖨 Imprimir / Salvar PDF
          </button>
        </div>
      </div>
    </header>
  );
}

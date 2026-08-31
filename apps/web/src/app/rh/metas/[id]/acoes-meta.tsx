'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AcoesMeta({ metaId, status, bateuMeta }: { metaId: string; status: string; bateuMeta: boolean | null }) {
  const router = useRouter();
  const [carregando, setCarregando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function chamar(acao: string, method: 'POST' | 'DELETE' = 'POST') {
    setCarregando(acao);
    setErro(null);
    try {
      const url = acao === 'excluir' ? `/api/metas/${metaId}` : `/api/metas/${metaId}/${acao}`;
      const res = await fetch(url, { method });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error ?? 'Erro na ação');
        return;
      }
      router.refresh();
    } finally {
      setCarregando(null);
    }
  }

  return (
    <div>
      {erro && <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        {status === 'aberta' && (
          <button
            onClick={() => chamar('avaliar')}
            disabled={carregando !== null}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {carregando === 'avaliar' ? 'Avaliando…' : '✅ Avaliar meta'}
          </button>
        )}
        {status === 'avaliada' && bateuMeta && (
          <button
            onClick={() => chamar('vincular-folha')}
            disabled={carregando !== null}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {carregando === 'vincular-folha' ? 'Vinculando…' : '🔗 Vincular à folha'}
          </button>
        )}
        {(status === 'avaliada' || status === 'vinculada') && (
          <button
            onClick={() => chamar('reabrir')}
            disabled={carregando !== null}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {carregando === 'reabrir' ? 'Reabrindo…' : '↩️ Reabrir'}
          </button>
        )}
        {status !== 'vinculada' && status !== 'cancelada' && (
          <button
            onClick={() => {
              if (confirm('Cancelar esta meta?')) chamar('excluir', 'DELETE');
            }}
            disabled={carregando !== null}
            className="rounded-md border border-rose-300 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            {status === 'aberta' ? '🗑️ Excluir' : '❌ Cancelar'}
          </button>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  filialId: string;
  tipo: string;
  qtd: number;
}

export function AceitarTodosBtn({ filialId, tipo, qtd }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function aceitar() {
    if (
      !confirm(
        `Aceitar TODAS as ${qtd} divergências dessa seção? Pra cada uma, sistema:\n\n` +
          `• Marca como aceita\n` +
          `• Aplica forma/bandeira da Cielo como efetiva\n` +
          `• Cria match firme manual (não volta a ser exceção)\n\n` +
          `Não pode ser desfeito facilmente. Continuar?`,
      )
    ) {
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/excecoes/aceitar-todos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId, tipo, processo: 'OPERADORA' }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(`Erro: ${d.error ?? r.status}`);
        return;
      }
      setMsg(`✓ ${d.aceitas} aceitas (${d.comFormaEfetiva} com correção de forma)`);
      start(() => router.refresh());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={aceitar}
        disabled={loading || pending}
        className="shrink-0 rounded-md border border-emerald-700 bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? 'Aceitando...' : `✓ Aceitar todos (${qtd})`}
      </button>
      {msg && <span className="text-[10px] text-slate-600">{msg}</span>}
    </div>
  );
}

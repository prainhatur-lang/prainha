'use client';
// Botão "Reativar" no selo Pausado da lista: tira a pausa de todos os tamanhos
// (a loja aplica no PDV em ~1 min). Reusa o ativar-lote com escopo = 1 produto.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ReativarProdutoButton({ filialId, produtoId }: { filialId: string; produtoId: string }) {
  const router = useRouter();
  const [estado, setEstado] = useState<'' | 'indo' | 'erro'>('');
  return (
    <button
      type="button"
      disabled={estado === 'indo'}
      onClick={async () => {
        setEstado('indo');
        const r = await fetch('/api/cadastros/produtos/ativar-lote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filialId, ativos: [produtoId], escopo: [produtoId] }),
        }).catch(() => null);
        if (!r || !r.ok) return setEstado('erro');
        router.refresh();
      }}
      className="ml-1 rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
      title="Voltar a vender: tira a pausa (a loja aplica no PDV em ~1 min)"
    >
      {estado === 'indo' ? '...' : estado === 'erro' ? 'falhou — tentar de novo' : 'Reativar'}
    </button>
  );
}

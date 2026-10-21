'use client';

// Cancela a cotação em aberto (não aprovada). Não apaga: fica "Cancelada" no
// histórico, o link do fornecedor para de aceitar resposta e os itens da Lista
// da semana voltam a ficar livres pra cotar de novo.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CancelarCotacaoButton({ cotacaoId, numero }: { cotacaoId: string; numero: number }) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function cancelar() {
    if (
      !confirm(
        `Cancelar a cotação #${numero}?\n\n` +
          '• ela fica como "Cancelada" (não some do histórico)\n' +
          '• o link dos fornecedores para de aceitar resposta\n' +
          '• os itens da Lista da semana voltam a ficar livres pra cotar de novo',
      )
    )
      return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/cotacao/${cotacaoId}/cancelar`, { method: 'POST' });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErro(d.error ?? `erro ${r.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void cancelar()}
        disabled={salvando}
        className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        title="Cancela a cotação (não apaga nada)"
      >
        {salvando ? 'Cancelando…' : '✕ Cancelar cotação'}
      </button>
      {erro && <span className="text-xs text-rose-600">⚠ {erro}</span>}
    </>
  );
}

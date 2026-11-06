'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function BotaoImprimirPedido() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 print:hidden"
    >
      🖨 Imprimir
    </button>
  );
}

/** Cancelar de dentro do pedido (dono 06/11/2026). Mesma rota da lista de /lelis/vender. */
export function BotaoCancelarPedido(props: { id: string; numero: number; casa: string; totalBr: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function cancelar() {
    if (
      !confirm(
        `Cancelar o pedido nº ${props.numero} (${props.casa}, ${props.totalBr})?\n\nO estoque volta pra Lelis, sai do estoque da casa o que ela já tiver conferido e a conta da casa é apagada.`,
      )
    )
      return;
    setEnviando(true);
    setErro(null);
    const r = await fetch(`/api/lelis/pedido?id=${props.id}`, { method: 'DELETE' });
    const js = (await r.json().catch(() => ({}))) as { error?: string };
    setEnviando(false);
    if (!r.ok) return setErro(js.error ?? 'erro ao cancelar');
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-1 print:hidden">
      <button
        onClick={cancelar}
        disabled={enviando}
        className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {enviando ? 'Cancelando…' : '✕ Cancelar pedido'}
      </button>
      {erro && <span className="max-w-xs text-right text-xs text-red-700">{erro}</span>}
    </span>
  );
}

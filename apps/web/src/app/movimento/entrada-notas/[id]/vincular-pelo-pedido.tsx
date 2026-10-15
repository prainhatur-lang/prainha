'use client';

// Vincula de uma vez os itens da nota ao insumo do pedido de compra quando a
// conversão é certa (valor bateu e o pedido está na unidade do insumo). Usa a
// mesma rota do "vincular produto" item a item (PATCH /api/nota-compra-item),
// então grava também o vínculo do fornecedor pras próximas notas.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export interface VinculoPedido {
  itemId: string;
  produtoId: string;
  fator: number;
  descricao: string;
  produtoNome: string;
}

export function VincularPeloPedidoBtn({
  vinculos,
  pedidos,
  outrosSugeridos,
}: {
  vinculos: VinculoPedido[];
  pedidos: number[];
  /** Itens com insumo do pedido sugerido mas conversão a conferir no item */
  outrosSugeridos: number;
}) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [, start] = useTransition();

  async function vincular() {
    setRodando(true);
    setErro(null);
    const falhas: string[] = [];
    const avisos: string[] = [];
    for (const v of vinculos) {
      const r = await fetch(`/api/nota-compra-item/${v.itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ produtoId: v.produtoId, fator: v.fator }),
      }).catch(() => null);
      const d = (await r?.json().catch(() => ({}))) as { error?: string; aviso?: string } | undefined;
      if (!r?.ok) falhas.push(`${v.descricao}: ${d?.error ?? r?.status ?? 'sem conexão'}`);
      else if (d?.aviso) avisos.push(d.aviso);
    }
    setRodando(false);
    if (falhas.length) setErro(falhas.join(' · '));
    if (avisos.length) alert(avisos.join('\n'));
    start(() => router.refresh());
  }

  const lista = pedidos.map((n) => `#${n}`).join(', ');
  return (
    <div className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <p className="text-sm font-semibold text-indigo-900">🧾 Insumos do pedido de compra {lista}</p>
      {vinculos.length > 0 ? (
        <>
          <p className="mt-1 text-xs text-indigo-800">
            {vinculos.length} item(ns) da nota bateram com o pedido no valor — dá pra vincular de uma vez:
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-indigo-900">
            {vinculos.map((v) => (
              <li key={v.itemId}>
                {v.descricao} → <b>{v.produtoNome}</b>
                {Math.abs(v.fator - 1) > 1e-9 && <span className="text-indigo-700"> (×{v.fator.toLocaleString('pt-BR')})</span>}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={vincular}
            disabled={rodando}
            className="mt-3 rounded-md bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
          >
            {rodando ? 'Vinculando…' : `Vincular ${vinculos.length} item(ns) pelo pedido`}
          </button>
        </>
      ) : null}
      {outrosSugeridos > 0 && (
        <p className="mt-2 text-xs text-indigo-800">
          {outrosSugeridos} item(ns) com o insumo do pedido sugerido na coluna <b>Produto interno</b> (botão 🧾) —
          clique e confira quantas unidades vêm em cada embalagem.
        </p>
      )}
      {erro && <p className="mt-2 text-xs text-red-700">Não vinculou: {erro}</p>}
    </div>
  );
}

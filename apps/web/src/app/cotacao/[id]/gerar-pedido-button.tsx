'use client';

// Pedido pro fornecedor que respondeu DEPOIS da aprovação.
//
// A aprovação é única: ela gera os pedidos de todo mundo e trava a cotação.
// Quem chega atrasado — a Vinhedo do Fernando, que mandou os preços depois que
// os pedidos já tinham saído — ficava sem pedido e sem caminho no app.
// Aqui o gestor marca o que quer comprar dela e gera o pedido à parte.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

export interface ItemPraPedido {
  cotacaoItemId: string;
  produtoNome: string;
  qtd: number;
  unidade: string;
  preco: number;
  total: number;
  marcaNome: string | null;
  /** Quem já levou esse produto nesta cotação — se preenchido, não dá pra pedir de novo. */
  jaPedidoPor: string | null;
}

export function GerarPedidoButton({
  cotacaoId,
  cotacaoFornecedorId,
  fornecedorNome,
  itens,
}: {
  cotacaoId: string;
  cotacaoFornecedorId: string;
  fornecedorNome: string;
  itens: ItemPraPedido[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const livres = itens.filter((i) => !i.jaPedidoPor);
  const [marcados, setMarcados] = useState<Set<string>>(
    () => new Set(livres.map((i) => i.cotacaoItemId)),
  );

  if (itens.length === 0) return <span className="text-[10px] text-slate-400">sem preço</span>;

  const total = itens
    .filter((i) => marcados.has(i.cotacaoItemId))
    .reduce((a, i) => a + i.total, 0);

  function alternar(id: string) {
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function gerar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/cotacao/${cotacaoId}/gerar-pedido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cotacaoFornecedorId, itemIds: [...marcados] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      setAberto(false);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded bg-violet-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-violet-700"
        title={`${fornecedorNome} respondeu mas ficou sem pedido — gerar o dele agora`}
      >
        🧾 Gerar pedido
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-slate-900">Gerar pedido — {fornecedorNome}</h3>
        <p className="mt-1 text-[11px] text-slate-500">
          Esta cotação já foi aprovada. Marque o que quer comprar deste fornecedor: vai virar um
          pedido novo, com número próprio.
        </p>

        <div className="mt-3 space-y-1">
          {itens.map((i) => {
            const bloqueado = !!i.jaPedidoPor;
            return (
              <label
                key={i.cotacaoItemId}
                className={`flex items-start gap-2 rounded border px-2 py-1.5 text-xs ${
                  bloqueado
                    ? 'border-slate-200 bg-slate-50 text-slate-400'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={bloqueado}
                  checked={marcados.has(i.cotacaoItemId)}
                  onChange={() => alternar(i.cotacaoItemId)}
                />
                <span className="flex-1">
                  <span className="font-medium text-slate-900">{i.produtoNome}</span>
                  {i.marcaNome && <span className="text-slate-500"> · {i.marcaNome}</span>}
                  <span className="block text-[10px] text-slate-500">
                    {i.qtd.toLocaleString('pt-BR')} {i.unidade} × {brl(i.preco)} ={' '}
                    <strong>{brl(i.total)}</strong>
                  </span>
                  {bloqueado && (
                    <span className="block text-[10px] text-rose-600">
                      já pedido a {i.jaPedidoPor}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
          <div className="text-sm">
            Total: <strong className="text-slate-900">{brl(total)}</strong>{' '}
            <span className="text-[11px] text-slate-500">({marcados.size} item(s))</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void gerar()}
              disabled={salvando || marcados.size === 0}
              className="rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {salvando ? 'Gerando…' : 'Gerar pedido'}
            </button>
          </div>
        </div>
        {erro && <div className="mt-2 text-[11px] text-rose-600">⚠ {erro}</div>}
      </div>
    </div>
  );
}

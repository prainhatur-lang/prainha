'use client';

import { useMemo, useState } from 'react';

export type ProdutoEstoque = {
  id: string;
  descricao: string;
  ean: string | null;
  fornecedor: string | null;
  unidade: string;
  saldo: number;
  custo: number;
  preco: number | null;
};

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const limpa = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function EstoqueLelis({ produtos }: { produtos: ProdutoEstoque[] }) {
  const [busca, setBusca] = useState('');
  const [todos, setTodos] = useState(false);

  const vistos = useMemo(() => {
    const termos = limpa(busca).split(/\s+/).filter(Boolean);
    return produtos.filter((p) => {
      if (!todos && p.saldo === 0) return false;
      if (termos.length === 0) return true;
      const alvo = limpa(`${p.descricao} ${p.ean ?? ''} ${p.fornecedor ?? ''}`);
      return termos.every((t) => alvo.includes(t));
    });
  }, [produtos, busca, todos]);

  const comSaldo = produtos.filter((p) => p.saldo > 0);
  const negativos = produtos.filter((p) => p.saldo < 0).length;
  const totalCusto = vistos.reduce((s, p) => s + Math.max(p.saldo, 0) * p.custo, 0);
  const totalVenda = vistos.reduce((s, p) => s + Math.max(p.saldo, 0) * (p.preco ?? 0), 0);
  const totalUn = vistos.reduce((s, p) => s + Math.max(p.saldo, 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Produtos com estoque</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900">{comSaldo.length}</div>
          {negativos > 0 && <div className="text-xs font-medium text-red-700">{negativos} com saldo negativo</div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Vale a custo (o que está na lista)</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900">{brl(totalCusto)}</div>
          <div className="text-xs text-slate-500">{qtd(totalUn)} unidade(s)</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Vale a preço pra empresa</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900">{brl(totalVenda)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar produto, código de barras ou fornecedor…"
          className="min-w-64 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
          Mostrar também os zerados
        </label>
        <button onClick={() => window.print()} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          Imprimir
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2 text-right">Em estoque</th>
              <th className="px-3 py-2 text-right">Custo un.</th>
              <th className="px-3 py-2 text-right">Vale a custo</th>
              <th className="px-3 py-2 text-right">Preço pra empresa</th>
            </tr>
          </thead>
          <tbody>
            {vistos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">
                  {produtos.length === 0
                    ? 'Nenhum produto ainda. Dê entrada nas notas de compra em Preços e notas.'
                    : 'Nada com estoque nessa busca. Marque “Mostrar também os zerados” pra ver todos.'}
                </td>
              </tr>
            )}
            {vistos.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 align-top">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{p.descricao}</div>
                  <div className="text-xs text-slate-500">
                    {[p.fornecedor, p.ean ? `EAN ${p.ean}` : null].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right font-mono text-base font-semibold ${p.saldo < 0 ? 'text-red-700' : p.saldo === 0 ? 'text-slate-400' : 'text-slate-900'}`}>
                  {qtd(p.saldo)} <span className="text-xs font-normal text-slate-500">{p.unidade}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{brl(p.custo)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{brl(Math.max(p.saldo, 0) * p.custo)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{p.preco != null ? brl(p.preco) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

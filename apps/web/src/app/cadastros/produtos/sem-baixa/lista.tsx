'use client';

// Marcar controle de estoque em lote, direto da lista de quem vende sem baixar.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface LinhaSemBaixa {
  id: string;
  nome: string | null;
  filial: string;
  vendas: number;
  quantidade: string;
  temFicha: boolean;
}

export function ListaSemBaixa({ linhas }: { linhas: LinhaSemBaixa[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function alternar(id: string) {
    const novo = new Set(sel);
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    setSel(novo);
  }

  async function marcar() {
    if (sel.size === 0 || salvando) return;
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/produtos/controle-estoque', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [...sel], controlaEstoque: true }),
      });
      const d = await r.json();
      if (!r.ok) setMsg(d.error ?? 'não deu pra marcar');
      else {
        setMsg(`${d.alterados} produto(s) passaram a controlar estoque.`);
        setSel(new Set());
        setTimeout(() => router.refresh(), 1200);
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <div className="text-xs text-slate-600">
          {sel.size > 0 ? `${sel.size} selecionado(s)` : `${linhas.length} produto(s)`}
          <button
            type="button"
            onClick={() => setSel(sel.size === linhas.length ? new Set() : new Set(linhas.map((l) => l.id)))}
            className="ml-3 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] hover:bg-slate-50"
          >
            {sel.size === linhas.length ? 'limpar' : 'selecionar todos'}
          </button>
        </div>
        <button
          type="button"
          onClick={marcar}
          disabled={sel.size === 0 || salvando}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {salvando ? 'marcando…' : 'Marcar controle de estoque'}
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="w-10 px-4 py-2" />
            <th className="px-4 py-2">Produto</th>
            <th className="px-4 py-2">Filial</th>
            <th className="px-4 py-2 text-right">Vendas (30d)</th>
            <th className="px-4 py-2 text-right">Qtd</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-2">
                <input
                  type="checkbox"
                  checked={sel.has(l.id)}
                  onChange={() => alternar(l.id)}
                  aria-label={`Selecionar ${l.nome ?? l.id}`}
                />
              </td>
              <td className="px-4 py-2">
                <a href={`/cadastros/produtos/${l.id}`} className="text-slate-800 hover:underline">
                  {l.nome ?? '(sem nome)'}
                </a>
              </td>
              <td className="px-4 py-2 text-xs text-slate-500">{l.filial}</td>
              <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">{l.vendas}</td>
              <td className="px-4 py-2 text-right font-mono text-xs text-slate-500">
                {Number(l.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
              </td>
            </tr>
          ))}
          {linhas.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-500">
                Nenhum produto vendendo sem baixar. 👏
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {msg && <p className="border-t border-slate-100 px-4 py-2 text-sm text-blue-800">{msg}</p>}
    </div>
  );
}

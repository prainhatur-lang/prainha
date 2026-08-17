'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { normalizaBusca } from '@/lib/texto';

export interface LinhaSugestao {
  produtoId: string;
  nome: string;
  unidade: string;
  categoria: string | null;
  atual: number;
  minimo: number | null;
  maximo: number | null;
  consumo7d: number;
  sugestao: number;
  base: 'minimo' | 'consumo';
  precisaRepor: boolean;
}

export interface FornecedorOpt {
  id: string;
  nome: string;
  categoria: string | null;
  valorPedidoMinimo: number | null;
}

interface Props {
  filialId: string;
  linhas: LinhaSugestao[];
  fornecedores: FornecedorOpt[];
  /** produtoId -> fornecedorIds que já têm vínculo com aquele produto */
  fornecedoresPorProduto: Record<string, string[]>;
}

function num(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export function SugestaoClient({ filialId, linhas, fornecedores, fornecedoresPorProduto }: Props) {
  const router = useRouter();
  const [qtd, setQtd] = useState<Record<string, number>>(
    () => Object.fromEntries(linhas.map((l) => [l.produtoId, l.sugestao])),
  );
  const [sel, setSel] = useState<Record<string, boolean>>(
    () => Object.fromEntries(linhas.map((l) => [l.produtoId, l.sugestao > 0])),
  );
  const [fornSel, setFornSel] = useState<Set<string>>(new Set());
  const [buscaForn, setBuscaForn] = useState('');
  const [catForn, setCatForn] = useState('');
  const [duracao, setDuracao] = useState(4);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const selecionados = useMemo(
    () => linhas.filter((l) => sel[l.produtoId] && (qtd[l.produtoId] ?? 0) > 0),
    [linhas, sel, qtd],
  );

  const categoriasForn = useMemo(
    () =>
      Array.from(new Set(fornecedores.map((f) => f.categoria).filter((c): c is string => !!c)))
        .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [fornecedores],
  );

  // Quantos dos itens selecionados cada fornecedor já vende (produto_fornecedor).
  const supplyPorForn = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of selecionados) {
      for (const fId of fornecedoresPorProduto[l.produtoId] ?? []) {
        map.set(fId, (map.get(fId) ?? 0) + 1);
      }
    }
    return map;
  }, [selecionados, fornecedoresPorProduto]);

  const fornecedoresFiltrados = useMemo(() => {
    const q = normalizaBusca(buscaForn.trim());
    return fornecedores
      .filter((f) => {
        if (catForn && f.categoria !== catForn) return false;
        if (q && !normalizaBusca(f.nome).includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        // Quem atende mais itens da sugestão vem primeiro.
        const sa = supplyPorForn.get(a.id) ?? 0;
        const sb = supplyPorForn.get(b.id) ?? 0;
        if (sa !== sb) return sb - sa;
        return a.nome.localeCompare(b.nome, 'pt-BR');
      });
  }, [fornecedores, buscaForn, catForn, supplyPorForn]);

  const temRecomendado = supplyPorForn.size > 0;

  function toggleForn(id: string) {
    setFornSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function marcarRecomendados() {
    setFornSel(new Set(supplyPorForn.keys()));
  }

  async function gerarCotacao() {
    setErro(null);
    if (selecionados.length === 0) return setErro('Selecione ao menos 1 produto com quantidade > 0.');
    if (fornSel.size === 0) return setErro('Selecione ao menos 1 fornecedor.');
    setEnviando(true);
    try {
      const r = await fetch('/api/cotacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          duracaoHoras: duracao,
          observacao: 'Gerada a partir da sugestão de compra (estoque + consumo)',
          itens: selecionados.map((l) => ({
            produtoId: l.produtoId,
            quantidade: qtd[l.produtoId],
            observacao: null,
          })),
          fornecedorIds: Array.from(fornSel),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      router.push(`/cotacao/${d.id}`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (linhas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-sm text-slate-500">
          🎉 Nada pra repor agora. Tudo abastecido.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          A sugestão considera produtos com <b>categoria de compras</b> definida: repõe quando o
          estoque chega no mínimo, ou (sem mínimo) quando há menos de 1 semana de consumo em estoque.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2 w-8"></th>
              <th className="px-3 py-2 text-left font-medium">Produto</th>
              <th className="px-3 py-2 text-left font-medium">Categoria</th>
              <th className="px-3 py-2 text-right font-medium">Atual</th>
              <th className="px-3 py-2 text-right font-medium">Mín</th>
              <th className="px-3 py-2 text-right font-medium">Máx</th>
              <th className="px-3 py-2 text-right font-medium">Consumo 7d</th>
              <th className="px-3 py-2 text-right font-medium">Pedir</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const semMax = l.maximo == null;
              const risco = l.consumo7d > l.atual;
              return (
                <tr key={l.produtoId} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={!!sel[l.produtoId]}
                      onChange={(e) => setSel((p) => ({ ...p, [l.produtoId]: e.target.checked }))}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-slate-900">{l.nome}</div>
                    <div className="text-[10px] text-slate-400">
                      por {l.unidade}
                      {l.base === 'consumo' && <span className="ml-1 text-sky-600">base: consumo</span>}
                      {risco && <span className="ml-1 text-rose-600">⚠ consumo &gt; estoque</span>}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{l.categoria ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-700">{num(l.atual)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-amber-700">{l.minimo != null ? num(l.minimo) : '—'}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${semMax ? 'text-slate-300' : 'text-slate-700'}`}>
                    {semMax ? '—' : num(l.maximo as number)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-700">{num(l.consumo7d)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <input
                      type="number"
                      min={0}
                      step="0.001"
                      value={qtd[l.produtoId] ?? 0}
                      onChange={(e) =>
                        setQtd((p) => ({ ...p, [l.produtoId]: Math.max(0, Number(e.target.value)) }))
                      }
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Fornecedores + duração + ação */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Fornecedores que vão cotar</h2>
          <div className="flex items-center gap-2">
            {temRecomendado && (
              <button
                type="button"
                onClick={marcarRecomendados}
                className="rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-800 hover:bg-sky-100"
                title="Marca quem já tem vínculo com pelo menos 1 item da lista"
              >
                Marcar quem vende esses itens ({supplyPorForn.size})
              </button>
            )}
            <p className="text-xs text-slate-500">
              {selecionados.length} produto(s) · {fornSel.size} fornecedor(es)
            </p>
          </div>
        </div>
        {fornecedores.length === 0 ? (
          <p className="text-xs text-amber-700">
            Nenhum fornecedor marcado como ativo para compras. Marque em Cadastros → Fornecedores
            (ativoCompras).
          </p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input
                type="search"
                placeholder="Buscar fornecedor..."
                value={buscaForn}
                onChange={(e) => setBuscaForn(e.target.value)}
                className="flex-1 rounded-md border border-slate-200 px-3 py-1 text-xs"
              />
              <select
                value={catForn}
                onChange={(e) => setCatForn(e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs"
              >
                <option value="">Todas categorias</option>
                {categoriasForn.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-slate-400">
                {fornecedoresFiltrados.length} de {fornecedores.length}
              </span>
            </div>
            <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto md:grid-cols-2">
              {fornecedoresFiltrados.map((f) => {
                const on = fornSel.has(f.id);
                const supply = supplyPorForn.get(f.id) ?? 0;
                const naoVende = temRecomendado && supply === 0;
                return (
                  <label
                    key={f.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-xs ${
                      on
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                        : naoVende
                          ? 'border-slate-200 bg-slate-50 text-slate-400 opacity-60'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleForn(f.id)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="flex-1">{f.nome}</span>
                    {supply > 0 && (
                      <span
                        className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-medium text-sky-900"
                        title={`Tem vínculo com ${supply} dos ${selecionados.length} itens selecionados`}
                      >
                        {supply}/{selecionados.length}
                      </span>
                    )}
                    {f.valorPedidoMinimo != null && f.valorPedidoMinimo > 0 && (
                      <span
                        className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800"
                        title={`Pedido mínimo: R$ ${f.valorPedidoMinimo.toFixed(2).replace('.', ',')}`}
                      >
                        mín. R$ {f.valorPedidoMinimo.toFixed(0)}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400">{f.categoria ?? '—'}</span>
                  </label>
                );
              })}
              {fornecedoresFiltrados.length === 0 && (
                <p className="col-span-full p-2 text-xs text-slate-400">
                  Nenhum fornecedor com esse filtro.
                </p>
              )}
            </div>
          </>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Prazo de resposta (horas)
            </label>
            <input
              type="number"
              min={1}
              value={duracao}
              onChange={(e) => setDuracao(Math.max(1, Number(e.target.value)))}
              className="mt-1 w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
            />
          </div>
          <button
            type="button"
            onClick={gerarCotacao}
            disabled={enviando || selecionados.length === 0 || fornSel.size === 0}
            className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:bg-slate-400"
          >
            {enviando ? 'Gerando…' : `📝 Gerar cotação (${selecionados.length} itens)`}
          </button>
        </div>
        {erro && <p className="mt-2 text-xs text-rose-600">{erro}</p>}
      </div>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

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
}

interface Props {
  filialId: string;
  linhas: LinhaSugestao[];
  fornecedores: FornecedorOpt[];
}

function num(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export function SugestaoClient({ filialId, linhas, fornecedores }: Props) {
  const router = useRouter();
  const [qtd, setQtd] = useState<Record<string, number>>(
    () => Object.fromEntries(linhas.map((l) => [l.produtoId, l.sugestao])),
  );
  const [sel, setSel] = useState<Record<string, boolean>>(
    () => Object.fromEntries(linhas.map((l) => [l.produtoId, l.sugestao > 0])),
  );
  const [fornSel, setFornSel] = useState<Set<string>>(new Set());
  const [duracao, setDuracao] = useState(4);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const selecionados = useMemo(
    () => linhas.filter((l) => sel[l.produtoId] && (qtd[l.produtoId] ?? 0) > 0),
    [linhas, sel, qtd],
  );

  function toggleForn(id: string) {
    setFornSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Fornecedores que vão cotar</h2>
          <p className="text-xs text-slate-500">
            {selecionados.length} produto(s) · {fornSel.size} fornecedor(es)
          </p>
        </div>
        {fornecedores.length === 0 ? (
          <p className="text-xs text-amber-700">
            Nenhum fornecedor marcado como ativo para compras. Marque em Cadastros → Fornecedores
            (ativoCompras).
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {fornecedores.map((f) => {
              const on = fornSel.has(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => toggleForn(f.id)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    on
                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                  title={f.categoria ?? ''}
                >
                  {on ? '✓ ' : ''}
                  {f.nome}
                </button>
              );
            })}
          </div>
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

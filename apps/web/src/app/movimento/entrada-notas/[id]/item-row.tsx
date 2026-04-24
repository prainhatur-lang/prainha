'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { brl } from '@/lib/format';

interface Item {
  id: string;
  numeroItem: number;
  codigoProdutoFornecedor: string | null;
  ean: string | null;
  descricao: string | null;
  unidade: string | null;
  quantidade: string | null;
  valorUnitario: string | null;
  valorTotal: string | null;
  produtoId: string | null;
  produtoNome: string | null;
  produtoTipo: string | null;
  produtoUnidade: string | null;
  lancado: boolean;
}

interface ProdutoOpcao {
  id: string;
  nome: string;
  tipo: string;
  unidade: string;
  codigo: string | null;
}

export function ItemRow({
  item,
  produtosDisponiveis,
  filialId,
}: {
  item: Item;
  produtosDisponiveis: ProdutoOpcao[];
  filialId: string;
}) {
  const router = useRouter();
  const [modal, setModal] = useState(false);
  const [pending, start] = useTransition();

  async function vincular(produtoId: string | null) {
    const r = await fetch(`/api/nota-compra-item/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ produtoId }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return false;
    }
    setModal(false);
    start(() => router.refresh());
    return true;
  }

  const qtd = Number(item.quantidade ?? 0);
  const unit = Number(item.valorUnitario ?? 0);

  return (
    <tr
      className={`border-t border-slate-100 ${item.lancado ? 'bg-slate-50/60 text-slate-500' : ''}`}
    >
      <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{item.numeroItem}</td>
      <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
        {item.codigoProdutoFornecedor || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
        {item.ean || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2 text-xs">
        <div className="max-w-xs truncate" title={item.descricao ?? ''}>
          {item.descricao || '—'}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">{qtd}</td>
      <td className="px-3 py-2 font-mono text-[10px] text-slate-500">
        {item.unidade || '—'}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">{brl(unit)}</td>
      <td className="px-3 py-2 text-right font-mono text-xs font-medium">
        {brl(Number(item.valorTotal ?? 0))}
      </td>
      <td className="px-3 py-2 text-xs">
        {item.produtoId && item.produtoNome ? (
          <div className="flex items-center gap-2">
            <Link
              href={`/cadastros/produtos/${item.produtoId}`}
              className="max-w-[180px] truncate text-slate-800 hover:underline"
              title={item.produtoNome}
            >
              {item.produtoNome}
            </Link>
            {item.produtoTipo === 'INSUMO' && (
              <span className="rounded bg-sky-100 px-1 py-0.5 text-[9px] text-sky-800">
                insumo
              </span>
            )}
            {item.lancado ? (
              <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] text-emerald-800">
                ✓ lançado
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setModal(true)}
                className="text-[10px] text-slate-500 hover:text-slate-800 hover:underline"
              >
                trocar
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setModal(true)}
            className="rounded border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-500 hover:border-slate-500 hover:text-slate-800"
          >
            vincular produto
          </button>
        )}
      </td>

      {modal && (
        <ModalVincular
          item={item}
          produtosDisponiveis={produtosDisponiveis}
          filialId={filialId}
          onFechar={() => setModal(false)}
          onVincular={vincular}
        />
      )}
    </tr>
  );
}

function ModalVincular({
  item,
  produtosDisponiveis,
  filialId,
  onFechar,
  onVincular,
}: {
  item: Item;
  produtosDisponiveis: ProdutoOpcao[];
  filialId: string;
  onFechar: () => void;
  onVincular: (produtoId: string | null) => Promise<boolean>;
}) {
  const [busca, setBusca] = useState((item.descricao ?? '').slice(0, 30));
  const [pending, start] = useTransition();
  const [aba, setAba] = useState<'vincular' | 'criar'>('vincular');

  // Aba "criar insumo" state
  const [nomeInsumo, setNomeInsumo] = useState(item.descricao ?? '');
  const [unidadeInsumo, setUnidadeInsumo] = useState<'un' | 'ml' | 'g' | 'kg' | 'l'>('un');
  const [erroCriar, setErroCriar] = useState<string | null>(null);

  const opcoes = useMemo(() => {
    const b = busca.trim().toLowerCase();
    if (!b) return produtosDisponiveis.slice(0, 30);
    return produtosDisponiveis
      .filter((p) => {
        const nome = p.nome.toLowerCase();
        const cod = (p.codigo ?? '').toLowerCase();
        return nome.includes(b) || cod.includes(b);
      })
      .slice(0, 50);
  }, [busca, produtosDisponiveis]);

  async function criarEVincular(e: React.FormEvent) {
    e.preventDefault();
    if (!nomeInsumo.trim()) return;
    setErroCriar(null);
    try {
      const r = await fetch('/api/produtos/insumo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId,
          nome: nomeInsumo.trim(),
          unidadeEstoque: unidadeInsumo,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErroCriar(d.error ?? `HTTP ${r.status}`);
        return;
      }
      if (d.id) await onVincular(d.id);
    } catch (err) {
      setErroCriar((err as Error).message);
    }
  }

  return (
    <td colSpan={9} className="p-0">
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
        onClick={onFechar}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Vincular produto</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Item #{item.numeroItem}:{' '}
              <span className="font-medium text-slate-700">{item.descricao}</span>
            </p>
            <p className="font-mono text-[10px] text-slate-400">
              EAN {item.ean || '—'} · Cód {item.codigoProdutoFornecedor || '—'}
            </p>
          </div>

          <div className="flex gap-1 border-b border-slate-200">
            <button
              type="button"
              onClick={() => setAba('vincular')}
              className={`border-b-2 px-3 py-1.5 text-xs ${
                aba === 'vincular'
                  ? 'border-slate-900 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Vincular existente
            </button>
            <button
              type="button"
              onClick={() => setAba('criar')}
              className={`border-b-2 px-3 py-1.5 text-xs ${
                aba === 'criar'
                  ? 'border-slate-900 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Criar novo insumo
            </button>
          </div>

          {aba === 'vincular' ? (
            <>
              <div>
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  autoFocus
                  placeholder="Buscar por nome ou código..."
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>

              <div className="max-h-80 overflow-y-auto rounded-md border border-slate-200">
                {opcoes.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-slate-500">
                    Nenhum produto encontrado. Tente criar um novo insumo.
                  </div>
                ) : (
                  opcoes.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      disabled={pending}
                      onClick={() => start(async () => { await onVincular(p.id); })}
                      className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-slate-800">{p.nome}</div>
                        {p.codigo && (
                          <div className="font-mono text-[10px] text-slate-400">{p.codigo}</div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                          {p.tipo === 'INSUMO'
                            ? 'insumo'
                            : p.tipo === 'VENDA_SIMPLES'
                              ? 'produto'
                              : p.tipo.toLowerCase()}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">{p.unidade}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <form onSubmit={criarEVincular} className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Nome do insumo *
                </label>
                <input
                  type="text"
                  value={nomeInsumo}
                  onChange={(e) => setNomeInsumo(e.target.value)}
                  autoFocus
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Unidade de estoque *
                </label>
                <select
                  value={unidadeInsumo}
                  onChange={(e) => setUnidadeInsumo(e.target.value as typeof unidadeInsumo)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <option value="un">un</option>
                  <option value="ml">ml</option>
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                  <option value="l">l</option>
                </select>
              </div>
              <p className="text-[10px] text-slate-500">
                Insumo será criado como "nuvem" e já vinculado a este item. O
                código/EAN do fornecedor vão pro mapeamento de fornecedor
                automaticamente.
              </p>
              {erroCriar && (
                <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  {erroCriar}
                </div>
              )}
              <button
                type="submit"
                disabled={pending || !nomeInsumo.trim()}
                className="w-full rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {pending ? 'Criando...' : 'Criar insumo + vincular'}
              </button>
            </form>
          )}

          <div className="flex justify-between border-t border-slate-100 pt-3">
            {item.produtoId ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => { await onVincular(null); })}
                className="text-[11px] text-rose-600 hover:text-rose-800 hover:underline"
              >
                Desvincular
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onFechar}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </td>
  );
}

'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface LinhaFicha {
  id: string;
  insumoId: string;
  insumoNome: string;
  insumoTipo: string;
  insumoUnidade: string;
  insumoControla: boolean;
  quantidade: string;
  baixaEstoque: boolean;
  observacao: string | null;
}

interface UsadoEm {
  id: string;
  produtoId: string;
  produtoNome: string;
  quantidade: string;
}

interface InsumoOpcao {
  id: string;
  nome: string;
  tipo: string;
  unidade: string;
}

export function AbaFicha({
  produtoId,
  produtoTipo,
  linhas,
  usadoEm,
  insumosDisponiveis,
}: {
  produtoId: string;
  produtoTipo: string;
  linhas: LinhaFicha[];
  usadoEm: UsadoEm[];
  insumosDisponiveis: InsumoOpcao[];
}) {
  const router = useRouter();
  const [adicionar, setAdicionar] = useState(false);
  const [busca, setBusca] = useState('');
  const [insumoId, setInsumoId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [baixaEstoque, setBaixaEstoque] = useState(true);
  const [observacao, setObservacao] = useState('');
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const idsJaNaFicha = useMemo(() => new Set(linhas.map((l) => l.insumoId)), [linhas]);
  const opcoesFiltradas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return insumosDisponiveis
      .filter((i) => !idsJaNaFicha.has(i.id))
      .filter((i) => (b ? i.nome.toLowerCase().includes(b) : true))
      .slice(0, 50);
  }, [busca, insumosDisponiveis, idsJaNaFicha]);

  const insumoEscolhido = insumosDisponiveis.find((i) => i.id === insumoId) ?? null;

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!insumoId) return;
    const q = Number(quantidade.replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) {
      setErro('Quantidade inválida');
      return;
    }
    setErro(null);
    try {
      const r = await fetch('/api/ficha', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          produtoId,
          insumoId,
          quantidade: q,
          baixaEstoque,
          observacao: observacao.trim() || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setAdicionar(false);
      setInsumoId('');
      setBusca('');
      setQuantidade('');
      setObservacao('');
      setBaixaEstoque(true);
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/ficha/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return false;
    }
    return true;
  }

  async function remover(id: string, nome: string) {
    if (!confirm(`Remover "${nome}" da ficha?`)) return;
    const r = await fetch(`/api/ficha/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return;
    }
    start(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      {produtoTipo === 'INSUMO' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Este produto é um <strong>INSUMO</strong>. Normalmente só aparece nas fichas de
          outros produtos. Veja a seção "Usado em" abaixo.
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Insumos consumidos</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Quantidade consumida por 1 unidade deste produto (na unidade de estoque do
            insumo). Linhas com <em>baixa</em> desligada não geram movimento de estoque.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdicionar(true)}
          className="rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          + Adicionar insumo
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Insumo</th>
              <th className="px-4 py-2 text-right">Quantidade</th>
              <th className="px-4 py-2">Un.</th>
              <th className="px-4 py-2">Baixa estoque</th>
              <th className="px-4 py-2">Obs</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-xs text-slate-500">
                  Nenhum insumo na ficha. Clique em "Adicionar insumo" pra começar.
                </td>
              </tr>
            ) : (
              linhas.map((l) => (
                <LinhaFichaRow
                  key={l.id}
                  linha={l}
                  onChange={async (patchBody) => {
                    const ok = await patch(l.id, patchBody);
                    if (ok) start(() => router.refresh());
                  }}
                  onRemove={() => remover(l.id, l.insumoNome)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {usadoEm.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-900">
            Usado em {usadoEm.length} {usadoEm.length === 1 ? 'produto' : 'produtos'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Produtos compostos que consomem este como insumo.
          </p>
          <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Produto</th>
                  <th className="px-4 py-2 text-right">Qtd por unidade</th>
                </tr>
              </thead>
              <tbody>
                {usadoEm.map((u) => (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-xs">
                      <Link
                        href={`/cadastros/produtos/${u.produtoId}`}
                        className="text-slate-800 hover:text-slate-900 hover:underline"
                      >
                        {u.produtoNome}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                      {Number(u.quantidade)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adicionar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setAdicionar(false)}
        >
          <form
            onSubmit={criar}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <h2 className="text-sm font-semibold text-slate-900">Adicionar insumo à ficha</h2>

            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Buscar insumo
              </label>
              <input
                type="text"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setInsumoId('');
                }}
                autoFocus
                placeholder="Digite pra filtrar..."
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              {busca.trim() && !insumoId && (
                <div className="mt-1 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-white">
                  {opcoesFiltradas.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-slate-500">
                      Nenhum insumo encontrado. Crie em{' '}
                      <Link href="/cadastros/produtos" className="text-slate-700 underline">
                        Produtos → Novo insumo
                      </Link>
                      .
                    </div>
                  ) : (
                    opcoesFiltradas.map((o) => (
                      <button
                        type="button"
                        key={o.id}
                        onClick={() => {
                          setInsumoId(o.id);
                          setBusca(o.nome);
                        }}
                        className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-left text-xs last:border-b-0 hover:bg-slate-50"
                      >
                        <span className="text-slate-800">{o.nome}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                            {o.tipo === 'INSUMO' ? 'insumo' : o.tipo === 'VENDA_SIMPLES' ? 'simples' : o.tipo}
                          </span>
                          <span className="font-mono text-[10px] text-slate-500">{o.unidade}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {insumoEscolhido && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{insumoEscolhido.nome}</span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {insumoEscolhido.unidade}
                  </span>
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Quantidade {insumoEscolhido ? `(${insumoEscolhido.unidade})` : ''} *
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                placeholder="Ex: 50 (ml), 1 (un), 0.3 (kg)"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                required
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={baixaEstoque}
                onChange={(e) => setBaixaEstoque(e.target.checked)}
              />
              Baixa estoque nesta linha (desmarcar pra decoração simbólica)
            </label>

            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Observação
              </label>
              <input
                type="text"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Ex: copo 300ml, decorar com casca"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>

            {erro && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {erro}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdicionar(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending || !insumoId || !quantidade.trim()}
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {pending ? 'Adicionando...' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function LinhaFichaRow({
  linha,
  onChange,
  onRemove,
}: {
  linha: LinhaFicha;
  onChange: (body: Record<string, unknown>) => Promise<void>;
  onRemove: () => void;
}) {
  const [editQtd, setEditQtd] = useState(false);
  const [qtd, setQtd] = useState(String(Number(linha.quantidade)));
  const [savingFlag, setSavingFlag] = useState(false);

  async function salvarQtd() {
    const q = Number(qtd.replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) {
      alert('Quantidade inválida');
      return;
    }
    await onChange({ quantidade: q });
    setEditQtd(false);
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2 text-xs">
        <Link
          href={`/cadastros/produtos/${linha.insumoId}`}
          className="text-slate-800 hover:underline"
        >
          {linha.insumoNome}
        </Link>
        {linha.insumoTipo !== 'INSUMO' && (
          <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-500">
            {linha.insumoTipo === 'VENDA_SIMPLES' ? 'simples' : linha.insumoTipo}
          </span>
        )}
        {!linha.insumoControla && (
          <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] text-amber-800">
            não controla
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-right font-mono text-xs">
        {editQtd ? (
          <input
            type="text"
            value={qtd}
            onChange={(e) => setQtd(e.target.value)}
            onBlur={salvarQtd}
            onKeyDown={(e) => {
              if (e.key === 'Enter') salvarQtd();
              if (e.key === 'Escape') {
                setQtd(String(Number(linha.quantidade)));
                setEditQtd(false);
              }
            }}
            autoFocus
            className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right text-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditQtd(true)}
            className="hover:bg-slate-50 px-1"
          >
            {Number(linha.quantidade)}
          </button>
        )}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-slate-500">{linha.insumoUnidade}</td>
      <td className="px-4 py-2">
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={linha.baixaEstoque}
            disabled={savingFlag}
            onChange={async (e) => {
              setSavingFlag(true);
              await onChange({ baixaEstoque: e.target.checked });
              setSavingFlag(false);
            }}
          />
          {linha.baixaEstoque ? 'Sim' : 'Não'}
        </label>
      </td>
      <td className="px-4 py-2 text-xs text-slate-500">
        {linha.observacao || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-4 py-2 text-right">
        <button
          type="button"
          onClick={onRemove}
          className="text-[10px] text-rose-600 hover:text-rose-800 hover:underline"
        >
          remover
        </button>
      </td>
    </tr>
  );
}

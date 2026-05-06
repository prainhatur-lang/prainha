'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface Produto {
  id: string;
  nome: string;
  tipo: string;
  categoria: string;
  unidade: string;
  marcasAceitas: string[];
}

interface Fornecedor {
  id: string;
  nome: string;
  categoria: string;
}

interface ItemSelecionado {
  produtoId: string;
  quantidade: string;
  observacao: string;
}

export function NovaCotacaoForm(props: {
  filialId: string;
  produtos: Produto[];
  fornecedores: Fornecedor[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [itens, setItens] = useState<Record<string, ItemSelecionado>>({});
  const [fornecedoresSelecionados, setFornecedoresSelecionados] = useState<Set<string>>(new Set());
  const [duracaoHoras, setDuracaoHoras] = useState('4');
  const [observacao, setObservacao] = useState('');
  const [filtro, setFiltro] = useState('');
  const [filtroForn, setFiltroForn] = useState('');
  const [categoriaFornFiltro, setCategoriaFornFiltro] = useState('');

  const produtosFiltrados = useMemo(() => {
    if (!filtro.trim()) return props.produtos;
    const q = filtro.toLowerCase();
    return props.produtos.filter(
      (p) => p.nome.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q),
    );
  }, [filtro, props.produtos]);

  const porCategoria = useMemo(() => {
    const grupos: Record<string, Produto[]> = {};
    for (const p of produtosFiltrados) {
      const cat = p.categoria;
      if (!grupos[cat]) grupos[cat] = [];
      grupos[cat].push(p);
    }
    return Object.entries(grupos).sort(([a], [b]) => a.localeCompare(b));
  }, [produtosFiltrados]);

  const categoriasForn = useMemo(() => {
    return Array.from(new Set(props.fornecedores.map((f) => f.categoria))).sort();
  }, [props.fornecedores]);

  const fornecedoresFiltrados = useMemo(() => {
    return props.fornecedores.filter((f) => {
      if (categoriaFornFiltro && f.categoria !== categoriaFornFiltro) return false;
      if (filtroForn.trim()) {
        const q = filtroForn.toLowerCase();
        if (!f.nome.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [props.fornecedores, filtroForn, categoriaFornFiltro]);

  function toggleProduto(p: Produto) {
    setItens((prev) => {
      if (prev[p.id]) {
        const { [p.id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [p.id]: { produtoId: p.id, quantidade: '', observacao: '' } };
    });
  }

  function setQuantidade(produtoId: string, valor: string) {
    setItens((prev) => ({ ...prev, [produtoId]: { ...prev[produtoId], quantidade: valor } }));
  }

  function toggleFornecedor(id: string) {
    setFornecedoresSelecionados((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    const itensArr = Object.values(itens);
    if (itensArr.length === 0) {
      setErro('Selecione pelo menos 1 item');
      return;
    }
    for (const i of itensArr) {
      const q = Number(i.quantidade.replace(',', '.'));
      if (!Number.isFinite(q) || q <= 0) {
        const p = props.produtos.find((x) => x.id === i.produtoId);
        setErro(`Quantidade inválida pra ${p?.nome ?? '?'}`);
        return;
      }
    }
    if (fornecedoresSelecionados.size === 0) {
      setErro('Selecione pelo menos 1 fornecedor');
      return;
    }

    const body = {
      filialId: props.filialId,
      duracaoHoras: Math.max(1, Math.min(72, Number(duracaoHoras) || 4)),
      observacao: observacao.trim() || null,
      itens: itensArr.map((i) => ({
        produtoId: i.produtoId,
        quantidade: Number(i.quantidade.replace(',', '.')),
        observacao: i.observacao || null,
      })),
      fornecedorIds: Array.from(fornecedoresSelecionados),
    };

    try {
      const r = await fetch('/api/cotacao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      start(() => router.push(`/cotacao/${d.id}`));
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  const itensCount = Object.keys(itens).length;

  return (
    <form onSubmit={enviar} className="space-y-6">
      {/* Itens */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Itens da cotação</h2>
          <span className="text-xs text-slate-500">{itensCount} selecionados</span>
        </div>
        <input
          type="search"
          placeholder="Buscar produto..."
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="mb-3 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm"
        />
        <div className="max-h-96 overflow-y-auto rounded-md border border-slate-100">
          {porCategoria.length === 0 ? (
            <p className="p-3 text-xs text-slate-500">Nenhum produto encontrado.</p>
          ) : (
            porCategoria.map(([cat, lista]) => (
              <div key={cat} className="border-b border-slate-100 last:border-b-0">
                <div className="bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {cat}
                </div>
                {lista.map((p) => {
                  const sel = itens[p.id];
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                        sel ? 'bg-emerald-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!!sel}
                        onChange={() => toggleProduto(p)}
                        className="h-3.5 w-3.5"
                      />
                      <button
                        type="button"
                        onClick={() => toggleProduto(p)}
                        className="flex-1 text-left"
                      >
                        <span className="font-medium text-slate-800">{p.nome}</span>
                        <span className="ml-2 text-[10px] text-slate-400">
                          [{p.tipo} / {p.unidade}]
                        </span>
                        {p.marcasAceitas.length > 0 && (
                          <span className="ml-2 inline-flex flex-wrap items-center gap-1">
                            {p.marcasAceitas.map((m) => (
                              <span
                                key={m}
                                className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-medium text-sky-800"
                              >
                                {m}
                              </span>
                            ))}
                          </span>
                        )}
                      </button>
                      {sel && (
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder={`qtd em ${p.unidade}`}
                          value={sel.quantidade}
                          onChange={(e) => setQuantidade(p.id, e.target.value)}
                          className="w-24 rounded border border-slate-200 px-2 py-0.5 text-xs"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Fornecedores */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Fornecedores convocados</h2>
          <span className="text-xs text-slate-500">
            {fornecedoresSelecionados.size}/{props.fornecedores.length} selecionados
          </span>
        </div>
        {props.fornecedores.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nenhum fornecedor marcado como <strong>ativo pra compras</strong>. Rode{' '}
            <code>pnpm --filter @concilia/db seed:fornecedores</code> ou marque os fornecedores em{' '}
            <a href="/cadastros/fornecedores" className="text-sky-600 hover:underline">
              Cadastros · Fornecedores
            </a>
            .
          </p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input
                type="search"
                placeholder="Buscar fornecedor..."
                value={filtroForn}
                onChange={(e) => setFiltroForn(e.target.value)}
                className="flex-1 rounded-md border border-slate-200 px-3 py-1 text-xs"
              />
              <select
                value={categoriaFornFiltro}
                onChange={(e) => setCategoriaFornFiltro(e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs"
              >
                <option value="">Todas categorias</option>
                {categoriasForn.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
              {fornecedoresFiltrados.map((f) => (
                <label
                  key={f.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-xs ${
                    fornecedoresSelecionados.has(f.id)
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={fornecedoresSelecionados.has(f.id)}
                    onChange={() => toggleFornecedor(f.id)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="flex-1">{f.nome}</span>
                  <span className="text-[10px] text-slate-400">{f.categoria}</span>
                </label>
              ))}
              {fornecedoresFiltrados.length === 0 && (
                <p className="col-span-full p-2 text-xs text-slate-400">
                  Nenhum fornecedor com esse filtro.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {/* Configuração */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Configuração</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Janela de resposta (horas)
            </label>
            <input
              type="number"
              min={1}
              max={72}
              value={duracaoHoras}
              onChange={(e) => setDuracaoHoras(e.target.value)}
              className="w-32 rounded border border-slate-200 px-2 py-1 text-sm"
            />
            <p className="mt-1 text-[10px] text-slate-500">
              Default 4h. Após a janela, sistema avalia respostas e seleciona vencedores.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Observação</label>
            <textarea
              rows={2}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Visível pros fornecedores"
              className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
            />
          </div>
        </div>
      </section>

      {erro && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {erro}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <a
          href="/cotacao"
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
        >
          Cancelar
        </a>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? 'Criando...' : 'Criar cotação'}
        </button>
      </div>
    </form>
  );
}

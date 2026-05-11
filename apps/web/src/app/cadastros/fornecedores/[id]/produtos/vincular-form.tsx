'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Produto {
  id: string;
  nome: string;
  tipo: string;
  categoria: string;
  unidade: string;
}

export function VincularProdutosForm({
  fornecedorId,
  produtos,
  vinculadosIniciais,
}: {
  fornecedorId: string;
  produtos: Produto[];
  vinculadosIniciais: string[];
}) {
  const router = useRouter();
  const [marcados, setMarcados] = useState<Set<string>>(new Set(vinculadosIniciais));
  const [filtro, setFiltro] = useState('');
  const [pending, start] = useTransition();
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  // Detecta mudanca pra habilitar/destacar botao salvar
  const inicial = useMemo(() => new Set(vinculadosIniciais), [vinculadosIniciais]);
  const mudou = useMemo(() => {
    if (marcados.size !== inicial.size) return true;
    for (const id of marcados) if (!inicial.has(id)) return true;
    return false;
  }, [marcados, inicial]);

  // Filtro de busca
  const produtosFiltrados = useMemo(() => {
    if (!filtro.trim()) return produtos;
    const q = filtro.toLowerCase();
    return produtos.filter(
      (p) => p.nome.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q),
    );
  }, [produtos, filtro]);

  // Agrupa por categoria
  const porCategoria = useMemo(() => {
    const grupos: Record<string, Produto[]> = {};
    for (const p of produtosFiltrados) {
      if (!grupos[p.categoria]) grupos[p.categoria] = [];
      grupos[p.categoria].push(p);
    }
    return Object.entries(grupos).sort(([a], [b]) => a.localeCompare(b));
  }, [produtosFiltrados]);

  function toggle(id: string) {
    setMarcados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selecionarCategoria(cat: string, lista: Produto[]) {
    setMarcados((prev) => {
      const next = new Set(prev);
      const todosMarcados = lista.every((p) => next.has(p.id));
      if (todosMarcados) lista.forEach((p) => next.delete(p.id));
      else lista.forEach((p) => next.add(p.id));
      return next;
    });
  }

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/fornecedores/${fornecedorId}/produtos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ produtoIds: Array.from(marcados) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      setMsg({
        tipo: 'ok',
        texto: `✓ ${marcados.size} vínculo(s) salvos (${d.criados ?? 0} novos, ${d.removidos ?? 0} removidos)`,
      });
      start(() => router.refresh());
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="sticky top-0 z-10 -mx-2 mb-3 flex items-center justify-between gap-2 rounded-md bg-slate-50/95 p-2 backdrop-blur">
        <input
          type="search"
          placeholder="Filtrar produto ou categoria..."
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <span className="whitespace-nowrap text-xs text-slate-600">
          {marcados.size} selecionados
        </span>
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || pending || !mudou}
          className={`rounded-md px-3 py-1.5 text-xs font-medium text-white ${
            mudou
              ? 'bg-slate-900 hover:bg-slate-800'
              : 'bg-slate-300'
          } disabled:opacity-50`}
        >
          {salvando ? 'Salvando...' : mudou ? 'Salvar' : '✓ Salvo'}
        </button>
      </div>

      {msg && (
        <p
          className={`mb-3 rounded-md p-2 text-xs ${
            msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
          }`}
        >
          {msg.texto}
        </p>
      )}

      <div className="space-y-3">
        {porCategoria.map(([cat, lista]) => {
          const marcadosCat = lista.filter((p) => marcados.has(p.id)).length;
          return (
            <div key={cat} className="rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {cat}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {marcadosCat}/{lista.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => selecionarCategoria(cat, lista)}
                  className="text-[10px] text-sky-700 hover:underline"
                >
                  {marcadosCat === lista.length ? 'desmarcar todos' : 'marcar todos'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1 p-2 md:grid-cols-3">
                {lista.map((p) => (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs ${
                      marcados.has(p.id) ? 'bg-emerald-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={marcados.has(p.id)}
                      onChange={() => toggle(p.id)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="flex-1 truncate">{p.nome}</span>
                    <span className="text-[9px] text-slate-400">/{p.unidade}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

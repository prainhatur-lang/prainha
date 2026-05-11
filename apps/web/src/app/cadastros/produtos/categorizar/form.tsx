'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { sugerirCategoria } from '@/lib/sugerir-categoria';

interface Produto {
  id: string;
  nome: string;
  tipo: string;
  categoria: string | null;
  unidade: string;
  codigoExterno: number | null;
  criadoNaNuvem: boolean;
  /** Categoria que esse mesmo nome de produto tem em outra filial da org. */
  categoriaCrossfilial: string | null;
}

export function CategorizarForm({
  produtos,
  categorias,
}: {
  produtos: Produto[];
  categorias: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [categoria, setCategoria] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  function toggle(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function marcarTodos() {
    if (selecionados.size === produtos.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(produtos.map((p) => p.id)));
    }
  }

  // Pre-computa sugestoes — prioriza cross-filial (mesmo nome ja categorizado
  // em outra filial), fallback pra palavra-chave
  const sugestoes = useMemo(() => {
    const map = new Map<string, { categoria: string; fonte: 'crossfilial' | 'keyword' }>();
    for (const p of produtos) {
      if (p.categoriaCrossfilial) {
        map.set(p.id, { categoria: p.categoriaCrossfilial, fonte: 'crossfilial' });
        continue;
      }
      const s = sugerirCategoria(p.nome);
      if (s) map.set(p.id, { categoria: s, fonte: 'keyword' });
    }
    return map;
  }, [produtos]);

  // Agrupa por categoria sugerida pra mostrar atalhos
  const porSugestao = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [id, sug] of sugestoes) {
      if (!m.has(sug.categoria)) m.set(sug.categoria, []);
      m.get(sug.categoria)!.push(id);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [sugestoes]);

  function marcarSugestao(cat: string, ids: string[]) {
    setSelecionados(new Set(ids));
    setCategoria(cat);
  }

  async function aplicarTodas() {
    const total = sugestoes.size;
    if (total === 0) return;
    if (!confirm(`Aplicar todas as ${total} sugestões em ${porSugestao.length} categorias?`)) return;
    setSalvando(true);
    setMsg(null);
    let totalAtualizados = 0;
    let totalReplica = 0;
    let totalErros = 0;
    try {
      for (const [cat, ids] of porSugestao) {
        const r = await fetch('/api/produtos/categorizar-batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ produtoIds: ids, categoria: cat }),
        });
        if (!r.ok) {
          totalErros++;
          continue;
        }
        const d = (await r.json().catch(() => ({}))) as {
          atualizados?: number;
          replicacao?: { atualizados: number };
        };
        totalAtualizados += d.atualizados ?? 0;
        totalReplica += d.replicacao?.atualizados ?? 0;
      }
      setMsg({
        tipo: totalErros > 0 ? 'erro' : 'ok',
        texto: `✓ ${totalAtualizados} categorizados em ${porSugestao.length} categorias · +${totalReplica} em filiais irmãs${totalErros > 0 ? ` · ${totalErros} categorias com erro` : ''}`,
      });
      setSelecionados(new Set());
      start(() => router.refresh());
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  async function salvar() {
    if (selecionados.size === 0 || !categoria) return;
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/produtos/categorizar-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          produtoIds: Array.from(selecionados),
          categoria,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      const partes = [`${d.atualizados ?? 0} categorizados`];
      const rep = d.replicacao as { filiaisIrmas: number; atualizados: number } | undefined;
      if (rep && rep.filiaisIrmas > 0) {
        partes.push(`+${rep.atualizados} em ${rep.filiaisIrmas} filial(is) irmã(s)`);
      }
      setMsg({ tipo: 'ok', texto: `✓ ${partes.join(' · ')}` });
      setSelecionados(new Set());
      start(() => router.refresh());
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  async function removerCategoria() {
    if (selecionados.size === 0) return;
    if (!confirm(`Remover categoria de ${selecionados.size} produto(s)?`)) return;
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/produtos/categorizar-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          produtoIds: Array.from(selecionados),
          categoria: null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      setMsg({ tipo: 'ok', texto: `✓ ${d.atualizados ?? 0} produtos descategorizados` });
      setSelecionados(new Set());
      start(() => router.refresh());
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      {/* Painel de sugestoes automaticas */}
      {porSugestao.length > 0 && (
        <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold text-sky-900">
              ✨ Sugestões automáticas
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-sky-700">
                {sugestoes.size} de {produtos.length} produtos com sugestão
              </span>
              <button
                type="button"
                onClick={aplicarTodas}
                disabled={salvando || sugestoes.size === 0}
                className="rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                title="Aplica todas as sugestoes em batch — 1 chamada por categoria"
              >
                {salvando ? 'Aplicando...' : `✨ Aplicar todas (${sugestoes.size})`}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {porSugestao.map(([cat, ids]) => (
              <button
                key={cat}
                type="button"
                onClick={() => marcarSugestao(cat, ids)}
                className="rounded-md border border-sky-300 bg-white px-2 py-1 text-[11px] text-sky-900 hover:bg-sky-100"
                title={`Marca os ${ids.length} produtos com sugestão de ${cat} e seta a categoria no dropdown`}
              >
                <strong>{ids.length}</strong> · {cat}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-sky-700">
            Botão azul aplica tudo em batch. Os botões claros permitem revisar categoria a
            categoria. Sugestão vem 1º de outras filiais (mesmo nome já categorizado lá), e como
            fallback de palavras-chave.
          </p>
        </div>
      )}

      {/* Barra de acao */}
      <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white/95 p-2 backdrop-blur">
        <button
          type="button"
          onClick={marcarTodos}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
        >
          {selecionados.size === produtos.length && produtos.length > 0
            ? 'desmarcar todos'
            : 'marcar todos da página'}
        </button>
        <span className="text-xs text-slate-600">
          {selecionados.size} selecionado(s)
        </span>
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          disabled={salvando || pending}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="">— escolher categoria —</option>
          {categorias.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={salvar}
          disabled={selecionados.size === 0 || !categoria || salvando}
          className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Atribuir categoria'}
        </button>
        <button
          type="button"
          onClick={removerCategoria}
          disabled={selecionados.size === 0 || salvando}
          className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1 text-xs text-rose-800 hover:bg-rose-100 disabled:opacity-50"
        >
          Remover categoria
        </button>
        {msg && (
          <span
            className={`text-xs ${msg.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}
          >
            {msg.texto}
          </span>
        )}
      </div>

      {/* Lista */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2 text-left font-medium">Nome</th>
              <th className="px-3 py-2 text-left font-medium">Tipo</th>
              <th className="px-3 py-2 text-left font-medium">Unidade</th>
              <th className="px-3 py-2 text-left font-medium">Origem</th>
              <th className="px-3 py-2 text-left font-medium">Sugestão</th>
              <th className="px-3 py-2 text-left font-medium">Categoria atual</th>
            </tr>
          </thead>
          <tbody>
            {produtos.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500">
                  Nenhum produto com esse filtro.
                </td>
              </tr>
            ) : (
              produtos.map((p) => {
                const sug = sugestoes.get(p.id);
                return (
                  <tr
                    key={p.id}
                    className={`border-t border-slate-100 cursor-pointer ${
                      selecionados.has(p.id) ? 'bg-emerald-50' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => toggle(p.id)}
                  >
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={selecionados.has(p.id)}
                        onChange={() => toggle(p.id)}
                        className="h-3.5 w-3.5"
                      />
                    </td>
                    <td className="px-3 py-1.5 font-medium text-slate-900">{p.nome}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`rounded px-1 py-0.5 text-[9px] font-medium ${
                          p.tipo === 'INSUMO'
                            ? 'bg-sky-100 text-sky-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {p.tipo === 'INSUMO' ? 'Insumo' : 'Produto'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">{p.unidade}</td>
                    <td className="px-3 py-1.5 text-[10px] text-slate-500">
                      {p.criadoNaNuvem
                        ? 'criado-na-nuvem'
                        : p.codigoExterno
                          ? `Consumer #${p.codigoExterno}`
                          : '—'}
                    </td>
                    <td className="px-3 py-1.5">
                      {sug ? (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            sug.fonte === 'crossfilial'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-sky-100 text-sky-800'
                          }`}
                          title={
                            sug.fonte === 'crossfilial'
                              ? 'Já categorizado com esse nome em outra filial — alta confiança'
                              : 'Sugerido por palavra-chave no nome'
                          }
                        >
                          {sug.fonte === 'crossfilial' ? '✓' : '✨'} {sug.categoria}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">
                      {p.categoria ?? <span className="italic text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

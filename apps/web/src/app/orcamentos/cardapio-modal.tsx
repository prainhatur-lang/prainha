'use client';

// Modal "abrir o cardápio": lista completa dos produtos ativos da filial com
// checkbox, busca no topo e cabeçalhos por letra. O que for marcado vira
// prato do orçamento (e desmarcar remove o prato correspondente).

import { useEffect, useMemo, useState } from 'react';
import { normalizarNome, type CardapioItem } from '@/lib/orcamentos';

// Cache por filial na sessão — o cardápio não muda no meio do preenchimento.
const cache = new Map<string, CardapioItem[]>();

interface Props {
  filialId: string;
  /** Nomes de pratos já presentes no orçamento (pré-marcados). */
  selecionadosIniciais: string[];
  onFechar: () => void;
  /** Recebe a seleção final + o catálogo carregado (pra saber o que remover
   *  e preencher as descrições dos pratos novos). */
  onAplicar: (selecionados: string[], catalogo: CardapioItem[]) => void;
}

export function CardapioModal({
  filialId,
  selecionadosIniciais,
  onFechar,
  onAplicar,
}: Props) {
  const [itens, setItens] = useState<CardapioItem[] | null>(cache.get(filialId) ?? null);
  const [erro, setErro] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [sel, setSel] = useState<Set<string>>(() => new Set(selecionadosIniciais));

  useEffect(() => {
    if (cache.has(filialId)) {
      setItens(cache.get(filialId)!);
      return;
    }
    let cancelado = false;
    fetch(`/api/orcamentos/cardapio?f=${filialId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelado) return;
        const arr: CardapioItem[] = Array.isArray(d?.itens) ? d.itens : [];
        cache.set(filialId, arr);
        setItens(arr);
      })
      .catch(() => {
        if (!cancelado) setErro(true);
      });
    return () => {
      cancelado = true;
    };
  }, [filialId]);

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') onFechar();
    }
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onFechar]);

  const visiveis = useMemo(() => {
    if (!itens) return [];
    const q = normalizarNome(filtro.trim());
    if (!q) return itens;
    // Busca no nome E na descrição (ex: "milanesa" acha pelo preparo).
    return itens.filter(
      (item) =>
        normalizarNome(item.nome).includes(q) ||
        (item.descricao && normalizarNome(item.descricao).includes(q)),
    );
  }, [itens, filtro]);

  function alternar(nome: string) {
    setSel((prev) => {
      const novo = new Set(prev);
      if (novo.has(nome)) novo.delete(nome);
      else novo.add(nome);
      return novo;
    });
  }

  const qtdNoCardapio = itens ? itens.filter((item) => sel.has(item.nome)).length : 0;

  let ultimaLetra = '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3"
      onClick={onFechar}
    >
      <div
        className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">Cardápio da casa</h2>
            <button
              type="button"
              onClick={onFechar}
              className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
          <input
            autoFocus
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar no cardápio… (ex: camarão)"
            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {erro && (
            <p className="py-8 text-center text-sm text-rose-600">
              Não consegui carregar o cardápio. Fecha e tenta de novo.
            </p>
          )}
          {!erro && itens === null && (
            <p className="py-8 text-center text-sm text-slate-500">Carregando cardápio…</p>
          )}
          {itens !== null && visiveis.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">
              Nada encontrado{filtro ? ` pra “${filtro}”` : ''}. Dá pra digitar o prato
              direto no formulário.
            </p>
          )}
          {visiveis.map((item) => {
            const letra = normalizarNome(item.nome.charAt(0)).toUpperCase() || '#';
            const mostraLetra = letra !== ultimaLetra;
            ultimaLetra = letra;
            return (
              <div key={item.nome}>
                {mostraLetra && (
                  <p className="sticky top-0 -mx-4 border-b border-slate-100 bg-slate-50 px-4 py-1 text-[11px] font-bold uppercase text-slate-400">
                    {letra}
                  </p>
                )}
                <label className="flex cursor-pointer items-start gap-2.5 rounded px-1 py-1.5 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={sel.has(item.nome)}
                    onChange={() => alternar(item.nome)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-800">{item.nome}</span>
                    {item.descricao && (
                      <span className="block text-xs leading-snug text-slate-400">
                        {item.descricao}
                      </span>
                    )}
                  </span>
                </label>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 p-3">
          <span className="text-xs text-slate-500">
            {qtdNoCardapio} prato{qtdNoCardapio !== 1 && 's'} selecionado
            {qtdNoCardapio !== 1 && 's'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onFechar}
              className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={itens === null}
              onClick={() => onAplicar([...sel], itens ?? [])}
              className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Aplicar seleção
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

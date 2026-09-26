'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

type Chave = 'tipo' | 'status' | 'ficha' | 'estoque' | 'fornecedor' | 'grupo';
type Op = { v: string; l: string };

const STATUS_DEFAULT = ['avenda', 'pausado'];

const FIXOS: Array<{ k: Exclude<Chave, 'tipo' | 'grupo'>; titulo: string; ops: Op[] }> = [
  {
    k: 'status',
    titulo: 'Status',
    ops: [
      { v: 'avenda', l: 'À venda' },
      { v: 'pausado', l: 'Pausados' },
      { v: 'descontinuado', l: 'Descontinuados' },
    ],
  },
  { k: 'ficha', titulo: 'Receita', ops: [{ v: 'com', l: 'Com ficha' }, { v: 'sem', l: 'Sem ficha' }] },
  {
    k: 'estoque',
    titulo: 'Estoque',
    ops: [{ v: 'baixo', l: '⚠ Abaixo do mínimo' }, { v: 'zerado', l: 'Zerado' }],
  },
  { k: 'fornecedor', titulo: 'Fornec.', ops: [{ v: 'sem', l: 'Sem fornecedor mapeado' }] },
];

/**
 * Filtros da lista de produtos em caixinhas: marca vários (ex.: grupos Cerveja
 * + Drink), aplica na hora. Nada marcado numa linha = sem filtro nela.
 */
export function FiltrosProdutos({
  filialId,
  q,
  tipos,
  grupos,
  marcados,
}: {
  filialId: string;
  q: string;
  tipos: Op[];
  grupos: Op[];
  marcados: Record<Chave, string[]>;
}) {
  const router = useRouter();
  const [sel, setSel] = useState(marcados);
  const [pendente, startTransition] = useTransition();

  const aplicar = (novo: Record<Chave, string[]>) => {
    setSel(novo);
    const qs = new URLSearchParams();
    qs.set('filialId', filialId);
    if (q) qs.set('q', q);
    for (const k of Object.keys(novo) as Chave[]) {
      const vs = [...novo[k]].sort();
      if (k === 'status') {
        // default (à venda + pausados) fica fora da URL; nenhum = todos
        if (vs.join(',') !== STATUS_DEFAULT.join(',')) qs.set('status', vs.length ? vs.join(',') : 'todos');
      } else if (vs.length) {
        qs.set(k, vs.join(','));
      }
    }
    startTransition(() => router.push(`/cadastros/produtos?${qs.toString()}`));
  };

  const alterna = (k: Chave, v: string) => {
    const atual = sel[k];
    aplicar({ ...sel, [k]: atual.includes(v) ? atual.filter((x) => x !== v) : [...atual, v] });
  };

  const caixa = (k: Chave, o: Op) => {
    const on = sel[k].includes(o.v);
    return (
      <label
        key={o.v}
        className={`inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] ${
          on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <input
          type="checkbox"
          checked={on}
          onChange={() => alterna(k, o.v)}
          className="h-3 w-3 accent-white"
        />
        {o.l}
      </label>
    );
  };

  const linha = (k: Chave, titulo: string, ops: Op[]) => (
    <div key={k} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-20 shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {titulo}
      </span>
      {ops.map((o) => caixa(k, o))}
      {sel[k].length > 0 && k !== 'status' && (
        <button
          type="button"
          onClick={() => aplicar({ ...sel, [k]: [] })}
          className="text-[11px] text-slate-400 underline hover:text-slate-600"
        >
          limpar
        </button>
      )}
    </div>
  );

  return (
    <div
      className={`mt-4 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${
        pendente ? 'opacity-60' : ''
      }`}
    >
      {linha('tipo', 'Tipo', tipos)}
      {FIXOS.map((f) => linha(f.k, f.titulo, f.ops))}
      {/* Grupo do cardápio (PRODUTOETIQUETA) — filial sem etiqueta não ganha linha vazia */}
      {grupos.length > 0 && linha('grupo', 'Grupo', grupos)}
      <p className="text-[10px] text-slate-400">Marque quantos quiser — nada marcado na linha = todos.</p>
    </div>
  );
}

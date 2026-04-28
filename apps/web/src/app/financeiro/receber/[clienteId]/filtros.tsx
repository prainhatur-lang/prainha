'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

interface SP {
  filialId?: string;
  dataIni?: string;
  dataFim?: string;
  pedido?: string;
  mesa?: string;
  valorMin?: string;
  valorMax?: string;
  modalidade?: string;
  nsu?: string;
  q?: string;
}

const MODALIDADES = [
  'Cartão de Crédito',
  'Cartão de Débito',
  'Pix Online',
  'Pix Manual',
  'Dinheiro',
  'iFood Online',
  'Voucher',
];

export function ClienteFiltros({ sp }: { sp: SP; filialId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Estado local pra inputs com debounce/enter
  const [pedido, setPedido] = useState(sp.pedido ?? '');
  const [mesa, setMesa] = useState(sp.mesa ?? '');
  const [vMin, setVMin] = useState(sp.valorMin ?? '');
  const [vMax, setVMax] = useState(sp.valorMax ?? '');
  const [nsu, setNsu] = useState(sp.nsu ?? '');
  const [q, setQ] = useState(sp.q ?? '');

  useEffect(() => setPedido(sp.pedido ?? ''), [sp.pedido]);
  useEffect(() => setMesa(sp.mesa ?? ''), [sp.mesa]);
  useEffect(() => setVMin(sp.valorMin ?? ''), [sp.valorMin]);
  useEffect(() => setVMax(sp.valorMax ?? ''), [sp.valorMax]);
  useEffect(() => setNsu(sp.nsu ?? ''), [sp.nsu]);
  useEffect(() => setQ(sp.q ?? ''), [sp.q]);

  function update(key: keyof SP, value: string) {
    const qs = new URLSearchParams(params.toString());
    if (value) qs.set(key, value);
    else qs.delete(key);
    startTransition(() => router.push(`?${qs.toString()}`));
  }

  function aplicarTexto() {
    const qs = new URLSearchParams(params.toString());
    const setOrDel = (k: string, v: string) => (v ? qs.set(k, v) : qs.delete(k));
    setOrDel('pedido', pedido);
    setOrDel('mesa', mesa);
    setOrDel('valorMin', vMin);
    setOrDel('valorMax', vMax);
    setOrDel('nsu', nsu);
    setOrDel('q', q);
    startTransition(() => router.push(`?${qs.toString()}`));
  }

  function limpar() {
    setPedido('');
    setMesa('');
    setVMin('');
    setVMax('');
    setNsu('');
    setQ('');
    const qs = new URLSearchParams();
    if (sp.filialId) qs.set('filialId', sp.filialId);
    startTransition(() => router.push(`?${qs.toString()}`));
  }

  const temFiltro =
    sp.dataIni ||
    sp.dataFim ||
    sp.pedido ||
    sp.mesa ||
    sp.valorMin ||
    sp.valorMax ||
    sp.modalidade ||
    sp.nsu ||
    sp.q;

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* Linha 1: datas + modalidade */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Período:
        </span>
        <input
          type="date"
          value={sp.dataIni ?? ''}
          onChange={(e) => update('dataIni', e.target.value)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <span className="text-xs text-slate-500">até</span>
        <input
          type="date"
          value={sp.dataFim ?? ''}
          onChange={(e) => update('dataFim', e.target.value)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <select
          value={sp.modalidade ?? ''}
          onChange={(e) => update('modalidade', e.target.value)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="">Toda modalidade</option>
          {MODALIDADES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Linha 2: pedido, mesa, NSU, valor, busca */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          value={pedido}
          onChange={(e) => setPedido(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && aplicarTexto()}
          disabled={pending}
          placeholder="Pedido #"
          className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <input
          type="text"
          value={mesa}
          onChange={(e) => setMesa(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && aplicarTexto()}
          disabled={pending}
          placeholder="Mesa / comanda"
          className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <input
          type="text"
          value={nsu}
          onChange={(e) => setNsu(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && aplicarTexto()}
          disabled={pending}
          placeholder="NSU"
          className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <input
          type="number"
          step="0.01"
          value={vMin}
          onChange={(e) => setVMin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && aplicarTexto()}
          disabled={pending}
          placeholder="R$ mín"
          className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <input
          type="number"
          step="0.01"
          value={vMax}
          onChange={(e) => setVMax(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && aplicarTexto()}
          disabled={pending}
          placeholder="R$ máx"
          className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && aplicarTexto()}
          disabled={pending}
          placeholder="Buscar observação..."
          className="w-44 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <button
          onClick={aplicarTexto}
          disabled={pending}
          className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          Aplicar
        </button>
        {temFiltro && (
          <button
            onClick={limpar}
            disabled={pending}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Limpar
          </button>
        )}
      </div>
    </div>
  );
}

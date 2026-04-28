'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

interface SP {
  filialId?: string;
  dataIni?: string;
  dataFim?: string;
  pedido?: string;
  mesa?: string;
  cliente?: string;
  forma?: string;
  bandeira?: string;
  nsu?: string;
  valorMin?: string;
  valorMax?: string;
  status?: string;
}

interface Filial {
  id: string;
  nome: string;
}

const FORMAS = [
  'Cartão de Crédito',
  'Cartão de Débito',
  'Pix Online',
  'Pix Manual',
  'Dinheiro',
  'iFood Online',
  'Voucher',
];

const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'Amex', 'Hipercard', 'Diners', 'Pix'];

export function PagamentosFiltros({ sp, filiais }: { sp: SP; filiais: Filial[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [pedido, setPedido] = useState(sp.pedido ?? '');
  const [mesa, setMesa] = useState(sp.mesa ?? '');
  const [cliente, setCliente] = useState(sp.cliente ?? '');
  const [nsu, setNsu] = useState(sp.nsu ?? '');
  const [vMin, setVMin] = useState(sp.valorMin ?? '');
  const [vMax, setVMax] = useState(sp.valorMax ?? '');

  useEffect(() => setPedido(sp.pedido ?? ''), [sp.pedido]);
  useEffect(() => setMesa(sp.mesa ?? ''), [sp.mesa]);
  useEffect(() => setCliente(sp.cliente ?? ''), [sp.cliente]);
  useEffect(() => setNsu(sp.nsu ?? ''), [sp.nsu]);
  useEffect(() => setVMin(sp.valorMin ?? ''), [sp.valorMin]);
  useEffect(() => setVMax(sp.valorMax ?? ''), [sp.valorMax]);

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
    setOrDel('cliente', cliente);
    setOrDel('nsu', nsu);
    setOrDel('valorMin', vMin);
    setOrDel('valorMax', vMax);
    startTransition(() => router.push(`?${qs.toString()}`));
  }

  function limpar() {
    setPedido('');
    setMesa('');
    setCliente('');
    setNsu('');
    setVMin('');
    setVMax('');
    const qs = new URLSearchParams();
    if (sp.filialId) qs.set('filialId', sp.filialId);
    startTransition(() => router.push(`?${qs.toString()}`));
  }

  const temFiltro =
    sp.dataIni ||
    sp.dataFim ||
    sp.pedido ||
    sp.mesa ||
    sp.cliente ||
    sp.forma ||
    sp.bandeira ||
    sp.nsu ||
    sp.valorMin ||
    sp.valorMax ||
    sp.status;

  return (
    <div className="flex flex-col gap-2">
      {/* Linha 1: filial + datas + status */}
      <div className="flex flex-wrap items-center gap-2">
        {filiais.length > 1 && (
          <select
            value={sp.filialId ?? ''}
            onChange={(e) => update('filialId', e.target.value)}
            disabled={pending}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
          >
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        )}
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
          value={sp.status ?? ''}
          onChange={(e) => update('status', e.target.value)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="">Todo status</option>
          <option value="aberto">Aberto (sem match)</option>
          <option value="cielo">Casado Cielo</option>
          <option value="banco">Casado Banco</option>
          <option value="qualquer-casado">Casado (qualquer)</option>
        </select>
      </div>

      {/* Linha 2: forma + bandeira + texto */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sp.forma ?? ''}
          onChange={(e) => update('forma', e.target.value)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="">Toda forma</option>
          {FORMAS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          value={sp.bandeira ?? ''}
          onChange={(e) => update('bandeira', e.target.value)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="">Toda bandeira</option>
          {BANDEIRAS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
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
          placeholder="Mesa"
          className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <input
          type="text"
          value={cliente}
          onChange={(e) => setCliente(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && aplicarTexto()}
          disabled={pending}
          placeholder="Cliente"
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

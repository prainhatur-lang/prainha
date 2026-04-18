'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

interface Filial {
  id: string;
  nome: string;
}

interface SP {
  filialId?: string;
  processo?: string;
  tipo?: string;
  severidade?: string;
  dataIni?: string;
  dataFim?: string;
  q?: string;
  valorMin?: string;
  valorMax?: string;
  forma?: string;
  page?: string;
}

const FORMAS = [
  'Cartão de Crédito',
  'Cartão de Débito',
  'Pix Online',
  'Pix Manual',
  'iFood Online',
];

export function ExcecoesFiltros({ filiais, sp }: { filiais: Filial[]; sp: SP }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Busca com debounce pra nao navegar a cada tecla
  const [qLocal, setQLocal] = useState(sp.q ?? '');
  const [vMinLocal, setVMinLocal] = useState(sp.valorMin ?? '');
  const [vMaxLocal, setVMaxLocal] = useState(sp.valorMax ?? '');
  useEffect(() => setQLocal(sp.q ?? ''), [sp.q]);
  useEffect(() => setVMinLocal(sp.valorMin ?? ''), [sp.valorMin]);
  useEffect(() => setVMaxLocal(sp.valorMax ?? ''), [sp.valorMax]);

  function updateParam(key: keyof SP, value: string) {
    const qs = new URLSearchParams(params.toString());
    if (value) qs.set(key, value);
    else qs.delete(key);
    qs.delete('page');
    startTransition(() => router.push(`/excecoes?${qs.toString()}`));
  }

  function aplicarTexto() {
    const qs = new URLSearchParams(params.toString());
    if (qLocal) qs.set('q', qLocal);
    else qs.delete('q');
    if (vMinLocal) qs.set('valorMin', vMinLocal);
    else qs.delete('valorMin');
    if (vMaxLocal) qs.set('valorMax', vMaxLocal);
    else qs.delete('valorMax');
    qs.delete('page');
    startTransition(() => router.push(`/excecoes?${qs.toString()}`));
  }

  function limpar() {
    setQLocal('');
    setVMinLocal('');
    setVMaxLocal('');
    startTransition(() => router.push('/excecoes'));
  }

  function onProcessoChange(v: string) {
    const qs = new URLSearchParams(params.toString());
    if (v) qs.set('processo', v);
    else qs.delete('processo');
    qs.delete('tipo');
    qs.delete('page');
    startTransition(() => router.push(`/excecoes?${qs.toString()}`));
  }

  const temFiltro =
    sp.filialId ||
    sp.processo ||
    sp.tipo ||
    sp.severidade ||
    sp.dataIni ||
    sp.dataFim ||
    sp.q ||
    sp.valorMin ||
    sp.valorMax ||
    sp.forma;

  return (
    <div className="flex flex-col gap-2 text-sm">
      {/* Linha 1: filial, processo, severidade, forma */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sp.filialId ?? ''}
          onChange={(e) => updateParam('filialId', e.target.value)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="">Todas filiais</option>
          {filiais.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>

        <select
          value={sp.processo ?? ''}
          onChange={(e) => onProcessoChange(e.target.value)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="">Todos processos</option>
          <option value="OPERADORA">Operadora</option>
          <option value="RECEBIVEIS">Recebíveis</option>
          <option value="BANCO">Banco</option>
        </select>

        <select
          value={sp.severidade ?? ''}
          onChange={(e) => updateParam('severidade', e.target.value)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="">Toda severidade</option>
          <option value="ALTA">Alta</option>
          <option value="MEDIA">Média</option>
          <option value="BAIXA">Baixa</option>
        </select>

        <select
          value={sp.forma ?? ''}
          onChange={(e) => updateParam('forma', e.target.value)}
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

        <input
          type="date"
          value={sp.dataIni ?? ''}
          onChange={(e) => updateParam('dataIni', e.target.value)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
          placeholder="de"
        />
        <input
          type="date"
          value={sp.dataFim ?? ''}
          onChange={(e) => updateParam('dataFim', e.target.value)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
          placeholder="até"
        />
      </div>

      {/* Linha 2: busca texto + valor min/max */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={qLocal}
          onChange={(e) => setQLocal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') aplicarTexto();
          }}
          disabled={pending}
          placeholder="NSU, pedido ou descrição..."
          className="w-60 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <input
          type="number"
          step="0.01"
          value={vMinLocal}
          onChange={(e) => setVMinLocal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') aplicarTexto();
          }}
          disabled={pending}
          placeholder="R$ mín"
          className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <input
          type="number"
          step="0.01"
          value={vMaxLocal}
          onChange={(e) => setVMaxLocal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') aplicarTexto();
          }}
          disabled={pending}
          placeholder="R$ máx"
          className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <button
          onClick={aplicarTexto}
          disabled={pending}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Aplicar
        </button>

        {temFiltro && (
          <button
            onClick={limpar}
            disabled={pending}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Limpar tudo
          </button>
        )}
      </div>
    </div>
  );
}

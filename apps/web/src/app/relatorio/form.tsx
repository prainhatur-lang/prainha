'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

interface Filial {
  id: string;
  nome: string;
}

interface SP {
  filialId?: string;
  dataInicio?: string;
  dataFim?: string;
}

export function RelatorioForm({ filiais, sp }: { filiais: Filial[]; sp: SP }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function updateParam(key: keyof SP, value: string) {
    const qs = new URLSearchParams(params.toString());
    if (value) qs.set(key, value);
    else qs.delete(key);
    startTransition(() => router.push(`/relatorio?${qs.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Filial
        </label>
        <select
          value={sp.filialId ?? ''}
          onChange={(e) => updateParam('filialId', e.target.value)}
          disabled={pending}
          className="mt-1 block rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          {filiais.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Data início
        </label>
        <input
          type="date"
          value={sp.dataInicio ?? ''}
          onChange={(e) => updateParam('dataInicio', e.target.value)}
          disabled={pending}
          className="mt-1 block rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Data fim
        </label>
        <input
          type="date"
          value={sp.dataFim ?? ''}
          onChange={(e) => updateParam('dataFim', e.target.value)}
          disabled={pending}
          className="mt-1 block rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>
      {pending && <span className="text-xs text-slate-500">carregando...</span>}
    </div>
  );
}

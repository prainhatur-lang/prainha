'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

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
  page?: string;
}

export function ExcecoesFiltros({ filiais, sp }: { filiais: Filial[]; sp: SP }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function updateParam(key: keyof SP, value: string) {
    const qs = new URLSearchParams(params.toString());
    if (value) qs.set(key, value);
    else qs.delete(key);
    qs.delete('page');
    startTransition(() => {
      router.push(`/excecoes?${qs.toString()}`);
    });
  }

  function limpar() {
    startTransition(() => router.push('/excecoes'));
  }

  const temFiltro =
    sp.filialId || sp.processo || sp.tipo || sp.severidade || sp.dataIni || sp.dataFim;

  function onProcessoChange(v: string) {
    // trocar processo limpa tipo (que eh especifico do processo)
    const qs = new URLSearchParams(params.toString());
    if (v) qs.set('processo', v);
    else qs.delete('processo');
    qs.delete('tipo');
    qs.delete('page');
    startTransition(() => router.push(`/excecoes?${qs.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
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
  );
}

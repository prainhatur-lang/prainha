'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const UNIDADES = ['un', 'ml', 'g', 'kg', 'l'] as const;

export function NovoInsumoButton({ filialId }: { filialId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [unidade, setUnidade] = useState<(typeof UNIDADES)[number]>('un');
  const [estoqueMinimo, setEstoqueMinimo] = useState('');
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function fechar() {
    setAberto(false);
    setNome('');
    setUnidade('un');
    setEstoqueMinimo('');
    setErro(null);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setErro(null);
    const body: Record<string, unknown> = {
      filialId,
      nome: nome.trim(),
      unidadeEstoque: unidade,
    };
    const min = estoqueMinimo.trim();
    if (min) {
      const n = Number(min.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        setErro('Estoque mínimo inválido');
        return;
      }
      body.estoqueMinimo = n;
    }
    try {
      const r = await fetch('/api/produtos/insumo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      fechar();
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
      >
        + Novo insumo
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={fechar}
        >
          <form
            onSubmit={enviar}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Novo insumo</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Insumos só existem na nuvem — não vão pro cardápio do PDV. São
                consumidos por ficha técnica quando produtos compostos são vendidos.
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Nome *
              </label>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                autoFocus
                placeholder="Ex: Vodka Absolut, Filé mignon bruto, Morango"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                required
              />
            </div>

            <div className="flex gap-3">
              <div className="w-32">
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Unidade *
                </label>
                <select
                  value={unidade}
                  onChange={(e) =>
                    setUnidade(e.target.value as (typeof UNIDADES)[number])
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  {UNIDADES.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Estoque mínimo
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={estoqueMinimo}
                  onChange={(e) => setEstoqueMinimo(e.target.value)}
                  placeholder="0"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            {erro && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {erro}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={fechar}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending || !nome.trim()}
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {pending ? 'Criando...' : 'Criar insumo'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function NovaOpButton({ filialId }: { filialId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      const r = await fetch('/api/ordem-producao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId, descricao: descricao.trim() || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      start(() => router.push(`/movimento/producao/${d.id}`));
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
        + Nova OP
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setAberto(false)}
        >
          <form
            onSubmit={criar}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Nova ordem de produção</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Ao criar, você será levado pra tela onde adiciona entradas (insumos
                consumidos) e saídas (produtos + perdas).
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Descrição (opcional)
              </label>
              <input
                type="text"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                autoFocus
                placeholder="Ex: Corte do filé mignon 3kg do Assaí"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            {erro && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {erro}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {pending ? 'Criando...' : 'Criar e abrir'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

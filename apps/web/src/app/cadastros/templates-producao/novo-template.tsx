'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function NovoTemplateBtn({ filialId }: { filialId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [_pending, start] = useTransition();

  function fechar() {
    setAberto(false);
    setNome('');
    setDescricao('');
    setErro(null);
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) {
      setErro('Nome obrigatório');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/template-op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId,
          nome: nome.trim(),
          descricaoPadrao: descricao.trim() || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      fechar();
      start(() => router.push(`/cadastros/templates-producao/${d.id}`));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
      >
        + Novo template
      </button>
      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={fechar}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={criar}
            className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <h2 className="text-sm font-semibold text-slate-900">Novo template de produção</h2>
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Nome *
              </label>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                autoFocus
                placeholder="Ex: Desossa Filé Mignon"
                maxLength={200}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Descrição padrão (opcional)
              </label>
              <input
                type="text"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Texto pré-preenchido em cada OP nova"
                maxLength={200}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            {erro && (
              <div className="rounded bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</div>
            )}
            <p className="text-[10px] text-slate-500">
              Após criar, você adiciona as entradas (ex: 3kg filé bruto) e as saídas
              (ex: 2kg lâmina peso 3, 500g cabeça peso 1, etc).
            </p>
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
                disabled={salvando}
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {salvando ? 'Criando...' : 'Criar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

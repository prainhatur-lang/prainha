'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  id: string;
  nomeAtual: string;
  descricaoAtual: string | null;
}

export function EditarMetaGrupo({ id, nomeAtual, descricaoAtual }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(nomeAtual);
  const [descricao, setDescricao] = useState(descricaoAtual ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function cancelar() {
    setNome(nomeAtual);
    setDescricao(descricaoAtual ?? '');
    setErro(null);
    setEditando(false);
  }

  async function salvar() {
    setErro(null);
    if (nome.trim().length < 2) {
      setErro('Nome precisa ter ao menos 2 caracteres.');
      return;
    }
    setSalvando(true);
    const r = await fetch(`/api/admin/grupos/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: nome.trim(),
        descricao: descricao.trim() || null,
      }),
    });
    const d = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) {
      setErro(d.error ?? `HTTP ${r.status}`);
      return;
    }
    setEditando(false);
    router.refresh();
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        className="text-[11px] text-sky-700 underline-offset-2 hover:underline"
      >
        Editar nome e descrição
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <div>
        <label className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Nome
        </label>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          minLength={2}
          maxLength={80}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Descrição
        </label>
        <input
          type="text"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={200}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      {erro && <div className="text-[11px] text-rose-700">{erro}</div>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={cancelar}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}

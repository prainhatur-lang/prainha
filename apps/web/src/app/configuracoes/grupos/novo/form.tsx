'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Modelo {
  id: string;
  nome: string;
  descricao: string | null;
}

interface Props {
  modelos: Modelo[];
  idsPorModelo: Record<string, string[]>;
}

export function NovoGrupoForm({ modelos, idsPorModelo }: Props) {
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [modeloId, setModeloId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nome.trim().length < 2) {
      setErro('Nome precisa ter ao menos 2 caracteres.');
      return;
    }
    setSalvando(true);
    const r = await fetch('/api/admin/grupos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        permissaoIds: modeloId ? idsPorModelo[modeloId] ?? [] : [],
      }),
    });
    const d = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) {
      setErro(d.error ?? `HTTP ${r.status}`);
      return;
    }
    router.push('/configuracoes/grupos/matriz');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Nome *
            </label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              placeholder="ex: Comprador Senior"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Descrição
            </label>
            <input
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={200}
              placeholder="descrição livre (opcional)"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Copiar permissões de</h2>
        <p className="mt-1 text-[11px] text-slate-500">
          Opcional. Inicializa o grupo com as permissões do modelo escolhido. Você
          pode ajustar depois na matriz.
        </p>
        <div className="mt-3 space-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 p-2 text-xs hover:bg-slate-50">
            <input
              type="radio"
              checked={modeloId === null}
              onChange={() => setModeloId(null)}
            />
            <span className="font-medium text-slate-900">Vazio</span>
            <span className="text-slate-500">— nenhuma permissão inicialmente</span>
          </label>
          {modelos.map((m) => (
            <label
              key={m.id}
              className={`flex cursor-pointer items-center gap-2 rounded border p-2 text-xs hover:bg-slate-50 ${
                modeloId === m.id ? 'border-sky-500 bg-sky-50' : 'border-slate-200'
              }`}
            >
              <input
                type="radio"
                checked={modeloId === m.id}
                onChange={() => setModeloId(m.id)}
              />
              <div>
                <span className="font-medium text-slate-900">{m.nome}</span>
                <span className="ml-1 text-slate-500">
                  ({(idsPorModelo[m.id] ?? []).length} permissões)
                </span>
                {m.descricao && (
                  <p className="mt-0.5 text-[10px] text-slate-500">{m.descricao}</p>
                )}
              </div>
            </label>
          ))}
        </div>
      </div>

      {erro && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/configuracoes/grupos')}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={salvando}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {salvando ? 'Criando...' : 'Criar grupo'}
        </button>
      </div>
    </form>
  );
}

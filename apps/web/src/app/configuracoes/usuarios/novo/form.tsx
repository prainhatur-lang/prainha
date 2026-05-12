'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Filial {
  id: string;
  nome: string;
}
interface Grupo {
  id: string;
  nome: string;
  descricao: string | null;
  sistema: boolean;
}

interface Vinculo {
  filialId: string;
  grupoIds: string[];
}

export function NovoUsuarioForm({ filiais, grupos }: { filiais: Filial[]; grupos: Grupo[] }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [vinculos, setVinculos] = useState<Vinculo[]>(
    filiais.length > 0 ? [{ filialId: filiais[0]!.id, grupoIds: [] }] : [],
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function toggleGrupo(filialId: string, grupoId: string) {
    setVinculos((vs) =>
      vs.map((v) =>
        v.filialId === filialId
          ? {
              ...v,
              grupoIds: v.grupoIds.includes(grupoId)
                ? v.grupoIds.filter((g) => g !== grupoId)
                : [...v.grupoIds, grupoId],
            }
          : v,
      ),
    );
  }

  function addFilial() {
    const usados = new Set(vinculos.map((v) => v.filialId));
    const disponivel = filiais.find((f) => !usados.has(f.id));
    if (!disponivel) return;
    setVinculos((vs) => [...vs, { filialId: disponivel.id, grupoIds: [] }]);
  }

  function removerFilial(filialId: string) {
    setVinculos((vs) => vs.filter((v) => v.filialId !== filialId));
  }

  function trocarFilial(antigaId: string, novaId: string) {
    setVinculos((vs) =>
      vs.map((v) => (v.filialId === antigaId ? { ...v, filialId: novaId } : v)),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!email || !senha) {
      setErro('Email e senha são obrigatórios.');
      return;
    }
    if (vinculos.length === 0 || vinculos.every((v) => v.grupoIds.length === 0)) {
      setErro('Selecione ao menos um grupo em uma filial.');
      return;
    }
    setSalvando(true);
    const r = await fetch('/api/admin/usuarios', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, senha, vinculos }),
    });
    const d = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) {
      setErro(d.error ?? `HTTP ${r.status}`);
      return;
    }
    router.push('/configuracoes/usuarios');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Dados de acesso</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Senha provisória *
            </label>
            <input
              type="text"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              minLength={6}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
            />
            <p className="mt-1 text-[10px] text-slate-500">
              O usuário deverá trocar no primeiro acesso.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Acessos por filial</h2>
          {vinculos.length < filiais.length && (
            <button
              type="button"
              onClick={addFilial}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              + Adicionar filial
            </button>
          )}
        </div>

        {vinculos.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">Nenhuma filial disponível.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {vinculos.map((v) => {
              const usadosOutras = new Set(
                vinculos.filter((x) => x.filialId !== v.filialId).map((x) => x.filialId),
              );
              return (
                <div
                  key={v.filialId}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <select
                      value={v.filialId}
                      onChange={(e) => trocarFilial(v.filialId, e.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      {filiais.map((f) => (
                        <option key={f.id} value={f.id} disabled={usadosOutras.has(f.id)}>
                          {f.nome}
                        </option>
                      ))}
                    </select>
                    {vinculos.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removerFilial(v.filialId)}
                        className="text-xs text-rose-700 hover:underline"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                  <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Grupos
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {grupos.map((g) => {
                      const checked = v.grupoIds.includes(g.id);
                      return (
                        <label
                          key={g.id}
                          className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-xs hover:bg-slate-50 ${
                            checked ? 'border-sky-500 bg-sky-50' : 'border-slate-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleGrupo(v.filialId, g.id)}
                            className="mt-0.5"
                          />
                          <div>
                            <span className="font-medium text-slate-900">{g.nome}</span>
                            {g.sistema && (
                              <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[9px] uppercase text-slate-500">
                                sistema
                              </span>
                            )}
                            {g.descricao && (
                              <p className="mt-0.5 text-[10px] text-slate-500">
                                {g.descricao}
                              </p>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {erro && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/configuracoes/usuarios')}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={salvando}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {salvando ? 'Criando...' : 'Criar usuário'}
        </button>
      </div>
    </form>
  );
}

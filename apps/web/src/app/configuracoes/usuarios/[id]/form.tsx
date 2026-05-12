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

interface Props {
  usuarioId: string;
  email: string;
  ehProprio: boolean;
  filiais: Filial[];
  grupos: Grupo[];
  vinculosIniciais: Vinculo[];
}

export function EditarUsuarioForm({
  usuarioId,
  email,
  ehProprio,
  filiais,
  grupos,
  vinculosIniciais,
}: Props) {
  const router = useRouter();
  const [vinculos, setVinculos] = useState<Vinculo[]>(vinculosIniciais);
  const [novaSenha, setNovaSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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

  async function salvarVinculos() {
    setErro(null);
    setMsg(null);
    setSalvando(true);
    const r = await fetch(`/api/admin/usuarios/${usuarioId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vinculos }),
    });
    const d = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) {
      setErro(d.error ?? `HTTP ${r.status}`);
      return;
    }
    setMsg('Acessos salvos com sucesso.');
    router.refresh();
  }

  async function trocarSenha() {
    if (!novaSenha || novaSenha.length < 6) {
      setErro('Senha precisa ter ao menos 6 caracteres.');
      return;
    }
    setErro(null);
    setMsg(null);
    setSalvando(true);
    const r = await fetch(`/api/admin/usuarios/${usuarioId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novaSenha }),
    });
    const d = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) {
      setErro(d.error ?? `HTTP ${r.status}`);
      return;
    }
    setNovaSenha('');
    setMsg(`Nova senha definida pra ${email}.`);
  }

  async function deletar() {
    if (
      !confirm(
        `Remover usuário ${email}?\n\nIsso revoga acesso ao Supabase Auth e apaga vínculos. Não pode ser desfeito.`,
      )
    )
      return;
    setErro(null);
    setSalvando(true);
    const r = await fetch(`/api/admin/usuarios/${usuarioId}`, { method: 'DELETE' });
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
    <div className="mt-5 space-y-5">
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
          <p className="mt-3 text-xs text-slate-500">
            Nenhuma filial vinculada. Use &quot;+ Adicionar filial&quot;.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {vinculos.map((v) => {
              const usadosOutras = new Set(
                vinculos.filter((x) => x.filialId !== v.filialId).map((x) => x.filialId),
              );
              return (
                <div key={v.filialId} className="rounded-lg border border-slate-200 p-3">
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
                    <button
                      type="button"
                      onClick={() => removerFilial(v.filialId)}
                      className="text-xs text-rose-700 hover:underline"
                    >
                      Remover filial
                    </button>
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

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={salvarVinculos}
            disabled={salvando}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : 'Salvar acessos'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Trocar senha</h2>
        <p className="mt-1 text-[11px] text-slate-500">
          Admin pode redefinir a senha do usuário (uso emergencial).
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            placeholder="Nova senha (mín. 6)"
            minLength={6}
            className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
          />
          <button
            type="button"
            onClick={trocarSenha}
            disabled={salvando || !novaSenha}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Redefinir
          </button>
        </div>
      </div>

      {!ehProprio && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <h2 className="text-sm font-semibold text-rose-900">Zona perigosa</h2>
          <p className="mt-1 text-[11px] text-rose-800">
            Remover o usuário revoga o acesso ao Supabase Auth e apaga todos os
            vínculos. Não pode ser desfeito.
          </p>
          <button
            type="button"
            onClick={deletar}
            disabled={salvando}
            className="mt-3 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
          >
            Remover usuário
          </button>
        </div>
      )}

      {erro && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</div>
      )}
      {msg && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {msg}
        </div>
      )}
    </div>
  );
}

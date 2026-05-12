'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Perm {
  id: string;
  codigo: string;
  modulo: string;
  acao: string;
  descricao: string | null;
}
interface Grupo {
  id: string;
  nome: string;
  descricao: string | null;
  sistema: boolean;
  organizacaoId: string | null;
}

interface Props {
  perms: Perm[];
  grupos: Grupo[];
  /** Mapa "grupoId|permId" → true. */
  marcadasIniciais: Record<string, boolean>;
  podeEditar: boolean;
}

export function MatrizEditor({ perms, grupos, marcadasIniciais, podeEditar }: Props) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>(marcadasIniciais);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Modulos em ordem
  const porModulo = useMemo(() => {
    const map = new Map<string, Perm[]>();
    for (const p of perms) {
      if (!map.has(p.modulo)) map.set(p.modulo, []);
      map.get(p.modulo)!.push(p);
    }
    return [...map.entries()];
  }, [perms]);

  function toggle(grupoId: string, permId: string) {
    const key = `${grupoId}|${permId}`;
    setMarcadas((m) => ({ ...m, [key]: !m[key] }));
  }

  function toggleModuloGrupo(grupoId: string, modulo: string) {
    const lista = perms.filter((p) => p.modulo === modulo);
    const todasMarcadas = lista.every((p) => marcadas[`${grupoId}|${p.id}`]);
    setMarcadas((m) => {
      const novo = { ...m };
      for (const p of lista) {
        novo[`${grupoId}|${p.id}`] = !todasMarcadas;
      }
      return novo;
    });
  }

  // Calcula diff: por grupo, quais perms marcar (add) e quais desmarcar (rem)
  function calcularDiff() {
    const diff: Record<string, { add: string[]; rem: string[] }> = {};
    for (const g of grupos) {
      if (g.sistema) continue;
      const add: string[] = [];
      const rem: string[] = [];
      for (const p of perms) {
        const key = `${g.id}|${p.id}`;
        const antes = !!marcadasIniciais[key];
        const agora = !!marcadas[key];
        if (antes && !agora) rem.push(p.id);
        if (!antes && agora) add.push(p.id);
      }
      if (add.length || rem.length) diff[g.id] = { add, rem };
    }
    return diff;
  }

  async function salvar() {
    setErro(null);
    setMsg(null);
    const diff = calcularDiff();
    const gruposComMudanca = Object.keys(diff);
    if (gruposComMudanca.length === 0) {
      setMsg('Nada para salvar — sem mudanças.');
      return;
    }
    setSalvando(true);
    try {
      for (const grupoId of gruposComMudanca) {
        const r = await fetch(`/api/admin/grupos/${grupoId}/permissoes`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(diff[grupoId]),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? `HTTP ${r.status}`);
        }
      }
      setMsg(`Salvo: ${gruposComMudanca.length} grupo(s) atualizado(s).`);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'falha ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  const temMudanca = Object.keys(calcularDiff()).length > 0;

  return (
    <div>
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="text-xs">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium text-slate-700">
                Permissão
              </th>
              {grupos.map((g) => (
                <th
                  key={g.id}
                  className="border-b border-r border-slate-200 px-2 py-2 text-center font-medium text-slate-700"
                  title={g.descricao ?? ''}
                >
                  <div className="whitespace-nowrap">{g.nome}</div>
                  {g.sistema ? (
                    <div className="mt-0.5 text-[8px] uppercase text-slate-400">
                      sistema
                    </div>
                  ) : (
                    <div className="mt-0.5 text-[8px] uppercase text-emerald-600">
                      custom
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {porModulo.map(([modulo, lista]) => (
              <FragmentModulo
                key={modulo}
                modulo={modulo}
                lista={lista}
                grupos={grupos}
                marcadas={marcadas}
                toggle={toggle}
                toggleModuloGrupo={toggleModuloGrupo}
                podeEditar={podeEditar}
              />
            ))}
          </tbody>
        </table>
      </div>

      {podeEditar && (
        <div className="sticky bottom-4 mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-600">
            {temMudanca
              ? '⚠ Há mudanças não salvas.'
              : 'Clique em checkbox de grupos custom pra alterar.'}
          </div>
          <div className="flex items-center gap-2">
            {msg && <span className="text-[11px] text-emerald-700">{msg}</span>}
            {erro && <span className="text-[11px] text-rose-700">{erro}</span>}
            <button
              type="button"
              onClick={salvar}
              disabled={salvando || !temMudanca}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {salvando ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentModulo({
  modulo,
  lista,
  grupos,
  marcadas,
  toggle,
  toggleModuloGrupo,
  podeEditar,
}: {
  modulo: string;
  lista: Perm[];
  grupos: Grupo[];
  marcadas: Record<string, boolean>;
  toggle: (grupoId: string, permId: string) => void;
  toggleModuloGrupo: (grupoId: string, modulo: string) => void;
  podeEditar: boolean;
}) {
  return (
    <>
      <tr className="bg-slate-100">
        <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
          {modulo}
        </td>
        {grupos.map((g) => {
          const lista_marcadas = lista.filter((p) => marcadas[`${g.id}|${p.id}`]).length;
          const todasMarcadas = lista_marcadas === lista.length;
          const editavel = podeEditar && !g.sistema;
          return (
            <td
              key={g.id}
              className="border-b border-r border-slate-200 bg-slate-100 px-2 py-1 text-center text-[10px] text-slate-600"
            >
              {editavel ? (
                <button
                  type="button"
                  onClick={() => toggleModuloGrupo(g.id, modulo)}
                  className="rounded px-1 hover:bg-slate-200"
                  title="Marcar/desmarcar tudo do módulo"
                >
                  {lista_marcadas}/{lista.length}
                </button>
              ) : (
                <span>
                  {lista_marcadas}/{lista.length}
                </span>
              )}
            </td>
          );
        })}
      </tr>
      {lista.map((p) => (
        <tr key={p.id} className="hover:bg-slate-50">
          <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-1.5 text-left">
            <div className="font-mono text-[10px] text-slate-700">{p.codigo}</div>
            {p.descricao && (
              <div className="text-[10px] text-slate-500">{p.descricao}</div>
            )}
          </td>
          {grupos.map((g) => {
            const key = `${g.id}|${p.id}`;
            const checked = !!marcadas[key];
            const editavel = podeEditar && !g.sistema;
            return (
              <td
                key={g.id}
                className="border-b border-r border-slate-200 px-2 py-1 text-center"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => editavel && toggle(g.id, p.id)}
                  disabled={!editavel}
                  className="accent-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

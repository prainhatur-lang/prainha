'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface MarcaAceita {
  id: string; // produto_marca_aceita.id
  marcaId: string;
  marcaNome: string;
}

interface MarcaOpcao {
  id: string;
  nome: string;
}

export function AbaMarcas({
  produtoId,
  produtoNome,
  marcasAceitas,
  marcasDisponiveis,
}: {
  produtoId: string;
  produtoNome: string;
  marcasAceitas: MarcaAceita[];
  marcasDisponiveis: MarcaOpcao[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [novaMarca, setNovaMarca] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    const nome = novaMarca.trim();
    if (!nome) return;
    setErro(null);
    try {
      const r = await fetch(`/api/produtos/${produtoId}/marcas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ marca: nome }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setNovaMarca('');
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function remover(vinculoId: string, marcaNome: string) {
    if (!confirm(`Remover marca "${marcaNome}" das aceitas pra ${produtoNome}?`)) return;
    setErro(null);
    try {
      const r = await fetch(`/api/produtos/${produtoId}/marcas/${vinculoId}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Marcas aceitas pra cotação</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Quando criar uma cotação com este produto, sistema vai sugerir essas marcas pros
          fornecedores. Se vazio, qualquer marca é aceita.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {marcasAceitas.length === 0 ? (
          <p className="mb-4 rounded bg-slate-50 p-3 text-xs text-slate-500">
            Nenhuma marca cadastrada como aceita ainda. Adicione abaixo.
          </p>
        ) : (
          <div className="mb-4 flex flex-wrap gap-2">
            {marcasAceitas.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-900"
              >
                {m.marcaNome}
                <button
                  type="button"
                  onClick={() => remover(m.id, m.marcaNome)}
                  disabled={pending}
                  className="text-sky-600 hover:text-rose-600 disabled:opacity-50"
                  title="Remover"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <form onSubmit={adicionar} className="flex items-center gap-2">
          <input
            type="text"
            list="marcas-disponiveis"
            value={novaMarca}
            onChange={(e) => setNovaMarca(e.target.value)}
            placeholder="Adicionar marca (ex: Polissêmio, Toma Atá, Tio João...)"
            className="flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm"
          />
          <datalist id="marcas-disponiveis">
            {marcasDisponiveis.map((m) => (
              <option key={m.id} value={m.nome} />
            ))}
          </datalist>
          <button
            type="submit"
            disabled={pending || !novaMarca.trim()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            + Adicionar
          </button>
        </form>

        {erro && (
          <p className="mt-2 text-xs text-rose-700">{erro}</p>
        )}

        <p className="mt-3 text-[10px] text-slate-400">
          Dica: digite uma marca nova ou escolha do autocomplete (marcas já cadastradas em
          outros produtos da filial).
        </p>
      </div>
    </div>
  );
}

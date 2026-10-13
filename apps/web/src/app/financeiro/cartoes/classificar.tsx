'use client';

// Categoria e casa de cada lançamento da fatura, escolhidas na mão. A regra do
// estabelecimento só sugere; o que o dono marca aqui fica gravado.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const OUTRA = '__outra__';
const RATEIO = '__rateio__';

export function ClassificarLancamento({
  id,
  categoria,
  filialId,
  rateado,
  parte,
  categorias,
  filiais,
  todos,
}: {
  id: string;
  categoria: string | null;
  filialId: string | null;
  /** Dividido em partes iguais entre as casas. */
  rateado: boolean;
  /** Quanto cabe a cada casa quando está dividido (já formatado). */
  parte: string | null;
  categorias: string[];
  filiais: Array<{ id: string; nome: string }>;
  todos: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function gravar(body: Record<string, unknown>) {
    setOcupado(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/cartoes/lancamentos/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, mesmoEstabelecimento: todos }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; mudados?: number };
      if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
      if ((j.mudados ?? 0) > 1) setAviso(`${j.mudados} lançamentos`);
      router.refresh();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'erro');
    } finally {
      setOcupado(false);
    }
  }

  const opcoes = categoria && !categorias.includes(categoria) ? [categoria, ...categorias] : categorias;
  const cls = 'rounded border border-slate-300 bg-white px-1.5 py-1 text-xs disabled:opacity-50';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        className={`${cls} ${categoria ? '' : 'border-amber-400 text-amber-800'}`}
        disabled={ocupado}
        value={categoria ?? ''}
        onChange={(e) => {
          let v: string | null = e.target.value;
          if (v === OUTRA) {
            v = window.prompt('Nome da categoria nova:')?.trim() || null;
            if (!v) return;
          }
          void gravar({ categoria: v || null });
        }}
      >
        <option value="">sem categoria</option>
        {opcoes.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value={OUTRA}>+ outra categoria…</option>
      </select>
      <select
        className={`${cls} ${filialId || rateado ? '' : 'border-amber-400 text-amber-800'}`}
        disabled={ocupado}
        value={rateado ? RATEIO : (filialId ?? '')}
        onChange={(e) => {
          const v = e.target.value;
          if (v === RATEIO) void gravar({ ratear: true });
          else if (v) void gravar({ filialId: v });
          else void gravar({ filialId: null, ratear: false });
        }}
      >
        <option value="">sem casa</option>
        {filiais.map((f) => (
          <option key={f.id} value={f.id}>
            {f.nome}
          </option>
        ))}
        {filiais.length > 1 ? <option value={RATEIO}>÷ dividir entre as {filiais.length} casas</option> : null}
      </select>
      {rateado && parte ? <span className="text-xs text-slate-500">{parte} cada</span> : null}
      {aviso ? <span className="text-xs text-slate-500">{aviso}</span> : null}
    </div>
  );
}

export interface LinhaLancamento {
  id: string;
  data: string;
  cartao: string;
  estabelecimento: string;
  parcela: string;
  categoria: string | null;
  filialId: string | null;
  rateado: boolean;
  parte: string | null;
  valor: string;
  credito: boolean;
}

/** A tabela de lançamentos da fatura com categoria e casa editáveis. */
export function LancamentosEditaveis({
  linhas,
  categorias,
  filiais,
}: {
  linhas: LinhaLancamento[];
  categorias: string[];
  filiais: Array<{ id: string; nome: string }>;
}) {
  const [todos, setTodos] = useState(true);
  return (
    <>
      <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
        Ao escolher, aplicar também aos outros lançamentos do mesmo estabelecimento (em todas as faturas)
      </label>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Cartão</th>
              <th className="px-3 py-2">Estabelecimento</th>
              <th className="px-3 py-2">Parcela</th>
              <th className="px-3 py-2">Categoria e casa</th>
              <th className="px-3 py-2 text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5">{l.data}</td>
                <td className="px-3 py-1.5 text-slate-500">{l.cartao}</td>
                <td className="px-3 py-1.5">{l.estabelecimento}</td>
                <td className="px-3 py-1.5 text-slate-500">{l.parcela}</td>
                <td className="px-3 py-1.5">
                  <ClassificarLancamento
                    id={l.id}
                    categoria={l.categoria}
                    filialId={l.filialId}
                    rateado={l.rateado}
                    parte={l.parte}
                    categorias={categorias}
                    filiais={filiais}
                    todos={todos}
                  />
                </td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${l.credito ? 'text-emerald-700' : ''}`}>
                  {l.valor}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

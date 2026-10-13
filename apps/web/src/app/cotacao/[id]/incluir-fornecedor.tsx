'use client';

// Convoca mais fornecedores numa cotação que já está aberta. Antes só dava pra
// escolher na criação; quem ficou de fora só entrava abrindo outra cotação.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface FornecedorCandidato {
  id: string;
  nome: string;
  categoria: string | null;
  /** Distribuidor que vende de tudo (recebe mesmo sem vínculo com o item). */
  geral: boolean;
  /** Quantos itens DESTA cotação ele tem vinculados. */
  itensQueVende: number;
  temFone: boolean;
}

export function IncluirFornecedor({
  cotacaoId,
  candidatos,
}: {
  cotacaoId: string;
  candidatos: FornecedorCandidato[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [falhas, setFalhas] = useState<string[]>([]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return candidatos
      .filter((f) => !q || f.nome.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          b.itensQueVende - a.itensQueVende ||
          Number(b.geral) - Number(a.geral) ||
          a.nome.localeCompare(b.nome, 'pt-BR'),
      );
  }, [candidatos, busca]);

  function toggle(id: string) {
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  async function incluir() {
    if (marcados.size === 0) return;
    setSalvando(true);
    setMsg(null);
    setFalhas([]);
    try {
      const r = await fetch(`/api/cotacao/${cotacaoId}/incluir-fornecedor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fornecedorIds: [...marcados] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error ?? `Erro ${r.status}`);
        return;
      }
      const partes = [`${d.incluidos} incluído(s)`];
      if (d.envioAutomatico) partes.push(`${d.enviados} enviado(s) no WhatsApp`);
      else partes.push('envie o link pelo botão 📲 da linha');
      if (d.semTelefone) partes.push(`${d.semTelefone} sem telefone`);
      if (d.falhas?.length) partes.push(`${d.falhas.length} falha(s) no envio`);
      setMsg(`✓ ${partes.join(' · ')}`);
      setFalhas(Array.isArray(d.falhas) ? d.falhas : []);
      setMarcados(new Set());
      setAberto(false);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          ➕ Incluir fornecedor
        </button>
        {msg && <span className="text-xs text-slate-600">{msg}</span>}
      </div>
      {falhas.length > 0 && (
        <div className="mt-1 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
          {falhas.map((f, i) => (
            <div key={i} className="break-all">⚠ {f}</div>
          ))}
        </div>
      )}
      {aberto && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-[11px] text-slate-600">
            Fornecedores de compras desta casa que ainda não estão nesta cotação. Quem for
            incluído recebe o link com os mesmos itens e o mesmo prazo.
          </div>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar fornecedor…"
            className="mb-2 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
          />
          {lista.length === 0 ? (
            <div className="text-xs text-slate-500">Nenhum fornecedor pra incluir.</div>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {lista.map((f) => (
                <label
                  key={f.id}
                  className="flex cursor-pointer items-center gap-2 rounded bg-white px-2 py-1 text-xs hover:bg-slate-100"
                >
                  <input
                    type="checkbox"
                    checked={marcados.has(f.id)}
                    onChange={() => toggle(f.id)}
                  />
                  <span className="font-medium text-slate-900">{f.nome}</span>
                  {f.geral && (
                    <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-800">geral</span>
                  )}
                  {f.itensQueVende > 0 && (
                    <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-800">
                      vende {f.itensQueVende} item(s)
                    </span>
                  )}
                  {!f.temFone && (
                    <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">
                      sem WhatsApp
                    </span>
                  )}
                  {f.categoria && <span className="text-[10px] text-slate-400">{f.categoria}</span>}
                </label>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void incluir()}
              disabled={salvando || marcados.size === 0}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {salvando ? 'Incluindo…' : `Incluir e enviar (${marcados.size})`}
            </button>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="text-xs text-slate-500 hover:underline"
            >
              fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

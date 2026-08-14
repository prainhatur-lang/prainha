'use client';

// Conferência pós-evento: cobrado no orçamento × consumido no PDV.
// A equipe abre UMA comanda pro evento; aqui ela marca qual(is) foram e o
// sistema calcula consumo real, média por pessoa e desvio.

import { useEffect, useState } from 'react';

interface Comanda {
  id: string;
  numero: number | null;
  tag: string | null;
  nomeCliente: string | null;
  valorTotal: number;
  pessoas: number | null;
  fechamento: string | null;
}

interface Conferencia {
  pedidoIds: string[];
  consumido: number;
  cobrado: number | null;
  mediaPessoa: number;
  desvioPct: number | null;
  conferidoEm: string;
  conferidoPor?: string | null;
}

const rs = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

export function ConferenciaBox({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [cobrado, setCobrado] = useState<number | null>(null);
  const [pessoas, setPessoas] = useState(0);
  const [conf, setConf] = useState<Conferencia | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [refazendo, setRefazendo] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/orcamentos/${id}/conferencia`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('falha ao carregar'))))
      .then((d) => {
        if (!vivo) return;
        setComandas(d.comandas ?? []);
        setCobrado(d.cobrado);
        setPessoas(d.pessoas ?? 0);
        setConf(d.conferencia ?? null);
        // pré-marca a maior comanda do dia (evento costuma ser o maior ticket)
        if (!d.conferencia && d.comandas?.length) setSel(new Set([d.comandas[0].id]));
      })
      .catch((e) => vivo && setErro(e.message))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [id]);

  async function conferir() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/orcamentos/${id}/conferencia`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoIds: [...sel] }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'falha ao conferir');
      setConf(d.conferencia);
      setRefazendo(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return null;

  return (
    <div className="mx-auto mb-6 max-w-3xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
      <h3 className="text-sm font-bold uppercase tracking-widest text-slate-700">
        Conferência pós-evento
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Cobrado no orçamento × consumido no PDV (comanda do evento).
      </p>

      {conf && !refazendo ? (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Cobrado</p>
              <p className="text-sm font-semibold text-slate-900">
                {conf.cobrado == null ? 'a combinar' : rs(conf.cobrado)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Consumido</p>
              <p className="text-sm font-semibold text-slate-900">{rs(conf.consumido)}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Média/pessoa</p>
              <p className="text-sm font-semibold text-slate-900">{rs(conf.mediaPessoa)}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Desvio</p>
              <p
                className={`text-sm font-bold ${
                  conf.desvioPct == null
                    ? 'text-slate-500'
                    : conf.desvioPct >= 0
                      ? 'text-emerald-600'
                      : 'text-red-600'
                }`}
              >
                {conf.desvioPct == null
                  ? '—'
                  : `${conf.desvioPct >= 0 ? '+' : ''}${conf.desvioPct.toFixed(1)}%`}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Conferido em {new Date(conf.conferidoEm).toLocaleString('pt-BR')}
            {conf.conferidoPor ? ` por ${conf.conferidoPor}` : ''} ·{' '}
            {conf.pedidoIds.length} comanda(s)
          </p>
          {podeEditar && (
            <button
              type="button"
              onClick={() => setRefazendo(true)}
              className="mt-2 text-xs font-medium text-slate-500 underline hover:text-slate-700"
            >
              Refazer conferência
            </button>
          )}
        </div>
      ) : (
        <div className="mt-4">
          {comandas.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhuma comanda fechada no PDV no dia do evento (o sync do Consumer pode levar até o
              dia seguinte).
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-600">
                Marque a(s) comanda(s) do evento — a maior do dia já vem marcada:
              </p>
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {comandas.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={sel.has(c.id)}
                        onChange={(e) => {
                          const novo = new Set(sel);
                          if (e.target.checked) novo.add(c.id);
                          else novo.delete(c.id);
                          setSel(novo);
                        }}
                      />
                      <span className="font-semibold text-slate-900">{rs(c.valorTotal)}</span>
                      <span className="text-slate-500">
                        {[c.tag, c.nomeCliente, c.numero != null ? `nº ${c.numero}` : null]
                          .filter(Boolean)
                          .join(' · ') || 'sem identificação'}
                        {c.pessoas ? ` · ${c.pessoas} pessoas` : ''}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {cobrado != null && (
                <p className="mt-2 text-xs text-slate-500">
                  Cobrado no orçamento: <strong>{rs(cobrado)}</strong>
                  {pessoas ? ` (${pessoas} pessoas)` : ''}
                </p>
              )}
              {podeEditar && (
                <button
                  type="button"
                  onClick={conferir}
                  disabled={salvando || sel.size === 0}
                  className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {salvando ? 'Conferindo…' : 'Conferir consumo'}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
    </div>
  );
}

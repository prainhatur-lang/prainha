'use client';

// "Lançar direto na casa" (dono 22/11/2026): a NF-e do ML cai na E.B. Serviços;
// aqui o Admin escolhe a casa da mercadoria, a nota passa pra lá e abre a entrada.

import { useState } from 'react';

export function LancarNaCasa(props: {
  notaIds: string[];
  filialAtual: string | null; // casa onde as notas estão (se todas na mesma)
  casas: { id: string; nome: string }[];
  sugestao: string | null;
}) {
  const [casa, setCasa] = useState(props.sugestao ?? '');
  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function ir() {
    if (!casa) return;
    setIndo(true);
    setErro(null);
    try {
      for (const id of props.notaIds) {
        const r = await fetch(`/api/nota-compra/${id}/mover-casa`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filialId: casa }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
      }
      window.location.href = `/movimento/entrada-notas/${props.notaIds[0]}`;
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setIndo(false);
    }
  }

  const mover = casa && casa !== props.filialAtual;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <select
        value={casa}
        onChange={(e) => setCasa(e.target.value)}
        className="rounded border border-slate-300 px-1 py-0.5 text-xs"
        disabled={indo}
      >
        <option value="">Lançar na casa…</option>
        {props.casas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
            {c.id === props.sugestao ? ' (o Pix saiu daqui)' : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={ir}
        disabled={!casa || indo}
        className="rounded bg-sky-700 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-40"
      >
        {indo ? 'Passando…' : mover ? `Passar ${props.notaIds.length > 1 ? `as ${props.notaIds.length} notas` : 'a nota'} e dar entrada` : 'Dar entrada'}
      </button>
      {erro && <div className="w-full text-rose-700">{erro}</div>}
    </div>
  );
}

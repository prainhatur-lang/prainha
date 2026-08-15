'use client';

// Condição de pagamento do FORNECEDOR (boleto 21 dias, à vista no pix…).
// Gravada no cadastro — vale pra todos os pedidos dele. Edição inline.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CondicaoPagamento(props: { fornecedorId: string; atual: string | null }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(props.atual ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/fornecedores/condicao-pagamento', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fornecedorId: props.fornecedorId, condicao: valor }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setEditando(false);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  if (!editando) {
    return (
      <span className="inline-flex items-center gap-1">
        · Pagamento:{' '}
        {props.atual ? (
          <strong className="text-slate-700">{props.atual}</strong>
        ) : (
          <span className="italic text-slate-400">não informado</span>
        )}
        <button
          onClick={() => setEditando(true)}
          className="rounded border border-slate-200 px-1 text-[10px] text-slate-500 hover:bg-slate-100"
          title="Editar condição de pagamento do fornecedor"
        >
          ✎
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      · Pagamento:
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void salvar();
          if (e.key === 'Escape') setEditando(false);
        }}
        placeholder="ex: boleto 21 dias"
        autoFocus
        maxLength={120}
        className="w-44 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
      />
      <button
        onClick={salvar}
        disabled={salvando}
        className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white disabled:opacity-50"
      >
        {salvando ? '…' : 'salvar'}
      </button>
      <button
        onClick={() => setEditando(false)}
        className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500"
      >
        cancelar
      </button>
      {erro && <span className="text-[10px] text-rose-600">{erro}</span>}
    </span>
  );
}

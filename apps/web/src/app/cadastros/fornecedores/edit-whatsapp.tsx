'use client';

// O WhatsApp do vendedor, editável na lista de fornecedores.
//
// Este é O lugar do número. Ele é gravado em fornecedor.fone_whatsapp, que o
// sync do Consumer NÃO sobrescreve — diferente do fone_principal, que volta a
// ser o fixo da empresa a cada sincronização (foi assim que o pedido 24 da
// Megga foi disparado pro fixo e não chegou em ninguém).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function formata(v: string | null): string {
  if (!v) return '';
  let d = v.replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v;
}

export function EditWhatsapp({
  fornecedorId,
  valorAtual,
}: {
  fornecedorId: string;
  valorAtual: string | null;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(valorAtual ?? '');
  const [pending, setPending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    const digitos = valor.replace(/\D/g, '');
    if (valor.trim() !== '' && digitos.length < 10) {
      setErro('faltou o DDD');
      return;
    }
    setPending(true);
    setErro(null);
    try {
      const r = await fetch(`/api/fornecedores/${fornecedorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ foneWhatsapp: valor.trim() === '' ? null : valor.trim() }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setErro(d.error ?? `erro ${r.status}`);
        return;
      }
      setEditando(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        className={`text-left text-xs ${
          valorAtual
            ? 'text-slate-700 underline decoration-dotted underline-offset-2 hover:text-sky-700'
            : 'rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 hover:bg-amber-100'
        }`}
        title={valorAtual ? 'Clique pra corrigir o WhatsApp' : 'Cadastrar o WhatsApp do vendedor'}
      >
        {valorAtual ? `📱 ${formata(valorAtual)}` : '+ WhatsApp'}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        autoFocus
        value={valor}
        inputMode="tel"
        placeholder="(79) 99999-9999"
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void salvar();
          if (e.key === 'Escape') setEditando(false);
        }}
        className="w-36 rounded border border-slate-300 px-1.5 py-1 text-xs"
      />
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={pending}
          className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white disabled:bg-slate-400"
        >
          {pending ? '…' : 'salvar'}
        </button>
        <button
          type="button"
          onClick={() => { setEditando(false); setValor(valorAtual ?? ''); setErro(null); }}
          className="rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-600"
        >
          cancelar
        </button>
      </div>
      {erro && <span className="text-[10px] text-rose-600">{erro}</span>}
    </div>
  );
}

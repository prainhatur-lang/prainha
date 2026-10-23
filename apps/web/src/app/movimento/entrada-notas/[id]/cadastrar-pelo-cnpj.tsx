'use client';

// Nota/pedido sem fornecedor: digita o CNPJ e o sistema cadastra (outra casa ou
// Receita) e liga na nota. Fica ao lado do "+ Vincular fornecedor".
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CadastrarPeloCnpj({ notaId, cnpjInicial }: { notaId: string; cnpjInicial: string | null }) {
  const router = useRouter();
  const [cnpj, setCnpj] = useState(cnpjInicial ?? '');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const pronto = cnpj.replace(/\D/g, '').length >= 11;
  async function enviar() {
    setEnviando(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}/fornecedor-cnpj`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cnpj }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ ok: false, texto: d.error ?? `HTTP ${r.status}` });
      else {
        setMsg({ ok: true, texto: d.mensagem ?? 'fornecedor cadastrado' });
        router.refresh();
      }
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        inputMode="numeric"
        placeholder="CNPJ do fornecedor"
        value={cnpj}
        onChange={(e) => setCnpj(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && pronto) enviar();
        }}
        className="w-48 rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900"
      />
      <button
        type="button"
        disabled={enviando || !pronto}
        onClick={enviar}
        className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {enviando ? 'Cadastrando…' : 'Cadastrar pelo CNPJ'}
      </button>
      {msg && <span className={`w-full text-xs ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.texto}</span>}
    </div>
  );
}

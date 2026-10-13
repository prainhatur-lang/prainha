'use client';

// Como o fornecedor recebe: chave Pix e, quando o Pix cai no nome de outra
// pessoa, o nome de quem recebe. Caso que criou o campo (13/10/2026): a Butique
// da Carne é paga por Pix em nome de Elizabeth Vieira dos Santos — no extrato
// do banco aparece ela, não o fornecedor. Vale pra mesma empresa nas outras casas.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function EditPix({
  fornecedorId,
  chaveAtual,
  favorecidoAtual,
}: {
  fornecedorId: string;
  chaveAtual: string | null;
  favorecidoAtual: string | null;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [chave, setChave] = useState(chaveAtual ?? '');
  const [favorecido, setFavorecido] = useState(favorecidoAtual ?? '');
  const [pending, setPending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setPending(true);
    setErro(null);
    try {
      const r = await fetch(`/api/fornecedores/${fornecedorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chavePix: chave.trim() || null, pixFavorecido: favorecido.trim() || null }),
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
    const tem = chaveAtual || favorecidoAtual;
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        className={`mt-1 block text-left text-xs ${
          tem
            ? 'text-slate-700 underline decoration-dotted underline-offset-2 hover:text-sky-700'
            : 'text-slate-400 hover:text-sky-700'
        }`}
        title="Chave Pix e nome de quem recebe o pagamento"
      >
        {tem ? (
          <>
            💠 Pix{chaveAtual ? `: ${chaveAtual}` : ''}
            {favorecidoAtual ? ` — em nome de ${favorecidoAtual}` : ''}
          </>
        ) : (
          '+ Pix (chave e quem recebe)'
        )}
      </button>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-1">
      <input
        autoFocus
        value={chave}
        placeholder="chave Pix (CPF, telefone, e-mail…)"
        onChange={(e) => setChave(e.target.value)}
        className="w-56 rounded border border-slate-300 px-1.5 py-1 text-xs"
      />
      <input
        value={favorecido}
        placeholder="quem recebe (nome que aparece no Pix)"
        onChange={(e) => setFavorecido(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void salvar();
          if (e.key === 'Escape') setEditando(false);
        }}
        className="w-56 rounded border border-slate-300 px-1.5 py-1 text-xs"
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
          onClick={() => {
            setEditando(false);
            setChave(chaveAtual ?? '');
            setFavorecido(favorecidoAtual ?? '');
            setErro(null);
          }}
          className="rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-600"
        >
          cancelar
        </button>
      </div>
      {erro && <span className="text-[10px] text-rose-600">{erro}</span>}
    </div>
  );
}

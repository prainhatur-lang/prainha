'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function TrocarTipoButton({
  produtoId,
  tipoAtual,
}: {
  produtoId: string;
  tipoAtual: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Só mostra o botão pra produtos INSUMO ou VENDA_SIMPLES.
  // Os outros tipos (VENDA_COMPOSTO, COMBO, COMPLEMENTO) precisam de fluxo proprio.
  if (tipoAtual !== 'INSUMO' && tipoAtual !== 'VENDA_SIMPLES') return null;

  const novoTipo = tipoAtual === 'INSUMO' ? 'VENDA_SIMPLES' : 'INSUMO';
  const novoLabel = novoTipo === 'INSUMO' ? 'Insumo' : 'Produto (revenda)';

  async function trocar() {
    setErro(null);
    try {
      const r = await fetch(`/api/produtos/${produtoId}/tipo`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tipo: novoTipo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setAberto(false);
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
        title="Mudar entre Insumo e Produto"
      >
        ↔ Mudar tipo
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setAberto(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <h3 className="text-sm font-semibold text-slate-900">Mudar tipo do produto</h3>
            <p className="text-xs text-slate-600">
              Atual: <strong>{tipoAtual === 'INSUMO' ? 'Insumo' : 'Produto (revenda)'}</strong>
              <br />
              Novo: <strong>{novoLabel}</strong>
            </p>
            <p className="rounded bg-slate-50 p-2 text-[10px] text-slate-600">
              <strong>Insumo</strong>: garrafa abre, dose em drink ou matéria-prima de cozinha (entra
              em ficha técnica).
              <br />
              <strong>Produto</strong>: compra unidade fechada, vende a mesma unidade (lata Coca,
              long neck Heineken).
            </p>
            {erro && <p className="text-xs text-rose-700">{erro}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={trocar}
                disabled={pending}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {pending ? 'Mudando...' : `Mudar pra ${novoLabel}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

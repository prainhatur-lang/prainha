'use client';

// Drink de boas-vindas da 81ª SOEA (13 a 18/10/2026). O cliente mostra esta
// tela e o crachá; o GARÇOM toca em "Entregar" e confirma — a baixa é uma vez
// só por cartão (não tem como desfazer).

import { useState } from 'react';

export function DrinkSoea({
  token, entregueEm, noPeriodo,
}: { token: string; entregueEm: string | null; noPeriodo: boolean }) {
  const [entregue, setEntregue] = useState(entregueEm);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function entregar() {
    setOcupado(true);
    setErro('');
    try {
      const r = await fetch('/api/fidelidade/cartao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, acao: 'entregar_drink' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || 'Não deu certo, tente de novo.');
      setEntregue(String(j.entregue_em || ''));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
      setConfirmando(false);
    }
  }

  if (entregue) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
        <div className="font-medium text-slate-700">Drink de boas-vindas · 81ª SOEA</div>
        <div className="mt-0.5">Entregue em {entregue}. Saúde!</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-700">81ª SOEA</div>
      <div className="mt-0.5 text-lg font-bold text-slate-900">Drink de boas-vindas</div>
      {!noPeriodo ? (
        <p className="mt-1 text-sm text-slate-600">Vale de 13 a 18 de outubro, no Prainha Bar. Te esperamos!</p>
      ) : confirmando ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium text-slate-800">Garçom: confirmar a entrega do drink? Não dá pra desfazer.</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setConfirmando(false)} disabled={ocupado} className="rounded-xl bg-white px-4 py-3 text-sm font-medium text-slate-600 ring-1 ring-slate-200">
              Voltar
            </button>
            <button onClick={entregar} disabled={ocupado} className="rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
              {ocupado ? 'Registrando…' : 'Confirmar entrega'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-600">
            Mostre esta tela e o seu crachá ao garçom. Quem toca no botão é ele, na hora de servir.
          </p>
          <button onClick={() => setConfirmando(true)} className="mt-3 w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white">
            Garçom: entregar drink
          </button>
        </>
      )}
      {erro && <p className="mt-2 text-sm text-red-700">{erro}</p>}
    </div>
  );
}

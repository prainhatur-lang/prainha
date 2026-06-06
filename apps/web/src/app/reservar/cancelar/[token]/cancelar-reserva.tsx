'use client';

import { useState } from 'react';

export function CancelarReserva({ token, jaCancelada }: { token: string; jaCancelada: boolean }) {
  const [estado, setEstado] = useState<'idle' | 'enviando' | 'ok' | 'erro'>(jaCancelada ? 'ok' : 'idle');
  const [erro, setErro] = useState<string | null>(null);

  async function cancelar() {
    setEstado('enviando');
    setErro(null);
    try {
      const r = await fetch(`/api/reservar/cancelar/${token}`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? `Erro ${r.status}`);
        setEstado('erro');
        return;
      }
      setEstado('ok');
    } catch (e) {
      setErro((e as Error).message);
      setEstado('erro');
    }
  }

  if (estado === 'ok') {
    return (
      <div className="mt-5">
        <div className="text-4xl">🚫</div>
        <p className="mt-2 text-base font-semibold text-[#b3411c]">Reserva cancelada.</p>
        <p className="mt-1 text-xs text-[#8a7a64]">A mesa foi liberada. Esperamos te ver em breve! 🌅</p>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <p className="text-sm text-[#8a7a64]">Quer mesmo cancelar esta reserva?</p>
      {erro && <p className="mt-2 text-xs text-[#b3411c]">{erro}</p>}
      <button
        onClick={cancelar}
        disabled={estado === 'enviando'}
        className="mt-3 w-full rounded-full border border-[#d8b48a] bg-transparent px-4 py-3 text-sm font-semibold text-[#b3411c] transition-colors duration-300 hover:bg-[#b3411c] hover:text-[#fbf6ec] disabled:opacity-50"
      >
        {estado === 'enviando' ? 'Cancelando…' : 'Cancelar reserva'}
      </button>
    </div>
  );
}

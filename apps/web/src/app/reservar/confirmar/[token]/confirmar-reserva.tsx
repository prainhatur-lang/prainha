'use client';

import { useState } from 'react';

type Estado = 'inicio' | 'confirmada' | 'cancelada';

export function ConfirmarReserva({
  token,
  jaCancelada,
  jaConfirmada,
}: {
  token: string;
  jaCancelada: boolean;
  jaConfirmada: boolean;
}) {
  const [estado, setEstado] = useState<Estado>(
    jaCancelada ? 'cancelada' : jaConfirmada ? 'confirmada' : 'inicio',
  );
  const [carregando, setCarregando] = useState<'sim' | 'nao' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setCarregando('sim');
    setErro(null);
    try {
      const r = await fetch(`/api/reservar/confirmar/${token}`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? 'Não foi possível confirmar.');
        return;
      }
      setEstado('confirmada');
    } catch {
      setErro('Erro de conexão. Tente de novo.');
    } finally {
      setCarregando(null);
    }
  }

  async function cancelar() {
    if (!confirm('Tem certeza que quer cancelar a reserva?')) return;
    setCarregando('nao');
    setErro(null);
    try {
      const r = await fetch(`/api/reservar/cancelar/${token}`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? 'Não foi possível cancelar.');
        return;
      }
      setEstado('cancelada');
    } catch {
      setErro('Erro de conexão. Tente de novo.');
    } finally {
      setCarregando(null);
    }
  }

  if (estado === 'confirmada') {
    return (
      <div className="mt-5">
        <div className="text-5xl">✅</div>
        <h2 className="mt-2 text-xl font-bold text-emerald-600">Presença confirmada!</h2>
        <p className="mt-1 text-sm text-slate-600">
          Obrigado por confirmar. Te esperamos! 🌅 Se mudar de ideia, é só voltar aqui e cancelar.
        </p>
        <button
          onClick={cancelar}
          disabled={carregando === 'nao'}
          className="mt-4 text-xs text-slate-400 underline hover:text-slate-600"
        >
          {carregando === 'nao' ? 'Cancelando…' : 'Preciso cancelar'}
        </button>
        {erro && <p className="mt-2 text-xs text-rose-600">{erro}</p>}
      </div>
    );
  }

  if (estado === 'cancelada') {
    return (
      <div className="mt-5">
        <div className="text-5xl">🚫</div>
        <h2 className="mt-2 text-xl font-bold text-rose-600">Reserva cancelada</h2>
        <p className="mt-1 text-sm text-slate-600">
          Tudo bem! A mesa foi liberada. Quando quiser, é só reservar de novo.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <p className="text-sm text-slate-700">Você confirma que vem amanhã?</p>
      <div className="mt-4 flex flex-col gap-2">
        <button
          onClick={confirmar}
          disabled={carregando !== null}
          className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {carregando === 'sim' ? 'Confirmando…' : '✅ Sim, vou!'}
        </button>
        <button
          onClick={cancelar}
          disabled={carregando !== null}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {carregando === 'nao' ? 'Cancelando…' : '❌ Não vou poder ir'}
        </button>
      </div>
      {erro && <p className="mt-2 text-xs text-rose-600">{erro}</p>}
    </div>
  );
}

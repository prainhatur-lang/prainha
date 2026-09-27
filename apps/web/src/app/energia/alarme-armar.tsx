'use client';

// Cartão grande de ligar/desligar o alarme (UniFi → Tuya), com janela de
// confirmação. Pensado pro celular do gerente: na saída liga, na chegada desliga.
// Desarmado, o webhook do alarme chega mas não liga nada.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export interface GatilhoArmavel {
  id: string;
  nome: string;
  ativo: boolean;
  ativoAlteradoPor: string | null;
  ativoAlteradoEm: string | null;
  ultimoDisparoEm: string | null;
  ultimoResultado: string | null;
}

function fmt(d: string | null): string {
  if (!d) return 'nunca';
  return new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function quem(email: string | null): string {
  if (!email) return '';
  return email.split('@')[0];
}

export function AlarmeArmar({ gatilhos, podeControlar }: { gatilhos: GatilhoArmavel[]; podeControlar: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [estado, setEstado] = useState<Record<string, GatilhoArmavel>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // gatilho esperando o "sim" na janela de confirmação
  const [confirmando, setConfirmando] = useState<GatilhoArmavel | null>(null);

  if (gatilhos.length === 0) return null;

  async function alternar(g: GatilhoArmavel) {
    const armar = !g.ativo;
    setConfirmando(null);
    setEnviando(g.id);
    setErro(null);
    try {
      const r = await fetch(`/api/energia/gatilhos/${g.id}/armar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ armado: armar }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'erro');
      setEstado((s) => ({
        ...s,
        [g.id]: { ...g, ativo: data.armado, ativoAlteradoPor: data.alteradoPor, ativoAlteradoEm: data.alteradoEm },
      }));
      start(() => router.refresh());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {erro ? <p className="rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{erro}</p> : null}
      {gatilhos.map((orig) => {
        const g = estado[orig.id] ?? orig;
        const armado = g.ativo;
        return (
          <div
            key={g.id}
            className={`rounded-2xl p-4 text-white shadow-sm ${armado ? 'bg-rose-600' : 'bg-emerald-600'}`}
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden>
                {armado ? '🔒' : '🔓'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide opacity-80">{g.nome}</p>
                <p className="text-2xl font-extrabold leading-tight">{armado ? 'ALARME LIGADO' : 'ALARME DESLIGADO'}</p>
                <p className="text-xs opacity-90">
                  {g.ativoAlteradoEm
                    ? `${armado ? 'Ligado' : 'Desligado'} por ${quem(g.ativoAlteradoPor)} em ${fmt(g.ativoAlteradoEm)}`
                    : armado
                      ? 'Ligado'
                      : 'Desligado'}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs opacity-80">
              Último disparo: {fmt(g.ultimoDisparoEm)}
              {g.ultimoResultado ? ` · ${g.ultimoResultado}` : ''}
            </p>
            {podeControlar ? (
              <button
                onClick={() => setConfirmando(g)}
                disabled={enviando === g.id}
                className={`mt-3 w-full rounded-xl bg-white py-4 text-lg font-bold shadow disabled:opacity-60 ${
                  armado ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {enviando === g.id ? 'Enviando...' : armado ? '🔓 Desligar alarme' : '🔒 Ligar alarme'}
              </button>
            ) : null}
          </div>
        );
      })}

      {confirmando ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-4 sm:items-center"
          onClick={() => setConfirmando(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-4xl" aria-hidden>
              {confirmando.ativo ? '🔓' : '🔒'}
            </p>
            <h3 className="mt-2 text-lg font-bold text-slate-900">
              {confirmando.ativo ? 'Desligar o alarme?' : 'Ligar o alarme?'}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {confirmando.ativo
                ? 'Movimento nas câmeras deixa de avisar e não liga nenhum disjuntor. As câmeras continuam gravando.'
                : 'Com o alarme ligado, qualquer movimento nas câmeras avisa no celular e liga os disjuntores do alarme. Confira se não ficou ninguém na loja.'}
            </p>
            <p className="mt-2 text-xs text-slate-400">{confirmando.nome}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setConfirmando(null)}
                className="rounded-xl bg-slate-100 py-3 text-base font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={() => alternar(confirmando)}
                className={`rounded-xl py-3 text-base font-bold text-white ${
                  confirmando.ativo ? 'bg-emerald-600' : 'bg-rose-600'
                }`}
              >
                {confirmando.ativo ? 'Sim, desligar' : 'Sim, ligar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

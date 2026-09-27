'use client';

// Cartão grande de armar/desarmar os gatilhos de alarme (UniFi → Tuya).
// Pensado pro celular do gerente: na saída arma, na chegada desarma.
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

  if (gatilhos.length === 0) return null;

  async function alternar(g: GatilhoArmavel) {
    const armar = !g.ativo;
    if (!confirm(armar ? `Armar "${g.nome}"?` : `Desarmar "${g.nome}"? O alarme não vai mais acender nada.`)) return;
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
                <p className="text-2xl font-extrabold leading-tight">{armado ? 'ALARME ARMADO' : 'DESARMADO'}</p>
                <p className="text-xs opacity-90">
                  {g.ativoAlteradoEm
                    ? `${armado ? 'Armado' : 'Desarmado'} por ${quem(g.ativoAlteradoPor)} em ${fmt(g.ativoAlteradoEm)}`
                    : armado
                      ? 'Armado'
                      : 'Desarmado'}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs opacity-80">
              Último disparo: {fmt(g.ultimoDisparoEm)}
              {g.ultimoResultado ? ` · ${g.ultimoResultado}` : ''}
            </p>
            {podeControlar ? (
              <button
                onClick={() => alternar(g)}
                disabled={enviando === g.id}
                className={`mt-3 w-full rounded-xl bg-white py-4 text-lg font-bold shadow disabled:opacity-60 ${
                  armado ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {enviando === g.id ? 'Enviando...' : armado ? '🔓 Desarmar alarme' : '🔒 Armar alarme'}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

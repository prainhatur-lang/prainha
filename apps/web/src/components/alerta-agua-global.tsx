'use client';

// Aviso em tela cheia da água, por cima de qualquer tela do sistema: caixa
// superior quase vazia, boia com defeito, bomba travada, quadro sem
// comunicação. Pisca em vermelho até alguém tocar em "Estou ciente"; volta em
// 30 minutos se o problema continuar.
//
// Só aparece pra quem tem a permissão `agua.read` (a rota devolve 401/403 pros
// demais e o componente para de consultar).

import { useCallback, useEffect, useRef, useState } from 'react';

interface Alarme {
  id: number;
  titulo: string;
  detalhe: string | null;
  abertoEm: string;
}

const INTERVALO_MS = 30_000;
const REAVISO_MIN = 30;

export function AlertaAguaGlobal() {
  const [alarmes, setAlarmes] = useState<Alarme[]>([]);
  const [pisca, setPisca] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/agua/estado?so=avisar', { cache: 'no-store' });
      if (r.status === 401 || r.status === 403) {
        // sem acesso à água: não é pra essa pessoa
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        return;
      }
      if (!r.ok) return;
      const d = await r.json();
      setAlarmes(Array.isArray(d?.alarmes) ? d.alarmes : []);
    } catch {
      /* consulta silenciosa */
    }
  }, []);

  useEffect(() => {
    carregar();
    timerRef.current = setInterval(carregar, INTERVALO_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [carregar]);

  const aberto = alarmes.length > 0;
  useEffect(() => {
    if (!aberto) return;
    const t = setInterval(() => setPisca((p) => !p), 700);
    return () => clearInterval(t);
  }, [aberto]);

  async function confirmar() {
    setEnviando(true);
    try {
      const r = await fetch('/api/agua/ciente', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: alarmes.map((a) => a.id) }),
      });
      if (r.ok) setAlarmes([]);
    } catch {
      /* fica na tela; a pessoa toca de novo */
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Problema no abastecimento de água"
      className="fixed inset-0 flex items-center justify-center p-4 transition-colors duration-300"
      style={{ zIndex: 2147483000, background: pisca ? 'rgba(170,20,20,0.94)' : 'rgba(110,10,10,0.94)' }}
    >
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-xl border-4 border-red-700 bg-white p-6 text-slate-900">
        <div className="mb-3 text-2xl font-bold text-red-700 sm:text-3xl">Atenção: problema na água do Prainha Bar</div>
        {alarmes.map((a) => (
          <div key={a.id} className="border-t border-slate-200 py-3">
            <div className="text-xl font-semibold">{a.titulo}</div>
            {a.detalhe && <div className="mt-1 text-base">{a.detalhe}</div>}
            <div className="mt-1 text-xs text-slate-500">
              Desde {new Date(a.abertoEm).toLocaleString('pt-BR', { timeZone: 'America/Maceio' })}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={confirmar}
          disabled={enviando}
          className="mt-4 w-full rounded-lg bg-red-700 px-4 py-3.5 text-lg font-semibold text-white hover:bg-red-800 disabled:opacity-60"
        >
          {enviando ? 'Confirmando…' : 'Estou ciente'}
        </button>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>O aviso volta em {REAVISO_MIN} minutos se o problema continuar.</span>
          <a href="/agua" className="font-medium text-red-700 underline">
            Abrir a tela Água
          </a>
        </div>
      </div>
    </div>
  );
}

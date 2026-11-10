'use client';

// Botão "Gerar escala sugerida (IA)" do estudo de equipe (10/11/2026).
// Só sugestão: não grava nada na escala do mês.

import { useState } from 'react';
import { Texto } from './texto-md';

export function PainelEscala(props: {
  filialId: string;
  mes: string;
  meta: number | null;
  metaCoz: number | null;
  min: number | null;
  escala: string | null;
  escalaEm: string | null;
  escalaPor: string | null;
}) {
  const [escala, setEscala] = useState(props.escala);
  const [escalaEm, setEscalaEm] = useState(props.escalaEm);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const quando = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '';

  async function gerar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch('/api/rh/estudo-equipe/escala', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: props.filialId, mes: props.mes, meta: props.meta, metaCoz: props.metaCoz, min: props.min }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || `erro ${r.status}`);
      setEscala(j.escala);
      setEscalaEm(j.escalaEm);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="mt-4 rounded-md border border-emerald-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Escala da semana com nomes (IA)</h3>
          <p className="text-xs text-slate-500">
            A IA distribui a equipe de hoje nos turnos acima, respeitando regime, horário de costume, CCT (10h/dia, 44h/semana, folga) e diarista até 2 dias.
          </p>
        </div>
        <button
          type="button"
          onClick={gerar}
          disabled={carregando}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {carregando ? 'Montando a escala… (até 4 min)' : escala ? 'Gerar de novo' : 'Gerar escala sugerida (IA)'}
        </button>
      </div>
      {erro && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {escala ? (
        <div className="rounded-md bg-emerald-50/40 p-3">
          {escalaEm && (
            <p className="mb-2 text-xs text-slate-400">
              Gerada em {quando(escalaEm)}
              {props.escalaPor && escalaEm === props.escalaEm ? ` por ${props.escalaPor}` : ''} · sugestão, não altera a escala do mês
            </p>
          )}
          <Texto md={escala} />
        </div>
      ) : (
        !carregando && <p className="text-sm text-slate-400">Ainda sem escala sugerida neste mês.</p>
      )}
    </div>
  );
}

'use client';

// Trava de dias por semana no ponto facial (pedido do dono 20/10/2026: quem
// trabalha sem registro só 2 vezes na semana). Grava pela rota
// /api/rh/ponto/limite-semana, que avisa as lojas pra puxarem o roster.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function enviar(body: unknown): Promise<string | null> {
  const r = await fetch('/api/rh/ponto/limite-semana', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  return j?.ok ? null : j?.error || `erro ${r.status}`;
}

/** Botão do topo do grupo: trava todo mundo da lista em N dias. */
export function TravarTodos(props: { ids: string[]; jaTravados: number; dias: number }) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const faltam = props.ids.length - props.jaTravados;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={salvando || faltam === 0}
        onClick={async () => {
          if (!confirm(`Travar ${props.ids.length} pessoa(s) em ${props.dias} dias por semana no ponto facial?`)) return;
          setSalvando(true);
          setErro(null);
          const e = await enviar({ funcionarioIds: props.ids, limite: props.dias });
          setSalvando(false);
          if (e) setErro(e);
          else router.refresh();
        }}
        className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
      >
        {salvando ? 'Travando…' : faltam === 0 ? `Todos travados em ${props.dias} dias` : `🔒 Travar todos em ${props.dias} dias/semana`}
      </button>
      {erro && <span className="text-xs text-rose-600">{erro}</span>}
    </div>
  );
}

/** Célula por pessoa: limite (sem / 1–6) + liberar hoje. */
export function TravaPessoa(props: {
  id: string;
  limite: number | null;
  liberadoHoje: boolean;
  diasSemanaAtual: number;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const travado = props.limite != null && props.diasSemanaAtual >= props.limite && !props.liberadoHoje;

  if (!props.podeEditar) {
    return <span className="text-xs text-slate-600">{props.limite ? `${props.limite} dias/sem` : 'sem trava'}</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      <select
        value={props.limite ?? ''}
        disabled={salvando}
        onChange={async (ev) => {
          const v = ev.target.value ? Number(ev.target.value) : null;
          setSalvando(true);
          setErro(null);
          const e = await enviar({ funcionarioIds: [props.id], limite: v });
          setSalvando(false);
          if (e) setErro(e);
          else router.refresh();
        }}
        className={`rounded border px-1 py-0.5 text-xs ${props.limite ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200'}`}
      >
        <option value="">sem trava</option>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <option key={n} value={n}>
            {n} {n === 1 ? 'dia' : 'dias'}/sem
          </option>
        ))}
      </select>
      {props.limite != null && (
        <span className="text-[11px] text-slate-500">
          esta semana: {props.diasSemanaAtual}/{props.limite}
          {travado && <span className="ml-1 font-medium text-rose-600">· bloqueado</span>}
          {props.liberadoHoje && <span className="ml-1 font-medium text-emerald-700">· liberado hoje</span>}
        </span>
      )}
      {props.limite != null && (travado || props.liberadoHoje) && (
        <button
          type="button"
          disabled={salvando}
          onClick={async () => {
            setSalvando(true);
            setErro(null);
            const e = await enviar({ funcionarioId: props.id, liberarHoje: !props.liberadoHoje });
            setSalvando(false);
            if (e) setErro(e);
            else router.refresh();
          }}
          className="self-start rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
        >
          {props.liberadoHoje ? 'desfazer liberação' : 'liberar hoje'}
        </button>
      )}
      {erro && <span className="text-[11px] text-rose-600">{erro}</span>}
    </div>
  );
}

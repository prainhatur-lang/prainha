'use client';

import { useState } from 'react';

interface Props {
  filialId: string;
  versaoAtual: string;
}

type Tipo = 'instalar_cdc' | 'desinstalar_cdc' | 'status_cdc' | 'auto_update';

const LABEL: Record<Tipo, string> = {
  instalar_cdc: '⚡ Instalar CDC',
  desinstalar_cdc: '🛑 Desinstalar CDC',
  status_cdc: '📊 Status',
  auto_update: `🔄 Atualizar pra v${''}`,
};

export function BotoesCdc({ filialId, versaoAtual }: Props) {
  const [running, setRunning] = useState<Tipo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function executar(tipo: Tipo, payload: Record<string, unknown> = {}) {
    if (running) return;
    if (tipo === 'desinstalar_cdc') {
      if (!confirm('Desinstalar CDC remove a fila e todos os triggers do Firebird. Confirma?')) return;
    }
    if (tipo === 'instalar_cdc') {
      const dias = window.prompt(
        'Backfill: quantos dias de historico marcar como pendente?\n' +
        '0 = sem backfill (so eventos novos)\n' +
        '365 = ultimo ano (recomendado)',
        '365',
      );
      if (dias === null) return;
      payload = { dias: Number(dias) || 0 };
    }
    if (tipo === 'auto_update') {
      payload = { versao: versaoAtual };
    }

    setRunning(tipo);
    setMsg(null);
    setErr(null);
    try {
      const r = await fetch('/api/admin/agente/comando', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, tipo, payload }),
      });
      const data = await r.json();
      if (!r.ok) {
        setErr(data.error || `HTTP ${r.status}`);
      } else {
        setMsg(data.msg ?? 'comando criado');
        // resetar msg apos 5s
        setTimeout(() => setMsg(null), 5000);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <Btn
          onClick={() => executar('instalar_cdc')}
          disabled={!!running}
          loading={running === 'instalar_cdc'}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          {LABEL.instalar_cdc}
        </Btn>
        <Btn
          onClick={() => executar('status_cdc')}
          disabled={!!running}
          loading={running === 'status_cdc'}
          className="bg-slate-600 hover:bg-slate-700"
        >
          {LABEL.status_cdc}
        </Btn>
        <Btn
          onClick={() => executar('auto_update')}
          disabled={!!running}
          loading={running === 'auto_update'}
          className="bg-blue-600 hover:bg-blue-700"
        >
          🔄 Atualizar pra v{versaoAtual}
        </Btn>
        <Btn
          onClick={() => executar('desinstalar_cdc')}
          disabled={!!running}
          loading={running === 'desinstalar_cdc'}
          className="bg-red-600 hover:bg-red-700"
        >
          {LABEL.desinstalar_cdc}
        </Btn>
      </div>
      {msg && (
        <div className="rounded bg-green-50 px-2 py-1 text-xs text-green-800">
          ✓ {msg}
        </div>
      )}
      {err && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">
          ✗ {err}
        </div>
      )}
    </div>
  );
}

function Btn(props: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={
        `rounded px-2 py-1 text-xs font-semibold text-white transition ` +
        (props.disabled ? 'cursor-not-allowed opacity-50 ' : '') +
        props.className
      }
    >
      {props.loading ? '...' : props.children}
    </button>
  );
}

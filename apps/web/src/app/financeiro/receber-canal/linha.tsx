'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LinhaReceberCanal({
  id,
  status,
  valorBruto,
}: {
  id: string;
  status: string;
  valorBruto: number;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState<'receber' | 'cancelar' | null>(null);
  const [valor, setValor] = useState(valorBruto.toFixed(2).replace('.', ','));
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (status !== 'aberto') {
    return <span className="text-xs text-slate-400">—</span>;
  }

  async function enviar(acao: 'receber' | 'cancelar') {
    setErro(null);
    setEnviando(true);
    try {
      const body =
        acao === 'receber'
          ? { acao, valorRecebido: Number(valor.replace(/\./g, '').replace(',', '.')) }
          : { acao, observacao: motivo };
      if (acao === 'cancelar' && motivo.trim().length < 2) {
        setErro('diga o motivo');
        setEnviando(false);
        return;
      }
      const r = await fetch(`/api/financeiro/receber-canal/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) {
        setErro(j.error || 'não deu');
        setEnviando(false);
        return;
      }
      setAberto(null);
      router.refresh();
    } catch {
      setErro('falha de rede');
      setEnviando(false);
    }
  }

  if (aberto === 'receber') {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <label className="text-[11px] text-slate-500">
          Valor líquido que caiu (o repasse, não o bruto do pedido)
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="mt-0.5 block w-32 rounded border border-slate-300 px-1.5 py-1 text-sm"
          />
        </label>
        {erro && <span className="text-xs text-rose-600">{erro}</span>}
        <div className="flex gap-1.5">
          <button
            disabled={enviando}
            onClick={() => enviar('receber')}
            className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Confirmar
          </button>
          <button onClick={() => setAberto(null)} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-200">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (aberto === 'cancelar') {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <label className="text-[11px] text-slate-500">
          Por quê? (pago na entrega, duplicado…)
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="mt-0.5 block w-48 rounded border border-slate-300 px-1.5 py-1 text-sm"
          />
        </label>
        {erro && <span className="text-xs text-rose-600">{erro}</span>}
        <div className="flex gap-1.5">
          <button
            disabled={enviando}
            onClick={() => enviar('cancelar')}
            className="rounded bg-rose-600 px-2 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            Confirmar
          </button>
          <button onClick={() => setAberto(null)} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-200">
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <button onClick={() => setAberto('receber')} className="text-xs font-medium text-emerald-700 hover:underline">
        ✓ Recebido
      </button>
      <button onClick={() => setAberto('cancelar')} className="text-xs font-medium text-slate-400 hover:underline">
        cancelar
      </button>
    </div>
  );
}

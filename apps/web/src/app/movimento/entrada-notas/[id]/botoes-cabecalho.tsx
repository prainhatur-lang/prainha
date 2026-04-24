'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function BotoesCabecalho({
  notaId,
  totalItens,
  mapeados,
  lancados,
  canLancar,
}: {
  notaId: string;
  totalItens: number;
  mapeados: number;
  lancados: number;
  canLancar: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState<'match' | 'lancar' | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function matchAuto() {
    setLoading('match');
    setMsg(null);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}/match-auto`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
      } else {
        setMsg({
          tipo: 'ok',
          texto: `✓ ${d.matched} novo(s) vinculado(s). Total mapeado: ${d.mapeadosTotal}/${d.total}.`,
        });
        start(() => router.refresh());
      }
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setLoading(null);
    }
  }

  async function lancar() {
    const pendentes = mapeados - lancados;
    if (pendentes <= 0) return;
    const mensagem =
      pendentes < mapeados
        ? `Lançar ${pendentes} item(ns) adicional(is) no estoque? Os ${lancados} já lançados serão pulados.`
        : `Lançar ${mapeados} item(ns) como entrada no estoque? Isso atualiza saldo e último custo.`;
    if (!confirm(mensagem)) return;

    setLoading('lancar');
    setMsg(null);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}/lancar-estoque`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
      } else {
        setMsg({
          tipo: 'ok',
          texto: `✓ ${d.lancados} item(ns) lançado(s) no estoque. ${d.pulados} pulado(s).`,
        });
        start(() => router.refresh());
      }
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={matchAuto}
          disabled={loading !== null || pending || totalItens === mapeados}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="Tenta vincular automaticamente via EAN e código do fornecedor"
        >
          {loading === 'match' ? 'Vinculando...' : '⚡ Match automático'}
        </button>
        <button
          type="button"
          onClick={lancar}
          disabled={!canLancar || loading !== null || pending}
          className="rounded-lg border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading === 'lancar' ? 'Lançando...' : '✓ Lançar no estoque'}
        </button>
      </div>
      {msg && (
        <div
          className={`rounded px-2 py-1 text-[11px] ${
            msg.tipo === 'ok'
              ? 'bg-emerald-50 text-emerald-800'
              : 'bg-rose-50 text-rose-800'
          }`}
        >
          {msg.texto}
        </div>
      )}
    </div>
  );
}

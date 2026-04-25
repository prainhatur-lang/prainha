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
  const [loading, setLoading] = useState<'match' | 'lancar' | 'excluir' | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function excluir() {
    const aviso = lancados > 0
      ? `Excluir esta nota?\n\nVai REVERTER ${lancados} lancamento(s) no estoque (subtrai a quantidade do saldo) e apagar a nota.\n\nApos excluir, voce pode re-importar o XML pra refazer.`
      : `Excluir esta nota?\n\nA nota ainda nao foi lancada — so o registro vai sumir. Apos excluir, voce pode re-importar o XML.`;
    if (!confirm(aviso)) return;

    setLoading('excluir');
    setMsg(null);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Erro especifico de estoque negativo: mostra os produtos
        if (r.status === 409 && Array.isArray(d.conflitos)) {
          const lista = d.conflitos
            .map((c: { nome: string; atual: number; aReverter: number }) =>
              `• ${c.nome}: estoque ${c.atual} < ${c.aReverter} a reverter`)
            .join('\n');
          setMsg({
            tipo: 'erro',
            texto: `Nao da pra reverter (estoque ja foi consumido):\n${lista}\n\nFaca um ajuste manual no estoque antes.`,
          });
        } else {
          setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        }
        return;
      }
      // Sucesso → volta pra listagem
      router.push('/movimento/entrada-notas');
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setLoading(null);
    }
  }

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
          onClick={excluir}
          disabled={loading !== null || pending}
          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          title={
            lancados > 0
              ? 'Reverte os lançamentos no estoque e apaga a nota — você pode re-importar o XML pra refazer'
              : 'Apaga a nota — você pode re-importar o XML pra refazer'
          }
        >
          {loading === 'excluir' ? 'Excluindo...' : '🗑 Excluir nota'}
        </button>
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
          className={`max-w-md whitespace-pre-line rounded px-2 py-1 text-[11px] ${
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

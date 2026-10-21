'use client';

// Aviso "esta compra está duas vezes" na tela da nota: Pedido sem nota (foto do
// DANFE) e NF-e da SEFAZ do mesmo número/fornecedor/valor. O botão junta as
// duas na NF-e (POST /api/nota-compra/[id]/juntar) e abre a NF-e.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

export function JuntarGemea(props: {
  notaId: string;
  euSouFoto: boolean;
  outra: { id: string; numero: string | null; serie: string | null; valorTotal: string | null; dataEmissao: string | null };
  nfeId: string;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function juntar() {
    if (
      !confirm(
        'Juntar as duas na NF-e da SEFAZ?\n\nO estoque, as contas (pagas continuam pagas) e a conferência do Pedido sem nota passam pra NF-e. O Pedido sem nota sai da lista (fica no registro de exclusões).',
      )
    )
      return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/nota-compra/${props.notaId}/juntar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ com: props.outra.id }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) {
        setErro(d.error ?? `erro ${r.status}`);
        return;
      }
      if (props.euSouFoto) router.replace(`/movimento/entrada-notas/${props.nfeId}`);
      else router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'sem rede');
    } finally {
      setEnviando(false);
    }
  }

  const data = props.outra.dataEmissao ? props.outra.dataEmissao.slice(0, 10).split('-').reverse().join('/') : null;
  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">⚠ Esta compra está duas vezes na lista</p>
      <p className="mt-1 text-xs">
        {props.euSouFoto ? 'Este Pedido sem nota é a mesma compra da ' : 'Esta NF-e da SEFAZ é a mesma compra do '}
        <Link href={`/movimento/entrada-notas/${props.outra.id}`} className="font-semibold underline">
          {props.euSouFoto ? 'NF-e da SEFAZ' : 'Pedido sem nota (foto)'} nº {props.outra.numero ?? '?'}
          {props.outra.serie ? `/${props.outra.serie}` : ''}
        </Link>
        {props.outra.valorTotal ? ` · ${brl(Number(props.outra.valorTotal))}` : ''}
        {data ? ` · ${data}` : ''}. Juntando, fica só a NF-e, com o estoque e as contas que já foram lançados.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={juntar}
          disabled={enviando}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {enviando ? 'Juntando…' : '🔗 Juntar na NF-e'}
        </button>
        {erro && <span className="text-xs text-red-700">{erro}</span>}
      </div>
    </div>
  );
}

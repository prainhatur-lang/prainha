'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Resp {
  ok?: boolean;
  error?: string;
  tentadas?: number;
  completas?: number;
  semXml?: { chave: string; motivo: string }[];
  bloqueio?: string | null;
}

/** Busca o XML completo pela chave (consChNFe) de nota que já tem ciência ou
 *  confirmação. Sem chave, a rota pega até 15 das que esperam há mais tempo. */
export function BuscarXmlBtn({ filialId, chave }: { filialId: string; chave?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const lote = !chave;

  async function buscar() {
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/notas/buscar-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, chaves: chave ? [chave] : undefined }),
      });
      const d = (await r.json().catch(() => ({}))) as Resp;
      if (!r.ok || !d.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      if (d.completas) {
        let texto = `✓ ${d.completas} XML baixado(s)`;
        if (lote && d.tentadas) texto += ` de ${d.tentadas} tentada(s)`;
        if (d.bloqueio) texto += `. ${d.bloqueio}`;
        setMsg({ tipo: 'ok', texto });
        start(() => router.refresh());
        return;
      }
      setMsg({
        tipo: 'erro',
        texto:
          d.bloqueio ??
          d.semXml?.[0]?.motivo ??
          (d.tentadas ? 'SEFAZ não devolveu o XML' : 'nenhuma nota esperando XML'),
      });
      if (d.tentadas) start(() => router.refresh());
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className={`inline-flex ${lote ? 'items-center gap-3' : 'flex-col items-start gap-0.5'}`}>
      <button
        type="button"
        onClick={buscar}
        disabled={loading || pending}
        className={
          lote
            ? 'rounded-md bg-sky-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50'
            : 'rounded border border-sky-300 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 hover:bg-sky-50 disabled:opacity-50'
        }
        title="Pede o XML completo à SEFAZ pela chave (a SEFAZ aceita ~20 consultas por hora)"
      >
        {loading ? '...' : lote ? 'Buscar XML (até 15)' : 'Buscar XML'}
      </button>
      {msg && (
        <span
          className={`max-w-[260px] whitespace-normal break-words leading-tight ${
            lote ? 'text-[11px]' : 'text-[10px]'
          } ${msg.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}
        >
          {msg.texto}
        </span>
      )}
    </span>
  );
}

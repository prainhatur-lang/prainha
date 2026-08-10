'use client';

// Ações por nota no painel: baixar XML, cancelar (justificativa), inutilizar.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AcoesNota({
  id,
  status,
  temXml,
  chave,
}: {
  id: string;
  status: string;
  temXml: boolean;
  chave: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  async function cancelar() {
    const justificativa = window.prompt(
      'Justificativa do cancelamento (mín. 15 caracteres):',
      'Erro na emissao da nota fiscal',
    );
    if (!justificativa) return;
    setOcupado(true);
    try {
      const r = await fetch('/api/nfce/cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, justificativa }),
      });
      const j = await r.json();
      if (!j.ok) window.alert(j.erro ?? 'falhou');
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  async function inutilizar() {
    if (!window.confirm('Inutilizar este número na SEFAZ? (número que nunca virou nota)')) return;
    setOcupado(true);
    try {
      const r = await fetch('/api/nfce/inutilizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, justificativa: 'Numero nao utilizado - falha na emissao' }),
      });
      const j = await r.json();
      if (!j.ok) window.alert(j.erro ?? 'falhou');
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {status === 'AUTORIZADA' && (
        <a
          href={`/fiscal/nfce/${id}/danfe`}
          className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
        >
          🖨 DANFE
        </a>
      )}
      {temXml && (
        <a
          href={`/api/nfce/${id}/xml`}
          className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
          title={chave}
        >
          XML
        </a>
      )}
      {status === 'AUTORIZADA' && (
        <button
          onClick={cancelar}
          disabled={ocupado}
          className="rounded border border-rose-300 px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          Cancelar
        </button>
      )}
      {(status === 'REJEITADA' || status === 'ERRO') && (
        <button
          onClick={inutilizar}
          disabled={ocupado}
          className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Inutilizar nº
        </button>
      )}
    </div>
  );
}

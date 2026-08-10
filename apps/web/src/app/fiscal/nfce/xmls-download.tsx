'use client';

// Baixar o ZIP de XMLs do mês de uma filial (visão do contador).

import { useState } from 'react';

function mesAtualBr(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Maceio',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7);
}

export function XmlsDownload({ filialId, nome }: { filialId: string; nome: string }) {
  const [mes, setMes] = useState(mesAtualBr());
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="w-32 font-medium text-slate-700">{nome}</span>
      <input
        type="month"
        value={mes}
        onChange={(e) => setMes(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1"
      />
      <a
        href={`/api/nfce/xmls?filial=${filialId}&mes=${mes}`}
        className="rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-100"
      >
        ⬇ Baixar XMLs
      </a>
    </div>
  );
}

'use client';

// Filtro de CPF/CNPJ da lista de notas. Roda aqui no navegador, em cima das
// linhas já carregadas (cada <tr> traz data-doc) — o documento do cliente não
// vai pra URL. Os outros filtros (data, filial, número…) vão pelo servidor.

import { useEffect, useState } from 'react';

export function FiltroDocumento() {
  const [doc, setDoc] = useState('');

  useEffect(() => {
    const d = doc.replace(/\D/g, '');
    document.querySelectorAll<HTMLElement>('tr[data-doc]').forEach((tr) => {
      tr.style.display = !d || (tr.dataset.doc ?? '').includes(d) ? '' : 'none';
    });
  }, [doc]);

  return (
    <label className="text-[11px] font-medium text-slate-600">
      CPF/CNPJ
      <input
        value={doc}
        onChange={(e) => setDoc(e.target.value)}
        inputMode="numeric"
        autoComplete="off"
        placeholder="inteiro ou um pedaço"
        className="mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
      />
    </label>
  );
}

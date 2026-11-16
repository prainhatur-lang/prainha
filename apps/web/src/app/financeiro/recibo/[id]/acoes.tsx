'use client';

// Saídas do recibo: imprimir (ou salvar PDF) e enviar pelo celular — WhatsApp
// de quem recebeu (wa.me, 1 toque) ou o compartilhar do próprio aparelho.

import { useState } from 'react';

export function AcoesRecibo({
  link,
  telefone,
  texto,
}: {
  /** Caminho público assinado (/recibo/<token>) ou null se não deu pra assinar. */
  link: string | null;
  telefone: string | null;
  texto: string;
}) {
  const [fone, setFone] = useState(telefone ?? '');
  const [copiado, setCopiado] = useState(false);
  const [aviso, setAviso] = useState('');

  const url = link && typeof window !== 'undefined' ? `${window.location.origin}${link}` : '';
  const mensagem = `${texto}\n${url}`;

  function whatsapp() {
    let d = fone.replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) d = `55${d}`;
    if (d && d.length < 12) return setAviso('Confira o número do WhatsApp (com DDD).');
    setAviso('');
    // Sem número: abre o WhatsApp pra escolher o contato.
    window.open(`https://wa.me/${d}?text=${encodeURIComponent(mensagem)}`, '_blank', 'noopener');
  }

  async function compartilhar() {
    try {
      if (navigator.share) await navigator.share({ title: 'Recibo', text: texto, url });
      else await copiar();
    } catch {
      // fechou a janela de compartilhar
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setAviso(url);
    }
  }

  const btn = 'rounded-md px-4 py-2 text-sm font-semibold';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 print:hidden">
      <div className="flex flex-wrap items-end gap-3">
        <button onClick={() => window.print()} className={`${btn} bg-slate-900 text-white hover:bg-slate-700`}>
          🖨 Imprimir / salvar PDF
        </button>
        {link && (
          <>
            <label className="block">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                WhatsApp de quem recebeu
              </span>
              <input
                className="mt-1 w-44 rounded-md border border-slate-300 px-3 py-2 text-sm"
                inputMode="tel"
                value={fone}
                onChange={(e) => setFone(e.target.value)}
                placeholder="79 9 9999-9999"
              />
            </label>
            <button onClick={whatsapp} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
              📱 Enviar pelo WhatsApp
            </button>
            <button onClick={() => void compartilhar()} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
              Compartilhar
            </button>
            <button onClick={() => void copiar()} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
              {copiado ? '✓ Link copiado' : 'Copiar link'}
            </button>
          </>
        )}
      </div>
      {!link && (
        <p className="mt-2 text-xs text-amber-700">Não consegui gerar o link pra enviar — use a impressão.</p>
      )}
      {aviso && <p className="mt-2 break-all text-xs text-amber-700">{aviso}</p>}
    </div>
  );
}

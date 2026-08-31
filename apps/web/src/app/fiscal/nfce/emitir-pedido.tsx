'use client';

// Botão de emitir a nota de um pedido que ainda não tem — na lista de
// "pedidos sem nota". Monta do espelho Postgres (lib/nfce/montar-do-espelho),
// então funciona sem a loja de pé.
//
// Emitir NFC-e é IRREVERSÍVEL (cancelar só até 30min na SEFAZ-SE), por isso
// confirma antes e mostra o que vai sair na nota.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function EmitirPedido({
  filialId,
  codigoExterno,
  rotulo,
  valor,
}: {
  filialId: string;
  codigoExterno: number;
  rotulo: string;
  valor: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [feito, setFeito] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function emitir() {
    const doc = window.prompt(
      `Emitir NFC-e — ${rotulo} · ${valor}\n\n` +
        'ATENÇÃO: a nota é enviada à SEFAZ e só pode ser cancelada em até 30 MINUTOS.\n\n' +
        'CPF/CNPJ do consumidor (deixe em branco pra nota sem identificação):',
      '',
    );
    if (doc === null) return; // cancelou o prompt

    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch('/api/nfce/emitir-pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          codigoExterno,
          documento: doc.trim() || null,
        }),
      });
      const j = await r.json();
      if (!j.ok) {
        setErro(j.erro ?? 'falhou');
        return;
      }
      setFeito(j.nota?.numero ? `nota ${j.nota.numero}` : 'autorizada');
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (feito) {
    return <span className="text-[11px] font-medium text-emerald-700">✓ {feito}</span>;
  }

  return (
    <span className="flex items-center gap-1.5">
      {erro && (
        <span className="max-w-[220px] truncate text-[11px] text-rose-700" title={erro}>
          {erro}
        </span>
      )}
      <button
        onClick={emitir}
        disabled={ocupado}
        className="shrink-0 rounded border border-sky-300 px-2 py-0.5 text-[11px] font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
      >
        {ocupado ? 'emitindo…' : '🧾 Emitir'}
      </button>
    </span>
  );
}

'use client';

// Caixa (escondida na impressão) com o link público de aceite do orçamento:
// copiar, mandar no WhatsApp e ver o estado do aceite/entrada.

import { useState } from 'react';
import { brl, formatDateTime } from '@/lib/format';

interface Props {
  url: string;
  clienteTelefone: string | null;
  filialNome: string;
  numero: string;
  entradaValor: number | null;
  aceiteNome: string | null;
  aceiteEm: string | null;
  pagamentoStatus: string | null;
  pagoEm: string | null;
}

export function LinkAceiteBox({
  url,
  clienteTelefone,
  filialNome,
  numero,
  entradaValor,
  aceiteNome,
  aceiteEm,
  pagamentoStatus,
  pagoEm,
}: Props) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      prompt('Copia o link:', url);
    }
  }

  const texto = encodeURIComponent(
    `Segue o orçamento Nº ${numero} do ${filialNome} 🌊\n\nPra ver, aceitar${
      entradaValor != null ? ` e garantir a data pagando a entrada de ${brl(entradaValor)} via Pix` : ''
    }, é só acessar:\n${url}`,
  );
  const fone = (clienteTelefone ?? '').replace(/\D/g, '');
  const waHref = fone
    ? `https://wa.me/${fone.startsWith('55') ? fone : '55' + fone}?text=${texto}`
    : `https://wa.me/?text=${texto}`;

  return (
    <div className="mx-auto mt-6 max-w-4xl rounded-lg border border-slate-200 bg-white p-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Link de aceite + entrada</p>
          {pagamentoStatus === 'pago' ? (
            <p className="mt-0.5 text-sm text-emerald-700">
              ✅ Entrada paga{pagoEm ? ` em ${formatDateTime(pagoEm)}` : ''}
              {aceiteNome ? ` · aceito por ${aceiteNome}` : ''}
            </p>
          ) : aceiteEm ? (
            <p className="mt-0.5 text-sm text-blue-700">
              ✍️ Aceito por {aceiteNome ?? 'cliente'} em {formatDateTime(aceiteEm)}
              {entradaValor != null && ' · entrada ainda não paga'}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-slate-500">
              Cliente ainda não aceitou pelo link
              {entradaValor != null && ` · entrada de ${brl(entradaValor)} no aceite`}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copiar}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            {copiado ? '✓ Copiado' : '🔗 Copiar link'}
          </button>
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Mandar no WhatsApp
          </a>
        </div>
      </div>
      <p className="mt-2 break-all font-mono text-xs text-slate-400">{url}</p>
    </div>
  );
}

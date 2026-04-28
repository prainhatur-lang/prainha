'use client';

// Linha individual da tabela de pagamentos. Server-side renderiza, mas
// precisa ser client component pra abrir o modal de edicao.

import { useState } from 'react';
import { brl, formatDateTime } from '@/lib/format';
import { EditarPagamentoModal } from './editar-modal';

interface Props {
  p: {
    id: string;
    pedido: number | null;
    pedidoNumero: number | null;
    pedidoMesa: string | null;
    pedidoNotaEmitida: boolean | null;
    nomeCliente: string | null;
    dataPagamento: Date | null;
    valor: number;
    formaPagamento: string | null;
    bandeiraMfe: string | null;
    bandeiraEfetiva: string | null;
    nsuTransacao: string | null;
    numeroAutorizacaoCartao: string | null;
    canalConciliacao: string | null;
    casadoCielo: boolean;
    casadoBanco: boolean;
  };
}

const CANAL_COR: Record<string, string> = {
  ADQUIRENTE: 'bg-sky-100 text-sky-800',
  DIRETO: 'bg-violet-100 text-violet-800',
  CAIXA: 'bg-emerald-100 text-emerald-800',
  INTERNA: 'bg-slate-100 text-slate-700',
};

export function LinhaPagamento({ p }: Props) {
  const [modal, setModal] = useState(false);

  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50">
        <td className="px-3 py-2 font-mono text-xs text-slate-700">
          {formatDateTime(p.dataPagamento)}
        </td>
        <td className="px-3 py-2 text-xs">
          {p.pedido ? (
            <div className="flex flex-col leading-tight">
              <span className="font-mono font-semibold text-slate-900">
                #{p.pedidoNumero ?? p.pedido}
              </span>
              {p.pedidoMesa && (
                <span className="text-[10px] text-slate-500">{p.pedidoMesa}</span>
              )}
              {p.pedidoNotaEmitida && (
                <span className="text-[9px] uppercase text-emerald-600">✓ NF</span>
              )}
            </div>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-slate-700">
          <span className="block max-w-[140px] truncate" title={p.nomeCliente ?? ''}>
            {p.nomeCliente ?? '—'}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-slate-700">
          {p.formaPagamento ?? '—'}
          {p.canalConciliacao && (
            <span
              className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                CANAL_COR[p.canalConciliacao] ?? 'bg-slate-100 text-slate-700'
              }`}
            >
              {p.canalConciliacao}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-slate-700">
          {p.bandeiraEfetiva ? (
            <span title="Bandeira efetiva (corrigida)" className="font-medium text-emerald-700">
              {p.bandeiraEfetiva}
            </span>
          ) : (
            p.bandeiraMfe ?? <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="px-3 py-2 font-mono text-xs text-slate-600">
          {p.nsuTransacao ? (
            <>
              {p.nsuTransacao}
              {p.numeroAutorizacaoCartao && (
                <span className="ml-1 text-slate-400">/ {p.numeroAutorizacaoCartao}</span>
              )}
            </>
          ) : (
            '—'
          )}
        </td>
        <td className="px-3 py-2 text-right font-mono text-sm font-medium text-slate-900">
          {brl(p.valor)}
        </td>
        <td className="px-3 py-2 text-xs">
          <div className="flex flex-col leading-tight">
            {p.casadoCielo && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-800">
                ✓ Cielo
              </span>
            )}
            {p.casadoBanco && (
              <span className="mt-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-800">
                ✓ Banco
              </span>
            )}
            {!p.casadoCielo && !p.casadoBanco && (
              <span className="text-slate-400">aberto</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={() => setModal(true)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
          >
            Editar
          </button>
        </td>
      </tr>

      {modal && (
        <EditarPagamentoModal
          pagamento={{
            id: p.id,
            pedido: p.pedidoNumero ?? p.pedido,
            valor: p.valor,
            formaPagamento: p.formaPagamento,
            bandeiraMfe: p.bandeiraMfe,
            bandeiraEfetiva: p.bandeiraEfetiva,
            nsuTransacao: p.nsuTransacao,
            numeroAutorizacaoCartao: p.numeroAutorizacaoCartao,
          }}
          onClose={() => setModal(false)}
        />
      )}
    </>
  );
}

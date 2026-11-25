'use client';

// Recebimentos do evento (dono 25/11/2026): quanto já entrou (entrada por Pix +
// cartão) e quanto falta. Daqui o gerente gera o link de cartão do SALDO —
// uso único, 3DS obrigatório. Aprovou no cartão, o link pago já conta como
// recebido aqui, sem ninguém dar baixa à mão.

import { useCallback, useEffect, useState } from 'react';
import { brl } from '@/lib/format';
import { LinkPagamentoPainel } from '@/components/link-pagamento-painel';
import type { RecebimentosOrcamento } from '@/lib/orcamentos-server';

function dataHora(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RecebimentosBox({
  orcamentoId,
  inicial,
  descricaoPadrao,
  nomePadrao,
  telefonePadrao,
}: {
  orcamentoId: string;
  inicial: RecebimentosOrcamento;
  descricaoPadrao: string;
  nomePadrao: string;
  telefonePadrao: string;
}) {
  const [rec, setRec] = useState(inicial);

  const recarregar = useCallback(async () => {
    const r = await fetch(`/api/financeiro/link-pagamento?orcamentoId=${orcamentoId}`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.recebimentos) setRec(d.recebimentos);
  }, [orcamentoId]);

  // O cliente paga no celular dele: ao voltar pra esta aba, confere de novo.
  useEffect(() => {
    const f = () => {
      if (document.visibilityState === 'visible') void recarregar();
    };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [recarregar]);

  const quitado = rec.saldo != null && rec.saldo <= 0;
  const valorPadrao =
    rec.saldo != null && rec.saldo > 0
      ? rec.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '';

  return (
    <div className="mx-auto mt-6 max-w-4xl rounded-lg border border-slate-200 bg-white p-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">💳 Recebimentos do evento</h2>
        <button type="button" onClick={() => void recarregar()} className="text-xs text-sky-700 hover:underline">
          Atualizar
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Total</dt>
          <dd className="font-semibold text-slate-900">{rec.total == null ? 'A combinar' : brl(rec.total)}</dd>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Entrada (Pix)</dt>
          <dd className="font-semibold text-slate-900">{brl(rec.entradaPaga)}</dd>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Cartão</dt>
          <dd className="font-semibold text-slate-900">{brl(rec.cartoes.reduce((s, c) => s + c.valor, 0))}</dd>
        </div>
        <div className={`rounded-md px-3 py-2 ${quitado ? 'bg-emerald-50' : 'bg-amber-50'}`}>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Falta receber</dt>
          <dd className={`font-semibold ${quitado ? 'text-emerald-700' : 'text-amber-800'}`}>
            {rec.saldo == null ? '—' : quitado ? '✅ Quitado' : brl(rec.saldo)}
          </dd>
        </div>
      </dl>

      {(rec.entradaPaga > 0 || rec.cartoes.length > 0) && (
        <ul className="mt-3 space-y-1 text-xs text-slate-600">
          {rec.entradaPaga > 0 && (
            <li>
              ✅ Entrada por Pix — {brl(rec.entradaPaga)}
              {rec.entradaPagaEm ? ` em ${dataHora(rec.entradaPagaEm)}` : ''}
            </li>
          )}
          {rec.cartoes.map((c) => (
            <li key={c.numero}>
              ✅ Cartão{c.bandeira ? ` ${c.bandeira}` : ''}
              {c.cartaoFinal ? ` final ${c.cartaoFinal}` : ''} — {brl(c.valor)}
              {c.pagoEm ? ` em ${dataHora(c.pagoEm)}` : ''} (link nº {c.numero})
            </li>
          ))}
        </ul>
      )}

      {!quitado && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-2 text-xs text-slate-500">
            Gere o link do que falta e mande ao cliente. Vale pra um único pagamento, só aprova com a
            confirmação do banco dele, e depois de pago entra aqui sozinho como recebido.
          </p>
          <LinkPagamentoPainel
            orcamentoId={orcamentoId}
            valorPadrao={valorPadrao}
            descricaoPadrao={descricaoPadrao}
            nomePadrao={nomePadrao}
            telefonePadrao={telefonePadrao}
            aoMudar={() => void recarregar()}
          />
        </div>
      )}
      {quitado && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <LinkPagamentoPainel orcamentoId={orcamentoId} aoMudar={() => void recarregar()} />
        </div>
      )}
    </div>
  );
}

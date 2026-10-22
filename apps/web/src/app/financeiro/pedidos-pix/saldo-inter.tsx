'use client';

// Saldo de agora no Inter da casa, na tela de Pedidos a pagar por Pix (pedido
// do dono 22/10/2026: "antes de lançar verificar se existe saldo na conta").
// Só mostra: quem decide se o Pix sai é a rota /pagar, que lê o saldo de novo
// dentro da trava da casa e recusa se faltar.

import { useCallback, useEffect, useState } from 'react';

export interface SaldoPix {
  disponivel: number;
  comprometido: number;
  qtdComprometidos: number;
  livre: number;
  consultadoEm: string;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Evento que a tela dispara depois de um Pix, pra todos os saldos relerem. */
export const EVENTO_SALDO_PIX = 'pix:saldo-atualizar';

export function useSaldoPix(filialId: string | undefined, ativo = true) {
  const [saldo, setSaldo] = useState<SaldoPix | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const ler = useCallback(async () => {
    if (!filialId) return;
    setCarregando(true);
    setErro(null);
    const r = await fetch(`/api/financeiro/pedidos-pix/saldo?filialId=${encodeURIComponent(filialId)}`, {
      cache: 'no-store',
    }).catch(() => null);
    const d = r ? ((await r.json().catch(() => ({}))) as Partial<SaldoPix> & { error?: string }) : {};
    if (r?.ok && typeof d.disponivel === 'number' && typeof d.livre === 'number') {
      setSaldo(d as SaldoPix);
    } else {
      setSaldo(null);
      setErro(d.error ?? 'Sem resposta do sistema.');
    }
    setCarregando(false);
  }, [filialId]);

  useEffect(() => {
    if (!ativo) return;
    void ler();
    const ouvir = () => void ler();
    window.addEventListener(EVENTO_SALDO_PIX, ouvir);
    return () => window.removeEventListener(EVENTO_SALDO_PIX, ouvir);
  }, [ativo, ler]);

  return { saldo, erro, carregando, ler };
}

/** Faixa no topo da tela: saldo disponível, Pix do sistema sem desfecho e o livre. */
export function SaldoInterFaixa({ filialId }: { filialId: string }) {
  const { saldo, erro, carregando, ler } = useSaldoPix(filialId);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-2.5 text-sm">
      <span className="font-medium text-violet-900">🏦 Saldo no Inter desta casa</span>
      {saldo ? (
        <>
          <span>
            Disponível agora: <b className="text-slate-900">{brl(saldo.disponivel)}</b>
          </span>
          {saldo.qtdComprometidos > 0 && (
            <span className="text-amber-800">
              − {brl(saldo.comprometido)} em {saldo.qtdComprometidos} Pix do sistema sem desfecho
            </span>
          )}
          <span>
            Livre pra Pix:{' '}
            <b className={saldo.livre > 0 ? 'text-emerald-700' : 'text-rose-700'}>{brl(saldo.livre)}</b>
          </span>
          <span className="text-[11px] text-slate-500">às {hora(saldo.consultadoEm)}</span>
        </>
      ) : erro ? (
        <span className="text-amber-800">Não deu pra ler o saldo agora: {erro}</span>
      ) : (
        <span className="text-slate-500">conferindo…</span>
      )}
      <button
        type="button"
        disabled={carregando}
        onClick={() => void ler()}
        className="ml-auto rounded-md border border-violet-300 bg-white px-2 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-50 disabled:opacity-50"
      >
        {carregando ? 'lendo…' : '↻ atualizar'}
      </button>
    </div>
  );
}

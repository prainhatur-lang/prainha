'use client';

// Modal pra editar campos seguros de um pagamento (bandeira, NSU,
// autorizacao). NAO permite trocar formaPagamento nem valor — esses
// afetam o canal de conciliacao e podem mascarar diferencas reais.

import { useEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

interface Props {
  pagamento: {
    id: string;
    pedido: number | null;
    valor: number;
    formaPagamento: string | null;
    bandeiraMfe: string | null;
    bandeiraEfetiva: string | null;
    nsuTransacao: string | null;
    numeroAutorizacaoCartao: string | null;
  };
  onClose: () => void;
}

const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'Amex', 'Hipercard', 'Diners', 'Pix'];

export function EditarPagamentoModal({ pagamento, onClose }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [bandeiraMfe, setBandeiraMfe] = useState(pagamento.bandeiraMfe ?? '');
  const [bandeiraEfetiva, setBandeiraEfetiva] = useState(pagamento.bandeiraEfetiva ?? '');
  const [nsu, setNsu] = useState(pagamento.nsuTransacao ?? '');
  const [auth, setAuth] = useState(pagamento.numeroAutorizacaoCartao ?? '');

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose, submitting]);

  async function salvar() {
    setErro(null);
    setAviso(null);
    setSubmitting(true);
    try {
      const r = await fetch(`/api/pagamentos/${pagamento.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bandeiraMfe: bandeiraMfe || null,
          bandeiraEfetiva: bandeiraEfetiva || null,
          nsuTransacao: nsu || null,
          numeroAutorizacaoCartao: auth || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErro(j.error || `HTTP ${r.status}`);
        return;
      }
      if (!j.alterado) {
        setAviso('Nada foi alterado.');
        return;
      }
      onClose();
      start(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  if (typeof window === 'undefined') return null;

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Editar pagamento</h3>
          <p className="mt-1 text-xs text-slate-600">
            Pedido <strong>#{pagamento.pedido ?? '—'}</strong> · {pagamento.formaPagamento ?? '—'}{' '}
            · <strong>{brl(pagamento.valor)}</strong>
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            Forma e valor não são editáveis (afetam canal de conciliação).
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Bandeira (mFE)
            </label>
            <input
              type="text"
              list="bandeiras-list"
              value={bandeiraMfe}
              onChange={(e) => setBandeiraMfe(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              placeholder="Ex: Visa"
            />
            <datalist id="bandeiras-list">
              {BANDEIRAS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            <p className="mt-0.5 text-[10px] text-slate-500">
              Bandeira que veio do TEF/maquininha.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Bandeira efetiva
            </label>
            <input
              type="text"
              list="bandeiras-list"
              value={bandeiraEfetiva}
              onChange={(e) => setBandeiraEfetiva(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              placeholder="Ex: Visa (corrigida)"
            />
            <p className="mt-0.5 text-[10px] text-slate-500">
              Bandeira corrigida (quando difere da mFE — ex: erro do garçom).
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">NSU</label>
            <input
              type="text"
              value={nsu}
              onChange={(e) => setNsu(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-mono"
              placeholder="Ex: 357435"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Autorização
            </label>
            <input
              type="text"
              value={auth}
              onChange={(e) => setAuth(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-mono"
              placeholder="Ex: 713069"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          {erro && <span className="mr-auto text-xs text-rose-600">{erro}</span>}
          {aviso && <span className="mr-auto text-xs text-slate-600">{aviso}</span>}
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={submitting || pending}
            className="rounded-md border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

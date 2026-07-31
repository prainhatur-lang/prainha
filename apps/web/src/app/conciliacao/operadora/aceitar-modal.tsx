'use client';

// Modal pra escolher motivo + observação opcional ao aceitar uma exceção.
// Usado tanto na linha individual (ExcecaoRow) quanto no dropdown
// "Aceitar todos" pra batch aceitar com motivo categorizado.

import { useEffect, useRef, useState } from 'react';
import { MOTIVOS, MOTIVO_LABEL, MOTIVO_DESCRICAO, type Motivo } from './motivos';

interface Props {
  // Texto do header — varia: linha individual diz "Aceitar exceção";
  // batch diz "Aceitar 12 divergências de alta confiabilidade".
  titulo: string;
  // Subtítulo/contexto — pode ser null pra esconder.
  subtitulo?: string | null;
  // Quando confirma, recebe motivo + observacao.
  onConfirm: (motivo: Motivo | null, observacao: string) => void | Promise<void>;
  onCancel: () => void;
  // Quando true, desabilita o botão Confirmar (loading).
  loading?: boolean;
}

export function AceitarModal({ titulo, subtitulo, onConfirm, onCancel, loading }: Props) {
  const [motivo, setMotivo] = useState<Motivo | ''>('');
  const [observacao, setObservacao] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Fecha com ESC
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading) onCancel();
    }
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onCancel, loading]);

  // Fecha clicando no backdrop
  function onBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget && !loading) onCancel();
  }

  function handleConfirm() {
    onConfirm(motivo === '' ? null : (motivo as Motivo), observacao.trim());
  }

  return (
    <div
      onMouseDown={onBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
    >
      <div
        ref={ref}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{titulo}</h3>
          {subtitulo && <p className="mt-0.5 text-xs text-slate-500">{subtitulo}</p>}
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">
              Motivo (opcional)
            </label>
            <select
              value={motivo}
              onChange={(e) => setMotivo(e.target.value as Motivo | '')}
              disabled={loading}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">— sem categorizar —</option>
              {MOTIVOS.map((m) => (
                <option key={m} value={m}>
                  {MOTIVO_LABEL[m]}
                </option>
              ))}
            </select>
            {motivo && (
              <p className="mt-1.5 text-[11px] leading-tight text-slate-500">
                {MOTIVO_DESCRICAO[motivo as Motivo]}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">
              Observação (opcional)
            </label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              disabled={loading}
              maxLength={500}
              rows={3}
              placeholder="Detalhes específicos do caso (cliente, número da nota, etc)..."
              className="w-full resize-none rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none disabled:opacity-50"
            />
            <p className="mt-1 text-right text-[10px] text-slate-400">
              {observacao.length}/500
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="rounded-md border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? 'Aceitando...' : '✓ Confirmar aceite'}
          </button>
        </div>
      </div>
    </div>
  );
}

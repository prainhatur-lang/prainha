'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CANAIS_LIQUIDACAO, CANAL_LABEL, CANAL_DESC } from '@/lib/canal-liquidacao';

interface Props {
  id: string;
  formaPagamento: string;
  canal: string;
  observacao: string | null;
  confirmada: boolean;
}

export function CanalEditor({ id, formaPagamento, canal, observacao, confirmada }: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [canalSel, setCanalSel] = useState(canal);
  const [obs, setObs] = useState(observacao ?? '');
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function fechar() {
    setAberto(false);
    setCanalSel(canal);
    setObs(observacao ?? '');
    setErro(null);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const body: Record<string, unknown> = {};
    if (canalSel !== canal) body.canal = canalSel;
    if ((obs.trim() || null) !== (observacao ?? null)) body.observacao = obs.trim() || null;
    if (Object.keys(body).length === 0) {
      // Sem mudança real, mas user clicou Salvar. Confirma assim mesmo.
      body.canal = canalSel;
    }
    const r = await fetch(`/api/formas-pagamento/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(d.error ?? `HTTP ${r.status}`);
      return;
    }
    setAberto(false);
    start(() => router.refresh());
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={`rounded border px-2 py-0.5 text-[10px] ${
          confirmada
            ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
        }`}
      >
        {confirmada ? 'Editar' : 'Confirmar'}
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={fechar}
        >
          <form
            onSubmit={salvar}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Classificar forma de pagamento
              </h2>
              <p className="mt-1 font-mono text-xs text-slate-700">{formaPagamento}</p>
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Canal de liquidação *
              </label>
              {CANAIS_LIQUIDACAO.map((c) => (
                <label
                  key={c}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs hover:bg-slate-50 ${
                    canalSel === c ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="canal"
                    checked={canalSel === c}
                    onChange={() => setCanalSel(c)}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="font-medium text-slate-900">{CANAL_LABEL[c]}</span>
                    <p className="mt-0.5 text-[10px] text-slate-500">{CANAL_DESC[c]}</p>
                  </div>
                </label>
              ))}
            </div>

            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Observação
              </label>
              <input
                type="text"
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="Ex: cartão da maquininha do delivery"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>

            {erro && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {erro}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={fechar}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {pending ? 'Salvando...' : confirmada ? 'Salvar' : 'Confirmar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

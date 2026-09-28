'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** "Unidade: un [converter p/ ml]" — garrafa entra na compra, estoque e ficha
 *  andam em ml. Converte saldo, custo, histórico e fichas de uma vez. */
export function ConverterUnidadeButton({
  produtoId,
  unidadeAtual,
  volumeMl,
  saldo,
  custo,
}: {
  produtoId: string;
  unidadeAtual: string;
  volumeMl: number | null;
  saldo: number;
  custo: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [fator, setFator] = useState(volumeMl ? String(volumeMl) : '');
  const [embalagem, setEmbalagem] = useState('garrafa');
  const [erro, setErro] = useState<string | null>(null);

  if (unidadeAtual !== 'un') return null;

  const f = Number(fator.replace(',', '.'));
  const ok = Number.isFinite(f) && f > 0;
  const fmt = (n: number, d = 2) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });

  async function converter() {
    setErro(null);
    const r = await fetch(`/api/produtos/${produtoId}/converter-unidade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ para: 'ml', fator: f, embalagem: embalagem.trim() || 'garrafa' }),
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
        className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
        title="Estoque e ficha em ml; compra continua em garrafa"
      >
        ⇄ converter p/ ml
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setAberto(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <h3 className="text-sm font-semibold text-slate-900">Controlar em ml</h3>
            <p className="text-xs text-slate-600">
              A compra continua entrando por {embalagem || 'garrafa'} e cada uma gera os ml abaixo.
              A ficha passa a pedir a dose em ml.
            </p>
            <div className="flex gap-3">
              <label className="flex-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Embalagem
                <input
                  value={embalagem}
                  onChange={(e) => setEmbalagem(e.target.value)}
                  placeholder="garrafa, galão, peça"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm normal-case"
                />
              </label>
              <label className="flex-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                ml por {embalagem || 'garrafa'}
                <input
                  value={fator}
                  onChange={(e) => setFator(e.target.value)}
                  inputMode="decimal"
                  placeholder="1000"
                  autoFocus
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </label>
            </div>
            {ok && (
              <div className="rounded bg-slate-50 p-2 text-[11px] text-slate-700">
                Saldo: {fmt(saldo, 3)} un → <strong>{fmt(saldo * f, 0)} ml</strong>
                <br />
                Custo: R$ {fmt(custo)} por un → <strong>R$ {fmt(custo / f, 4)} por ml</strong>
                <br />
                Fichas: dose do Consumer é em litro (0,06 → 60 ml); 1 ou {fmt(f / 1000, 3)} →{' '}
                {fmt(f, 0)} ml (a {embalagem || 'garrafa'} inteira). Histórico, mínimo,
                fornecedores e embalagens também.
              </div>
            )}
            {erro && <p className="text-xs text-rose-700">{erro}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!ok || pending}
                onClick={converter}
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {pending ? 'Convertendo...' : 'Converter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

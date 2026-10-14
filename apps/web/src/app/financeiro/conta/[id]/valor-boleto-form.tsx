'use client';

// Conta de NF-e: o boleto veio com valor diferente da nota (acréscimo
// financeiro, tarifa bancária embutida). Digita o valor do boleto e a conta
// passa a valer ele; o valor da nota fica guardado e a diferença aparece como
// acréscimo financeiro. Voltar pro valor da nota desfaz.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

function lerValor(txt: string): number | null {
  const t = txt.replace(/[^\d.,]/g, '');
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function ValorBoletoForm({
  contaId,
  valor,
  valorNota,
}: {
  contaId: string;
  valor: number;
  /** valor que a nota mandou; null = conta nunca ajustada (valor = nota) */
  valorNota: number | null;
}) {
  const router = useRouter();
  const daNota = valorNota ?? valor;
  const [aberto, setAberto] = useState(false);
  const [txt, setTxt] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const novo = lerValor(txt);
  const dif = novo != null ? Math.round((novo - daNota) * 100) / 100 : null;

  async function salvar(v: number) {
    setOcupado(true);
    setErro('');
    try {
      const r = await fetch(`/api/financeiro/contas/${contaId}/valor-boleto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor: v }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setAberto(false);
      setTxt('');
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
      {valorNota != null && (
        <p>
          Valor do boleto <b className="font-mono">{brl(valor)}</b> = nota{' '}
          <span className="font-mono">{brl(valorNota)}</span> + acréscimo financeiro{' '}
          <b className="font-mono">{brl(valor - valorNota)}</b>
        </p>
      )}
      {!aberto ? (
        <div className={`flex flex-wrap items-center gap-2 ${valorNota != null ? 'mt-2' : ''}`}>
          {valorNota == null && <span>O boleto veio com valor diferente da nota?</span>}
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="rounded-md border border-amber-300 bg-white px-3 py-1 font-medium text-amber-900 hover:bg-amber-100"
          >
            ✎ {valorNota == null ? 'Ajustar valor do boleto' : 'Corrigir valor do boleto'}
          </button>
          {valorNota != null && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => {
                if (confirm(`Voltar a conta pro valor da nota (${brl(valorNota)})?`)) void salvar(valorNota);
              }}
              className="rounded-md px-2 py-1 text-amber-800 underline hover:text-amber-950 disabled:opacity-50"
            >
              voltar pro valor da nota
            </button>
          )}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (novo != null) void salvar(novo);
          }}
          className={valorNota != null ? 'mt-2' : ''}
        >
          <p>
            Valor da nota: <span className="font-mono">{brl(daNota)}</span>. Digite o valor que está no
            boleto (com a tarifa/acréscimo):
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={txt}
              onChange={(e) => setTxt(e.target.value)}
              inputMode="decimal"
              placeholder="ex.: 3.310,43"
              className="w-36 rounded-md border border-amber-300 bg-white px-2 py-1.5 font-mono text-sm text-slate-900"
            />
            <button
              type="submit"
              disabled={ocupado || novo == null || Math.abs(novo - valor) < 0.005}
              className="rounded-md bg-amber-700 px-3 py-1.5 font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              {ocupado ? 'Salvando...' : 'Salvar valor do boleto'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAberto(false);
                setErro('');
              }}
              className="rounded-md px-2 py-1.5 text-amber-800 hover:underline"
            >
              cancelar
            </button>
          </div>
          {dif != null && Math.abs(dif) >= 0.005 && (
            <p className="mt-1.5">
              {dif > 0 ? 'Acréscimo financeiro' : 'Desconto'}:{' '}
              <b className="font-mono">{brl(Math.abs(dif))}</b> — a conta passa a valer{' '}
              <b className="font-mono">{brl(novo!)}</b>.
            </p>
          )}
        </form>
      )}
      {erro && <p className="mt-1.5 text-rose-700">{erro}</p>}
    </div>
  );
}

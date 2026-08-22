'use client';

// Duas caras num componente só:
//  - sem estornarId: form de registrar pagamento (parcial ou total);
//  - com estornarId: botãozinho de estornar aquela baixa do histórico.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { hojeBr } from '@/lib/datas';
import { parseValorBr } from '@/lib/format';

export function BaixaForm({
  contaId,
  saldo,
  estornarId,
}: {
  contaId: string;
  saldo?: number;
  estornarId?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState(hojeBr());
  const [valor, setValor] = useState(saldo != null ? saldo.toFixed(2).replace('.', ',') : '');
  const [observacao, setObservacao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function estornar() {
    if (!confirm('Estornar esse pagamento? Ele sai do histórico e o saldo volta.')) return;
    setOcupado(true);
    const r = await fetch(`/api/financeiro/contas/${contaId}/baixas?baixaId=${estornarId}`, {
      method: 'DELETE',
    });
    setOcupado(false);
    if (r.ok) router.refresh();
    else alert((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
  }

  if (estornarId) {
    return (
      <button
        type="button"
        onClick={estornar}
        disabled={ocupado}
        title="Estornar esse pagamento"
        className="text-[10px] text-rose-600 hover:underline disabled:opacity-50"
      >
        estornar
      </button>
    );
  }

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const v = parseValorBr(valor);
    if (v == null || v <= 0) return setErro('Valor inválido — digite como 1.250,00 ou 1250.');
    setOcupado(true);
    try {
      const r = await fetch(`/api/financeiro/contas/${contaId}/baixas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data, valor: v, observacao: observacao.trim() || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setObservacao('');
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={registrar} className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Registrar pagamento
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[10px] text-slate-400">Data</label>
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="mt-0.5 rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-400">Valor (R$)</label>
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            className="mt-0.5 w-28 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-xs"
          />
        </div>
        <div className="min-w-40 flex-1">
          <label className="block text-[10px] text-slate-400">Observação</label>
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex.: pix, 1ª parte..."
            className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
        </div>
        <button
          type="submit"
          disabled={ocupado}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {ocupado ? 'Registrando...' : 'Registrar'}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-slate-400">
        Valor menor que o saldo = pagamento parcial; a conta fica como PARCIAL até quitar.
      </p>
      {erro && <p className="mt-1.5 text-[11px] text-rose-700">{erro}</p>}
    </form>
  );
}

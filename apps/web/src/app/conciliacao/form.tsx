'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Filial {
  id: string;
  nome: string;
}

interface Resultado {
  totalPagamentos: number;
  excecoesCriadas: number;
  porEtapa: Record<string, { qtd: number; valor: number }>;
}

const ETAPA_LABELS: Record<string, string> = {
  COMPLETO: '✅ Completo (PDV → Cielo → Banco)',
  NAO_NA_CIELO_VENDA: '❌ Não chegou na Cielo',
  SEM_AGENDA_RECEBIVEL: '⚠️ Sem agenda recebível',
  NAO_PAGO_NO_BANCO: '❌ Cielo prometeu mas não pagou',
  DIVERGENCIA_VALOR: '⚠️ Divergência de valor',
};

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}
function diasAtras(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function ConciliacaoForm({ filiais }: { filiais: Filial[] }) {
  const router = useRouter();
  const [filialId, setFilialId] = useState(filiais[0]?.id ?? '');
  const [dataInicio, setDataInicio] = useState(diasAtras(30));
  const [dataFim, setDataFim] = useState(hojeISO());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Resultado | null>(null);

  async function rodar() {
    if (!filialId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/conciliacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, dataInicio, dataFim }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setResult(data);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Rodar conciliação</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Cruza tudo que está no banco para o período escolhido.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Filial
          </label>
          <select
            value={filialId}
            onChange={(e) => setFilialId(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Data início
            </label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Data fim
            </label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>
        </div>
      </div>

      <button
        onClick={rodar}
        disabled={loading || !filialId}
        className="mt-5 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {loading ? 'Cruzando dados...' : 'Rodar conciliação'}
      </button>

      {error && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-5 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Resultado</p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-medium">
              {result.totalPagamentos} pagamentos analisados · {result.excecoesCriadas} exceções criadas
            </p>
          </div>
          {Object.entries(result.porEtapa)
            .filter(([, v]) => v.qtd > 0)
            .sort((a, b) => b[1].valor - a[1].valor)
            .map(([etapa, v]) => (
              <div
                key={etapa}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <span>{ETAPA_LABELS[etapa] ?? etapa}</span>
                <span className="font-mono text-xs text-slate-600">
                  {v.qtd} · {v.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

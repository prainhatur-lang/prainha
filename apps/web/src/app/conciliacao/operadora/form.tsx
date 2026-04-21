'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

interface Filial {
  id: string;
  nome: string;
  dataInicioConciliacao: string | null;
}

function inicioPadrao(corte: string | null) {
  const trintaDias = diasAtrasBr(30);
  return corte && corte > trintaDias ? corte : trintaDias;
}

export function OperadoraForm({ filiais }: { filiais: Filial[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const urlFilial = sp.get('filialId');
  const urlIni = sp.get('dataInicio');
  const urlFim = sp.get('dataFim');
  const [filialId, setFilialId] = useState(urlFilial ?? filiais[0]?.id ?? '');
  const filialSelecionada = useMemo(
    () => filiais.find((f) => f.id === filialId) ?? null,
    [filialId, filiais],
  );
  const corte = filialSelecionada?.dataInicioConciliacao ?? null;
  const [dataInicio, setDataInicio] = useState(urlIni ?? inicioPadrao(corte));
  const [dataFim, setDataFim] = useState(urlFim ?? hojeBr());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Checa se ja existe conciliacao OK pra esse periodo — avisa antes de sobrescrever
  useEffect(() => {
    if (!filialId || !dataInicio || !dataFim) return;
    let cancelado = false;
    const qs = new URLSearchParams({
      filialId,
      processo: 'OPERADORA',
      dataInicio,
      dataFim,
    });
    fetch(`/api/conciliacao/status?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelado || !d?.temAnterior) {
          if (!cancelado) setAviso(null);
          return;
        }
        const quando = new Date(d.ultimaEm).toLocaleString('pt-BR');
        const p = d.periodo;
        const pTxt = p
          ? ` (período ${p.inicio?.split('-').reverse().join('/')} a ${p.fim?.split('-').reverse().join('/')})`
          : '';
        setAviso(`Já rodada em ${quando}${pTxt}. Rodar de novo sobrescreve as exceções em aberto.`);
      })
      .catch(() => {
        /* silencia */
      });
    return () => {
      cancelado = true;
    };
  }, [filialId, dataInicio, dataFim]);

  function onFilialChange(id: string) {
    setFilialId(id);
    const novoCorte = filiais.find((f) => f.id === id)?.dataInicioConciliacao ?? null;
    if (novoCorte && dataInicio < novoCorte) setDataInicio(novoCorte);
  }

  async function rodar() {
    if (!filialId) return;
    if (aviso && !confirm(`${aviso}\n\nDeseja sobrescrever?`)) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/conciliacao/operadora', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, dataInicio, dataFim }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const qs = new URLSearchParams({ filialId, dataInicio, dataFim });
      router.push(`/conciliacao/operadora?${qs.toString()}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Rodar conciliação</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Cruza PDV × Vendas Cielo pro período.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Filial
          </label>
          <select
            value={filialId}
            onChange={(e) => onFilialChange(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Data início
            </label>
            <input
              type="date"
              value={dataInicio}
              min={corte ?? undefined}
              onChange={(e) => setDataInicio(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Data fim
            </label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
            />
          </div>
        </div>
        {corte && (
          <p className="text-[11px] text-slate-500">
            Corte da filial: {corte.split('-').reverse().join('/')}
          </p>
        )}
      </div>

      <button
        onClick={rodar}
        disabled={loading || !filialId}
        className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {loading ? 'Cruzando dados...' : 'Rodar conciliação'}
      </button>

      {aviso && !error && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          ⚠ {aviso}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

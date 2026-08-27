'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Duplicado de lib/metas/metricas.ts (que importa db/schema — server-only,
// não pode ir pro bundle do client). Mesma lista, mantida em sincronia.
const METRICAS: Array<{ valor: string; label: string }> = [
  { valor: 'faturamento', label: 'Faturamento' },
  { valor: 'faturamento_liquido', label: 'Faturamento líquido' },
  { valor: 'ticket_medio', label: 'Ticket médio' },
  { valor: 'servico', label: 'Serviço (10%)' },
  { valor: 'pedidos', label: 'Pedidos' },
  { valor: 'avaliacao_media', label: 'Avaliação média' },
];

function mesAtualYYYYMM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function NovaMetaForm({ filialId }: { filialId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [metrica, setMetrica] = useState('faturamento');
  const [competencia, setCompetencia] = useState(mesAtualYYYYMM());
  const [valorAlvo, setValorAlvo] = useState('');
  const [premiacaoTotal, setPremiacaoTotal] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (!nome.trim() || !valorAlvo || !premiacaoTotal) {
      setErro('Preencha nome, alvo e valor da premiação.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch('/api/metas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId, nome: nome.trim(), metrica, competencia, valorAlvo, premiacaoTotal }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error ?? 'Erro ao criar meta');
        return;
      }
      router.push(`/rh/metas/${json.meta.id}`);
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
      >
        + Nova meta
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Nova meta</h2>
      {erro && <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{erro}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs text-slate-500 lg:col-span-2">
          Nome
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex: Meta de faturamento — Agosto"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          Métrica
          <select
            value={metrica}
            onChange={(e) => setMetrica(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {METRICAS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Competência
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          Valor alvo
          <input
            type="number"
            step="0.01"
            min="0"
            value={valorAlvo}
            onChange={(e) => setValorAlvo(e.target.value)}
            placeholder="0,00"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          Premiação (se bater)
          <input
            type="number"
            step="0.01"
            min="0"
            value={premiacaoTotal}
            onChange={(e) => setPremiacaoTotal(e.target.value)}
            placeholder="0,00"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={salvar}
          disabled={salvando}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {salvando ? 'Criando…' : 'Criar meta'}
        </button>
        <button
          onClick={() => setAberto(false)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

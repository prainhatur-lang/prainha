'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Props {
  mes: string; // YYYY-MM
  filialId: string;
  processo: 'OPERADORA' | 'RECEBIVEIS' | 'BANCO';
  isAdmin: boolean;
  diasFechados: string[];
  stats: Record<string, { qtd: number; valor: number }>;
}

function diasDoMes(mes: string): string[] {
  const [y, m] = mes.split('-').map(Number);
  const out: string[] = [];
  const n = new Date(y!, m!, 0).getDate();
  for (let d = 1; d <= n; d++) {
    out.push(`${mes}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

function diaDaSemana(iso: string): number {
  return new Date(iso + 'T12:00:00').getDay();
}

export function Calendario({ mes, filialId, processo, isAdmin, diasFechados, stats }: Props) {
  const router = useRouter();
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const fechadoSet = new Set(diasFechados);
  const dias = diasDoMes(mes);
  const primeiroDiaSemana = diaDaSemana(dias[0]!);

  function toggle(d: string) {
    if (!isAdmin) return;
    const s = new Set(selecao);
    if (s.has(d)) s.delete(d);
    else s.add(d);
    setSelecao(s);
  }

  async function fecharSelecao() {
    if (!isAdmin || selecao.size === 0) return;
    const sorted = [...selecao].sort();
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch('/api/fechamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          processo,
          dataInicio: sorted[0],
          dataFim: sorted[sorted.length - 1],
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSelecao(new Set());
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function reabrirSelecao() {
    if (!isAdmin || selecao.size === 0) return;
    const sorted = [...selecao].sort();
    setLoading(true);
    setErro(null);
    try {
      const qs = new URLSearchParams({
        filialId,
        processo,
        dataInicio: sorted[0]!,
        dataFim: sorted[sorted.length - 1]!,
      });
      const r = await fetch(`/api/fechamento?${qs.toString()}`, { method: 'DELETE' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSelecao(new Set());
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const todosSelFechados = selecao.size > 0 && [...selecao].every((d) => fechadoSet.has(d));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: primeiroDiaSemana }).map((_, i) => (
          <div key={`e${i}`} />
        ))}
        {dias.map((d) => {
          const fechado = fechadoSet.has(d);
          const excs = stats[d];
          const temExc = excs && excs.qtd > 0;
          const ativa = selecao.has(d);
          const hrefExc = `/excecoes?filialId=${filialId}&processo=${processo}&dataTrans=${d}`;
          return (
            <div
              key={d}
              className={`relative flex h-20 flex-col rounded-md border transition ${
                ativa
                  ? 'border-sky-600 bg-sky-100'
                  : fechado
                    ? 'border-slate-400 bg-slate-200 text-slate-700'
                    : temExc
                      ? 'border-amber-300 bg-amber-50 text-amber-900'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}
            >
              <button
                onClick={() => toggle(d)}
                disabled={!isAdmin}
                className={`flex flex-1 flex-col items-center justify-center p-1 text-xs ${
                  isAdmin ? 'cursor-pointer hover:shadow' : 'cursor-default'
                }`}
                title={isAdmin ? 'Clique para selecionar' : ''}
              >
                <span className="font-semibold">{d.slice(-2)}</span>
                {fechado ? (
                  <span className="text-[10px]">🔒 fechado</span>
                ) : temExc ? (
                  <span className="text-[10px]">⚠ {excs.qtd}</span>
                ) : (
                  <span className="text-[10px]">✓</span>
                )}
              </button>
              {temExc && (
                <Link
                  href={hrefExc}
                  className="border-t border-amber-200 bg-white/60 py-0.5 text-center text-[10px] font-medium text-amber-900 hover:bg-white"
                  onClick={(e) => e.stopPropagation()}
                >
                  Ver →
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {isAdmin && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
          <p className="text-xs text-slate-500">
            {selecao.size === 0
              ? 'Clique nos dias para selecionar'
              : `${selecao.size} dia(s) selecionado(s)`}
          </p>
          <div className="ml-auto flex gap-2">
            {todosSelFechados ? (
              <button
                onClick={reabrirSelecao}
                disabled={loading || selecao.size === 0}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60"
              >
                Reabrir selecionados
              </button>
            ) : (
              <button
                onClick={fecharSelecao}
                disabled={loading || selecao.size === 0}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                🔒 Fechar selecionados
              </button>
            )}
          </div>
          {erro && <span className="w-full text-xs text-rose-700">{erro}</span>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-200 pt-3 text-[11px] text-slate-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-emerald-200 bg-emerald-50" />
          Sem exceções
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-amber-300 bg-amber-50" />
          Com exceções abertas
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-slate-400 bg-slate-200" />
          🔒 Fechado
        </span>
      </div>
    </div>
  );
}

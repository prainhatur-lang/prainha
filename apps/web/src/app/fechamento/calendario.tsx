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
  const hojeIso = new Date().toISOString().slice(0, 10);

  function toggle(d: string) {
    if (!isAdmin) return;
    const s = new Set(selecao);
    if (s.has(d)) s.delete(d);
    else s.add(d);
    setSelecao(s);
  }

  function selecionarTodosOk() {
    if (!isAdmin) return;
    const s = new Set<string>();
    for (const d of dias) {
      if (fechadoSet.has(d)) continue;
      if (d > hojeIso) continue; // não fecha dia futuro
      const exc = stats[d];
      if (!exc || exc.qtd === 0) s.add(d);
    }
    setSelecao(s);
  }

  function selecionarMesInteiro() {
    if (!isAdmin) return;
    const s = new Set<string>();
    for (const d of dias) {
      if (fechadoSet.has(d)) continue;
      if (d > hojeIso) continue;
      s.add(d);
    }
    setSelecao(s);
  }

  function limparSelecao() {
    setSelecao(new Set());
  }

  // Resumo da selecao
  const selArr = [...selecao].sort();
  const selComExcecao = selArr.filter((d) => (stats[d]?.qtd ?? 0) > 0).length;
  const selValorExc = selArr.reduce((s, d) => s + (stats[d]?.valor ?? 0), 0);

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
          const futuro = d > hojeIso;
          const hrefExc = `/excecoes?filialId=${filialId}&processo=${processo}&dataTrans=${d}`;
          const tooltip = fechado
            ? `🔒 Dia fechado em ${d}`
            : futuro
              ? 'Dia futuro'
              : temExc
                ? `⚠ ${excs.qtd} exceção(ões) aberta(s) · R$ ${excs.valor.toFixed(2)}`
                : 'Sem exceções — pronto pra fechar';
          return (
            <div
              key={d}
              className={`relative flex h-20 flex-col rounded-md border transition ${
                ativa
                  ? 'border-sky-600 bg-sky-100 ring-2 ring-sky-400'
                  : fechado
                    ? 'border-slate-400 bg-slate-200 text-slate-700'
                    : futuro
                      ? 'border-slate-200 bg-slate-50 text-slate-400'
                      : temExc
                        ? 'border-amber-300 bg-amber-50 text-amber-900'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}
              title={tooltip}
            >
              <button
                onClick={() => toggle(d)}
                disabled={!isAdmin || futuro}
                className={`flex flex-1 flex-col items-center justify-center p-1 text-xs ${
                  isAdmin && !futuro ? 'cursor-pointer hover:shadow' : 'cursor-default'
                }`}
              >
                <span className="font-semibold">{d.slice(-2)}</span>
                {fechado ? (
                  <span className="text-[10px]">🔒</span>
                ) : futuro ? (
                  <span className="text-[10px]">·</span>
                ) : temExc ? (
                  <span className="text-[10px]">⚠ {excs.qtd}</span>
                ) : (
                  <span className="text-[10px]">✓</span>
                )}
              </button>
              {temExc && !futuro && (
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
        <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
          {/* Ações rápidas */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={selecionarTodosOk}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
              title="Seleciona todos os dias sem exceção aberta (até hoje)"
            >
              ✓ Selecionar todos OK
            </button>
            <button
              onClick={selecionarMesInteiro}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
              title="Seleciona todos os dias até hoje (inclui com exceção)"
            >
              Selecionar mês inteiro
            </button>
            {selecao.size > 0 && (
              <button
                onClick={limparSelecao}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Limpar seleção
              </button>
            )}
          </div>

          {/* Resumo + ação */}
          {selecao.size === 0 ? (
            <p className="text-xs text-slate-500">Clique nos dias ou use as ações acima.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-700">
                <p className="font-medium">
                  {selecao.size} dia(s) selecionado(s) — {selArr[0]?.slice(-2)}/
                  {selArr[0]?.slice(5, 7)} a {selArr[selArr.length - 1]?.slice(-2)}/
                  {selArr[selArr.length - 1]?.slice(5, 7)}
                </p>
                {selComExcecao > 0 && (
                  <p className="mt-0.5 text-amber-700">
                    ⚠ {selComExcecao} dia(s) com exceção aberta · R${' '}
                    {selValorExc.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em exceções
                  </p>
                )}
              </div>
              <div className="ml-auto flex gap-2">
                {todosSelFechados ? (
                  <button
                    onClick={reabrirSelecao}
                    disabled={loading}
                    className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                  >
                    {loading ? 'Reabrindo...' : 'Reabrir selecionados'}
                  </button>
                ) : (
                  <button
                    onClick={fecharSelecao}
                    disabled={loading}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {loading ? 'Fechando...' : '🔒 Fechar selecionados'}
                  </button>
                )}
              </div>
            </div>
          )}

          {erro && <span className="block text-xs text-rose-700">{erro}</span>}
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
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-slate-200 bg-slate-50" />
          Dia futuro
        </span>
      </div>
    </div>
  );
}

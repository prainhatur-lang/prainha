'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

interface CreditoOpt {
  id: string;
  dataLanc: string; // DD/MM/YYYY ou YYYY-MM-DD ou ISO
  valor: number;
  descricao: string;
}

interface Props {
  excecaoId: string;
  dataGrupo: string; // texto descritivo da data (nao usado na logica)
  valorGrupo: number;
  creditosDisponiveis: CreditoOpt[];
}

/** Formata data independente do input (ISO, YYYY-MM-DD ou DD/MM/YYYY) */
function formatData(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10).split('-').reverse().join('/');
  }
  return s;
}

export function MatchManualBanco({
  excecaoId,
  valorGrupo,
  creditosDisponiveis,
}: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const soma = useMemo(
    () =>
      [...sel].reduce((s, id) => {
        const c = creditosDisponiveis.find((x) => x.id === id);
        return s + (c?.valor ?? 0);
      }, 0),
    [sel, creditosDisponiveis],
  );
  const diff = +(soma - valorGrupo).toFixed(2);
  // Indicador visual: bate = diff <= R$ 0,10 (verde no card).
  // Botao NAO fica disabled por isso — match manual e responsabilidade
  // do user (assumiu que a soma corresponde ao grupo apesar de diff).
  const bate = Math.abs(diff) <= 0.10;
  const pctDiff = valorGrupo > 0 ? Math.abs(diff / valorGrupo) * 100 : 0;

  function toggle(id: string) {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSel(n);
  }

  async function aplicar() {
    if (sel.size === 0) return;
    if (Math.abs(diff) > 1 && pctDiff > 1) {
      const ok = confirm(
        `Diferenca de ${diff >= 0 ? '+' : ''}${diff.toFixed(2).replace('.', ',')} (${pctDiff.toFixed(2)}%) — fora da tolerancia tipica.\n\n` +
          `Conciliar mesmo assim? Recomendado preencher observacao.`,
      );
      if (!ok) return;
    }
    setErro(null);
    try {
      const r = await fetch('/api/conciliacao/banco/match-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          excecaoCieloId: excecaoId,
          excecoesCreditoIds: [...sel],
          observacao: obs || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setAberto(false);
      start(() => router.refresh());
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
      >
        Conciliar manual
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Match manual — grupo R$ {valorGrupo.toFixed(2).replace('.', ',')}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Selecione créditos do banco que correspondem a esse grupo. Soma
              precisa bater (tolerância R$ 0,10).
            </p>
          </div>
          <button
            onClick={() => setAberto(false)}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-slate-200">
          {creditosDisponiveis.length === 0 ? (
            <p className="p-3 text-xs text-slate-500">
              Nenhum crédito sem origem próximo disponível. O grupo pode ser
              venda cancelada ou houve erro no extrato.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left font-medium text-slate-600">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2">Descrição</th>
                </tr>
              </thead>
              <tbody>
                {creditosDisponiveis.map((c) => {
                  const marcado = sel.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      className={`cursor-pointer border-t border-slate-100 ${
                        marcado ? 'bg-emerald-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => toggle(c.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700">
                        {formatData(c.dataLanc)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-slate-900">
                        {brl(c.valor)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{c.descricao}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-600">Selecionado:</span>
            <span className="font-mono font-semibold text-slate-900">
              {brl(soma)} ({sel.size} crédito{sel.size !== 1 ? 's' : ''})
            </span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-slate-600">Esperado:</span>
            <span className="font-mono text-slate-900">{brl(valorGrupo)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
            <span className="text-slate-600">Diferença:</span>
            <span
              className={`font-mono font-semibold ${
                bate ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {diff >= 0 ? '+' : ''}
              {brl(diff)}
            </span>
          </div>
        </div>

        <input
          type="text"
          placeholder="Observação (opcional)"
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          className="mt-3 w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
        />

        <div className="mt-3 flex justify-end gap-2">
          {erro && <span className="mr-auto text-xs text-rose-600">{erro}</span>}
          <button
            onClick={() => setAberto(false)}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={aplicar}
            disabled={sel.size === 0 || pending}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? 'Aplicando...' : 'Conciliar'}
          </button>
        </div>
      </div>
    </div>
  );
}

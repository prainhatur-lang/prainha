'use client';

// Perdas/quebras da semana — abatem o pote dos FUNCIONÁRIOS (pp_funcionarios
// do 10%) no dia em que aconteceram, antes do rateio por horas. Empresa e
// gerente continuam recebendo os pp deles sobre o 10% cheio.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { nomeDia } from '@/lib/folha/semana';

export interface PerdaRow {
  id: string;
  dia: string; // YYYY-MM-DD
  valor: number;
  descricao: string | null;
}

interface Props {
  folhaId: string;
  aberta: boolean;
  dias: string[];
  perdas: PerdaRow[];
  /** Pote dos funcionários por dia (ppFuncionarios/10 × 10% do dia), ANTES
   *  da perda — usado só pra avisar quando a perda não cabe no dia. */
  potePorDia: Record<string, number>;
  ppFuncionarios: number;
}

export function PerdasManager({
  folhaId,
  aberta,
  dias,
  perdas,
  potePorDia,
  ppFuncionarios,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [dia, setDia] = useState(dias[0] ?? '');
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');

  const total = perdas.reduce((s, p) => s + p.valor, 0);

  function adicionar() {
    const v = Number(valor.replace(',', '.'));
    if (!dia || !Number.isFinite(v) || v <= 0) {
      setErro('Escolha o dia e informe um valor maior que zero.');
      return;
    }
    setErro(null);
    start(async () => {
      const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/perdas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dia, valor: v, descricao: descricao || undefined }),
      });
      if (r.ok) {
        setValor('');
        setDescricao('');
        router.refresh();
      } else {
        setErro(await r.text());
      }
    });
  }

  function remover(perdaId: string) {
    setErro(null);
    start(async () => {
      const r = await fetch(
        `/api/folha-equipe/folhas/${folhaId}/perdas?perdaId=${perdaId}`,
        { method: 'DELETE' },
      );
      if (r.ok) router.refresh();
      else setErro(await r.text());
    });
  }

  // Perda do dia maior que o pote do dia: o excedente rola pros dias
  // seguintes (mesma regra do motor) — vale avisar na hora do lançamento.
  const porDia: Record<string, number> = {};
  for (const p of perdas) porDia[p.dia] = (porDia[p.dia] ?? 0) + p.valor;
  const diasEstourados = Object.keys(porDia).filter(
    (d) => porDia[d] > (potePorDia[d] ?? 0) + 0.005,
  );

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">
          💥 Perdas / quebras da semana
        </h2>
        <span className="font-mono text-sm font-semibold text-rose-700">
          − {brl(total)}
        </span>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Sai do bolo dos funcionários ({ppFuncionarios}pp dos 10%) no dia em que
        aconteceu, antes do rateio por horas — quem trabalhou naquele dia é
        quem paga. Empresa e gerente não são afetados.
      </p>

      {perdas.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">
          Nenhuma perda lançada nesta semana.
        </p>
      ) : (
        <table className="mb-4 w-full text-sm">
          <thead className="bg-slate-50 text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-500">Dia</th>
              <th className="px-3 py-2 text-left font-medium text-slate-500">Motivo</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">Valor</th>
              {aberta && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {[...perdas]
              .sort((a, b) => a.dia.localeCompare(b.dia))
              .map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span className="mr-2 text-xs uppercase text-slate-500">
                      {nomeDia(p.dia)}
                    </span>
                    {formatBr(p.dia)}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {p.descricao ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-rose-700">
                    − {brl(p.valor)}
                  </td>
                  {aberta && (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => remover(p.id)}
                        disabled={pending}
                        className="text-xs text-rose-600 hover:underline disabled:opacity-50"
                      >
                        remover
                      </button>
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {diasEstourados.length > 0 && (
        <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          A perda de{' '}
          {diasEstourados.map((d) => formatBr(d)).join(', ')} passa do que a
          equipe tem a receber naquele dia — o que sobrar é abatido nos dias
          seguintes da mesma semana. Se não couber na semana, o resto NÃO é
          cobrado (não carrega pra semana seguinte).
        </p>
      )}

      {aberta && (
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
          <label className="text-xs text-slate-500">
            Dia
            <select
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              className="mt-1 block rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
            >
              {dias.map((d) => (
                <option key={d} value={d}>
                  {nomeDia(d)} {formatBr(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Valor (R$)
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className="mt-1 block w-28 rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex-1 text-xs text-slate-500">
            Motivo
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={200}
              placeholder="Ex: copos quebrados de propósito"
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <button
            type="button"
            onClick={adicionar}
            disabled={pending}
            className="rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            Lançar perda
          </button>
        </div>
      )}

      {erro && <p className="mt-3 text-xs text-rose-700">{erro}</p>}
    </section>
  );
}

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

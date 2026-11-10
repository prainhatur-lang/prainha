// Quanto a equipe custou de verdade no período: o que a casa lançou (folha do
// mês, diária, bonificação, transporte) e os 10% repassados, separado por
// registrado × não registrado. Pedido do dono (10/11/2026).

import type { CustoRealResumo, GrupoCustoReal } from '@/lib/rh/estudo-equipe';
import { custoCasa, PAGO_ZERO, type Pago } from '@/lib/rh/custo-real-equipe';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pct = (n: number) => `${(n * 100).toFixed(1).replace('.', ',')}%`;
const n0 = (n: number) => Math.round(n).toLocaleString('pt-BR');
const v = (n: number) => (Math.round(n) ? brl(n) : '—');

function somaSemPonto(c: CustoRealResumo): Pago {
  const t = { ...PAGO_ZERO };
  for (const s of c.semPonto) for (const k of Object.keys(PAGO_ZERO) as (keyof Pago)[]) t[k] += s.pago[k];
  return t;
}

export function SecaoCustoReal({ c, venda, custoEstimado }: { c: CustoRealResumo; venda: number; custoEstimado: number }) {
  const semPonto = somaSemPonto(c);
  const linhas: { nome: string; sub: string; g: GrupoCustoReal }[] = [
    { nome: 'Registrados', sub: 'com empresa de registro no cadastro', g: c.registrados },
    { nome: 'Não registrados', sub: 'diarista / por fora', g: c.naoRegistrados },
    { nome: 'Pagos sem ponto na casa', sub: 'receberam e não bateram ponto aqui', g: { pessoas: c.semPonto.length, horas: 0, pago: semPonto } },
  ];
  const total: Pago = { ...PAGO_ZERO };
  for (const l of linhas) for (const k of Object.keys(PAGO_ZERO) as (keyof Pago)[]) total[k] += l.g.pago[k];
  const hTotal = c.registrados.horas + c.naoRegistrados.horas;

  return (
    <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-800">Quanto a equipe custou de verdade</h2>
      <p className="mb-3 text-xs text-slate-500">
        O que a casa lançou no período: folha do mês, diárias, bonificação e transporte. Os 10% são pagos pelo cliente — aparecem à parte, fora do
        custo. Pelo cadastro (salário ou valor da hora) a estimativa era {brl(custoEstimado)}.
      </p>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded border border-slate-200 p-3">
          <div className="text-xs uppercase text-slate-500">Custo da casa</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{brl(c.custo)}</div>
          <div className="text-xs text-slate-500">{venda > 0 ? `${pct(c.custoPctVenda)} da venda` : ''}</div>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <div className="text-xs uppercase text-slate-500">10% repassado à equipe</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{brl(c.dezPct)}</div>
          <div className="text-xs text-slate-500">pago pelo cliente</div>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <div className="text-xs uppercase text-slate-500">Horas sem registro</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{hTotal > 0 ? pct(c.naoRegistrados.horas / hTotal) : '—'}</div>
          <div className="text-xs text-slate-500">
            {c.naoRegistrados.pessoas} de {c.registrados.pessoas + c.naoRegistrados.pessoas} pessoas com ponto
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Grupo</th>
              <th className="px-3 py-2 text-right">Pessoas</th>
              <th className="px-3 py-2 text-right">Horas</th>
              <th className="px-3 py-2 text-right">Salário (folha)</th>
              <th className="px-3 py-2 text-right">Encargos *</th>
              <th className="px-3 py-2 text-right">Diárias</th>
              <th className="px-3 py-2 text-right">Bonificação</th>
              <th className="px-3 py-2 text-right">Transporte</th>
              <th className="px-3 py-2 text-right">Custo da casa</th>
              <th className="px-3 py-2 text-right">R$/hora</th>
              <th className="px-3 py-2 text-right">10%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {linhas.map((l) => (
              <tr key={l.nome}>
                <td className="px-3 py-1.5">
                  <div className="font-medium text-slate-800">{l.nome}</div>
                  <div className="text-xs text-slate-500">{l.sub}</div>
                </td>
                <td className="px-3 py-1.5 text-right">{l.g.pessoas}</td>
                <td className="px-3 py-1.5 text-right">{l.g.horas ? n0(l.g.horas) : '—'}</td>
                <td className="px-3 py-1.5 text-right">{v(l.g.pago.salario)}</td>
                <td className="px-3 py-1.5 text-right">{v(l.g.pago.encargos)}</td>
                <td className="px-3 py-1.5 text-right">{v(l.g.pago.diaria)}</td>
                <td className="px-3 py-1.5 text-right">{v(l.g.pago.bonificacao)}</td>
                <td className="px-3 py-1.5 text-right">{v(l.g.pago.transporte)}</td>
                <td className="px-3 py-1.5 text-right font-medium">{v(custoCasa(l.g.pago))}</td>
                <td className="px-3 py-1.5 text-right">{l.g.horas > 0 ? brl(custoCasa(l.g.pago) / l.g.horas) : '—'}</td>
                <td className="px-3 py-1.5 text-right text-slate-500">{v(l.g.pago.dezPct)}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-medium">
              <td className="px-3 py-1.5">Total</td>
              <td className="px-3 py-1.5 text-right">{linhas.reduce((x, l) => x + l.g.pessoas, 0)}</td>
              <td className="px-3 py-1.5 text-right">{n0(hTotal)}</td>
              <td className="px-3 py-1.5 text-right">{v(total.salario)}</td>
              <td className="px-3 py-1.5 text-right">{v(total.encargos)}</td>
              <td className="px-3 py-1.5 text-right">{v(total.diaria)}</td>
              <td className="px-3 py-1.5 text-right">{v(total.bonificacao)}</td>
              <td className="px-3 py-1.5 text-right">{v(total.transporte)}</td>
              <td className="px-3 py-1.5 text-right">{v(custoCasa(total))}</td>
              <td className="px-3 py-1.5 text-right">{hTotal > 0 ? brl(custoCasa(total) / hTotal) : '—'}</td>
              <td className="px-3 py-1.5 text-right text-slate-500">{v(total.dezPct)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        * Encargos = estimativa sobre o salário (FGTS, férias, 13º). Folha semanal que cruza o mês entra proporcional aos dias. Quem trabalha em mais
        de uma casa tem o salário dividido pelas horas em cada uma.
      </p>

      {(c.semPonto.length > 0 || c.pontoSemPagamento.length > 0) && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {c.semPonto.length > 0 && (
            <details className="rounded border border-amber-200 bg-amber-50/50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-amber-900">
                {c.semPonto.length} pessoa(s) receberam e não bateram ponto nesta casa — {brl(custoCasa(semPonto))}
                {semPonto.dezPct >= 1 ? ` + ${brl(semPonto.dezPct)} de 10%` : ''}
              </summary>
              <ul className="mt-2 space-y-0.5 text-xs text-slate-700">
                {c.semPonto.map((s, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>
                      {s.nome} <span className="text-slate-400">· {s.registrado ? 'registrado' : 'não registrado'}</span>
                    </span>
                    <span className="whitespace-nowrap">
                      {[
                        s.pago.salario >= 1 && `salário ${brl(s.pago.salario)}`,
                        s.pago.diaria >= 1 && `diária ${brl(s.pago.diaria)}`,
                        s.pago.bonificacao >= 1 && `bonif. ${brl(s.pago.bonificacao)}`,
                        s.pago.transporte >= 1 && `transp. ${brl(s.pago.transporte)}`,
                        s.pago.dezPct >= 1 && `10% ${brl(s.pago.dezPct)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {c.pontoSemPagamento.length > 0 && (
            <details className="rounded border border-amber-200 bg-amber-50/50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-amber-900">
                {c.pontoSemPagamento.length} pessoa(s) bateram ponto e não têm nenhum lançamento no período
              </summary>
              <ul className="mt-2 space-y-0.5 text-xs text-slate-700">
                {c.pontoSemPagamento.map((s, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>
                      {s.nome} <span className="text-slate-400">· {s.registrado ? 'registrado' : 'não registrado'}</span>
                    </span>
                    <span>{s.horas} h</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

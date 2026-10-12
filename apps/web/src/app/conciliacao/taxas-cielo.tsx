// Quadro "Quanto a Cielo custa" na Conciliação: taxa prevista (cadastrada) ×
// taxa cobrada × custo total com o aluguel das maquininhas, sobre o vendido.
// Pedido do dono em 12/10/2026. Só leitura. Se o cálculo falhar, o quadro some
// e o resto da tela abre igual.

import Link from 'next/link';
import { brl, int } from '@/lib/format';
import { taxasCielo, type FormaTaxa, type TaxasCielo, type TaxasCieloMes } from '@/lib/taxas-cielo';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesBr = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
const pct = (parte: number, todo: number) =>
  todo > 0 ? `${((parte / todo) * 100).toFixed(2).replace('.', ',')}%` : '—';
const FORMA: Record<FormaTaxa, string> = {
  CREDITO: 'Crédito',
  DEBITO: 'Débito',
  PIX: 'Pix',
  OUTROS: 'Outros',
};
// cobrada acima da cadastrada por mais que isso (em pontos percentuais) fica vermelho
const FOLGA_PP = 0.05;
const acima = (cobrada: number, prevista: number, bruto: number) =>
  bruto > 0 && ((cobrada - prevista) / bruto) * 100 > FOLGA_PP;

export async function TaxasCieloPainel({ filialId }: { filialId: string }) {
  let d: TaxasCielo;
  try {
    d = await taxasCielo(filialId);
  } catch (e) {
    console.error('[taxas-cielo]', e);
    return null;
  }
  return <TaxasCieloView d={d} />;
}

export function TaxasCieloView({ d }: { d: TaxasCielo }) {
  if (d.meses.length === 0) return null;
  // destaque = último mês fechado (o corrente ainda não tem aluguel nem mês inteiro)
  const destaque = d.meses.find((m) => m.mes !== d.mesAberto) ?? d.meses[0]!;
  const total = destaque.cobrada + destaque.aluguel;
  const temDeposito = d.meses.some((m) => m.depositoMenor > 0.05);
  const temSemCadastro = d.meses.some((m) => m.brutoSemCadastro > 0.05);

  return (
    <div className="mt-6 rounded-xl border border-slate-300 bg-white p-5">
      <p className="text-sm font-black uppercase tracking-wide text-slate-700">
        💳 Quanto a Cielo custa — taxa prevista × taxa efetiva
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Sobre o que foi vendido na Cielo (cartão e Pix). Prevista = taxa cadastrada em{' '}
        <Link href="/configuracoes" className="underline">
          Configurações
        </Link>
        . Cobrada = venda menos o que a Cielo paga. Total = cobrada + aluguel das maquininhas.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Cartao rotulo={`Vendido na Cielo · ${mesBr(destaque.mes)}`} valor={brl(destaque.bruto)} sub={`${int(destaque.qtd)} vendas`} />
        <Cartao rotulo="Taxa prevista" valor={pct(destaque.prevista, destaque.bruto)} sub={brl(destaque.prevista)} />
        <Cartao
          rotulo="Taxa cobrada"
          valor={pct(destaque.cobrada, destaque.bruto)}
          sub={brl(destaque.cobrada)}
          alerta={acima(destaque.cobrada, destaque.prevista, destaque.bruto)}
        />
        <Cartao
          rotulo="Taxa total efetiva (com aluguel)"
          valor={pct(total, destaque.bruto)}
          sub={`${brl(total)} = ${brl(destaque.cobrada)} + ${brl(destaque.aluguel)} de aluguel`}
          forte
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2">Mês da venda</th>
              <th className="px-3 py-2 text-right">Vendido</th>
              <th className="px-3 py-2 text-right">Taxa prevista</th>
              <th className="px-3 py-2 text-right">Taxa cobrada</th>
              <th className="px-3 py-2 text-right">Cobrado a mais</th>
              <th className="px-3 py-2 text-right">Aluguel</th>
              <th className="px-3 py-2 text-right">Total pago</th>
              <th className="px-3 py-2 text-right">Taxa total</th>
            </tr>
          </thead>
          <tbody>
            {d.meses.map((m) => (
              <LinhaMes key={m.mes} m={m} aberto={m.mes === d.mesAberto} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs font-bold uppercase text-slate-600">
        Por forma de pagamento · {mesBr(destaque.mes)}
      </p>
      <div className="mt-1 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2">Forma</th>
              <th className="px-3 py-2 text-right">Vendas</th>
              <th className="px-3 py-2 text-right">Vendido</th>
              <th className="px-3 py-2 text-right">Prevista</th>
              <th className="px-3 py-2 text-right">Cobrada</th>
              <th className="px-3 py-2 text-right">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {destaque.formas.map((f) => {
              const ruim = acima(f.cobrada, f.prevista, f.bruto);
              return (
                <tr key={f.forma} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{FORMA[f.forma]}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{int(f.qtd)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{brl(f.bruto)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {pct(f.prevista, f.bruto)} · {brl(f.prevista)}
                  </td>
                  <td className={`px-3 py-2 text-right ${ruim ? 'font-bold text-red-700' : 'text-slate-700'}`}>
                    {pct(f.cobrada, f.bruto)} · {brl(f.cobrada)}
                  </td>
                  <td className={`px-3 py-2 text-right ${ruim ? 'font-black text-red-700' : 'text-slate-700'}`}>
                    {brl(f.cobrada - f.prevista)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-1 text-xs text-slate-500">
        <p>
          A taxa é do mês da venda; o aluguel é do mês em que a Cielo descontou (ela desconta por
          volta do dia 10). {mesBr(d.mesAberto)} ainda está em andamento.
        </p>
        {temDeposito && (
          <p className="text-red-800">
            * Fora dessa conta: depósito de cartão que veio menor que o previsto (está no quadro
            vermelho lá em cima). Se for desconto da Cielo, o custo real é maior — não está
            conferido.
          </p>
        )}
        {temSemCadastro && (
          <p>
            Parcelado, pré-pago e bandeira sem taxa cadastrada entram na prevista pelo valor que
            foi cobrado.
          </p>
        )}
      </div>
    </div>
  );
}

function LinhaMes({ m, aberto }: { m: TaxasCieloMes; aberto: boolean }) {
  const total = m.cobrada + m.aluguel;
  const ruim = acima(m.cobrada, m.prevista, m.bruto);
  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-2 font-medium text-slate-900">
        {mesBr(m.mes)}
        {aberto && <span className="ml-1 text-xs font-normal text-slate-500">(em andamento)</span>}
      </td>
      <td className="px-3 py-2 text-right text-slate-700">{brl(m.bruto)}</td>
      <td className="px-3 py-2 text-right text-slate-700">
        {pct(m.prevista, m.bruto)} · {brl(m.prevista)}
      </td>
      <td className={`px-3 py-2 text-right ${ruim ? 'font-bold text-red-700' : 'text-slate-700'}`}>
        {pct(m.cobrada, m.bruto)} · {brl(m.cobrada)}
      </td>
      <td className={`px-3 py-2 text-right ${ruim ? 'font-black text-red-700' : 'text-slate-700'}`}>
        {brl(m.cobrada - m.prevista)}
      </td>
      <td className="px-3 py-2 text-right text-slate-700">
        {m.aluguel > 0 ? brl(m.aluguel) : '—'}
        {m.depositoMenor > 0.05 && (
          <span className="block text-xs text-red-700">+ {brl(m.depositoMenor)} a menor*</span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-bold text-slate-900">{brl(total)}</td>
      <td className="px-3 py-2 text-right font-black text-slate-900">{pct(total, m.bruto)}</td>
    </tr>
  );
}

function Cartao(p: { rotulo: string; valor: string; sub: string; alerta?: boolean; forte?: boolean }) {
  const cor = p.alerta
    ? 'border-red-400 bg-red-50'
    : p.forte
      ? 'border-slate-800 bg-slate-900'
      : 'border-slate-200 bg-slate-50';
  const texto = p.forte ? 'text-white' : p.alerta ? 'text-red-700' : 'text-slate-900';
  const fraco = p.forte ? 'text-slate-300' : 'text-slate-500';
  return (
    <div className={`rounded-lg border p-3 ${cor}`}>
      <p className={`text-xs font-bold uppercase ${fraco}`}>{p.rotulo}</p>
      <p className={`mt-1 text-2xl font-black ${texto}`}>{p.valor}</p>
      <p className={`mt-0.5 text-xs ${fraco}`}>{p.sub}</p>
    </div>
  );
}

// Quadro "Caixa × banco" da Conciliação, pra casa sem a agenda da Cielo no
// sistema (hoje a Prainha Mar). Pedido do dono em 12/10/2026. Só leitura. Se o
// cálculo falhar ou não se aplicar, o quadro some e o resto da tela abre igual.

import Link from 'next/link';
import { brl, int } from '@/lib/format';
import { pdvContraBanco, type DiaCartao, type PdvBanco } from '@/lib/pdv-banco';

const dataBr = (iso: string) => iso.split('-').reverse().join('/');
const pct = (parte: number, todo: number) =>
  todo > 0 ? `${((parte / todo) * 100).toFixed(1).replace('.', ',')}%` : '—';

export async function PdvBancoPainel({ filialId }: { filialId: string }) {
  let d: PdvBanco | null;
  try {
    d = await pdvContraBanco(filialId);
  } catch (e) {
    console.error('[pdv-banco]', e);
    return null;
  }
  if (!d) return null;
  return <PdvBancoView d={d} />;
}

const STATUS: Record<DiaCartao['status'], { rotulo: string; cor: string }> = {
  OK: { rotulo: 'entrou', cor: 'text-emerald-700' },
  A_MENOS: { rotulo: 'entrou a menos', cor: 'font-bold text-red-700' },
  NADA: { rotulo: 'NÃO ENTROU', cor: 'font-black text-red-700' },
  SEM_EXTRATO: { rotulo: 'sem extrato do dia', cor: 'text-amber-700' },
  AGUARDANDO: { rotulo: 'aguardando', cor: 'text-slate-500' },
};

export function PdvBancoView({ d }: { d: PdvBanco }) {
  const c = d.cartao;
  const p = d.pix;
  const faltaTotal = c.falta + p.semCreditoValor;
  const temFalta = faltaTotal > 0.05;

  return (
    <div className="mt-6">
      {temFalta ? (
        <div className="rounded-xl border-4 border-red-600 bg-red-50 p-5">
          <p className="text-lg font-black uppercase text-red-700">
            🚨 Dinheiro que não entrou na conta — caixa × banco
          </p>
          <p className="mt-1 text-3xl font-black text-red-700">{brl(faltaTotal)}</p>
          <ul className="mt-2 space-y-0.5 text-sm text-red-900">
            {c.faltaNada > 0.05 && (
              <li>
                <b>{brl(c.faltaNada)}</b> de cartão em dia que a Cielo não depositou nada
              </li>
            )}
            {c.faltaAMenos > 0.05 && (
              <li>
                <b>{brl(c.faltaAMenos)}</b> de cartão em dia que o depósito veio menor que o previsto
              </li>
            )}
            {p.semCreditoValor > 0.05 && (
              <li>
                <b>{brl(p.semCreditoValor)}</b> em {int(p.semCredito.length)} Pix do caixa sem crédito
                de valor igual no banco
              </li>
            )}
          </ul>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-3 text-sm text-emerald-900">
          ✅ Caixa × banco de {dataBr(d.desde)} a {dataBr(d.ate)}: o cartão e o Pix registrados no
          caixa foram achados no extrato.
        </div>
      )}

      <div className="mt-3 rounded-xl border border-slate-300 bg-white p-5">
        <p className="text-sm font-black uppercase tracking-wide text-slate-700">
          Cartão — vendido no caixa × depósito da Cielo no dia seguinte
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Essa casa não tem o arquivo de vendas da Cielo no sistema, então a conferência é por dia e
          não venda a venda. Dias conferidos: vendido {brl(c.bruto)}, previsto {brl(c.previsto)},
          depositado {brl(c.depositado)} ({pct(c.bruto - c.depositado, c.bruto)} a menos que o
          vendido).
        </p>
        {d.semEcCadastrado && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            ⚠️ O número da Cielo dessa casa não está cadastrado em{' '}
            <Link href="/configuracoes" className="underline">
              Configurações
            </Link>
            : o previsto usou a taxa padrão, que pode não ser a do contrato. Com a taxa errada o Pix
            deixa de casar e a falta aparece maior do que é.
          </p>
        )}
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Dia da venda</th>
                <th className="px-3 py-2 text-right">Vendas</th>
                <th className="px-3 py-2 text-right">Vendido</th>
                <th className="px-3 py-2 text-right">Previsto (sem a taxa)</th>
                <th className="px-3 py-2 text-right">Depósito</th>
                <th className="px-3 py-2 text-right">Descontado</th>
                <th className="px-3 py-2 text-right">Faltou</th>
                <th className="px-3 py-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {c.dias.map((x) => (
                <tr key={x.data} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{dataBr(x.data)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{int(x.qtd)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{brl(x.bruto)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{brl(x.previsto)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {x.deposito != null ? (
                      <>
                        {brl(x.deposito)}
                        <span className="block text-xs text-slate-500">em {dataBr(x.depositoEm)}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {x.deposito != null ? pct(x.bruto - x.deposito, x.bruto) : '—'}
                  </td>
                  <td className={`px-3 py-2 text-right ${x.falta > 0 ? 'font-black text-red-700' : 'text-slate-400'}`}>
                    {x.falta > 0 ? brl(x.falta) : '—'}
                  </td>
                  <td className={`px-3 py-2 ${STATUS[x.status].cor}`}>{STATUS[x.status].rotulo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-5 text-sm font-black uppercase tracking-wide text-slate-700">
          Pix da maquininha — um crédito por venda
        </p>
        <p className="mt-1 text-xs text-slate-500">
          No caixa: {int(p.vendidoQtd)} Pix, {brl(p.vendido)}. No banco: {int(p.creditoQtd)} créditos
          de Pix da Cielo, {brl(p.credito)}.
        </p>
        {p.comoCartao.qtd > 0 && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {int(p.comoCartao.qtd)} pagamentos ({brl(p.comoCartao.valor)}) estão no caixa como cartão
            mas entraram no banco como Pix, com valor idêntico no mesmo dia. Foram tirados da conta do
            cartão acima.
          </p>
        )}
        {p.semCredito.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-red-300">
            <table className="w-full text-sm">
              <thead className="bg-red-100 text-left text-xs uppercase text-red-800">
                <tr>
                  <th className="px-3 py-2">Pix do caixa sem crédito igual no banco</th>
                  <th className="px-3 py-2">Hora</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {p.semCredito.map((v, i) => (
                  <tr key={i} className="border-t border-red-100">
                    <td className="px-3 py-2 text-slate-900">{dataBr(v.data)}</td>
                    <td className="px-3 py-2 text-slate-700">{v.hora}</td>
                    <td className="px-3 py-2 text-right font-bold text-red-700">{brl(v.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {p.semVenda.length > 0 && (
          <p className="mt-2 text-xs text-slate-600">
            Créditos de Pix da Cielo sem pagamento de valor igual no caixa ({brl(p.semVendaValor)}):{' '}
            {p.semVenda.map((v) => `${dataBr(v.data)} ${brl(v.valor)}`).join(' · ')}.
          </p>
        )}

        <div className="mt-3 space-y-1 text-xs text-slate-500">
          <p>
            A Cielo deposita o cartão num Pix só, no dia seguinte ao da venda. O previsto usa a taxa
            à vista cadastrada: o caixa não sabe o que foi parcelado, e parcelado custa mais. Por isso
            só conta como &quot;a menos&quot; a diferença acima de 1% do vendido.
          </p>
          <p>
            &quot;Sem extrato do dia&quot; = não há nenhum lançamento do banco carregado naquele dia;
            não foi conferido. Pix só casa com valor idêntico (cheio ou já sem a taxa).
          </p>
        </div>
      </div>
    </div>
  );
}

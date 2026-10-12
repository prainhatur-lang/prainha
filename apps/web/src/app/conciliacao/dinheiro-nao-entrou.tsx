// Painel "DINHEIRO QUE NÃO ENTROU" no topo da Conciliação. Pedido do dono em
// 12/10/2026: o que foi vendido, já sem a taxa, e não caiu na conta tem que
// aparecer de forma escandalosa e com o detalhe, pra poder cobrar.
// Só leitura. Se o cálculo falhar, o painel some e o resto da tela abre igual.

import Link from 'next/link';
import { brl, int } from '@/lib/format';
import {
  DIAS_JANELA_NAO_ENTROU,
  dinheiroNaoEntrou,
  type DinheiroNaoEntrou,
  type GrupoNaoEntrou,
} from '@/lib/dinheiro-nao-entrou';

const dataBr = (iso: string) => iso.split('-').reverse().join('/');
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesBr = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;

export async function DinheiroNaoEntrouPainel({ filialId }: { filialId: string }) {
  let d: DinheiroNaoEntrou;
  try {
    d = await dinheiroNaoEntrou(filialId);
  } catch (e) {
    console.error('[dinheiro-nao-entrou]', e);
    return null;
  }
  return <DinheiroNaoEntrouView d={d} filialId={filialId} />;
}

export function DinheiroNaoEntrouView({ d, filialId }: { d: DinheiroNaoEntrou; filialId: string }) {
  const periodo = `${dataBr(d.desde)} a ${dataBr(d.ate)}`;

  if (d.semExtrato) {
    if (d.previsto.qtd === 0) return null;
    return (
      <div className="mt-6 rounded-xl border-4 border-red-600 bg-red-50 p-5">
        <p className="text-lg font-black uppercase text-red-700">
          🚨 Nenhum extrato de banco carregado — nada foi conferido
        </p>
        <p className="mt-1 text-sm text-red-900">
          A Cielo previu {brl(d.previsto.valor)} em {int(d.previsto.qtd)} recebimentos de {periodo} e
          o sistema não tem o extrato pra dizer se entrou.
        </p>
      </div>
    );
  }

  const falta = d.grupos.filter((g) => !g.foraDoExtrato && !g.extratoFaltando);
  const semExtrato = d.grupos.filter((g) => g.extratoFaltando);
  const temFalta = d.naoAchado.valor > 0.05;
  const temOutra = d.outraConta.valor > 0.05;
  const temBuraco = d.extratoFaltando.valor > 0.05;

  if (!temFalta && !temOutra && !temBuraco) {
    return (
      <div className="mt-6 rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-3 text-sm text-emerald-900">
        ✅ Tudo que a Cielo previu de {periodo} ({brl(d.previsto.valor)}) foi achado no extrato do
        banco.
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      {temFalta && (
        <div className="rounded-xl border-4 border-red-600 bg-red-50 p-5 shadow-lg">
          <p className="text-sm font-black uppercase tracking-wide text-red-700">
            🚨 Dinheiro que não entrou na conta
          </p>
          <p className="mt-1 text-4xl font-black text-red-700">{brl(d.naoAchado.valor)}</p>
          <p className="mt-1 text-sm text-red-900">
            Vendido, já descontada a taxa, e <b>não achado no extrato do banco</b> — {periodo} (
            {DIAS_JANELA_NAO_ENTROU} dias). A Cielo previu {brl(d.previsto.valor)} no período.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {d.porMes
              .filter((m) => m.naoAchado > 0.05)
              .map((m) => (
                <span
                  key={m.mes}
                  className="rounded-full bg-red-600 px-3 py-1 text-sm font-bold text-white"
                >
                  {mesBr(m.mes)}: {brl(m.naoAchado)}
                </span>
              ))}
          </div>

          <TabelaGrupos grupos={falta} />

          <p className="mt-3 text-xs text-red-900">
            Cartão: a Cielo deposita um valor por dia; a falta é o previsto do dia menos o que ela
            depositou. Pix: cada venda tem que ter um crédito de valor igual; sem ele, o valor
            inteiro conta como falta.{' '}
            <Link href={`/conciliacao/banco?filialId=${filialId}`} className="font-bold underline">
              Ver recebíveis × banco
            </Link>
          </p>
        </div>
      )}

      {temOutra && (
        <div className="rounded-xl border-4 border-orange-500 bg-orange-50 p-5">
          <p className="text-sm font-black uppercase tracking-wide text-orange-700">
            ⚠️ Pago em outra conta — NÃO conferido
          </p>
          <p className="mt-1 text-3xl font-black text-orange-700">{brl(d.outraConta.valor)}</p>
          <p className="mt-1 text-sm text-orange-900">
            {int(d.outraConta.qtd)} recebimentos que a Cielo paga no{' '}
            <b>{d.outraConta.bancos.join(', ') || 'outro banco'}</b>. O sistema não lê o extrato
            dessa conta, então ninguém conferiu se esse dinheiro entrou.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {d.porMes
              .filter((m) => m.outraConta > 0.05)
              .map((m) => (
                <span
                  key={m.mes}
                  className="rounded-full bg-orange-500 px-3 py-1 text-sm font-bold text-white"
                >
                  {mesBr(m.mes)}: {brl(m.outraConta)}
                </span>
              ))}
          </div>
        </div>
      )}

      {temBuraco && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-5">
          <p className="text-sm font-black uppercase tracking-wide text-amber-800">
            ⚠️ Extrato do banco não carregado — NÃO conferido
          </p>
          <p className="mt-1 text-2xl font-black text-amber-800">{brl(d.extratoFaltando.valor)}</p>
          <p className="mt-1 text-sm text-amber-900">
            {int(d.extratoFaltando.qtd)} recebimentos previstos em dias que não têm nenhum
            lançamento de banco no sistema ({resumoDias(semExtrato)}). Falta carregar o extrato
            desses dias pra saber se entrou.
          </p>
        </div>
      )}
    </div>
  );
}

function resumoDias(gs: GrupoNaoEntrou[]): string {
  const dias = [...new Set(gs.map((g) => g.data))].sort();
  if (dias.length === 0) return '';
  if (dias.length === 1) return dataBr(dias[0]!);
  return `${dias.length} dias, de ${dataBr(dias[0]!)} a ${dataBr(dias[dias.length - 1]!)}`;
}

function TabelaGrupos({ grupos }: { grupos: GrupoNaoEntrou[] }) {
  if (grupos.length === 0) return null;
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-red-300 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-red-100 text-left text-xs uppercase text-red-900">
          <tr>
            <th className="px-3 py-2">Dia previsto</th>
            <th className="px-3 py-2">Tipo</th>
            <th className="px-3 py-2 text-right">Vendas</th>
            <th className="px-3 py-2 text-right">Cielo previu</th>
            <th className="px-3 py-2 text-right">Entrou</th>
            <th className="px-3 py-2 text-right">Faltou</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <tr key={`${g.data}|${g.tipo}`} className="border-t border-red-100">
              <td className="px-3 py-2 font-medium text-slate-900">{dataBr(g.data)}</td>
              <td className="px-3 py-2 text-slate-700">{g.tipo === 'PIX' ? 'Pix' : 'Cartão'}</td>
              <td className="px-3 py-2 text-right text-slate-700">{int(g.qtd)}</td>
              <td className="px-3 py-2 text-right text-slate-700">
                {brl(g.previstoDia ?? g.valor)}
              </td>
              <td className="px-3 py-2 text-right text-slate-700">
                {g.depositadoDia != null ? brl(g.depositadoDia) : 'nada achado'}
              </td>
              <td className="px-3 py-2 text-right font-black text-red-700">{brl(g.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

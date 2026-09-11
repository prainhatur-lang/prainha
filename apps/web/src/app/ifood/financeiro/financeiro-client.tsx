'use client';

import { useCallback, useEffect, useState } from 'react';

interface Venda {
  orderId: string;
  displayId: string;
  data: string;
  status: string;
  tipoPagamento: string;
  metodo: string;
  bruto: number;
  taxaEntrega: number;
  comissao: number;
  taxaCartao: number;
  comissaoEntrega: number;
  promoLoja: number;
  totalDebito: number;
  totalCredito: number;
  liquido: number;
  repasseEm: string;
  lancamento: string;
  lancamentoId: string | null;
  brutoConcilia: number | null;
  liquidoGravado: number | null;
  problema: string;
}

interface Repasse {
  calculoDe: string;
  calculoAte: string;
  tipo: string;
  produto: string;
  valor: number;
  situacao: string;
  pagoEm: string;
  banco: string;
  conta: string;
}

interface Evento {
  nome: string;
  descricao: string;
  quando: string;
  refTipo: string;
  refId: string;
  mexeNoRepasse: boolean;
  valor: number;
  percentual: string;
  repasseEm: string;
}

interface Resposta {
  filial: { id: string; nome: string };
  de: string;
  ate: string;
  visao: string;
  resumo?: {
    pedidos: number; pedidosOnline: number; cancelados: number; naEntrega: number;
    bruto: number; comissao: number; taxaCartao: number; promoLoja: number; liquido: number;
  };
  comProblema?: number;
  semLiquidoGravado?: number;
  vendas?: Venda[];
  saldo?: number;
  itens?: Repasse[];
  eventos?: Evento[];
  temMais?: boolean;
}

const reais = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** 'yyyy-mm-dd' → 'dd/mm'. Fatiar string é de propósito: `new Date(ymd)` lê
 *  como UTC e mostra um dia a menos no Brasil. */
const dia = (ymd: string) => (ymd && ymd.length >= 10 ? ymd.slice(8, 10) + '/' + ymd.slice(5, 7) : '—');

const VISOES: Array<{ v: string; label: string }> = [
  { v: 'vendas', label: 'Por pedido' },
  { v: 'repasses', label: 'Repasses no banco' },
  { v: 'eventos', label: 'Taxas e ocorrências' },
];

export function FinanceiroIfoodClient({
  filiais,
  inicial,
  de: deInicial,
  ate: ateInicial,
  podeGravar,
}: {
  filiais: Array<{ id: string; nome: string }>;
  inicial: string;
  de: string;
  ate: string;
  podeGravar: boolean;
}) {
  const [filialId, setFilialId] = useState(inicial);
  const [de, setDe] = useState(deInicial);
  const [ate, setAte] = useState(ateInicial);
  const [visao, setVisao] = useState('vendas');
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [soProblema, setSoProblema] = useState(false);

  const carregar = useCallback(async (id: string, v: string, d: string, a: string) => {
    if (!id) return;
    setCarregando(true);
    setErro(null);
    try {
      const q = new URLSearchParams({ filialId: id, visao: v, de: d, ate: a });
      const r = await fetch('/api/ifood/financeiro?' + q.toString(), { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error ?? `Erro ${r.status}`); setDados(null); return; }
      setDados(j);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(filialId, visao, de, ate); }, [filialId, visao, de, ate, carregar]);

  async function gravarLiquido() {
    if (!confirm('Gravar o líquido que o iFood informou nas contas a receber AINDA ABERTAS deste período?')) return;
    setGravando(true);
    try {
      const r = await fetch('/api/ifood/financeiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, de, ate }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.error ?? `Erro ${r.status}`); return; }
      alert(`${j.gravados} ${j.gravados === 1 ? 'lançamento atualizado' : 'lançamentos atualizados'}.`);
      await carregar(filialId, visao, de, ate);
    } finally {
      setGravando(false);
    }
  }

  const vendas = dados?.vendas ?? [];
  const mostradas = soProblema ? vendas.filter((v) => v.problema) : vendas;
  const r = dados?.resumo;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">
          Casa
          <select
            className="mt-0.5 block rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
            value={filialId}
            onChange={(e) => setFilialId(e.target.value)}
          >
            {filiais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          De
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)}
            className="mt-0.5 block rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900" />
        </label>
        <label className="text-xs text-slate-500">
          Até
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)}
            className="mt-0.5 block rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900" />
        </label>
        <button
          onClick={() => carregar(filialId, visao, de, ate)}
          disabled={carregando}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40"
        >
          {carregando ? 'lendo…' : 'Recarregar'}
        </button>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {VISOES.map((x) => (
          <button
            key={x.v}
            onClick={() => setVisao(x.v)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              visao === x.v ? 'border-rose-500 font-semibold text-rose-700' : 'border-transparent text-slate-500'
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {erro && <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{erro}</p>}

      {visao === 'vendas' && r && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { t: 'Bruto (online)', v: reais(r.bruto), s: `${r.pedidosOnline} pedidos` },
              { t: 'Comissão iFood', v: '- ' + reais(r.comissao), s: 'inclui comissão de entrega' },
              { t: 'Taxa de cartão', v: '- ' + reais(r.taxaCartao), s: r.promoLoja ? 'promoção da casa: ' + reais(r.promoLoja) : '' },
              { t: 'Sobra pra casa', v: reais(r.liquido), s: r.bruto ? (100 * r.liquido / r.bruto).toFixed(1) + '% do bruto' : '' },
            ].map((c) => (
              <div key={c.t} className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-500">{c.t}</p>
                <p className="mt-0.5 text-lg font-semibold text-slate-900">{c.v}</p>
                {c.s && <p className="text-xs text-slate-400">{c.s}</p>}
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-500">
            {r.cancelados} {r.cancelados === 1 ? 'cancelado' : 'cancelados'} e {r.naEntrega} pago
            {r.naEntrega === 1 ? '' : 's'} na entrega ficam fora da soma — dinheiro de pagamento na
            entrega já está no caixa da casa, somar contaria duas vezes.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            {!!dados?.comProblema && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4" checked={soProblema} onChange={(e) => setSoProblema(e.target.checked)} />
                só os com problema ({dados.comProblema})
              </label>
            )}
            {podeGravar && !!dados?.semLiquidoGravado && (
              <button
                onClick={gravarLiquido}
                disabled={gravando}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {gravando ? 'gravando…' : `Gravar o líquido em ${dados.semLiquidoGravado} lançamento(s)`}
              </button>
            )}
          </div>

          {!!dados?.comProblema && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <b>{dados.comProblema} {dados.comProblema === 1 ? 'pedido' : 'pedidos'} sem contrapartida certa no Concilia.</b>{' '}
              Pedido do iFood sem conta a receber significa repasse caindo no banco sem lançamento —
              o dinheiro entra e não aparece no controle.
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Pedido</th>
                  <th className="px-3 py-2">Pagamento</th>
                  <th className="px-3 py-2 text-right">Bruto</th>
                  <th className="px-3 py-2 text-right">Comissão</th>
                  <th className="px-3 py-2 text-right">Cartão</th>
                  <th className="px-3 py-2 text-right">Sobra</th>
                  <th className="px-3 py-2">Repasse</th>
                  <th className="px-3 py-2">No Concilia</th>
                </tr>
              </thead>
              <tbody>
                {mostradas.map((v) => (
                  <tr key={v.orderId} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-900">#{v.displayId || '—'}</span>
                      <span className="block text-xs text-slate-400">{dia(v.data)}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {v.metodo || '—'}
                      <span className="block text-xs text-slate-400">
                        {v.tipoPagamento === 'OFFLINE' ? 'na entrega' : 'pelo iFood'}
                        {v.status === 'CANCELLED' ? ' · cancelado' : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-900">{reais(v.bruto)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{reais(v.comissao + v.comissaoEntrega)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{reais(v.taxaCartao)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{reais(v.liquido)}</td>
                    <td className="px-3 py-2 text-slate-600">{dia(v.repasseEm)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        v.lancamento === 'sem lançamento' ? 'bg-rose-100 text-rose-800'
                          : v.lancamento === 'recebido' ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                      }`}>
                        {v.lancamento}
                      </span>
                      {v.problema && <span className="block text-xs text-rose-600">{v.problema}</span>}
                      {v.brutoConcilia != null && Math.abs(v.brutoConcilia - v.bruto) > 0.01 && (
                        <span className="block text-xs text-slate-400">Concilia: {reais(v.brutoConcilia)}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {mostradas.length === 0 && !carregando && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">nenhum pedido no período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {visao === 'repasses' && dados?.itens && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Saldo do período</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-900">{reais(dados.saldo ?? 0)}</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Pagamento</th>
                  <th className="px-3 py-2">Cálculo</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2">Situação</th>
                  <th className="px-3 py-2">Conta</th>
                </tr>
              </thead>
              <tbody>
                {dados.itens.map((i, n) => (
                  <tr key={n} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-medium text-slate-900">{dia(i.pagoEm)}</td>
                    <td className="px-3 py-2 text-slate-600">{dia(i.calculoDe)} a {dia(i.calculoAte)}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {i.tipo || '—'}
                      {i.produto && <span className="block text-xs text-slate-400">{i.produto}</span>}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${i.valor < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                      {reais(i.valor)}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{i.situacao || '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {i.banco || '—'}{i.conta ? ' · ' + i.conta : ''}
                    </td>
                  </tr>
                ))}
                {dados.itens.length === 0 && !carregando && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">nenhum repasse no período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {visao === 'eventos' && dados?.eventos && (
        <>
          {dados.temMais && (
            <p className="text-xs text-amber-700">
              O período tem mais eventos do que uma leitura cabe. Aperte o intervalo pra ver o resto.
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Evento</th>
                  <th className="px-3 py-2">Quando</th>
                  <th className="px-3 py-2">Referência</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2">Repasse</th>
                </tr>
              </thead>
              <tbody>
                {dados.eventos.map((e, n) => (
                  <tr key={n} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-900">{e.descricao || e.nome}</span>
                      {e.percentual && <span className="block text-xs text-slate-400">{e.percentual}%</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{dia((e.quando || '').slice(0, 10))}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {e.refTipo || '—'}
                      {e.refId && <span className="block">{e.refId.slice(0, 8)}…</span>}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${e.valor < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                      {reais(e.valor)}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {e.mexeNoRepasse ? dia(e.repasseEm) : <span className="text-xs text-slate-400">não mexe</span>}
                    </td>
                  </tr>
                ))}
                {dados.eventos.length === 0 && !carregando && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">nenhum evento no período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

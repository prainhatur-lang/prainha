'use client';

// "Paga por outra casa" (pedido do dono 20/10/2026): a conta é desta casa, mas
// quem pagou foi outra (Pix de outro banco, cartão, dinheiro...). Entra no
// encontro de contas do mês do pagamento e, marcado, já dá a baixa na conta.
// Boleto pago pelo Inter de outra casa continua em /financeiro/boletos-inter.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { hojeBr } from '@/lib/datas';
import { brl, parseValorBr } from '@/lib/format';

const FORMAS = ['Pix', 'Boleto', 'Transferência', 'Cartão', 'Dinheiro', 'Outro'] as const;

export type LancamentoOutraCasa = {
  id: string;
  data: string;
  competencia: string;
  valor: string;
  descricao: string | null;
  status: string;
  origem: string;
  pagadora: string;
};

const dataBr = (ymd: string) => ymd.split('-').reverse().join('/');
const mesBr = (comp: string) => comp.split('-').reverse().join('/');

export function PagaOutraCasa({
  contaId,
  casas,
  saldo,
  valorConta,
  podeBaixar,
  lancamentos,
}: {
  contaId: string;
  /** casas que o usuário acessa, menos a da conta */
  casas: Array<{ id: string; nome: string }>;
  saldo: number;
  valorConta: number;
  /** a conta aceita baixa aqui (não é do Consumer ativo) e tem saldo */
  podeBaixar: boolean;
  lancamentos: LancamentoOutraCasa[];
}) {
  const router = useRouter();
  const ativo = lancamentos.find((l) => l.status !== 'CANCELADO');
  const [aberto, setAberto] = useState(false);
  const [casa, setCasa] = useState(casas[0]?.id ?? '');
  const [data, setData] = useState(hojeBr());
  const [valor, setValor] = useState((saldo > 0.005 ? saldo : valorConta).toFixed(2).replace('.', ','));
  const [forma, setForma] = useState<(typeof FORMAS)[number]>('Pix');
  const [observacao, setObservacao] = useState('');
  const [darBaixa, setDarBaixa] = useState(podeBaixar);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function lancar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const v = parseValorBr(valor);
    if (v == null || v <= 0) return setErro('Valor inválido — digite como 1.250,00 ou 1250.');
    if (!casa) return setErro('Escolha a casa que pagou.');
    setOcupado(true);
    try {
      const r = await fetch(`/api/financeiro/contas/${contaId}/paga-outra-casa`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialPagadoraId: casa,
          data,
          valor: v,
          forma,
          observacao: observacao.trim() || null,
          darBaixa: podeBaixar && darBaixa,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErro(d.error ?? `HTTP ${r.status}`);
      setAberto(false);
      setObservacao('');
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  async function desfazer(id: string) {
    if (!confirm('Tirar esse pagamento do encontro de contas? Se teve baixa, estorne no histórico de pagamentos.')) return;
    setOcupado(true);
    const r = await fetch(`/api/financeiro/contas/${contaId}/paga-outra-casa?pagamentoId=${id}`, { method: 'DELETE' });
    setOcupado(false);
    if (r.ok) router.refresh();
    else alert((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
  }

  if (casas.length === 0 && lancamentos.length === 0) return null;

  return (
    <div className="mt-5 rounded-xl border border-violet-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Paga por outra casa</h2>
        {!ativo && casas.length > 0 && !aberto && (
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-100"
          >
            🏠 Paga por outra casa
          </button>
        )}
      </div>

      {lancamentos.length > 0 && (
        <table className="mt-2 w-full text-xs">
          <tbody>
            {lancamentos.map((l) => (
              <tr key={l.id} className={`border-t border-slate-100 first:border-t-0 ${l.status === 'CANCELADO' ? 'text-slate-400 line-through' : ''}`}>
                <td className="py-1.5 pr-3 whitespace-nowrap">{dataBr(l.data)}</td>
                <td className="py-1.5 pr-3">
                  pela <b>{l.pagadora}</b>
                  {l.origem === 'INTER_BOLETO' && ' (Inter)'}
                  <span className="block text-[10px] text-slate-400">{l.descricao}</span>
                </td>
                <td className="py-1.5 pr-3 text-right font-mono whitespace-nowrap">{brl(Number(l.valor))}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {l.status === 'ABERTO' ? (
                    <Link
                      href={`/movimento/transferencias/encontro?comp=${l.competencia}`}
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 no-underline hover:underline"
                    >
                      encontro de {mesBr(l.competencia)} (aberto)
                    </Link>
                  ) : l.status === 'COMPENSADO' ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                      compensado em {mesBr(l.competencia)}
                    </span>
                  ) : (
                    <span className="text-[10px]">desfeito</span>
                  )}
                </td>
                <td className="py-1.5 text-right">
                  {l.status === 'ABERTO' && (
                    <button
                      type="button"
                      onClick={() => desfazer(l.id)}
                      disabled={ocupado}
                      className="text-[10px] text-rose-600 hover:underline disabled:opacity-50"
                    >
                      desfazer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!ativo && lancamentos.length === 0 && !aberto && (
        <p className="mt-1 text-[11px] text-slate-500">
          A conta é desta casa, mas outra casa pagou? Lance aqui: ela entra no encontro de contas do mês do pagamento.
        </p>
      )}

      {aberto && (
        <form onSubmit={lancar} className="mt-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] text-slate-400">Casa que pagou</label>
              <select
                value={casa}
                onChange={(e) => setCasa(e.target.value)}
                className="mt-0.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
              >
                {casas.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-400">Data do pagamento</label>
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="mt-0.5 rounded-md border border-slate-300 px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400">Valor pago (R$)</label>
              <input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                className="mt-0.5 w-28 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400">Como pagou</label>
              <select
                value={forma}
                onChange={(e) => setForma(e.target.value as (typeof FORMAS)[number])}
                className="mt-0.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
              >
                {FORMAS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div className="min-w-40 flex-1">
              <label className="block text-[10px] text-slate-400">Observação</label>
              <input
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Ex.: Pix do Itaú do Bar"
                className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
              />
            </div>
          </div>
          {podeBaixar ? (
            <label className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600">
              <input type="checkbox" checked={darBaixa} onChange={(e) => setDarBaixa(e.target.checked)} />
              Dar baixa nesta conta também (saldo {brl(saldo)}; o que passar do saldo vai como juros)
            </label>
          ) : (
            <p className="mt-2 text-[11px] text-slate-500">
              Só lança no encontro: a conta já está paga ou a baixa dela é no Consumer.
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={ocupado}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {ocupado ? 'Lançando...' : 'Lançar no encontro de contas'}
            </button>
            <button type="button" onClick={() => setAberto(false)} className="text-xs text-slate-500 hover:underline">
              cancelar
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-slate-400">
            Entra no encontro do mês da data do pagamento: esta casa fica devendo o valor pra casa que pagou.
          </p>
          {erro && <p className="mt-1.5 text-[11px] text-rose-700">{erro}</p>}
        </form>
      )}
    </div>
  );
}

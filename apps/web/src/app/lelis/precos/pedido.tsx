'use client';

// Pedido SEM NOTA pras casas (06/11/2026): os itens marcados em "Vender (qtd)"
// vão pra uma casa sem emitir NF-e. Baixa o estoque da Lelis, lança o a receber
// da Lelis e a conta a pagar na casa. A nota sai depois.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { hojeBr } from '@/lib/datas';
import type { ProdutoLinha } from './manager';

interface ItemPedido {
  produto: ProdutoLinha;
  quantidade: number;
  precoEmpresa: number | null;
  precoAtual: number | null;
}

interface PedidoLista {
  id: string;
  numero: number;
  casa: string;
  status: string;
  total: number;
  vencimento: string;
  observacao: string | null;
  criadoEmBr: string;
  casa_pagou: boolean | null;
  lelis_recebeu: boolean | null;
  itens: { descricao: string; quantidade: number; preco_unit: number; total: number }[];
}

const CASAS = [
  { id: '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9', nome: 'Prainha Bar' },
  { id: 'e899dae2-38bf-4f3f-9149-7effd059fab8', nome: 'Prainha Mar' },
  { id: 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7', nome: 'Tabuará' },
];

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (s: string) => s.split('-').reverse().join('/');
const r2 = (n: number) => Math.round(n * 100) / 100;

export function PedidoSemNota({ itens, onLimpar }: { itens: ItemPedido[]; onLimpar: () => void }) {
  const [casa, setCasa] = useState('');
  const [base, setBase] = useState<'empresa' | 'atual'>('empresa');
  const [precos, setPrecos] = useState<Record<string, string>>({});
  const [venc, setVenc] = useState(hojeBr());
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pedidos, setPedidos] = useState<PedidoLista[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch('/api/lelis/pedido');
    const js = await r.json().catch(() => ({}));
    if (r.ok) setPedidos(js.pedidos ?? []);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const linhas = useMemo(
    () =>
      itens.map((i) => {
        const sugerido = (base === 'empresa' ? i.precoEmpresa : i.precoAtual) ?? i.precoAtual ?? 0;
        const digitado = precos[i.produto.id];
        const preco = digitado != null && digitado !== '' ? Number(digitado.replace(',', '.')) : r2(sugerido);
        return { ...i, preco: Number.isFinite(preco) ? preco : 0, sugerido: r2(sugerido) };
      }),
    [itens, base, precos],
  );
  const total = r2(linhas.reduce((s, l) => s + r2(l.quantidade * l.preco), 0));

  async function enviar() {
    setMsg(null);
    if (!casa) return setMsg({ tipo: 'erro', texto: 'Escolha a casa que recebe.' });
    if (linhas.some((l) => !(l.preco > 0))) return setMsg({ tipo: 'erro', texto: 'Tem item sem preço.' });
    const nome = CASAS.find((c) => c.id === casa)?.nome;
    if (!confirm(`Mandar ${linhas.length} item(ns) pra ${nome} sem nota, total ${brl(total)}?\n\nBaixa o estoque da Lelis, lança o a receber e a conta a pagar na casa.`)) return;
    setOcupado(true);
    const r = await fetch('/api/lelis/pedido', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        destinoId: casa,
        vencimento: venc,
        observacao: obs.trim() || null,
        itens: linhas.map((l) => ({ produtoId: l.produto.id, quantidade: l.quantidade, precoUnit: l.preco })),
      }),
    });
    const js = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) return setMsg({ tipo: 'erro', texto: js.error ?? 'erro ao gravar o pedido' });
    setMsg({ tipo: 'ok', texto: `Pedido nº ${js.numero} gravado: ${brl(js.total)} a receber de ${nome}, conta a pagar lançada lá.` });
    setPrecos({});
    setObs('');
    onLimpar();
    void carregar();
  }

  async function cancelar(p: PedidoLista) {
    if (!confirm(`Cancelar o pedido nº ${p.numero} (${p.casa}, ${brl(p.total)})?\n\nO estoque volta pra Lelis e a conta da casa é apagada.`)) return;
    const r = await fetch(`/api/lelis/pedido?id=${p.id}`, { method: 'DELETE' });
    const js = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg({ tipo: 'erro', texto: js.error ?? 'erro ao cancelar' });
    setMsg({ tipo: 'ok', texto: `Pedido nº ${p.numero} cancelado.` });
    void carregar();
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-white p-4 text-sm">
      <h2 className="text-base font-semibold text-slate-900">Pedido sem nota pras casas</h2>
      <p className="mt-1 text-xs text-slate-500">
        Usa os mesmos itens marcados em “Vender (qtd)”. Não emite NF-e: baixa o estoque da Lelis, lança o valor a receber
        da casa aqui na Lelis e a conta a pagar lá na casa (fornecedor Lelis). A nota pode sair depois.
      </p>

      {msg && (
        <p className={`mt-3 rounded-lg border p-2 text-sm ${msg.tipo === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {msg.texto}
        </p>
      )}

      {linhas.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">Marque a quantidade na coluna “Vender (qtd)” da tabela pra montar o pedido.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs text-slate-500">Casa que recebe</span>
              <select value={casa} onChange={(e) => setCasa(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5">
                <option value="">— escolha —</option>
                {CASAS.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Preço</span>
              <select value={base} onChange={(e) => { setBase(e.target.value as 'empresa' | 'atual'); setPrecos({}); }} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5">
                <option value="empresa">Pra empresa</option>
                <option value="atual">Preço da tabela</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Casa paga até</span>
              <input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5" />
            </label>
            <label className="block min-w-[200px] flex-1">
              <span className="text-xs text-slate-500">Observação</span>
              <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ex.: 3 caixas pro evento" className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5" />
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-2">Item</th>
                  <th className="py-1 pr-2 text-right">Qtd</th>
                  <th className="py-1 pr-2 text-right">Preço un.</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.produto.id} className="border-t border-slate-100">
                    <td className="py-1 pr-2">{l.produto.descricao}</td>
                    <td className="py-1 pr-2 text-right">{l.quantidade} {l.produto.unidade}</td>
                    <td className="py-1 pr-2 text-right">
                      <input
                        value={precos[l.produto.id] ?? l.sugerido.toFixed(2).replace('.', ',')}
                        onChange={(e) => setPrecos((p) => ({ ...p, [l.produto.id]: e.target.value }))}
                        className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right"
                      />
                    </td>
                    <td className="py-1 text-right">{brl(r2(l.quantidade * l.preco))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-300 font-medium">
                  <td className="py-1" colSpan={3}>Total do pedido</td>
                  <td className="py-1 text-right">{brl(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <button onClick={enviar} disabled={ocupado} className="rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
            {ocupado ? 'Gravando…' : 'Mandar sem nota'}
          </button>
        </div>
      )}

      {pedidos.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-medium text-slate-900">Pedidos sem nota</h3>
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 pr-2">Nº</th>
                <th className="py-1 pr-2">Data</th>
                <th className="py-1 pr-2">Casa</th>
                <th className="py-1 pr-2 text-right">Total</th>
                <th className="py-1 pr-2">Vence</th>
                <th className="py-1 pr-2">Situação</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => (
                <Fragment key={p.id}>
                  <tr className={`border-t border-slate-100 ${p.status === 'CANCELADO' ? 'text-slate-400 line-through' : ''}`}>
                    <td className="py-1 pr-2">
                      <button onClick={() => setAberto(aberto === p.id ? null : p.id)} className="text-sky-700 hover:underline">
                        {p.numero}
                      </button>
                    </td>
                    <td className="py-1 pr-2">{dataBr(p.criadoEmBr)}</td>
                    <td className="py-1 pr-2">{p.casa}</td>
                    <td className="py-1 pr-2 text-right">{brl(p.total)}</td>
                    <td className="py-1 pr-2">{dataBr(p.vencimento)}</td>
                    <td className="py-1 pr-2 text-xs">
                      {p.status === 'CANCELADO' ? 'cancelado' : p.lelis_recebeu ? 'recebido' : p.casa_pagou ? 'casa pagou' : 'a receber'}
                    </td>
                    <td className="py-1 text-right">
                      {p.status !== 'CANCELADO' && !p.casa_pagou && !p.lelis_recebeu && (
                        <button onClick={() => cancelar(p)} className="text-xs text-red-600 hover:underline">cancelar</button>
                      )}
                    </td>
                  </tr>
                  {aberto === p.id && (
                    <tr>
                      <td colSpan={7} className="bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        {p.itens.map((i, k) => (
                          <div key={k}>
                            {i.quantidade} × {i.descricao} a {brl(i.preco_unit)} = {brl(i.total)}
                          </div>
                        ))}
                        {p.observacao && <div className="mt-1 italic">{p.observacao}</div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

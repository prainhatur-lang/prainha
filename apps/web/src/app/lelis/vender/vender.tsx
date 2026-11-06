'use client';

// Tela de pedido da Lelis (saída pras casas). Consulta por nome/código de barras/
// fornecedor — mostra no máximo 30 resultados, nunca a lista inteira — e monta o
// pedido no carrinho. Grava em POST /api/lelis/pedido (mesmo fluxo do sem nota).

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hojeBr } from '@/lib/datas';

export interface ProdutoVenda {
  id: string;
  descricao: string;
  ean: string | null;
  fornecedor: string | null;
  unidade: string;
  saldo: number;
  preco: number | null;
}

interface Linha {
  produto: ProdutoVenda;
  qtd: string;
  preco: string;
}

interface PedidoLista {
  id: string;
  numero: number;
  casa: string;
  status: string;
  total: number;
  vencimento: string;
  criadoEmBr: string;
  casa_pagou: boolean | null;
  recebido_em?: string | null;
  itens: { descricao: string; quantidade: number }[];
}

const CASAS = [
  { id: '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9', nome: 'Prainha Bar' },
  { id: 'e899dae2-38bf-4f3f-9149-7effd059fab8', nome: 'Prainha Mar' },
  { id: 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7', nome: 'Tabuará' },
];

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const r2 = (n: number) => Math.round(n * 100) / 100;
const lerNum = (s: string) => Number(String(s).trim().replace(/\./g, '').replace(',', '.'));
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtP = (n: number) => n.toFixed(2).replace('.', ',');
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function VenderLelis({ produtos }: { produtos: ProdutoVenda[] }) {
  const [casa, setCasa] = useState('');
  const [busca, setBusca] = useState('');
  const [carrinho, setCarrinho] = useState<Linha[]>([]);
  const [venc, setVenc] = useState(hojeBr());
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string; pedidoId?: string } | null>(null);
  const [pedidos, setPedidos] = useState<PedidoLista[]>([]);
  const buscaRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const r = await fetch('/api/lelis/pedido');
    const js = await r.json().catch(() => ({}));
    if (r.ok) setPedidos(js.pedidos ?? []);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const resultados = useMemo(() => {
    const b = semAcento(busca.trim());
    if (b.length < 2) return [];
    const palavras = b.split(/\s+/);
    const out: ProdutoVenda[] = [];
    for (const p of produtos) {
      if (p.ean && p.ean === busca.trim()) return [p];
      const txt = semAcento(`${p.descricao} ${p.fornecedor ?? ''} ${p.ean ?? ''}`);
      if (palavras.every((w) => txt.includes(w))) out.push(p);
      if (out.length >= 30) break;
    }
    return out;
  }, [busca, produtos]);

  function adicionar(p: ProdutoVenda) {
    setMsg(null);
    setCarrinho((c) => {
      const i = c.findIndex((l) => l.produto.id === p.id);
      if (i >= 0) {
        const n = [...c];
        n[i] = { ...n[i]!, qtd: fmtQ((lerNum(n[i]!.qtd) || 0) + 1) };
        return n;
      }
      return [...c, { produto: p, qtd: '1', preco: p.preco != null ? fmtP(p.preco) : '' }];
    });
    setBusca('');
    buscaRef.current?.focus();
  }

  const calc = carrinho.map((l) => {
    const q = lerNum(l.qtd);
    const pr = lerNum(l.preco);
    const qOk = Number.isFinite(q) && q > 0 && q <= l.produto.saldo + 1e-9;
    const pOk = Number.isFinite(pr) && pr > 0;
    return { l, q, pr, qOk, pOk, total: qOk && pOk ? r2(q * pr) : 0 };
  });
  const total = r2(calc.reduce((s, c) => s + c.total, 0));
  const nomeCasa = CASAS.find((c) => c.id === casa)?.nome ?? '';

  async function enviar() {
    setMsg(null);
    if (!casa) return setMsg({ tipo: 'erro', texto: 'Escolha a casa que recebe.' });
    if (!calc.length) return setMsg({ tipo: 'erro', texto: 'O pedido está vazio.' });
    const ruim = calc.find((c) => !c.qOk || !c.pOk);
    if (ruim) return setMsg({ tipo: 'erro', texto: `${ruim.l.produto.descricao}: ${!ruim.qOk ? `quantidade inválida (tem ${fmtQ(ruim.l.produto.saldo)} no estoque)` : 'sem preço'}.` });
    if (!confirm(`Mandar ${calc.length} item(ns) pra ${nomeCasa}, total ${brl(total)}?\n\nSem nota: baixa o estoque da Lelis, fica a receber aqui e a conta a pagar em ${nomeCasa}. Lá eles conferem e dão entrada.`)) return;
    setOcupado(true);
    const r = await fetch('/api/lelis/pedido', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        destinoId: casa,
        vencimento: venc,
        observacao: obs.trim() || null,
        itens: calc.map((c) => ({ produtoId: c.l.produto.id, quantidade: c.q, precoUnit: c.pr })),
      }),
    });
    const js = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) return setMsg({ tipo: 'erro', texto: js.error ?? 'erro ao gravar o pedido' });
    setMsg({ tipo: 'ok', texto: `Pedido nº ${js.numero} pra ${nomeCasa}: ${brl(js.total)}. Já aparece em Transferências de ${nomeCasa} pra conferir.`, pedidoId: js.id });
    setCarrinho([]);
    setObs('');
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
    <div className="space-y-5">
      {/* 1. Casa */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">1. Pra qual casa</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {CASAS.map((c) => (
            <button
              key={c.id}
              onClick={() => setCasa(c.id)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                casa === c.id ? 'border-violet-700 bg-violet-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {c.nome}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Consulta */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">2. Consultar produto</div>
        <input
          ref={buscaRef}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && resultados.length === 1) adicionar(resultados[0]!);
          }}
          placeholder="Nome, código de barras ou fornecedor (Enter com 1 resultado já adiciona)"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
          autoFocus
        />
        {busca.trim().length >= 2 && (
          <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-slate-100">
            {resultados.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">Nada encontrado.</p>
            ) : (
              resultados.map((p) => (
                <button
                  key={p.id}
                  onClick={() => adicionar(p)}
                  disabled={p.saldo <= 0}
                  className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-violet-50 disabled:opacity-40"
                >
                  <span>
                    <span className="font-medium text-slate-800">{p.descricao}</span>
                    <span className="block text-xs text-slate-500">
                      {p.fornecedor ?? '—'}
                      {p.ean ? ` · ${p.ean}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    <span className="block font-semibold text-slate-800">{p.preco != null ? brl(p.preco) : 'sem preço'}</span>
                    <span className={p.saldo > 0 ? 'text-slate-500' : 'text-rose-600'}>
                      estoque {fmtQ(p.saldo)} {p.unidade}
                    </span>
                  </span>
                </button>
              ))
            )}
            {resultados.length >= 30 && <p className="p-2 text-center text-xs text-slate-400">Mostrando 30 — refine a busca.</p>}
          </div>
        )}
      </div>

      {/* 3. Pedido */}
      <div className="rounded-xl border border-violet-200 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          3. Pedido {nomeCasa && <>pra <span className="text-violet-700">{nomeCasa}</span></>}
        </div>
        {carrinho.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Consulte um produto acima e clique nele pra entrar no pedido.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-2">Produto</th>
                  <th className="py-1 pr-2 text-right">Estoque</th>
                  <th className="py-1 pr-2 text-right">Qtd</th>
                  <th className="py-1 pr-2 text-right">Preço un.</th>
                  <th className="py-1 pr-2 text-right">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {calc.map(({ l, qOk, pOk, total: t }, idx) => (
                  <tr key={l.produto.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-2">{l.produto.descricao}</td>
                    <td className="py-1.5 pr-2 text-right text-xs text-slate-500">{fmtQ(l.produto.saldo)} {l.produto.unidade}</td>
                    <td className="py-1.5 pr-2 text-right">
                      <input
                        value={l.qtd}
                        inputMode="decimal"
                        onChange={(e) => setCarrinho((c) => c.map((x, i) => (i === idx ? { ...x, qtd: e.target.value } : x)))}
                        className={`w-20 rounded border px-2 py-1 text-right ${qOk ? 'border-slate-300' : 'border-rose-400 bg-rose-50'}`}
                      />
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <input
                        value={l.preco}
                        inputMode="decimal"
                        onChange={(e) => setCarrinho((c) => c.map((x, i) => (i === idx ? { ...x, preco: e.target.value } : x)))}
                        className={`w-24 rounded border px-2 py-1 text-right ${pOk ? 'border-slate-300' : 'border-rose-400 bg-rose-50'}`}
                      />
                    </td>
                    <td className="py-1.5 pr-2 text-right font-semibold">{t ? brl(t) : '—'}</td>
                    <td className="py-1.5 text-right">
                      <button onClick={() => setCarrinho((c) => c.filter((_, i) => i !== idx))} className="text-xs text-rose-600 hover:underline">
                        tirar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200">
                  <td colSpan={4} className="py-2 pr-2 text-right text-slate-600">Total do pedido</td>
                  <td className="py-2 pr-2 text-right text-base font-bold">{brl(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="block">
            <span className="text-xs text-slate-500">Casa paga até</span>
            <input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
          <label className="block min-w-[220px] flex-1">
            <span className="text-xs text-slate-500">Observação</span>
            <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ex.: pro evento de sábado" className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
          <button
            onClick={enviar}
            disabled={ocupado || !carrinho.length}
            className="rounded-lg bg-violet-700 px-5 py-2.5 font-medium text-white hover:bg-violet-800 disabled:opacity-50"
          >
            {ocupado ? 'Gravando…' : `Fechar pedido${nomeCasa ? ` pra ${nomeCasa}` : ''}`}
          </button>
        </div>
        {msg && (
          <p className={`mt-3 rounded-lg border p-2 text-sm ${msg.tipo === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {msg.texto}
            {msg.pedidoId && (
              <>
                {' '}
                <Link href={`/lelis/pedido/${msg.pedidoId}`} className="font-medium text-sky-700 hover:underline">
                  Ver os itens / imprimir →
                </Link>
              </>
            )}
          </p>
        )}
      </div>

      {/* Saídas */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Pedidos que saíram</div>
        {pedidos.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nenhum pedido ainda.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <tbody>
              {pedidos.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 pr-2">
                    <Link href={`/lelis/pedido/${p.id}`} className="text-sky-700 hover:underline" title="Abrir o pedido inteiro">
                      nº {p.numero}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-2">{p.criadoEmBr}</td>
                  <td className="py-1.5 pr-2 font-medium">{p.casa}</td>
                  <td className="py-1.5 pr-2 text-xs text-slate-500">
                    {p.itens.slice(0, 3).map((i) => `${fmtQ(i.quantidade)} × ${i.descricao}`).join(' · ')}
                    {p.itens.length > 3 ? (
                      <Link href={`/lelis/pedido/${p.id}`} className="text-sky-700 hover:underline">{` · +${p.itens.length - 3}`}</Link>
                    ) : null}
                    <div className="mt-1">
                      <Link
                        href={`/lelis/pedido/${p.id}`}
                        className="inline-block rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-medium text-sky-700 hover:bg-sky-100"
                      >
                        Ver os {p.itens.length} itens / imprimir →
                      </Link>
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 text-right font-semibold">{brl(p.total)}</td>
                  <td className="py-1.5 pr-2 text-xs">
                    {p.status === 'CANCELADO' ? (
                      <span className="text-slate-400">cancelado</span>
                    ) : p.recebido_em ? (
                      <span className="text-emerald-700">casa conferiu</span>
                    ) : (
                      <span className="text-amber-700">aguardando conferência</span>
                    )}
                    {p.casa_pagou ? <span className="ml-1 text-emerald-700">· pago</span> : null}
                  </td>
                  <td className="py-1.5 text-right">
                    {p.status !== 'CANCELADO' && (
                      <button onClick={() => cancelar(p)} className="text-xs text-red-600 hover:underline">cancelar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

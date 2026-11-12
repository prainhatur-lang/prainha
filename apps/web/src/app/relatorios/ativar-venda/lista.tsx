'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PerguntaVenda, NegativoVenda } from '@/lib/ativar-venda';

type Canal = 'garcom' | 'cliente' | 'delivery';
type Estado = { garcom?: boolean; cliente?: boolean; delivery?: boolean; saiu?: boolean; msg?: string; erro?: boolean };

const brData = (ymd: string | null) => (ymd ? ymd.split('-').reverse().slice(0, 2).join('/') : '');
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function ListaAtivar(props: {
  filialId: string;
  perguntas: PerguntaVenda[];
  soDelivery: PerguntaVenda[];
  dispensados: PerguntaVenda[];
  negativos: NegativoVenda[];
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<Record<string, Estado>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const muda = (id: string, e: Estado) => setEstado((s) => ({ ...s, [id]: { ...s[id], ...e } }));

  async function ligarLoja(p: PerguntaVenda, canais: Canal[]): Promise<string | null> {
    const campos: Record<string, boolean> = {};
    if (canais.includes('garcom')) campos.comanda_mobile = true;
    if (canais.includes('cliente')) campos.cardapio_digital = true;
    if (Object.keys(campos).length === 0) return null;
    if (p.codigo == null) return 'produto sem código no PDV';
    const r = await fetch('/api/cadastros/produtos/alterar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ produtoId: p.produtoId, varianteCodigo: p.codigo, campos }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return j.erro || j.error || 'não deu pra ligar na loja';
    return null;
  }

  async function acaoNuvem(p: PerguntaVenda, acao: 'delivery' | 'dispensar' | 'perguntar'): Promise<string | null> {
    const r = await fetch('/api/estoque/ativar-venda', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acao, filialId: props.filialId, varianteId: p.varianteId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return j.erro || 'não deu pra gravar';
    return null;
  }

  async function ligar(p: PerguntaVenda, canais: Canal[]) {
    setOcupado(p.varianteId);
    const erros: string[] = [];
    const feito: Estado = {};
    try {
      const loja = canais.filter((c) => c !== 'delivery');
      if (loja.length > 0) {
        const e = await ligarLoja(p, loja);
        if (e) erros.push(e);
        else for (const c of loja) feito[c] = true;
      }
      if (canais.includes('delivery')) {
        const e = await acaoNuvem(p, 'delivery');
        if (e) erros.push(e);
        else feito.delivery = true;
      }
    } catch {
      erros.push('sem conexão');
    }
    muda(p.varianteId, {
      ...feito,
      erro: erros.length > 0,
      msg: erros.length > 0 ? erros.join(' · ') : 'Ligado.',
    });
    setOcupado(null);
  }

  async function dispensar(p: PerguntaVenda, voltar = false) {
    setOcupado(p.varianteId);
    let e: string | null = 'sem conexão';
    try {
      e = await acaoNuvem(p, voltar ? 'perguntar' : 'dispensar');
    } catch {}
    setOcupado(null);
    if (e) return muda(p.varianteId, { erro: true, msg: e });
    muda(p.varianteId, { saiu: true });
    if (voltar) router.refresh();
  }

  function Linha({ p, modo }: { p: PerguntaVenda; modo: 'pergunta' | 'delivery' | 'dispensado' }) {
    const e = estado[p.varianteId] ?? {};
    if (e.saiu) return null;
    const garcom = p.garcom || e.garcom || p.naFila.garcom;
    const cliente = p.cliente || e.cliente || p.naFila.cliente;
    const delivery = p.delivery === 'ativo' || e.delivery;
    const faltam: Canal[] = [];
    if (!garcom) faltam.push('garcom');
    if (!cliente) faltam.push('cliente');
    if (!delivery) faltam.push('delivery');
    const travado = ocupado === p.varianteId;
    const selo = (ligado: boolean, fila: boolean, nome: string, extra?: string) => (
      <span
        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
          ligado ? (fila ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800') : 'bg-slate-200 text-slate-600'
        }`}
      >
        {nome}: {ligado ? (fila ? 'ligando…' : 'ligado') : (extra ?? 'desligado')}
      </span>
    );
    const botao = 'rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-50';
    return (
      <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {p.nome}
            {p.tamanho ? <span className="font-normal text-slate-500"> · {p.tamanho}</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {p.categoria ?? 'sem categoria'} · {brl(p.preco)} · estoque {qtd(p.estoque)}
            {p.chegouEm ? ` · chegou em ${brData(p.chegouEm)}` : ''} ·{' '}
            <Link
              className="underline"
              href={`/relatorios/extrato-produto?filialId=${props.filialId}&produtoId=${p.estoqueProdutoId}`}
            >
              extrato
            </Link>
          </p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            {selo(garcom, !p.garcom && garcom, 'Garçom')}
            {selo(cliente, !p.cliente && cliente, 'Cliente (QR)')}
            {selo(!!delivery, false, 'Delivery', p.delivery === 'fora' ? 'não está' : 'desligado')}
          </p>
          {e.msg ? <p className={`mt-1 text-xs ${e.erro ? 'text-red-700' : 'text-emerald-700'}`}>{e.msg}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {modo === 'dispensado' ? (
            <button className={`${botao} border-slate-300 bg-white text-slate-700`} disabled={travado} onClick={() => dispensar(p, true)}>
              Voltar a perguntar
            </button>
          ) : (
            <>
              {faltam.length > 1 ? (
                <button className={`${botao} border-emerald-700 bg-emerald-700 text-white`} disabled={travado} onClick={() => ligar(p, faltam)}>
                  Ligar tudo
                </button>
              ) : null}
              {!garcom ? (
                <button className={`${botao} border-slate-300 bg-white text-slate-800`} disabled={travado} onClick={() => ligar(p, ['garcom'])}>
                  Ligar garçom
                </button>
              ) : null}
              {!cliente ? (
                <button className={`${botao} border-slate-300 bg-white text-slate-800`} disabled={travado} onClick={() => ligar(p, ['cliente'])}>
                  Ligar cliente
                </button>
              ) : null}
              {!delivery ? (
                <button className={`${botao} border-slate-300 bg-white text-slate-800`} disabled={travado} onClick={() => ligar(p, ['delivery'])}>
                  Ligar delivery
                </button>
              ) : null}
              <button className={`${botao} border-transparent text-slate-500 underline`} disabled={travado} onClick={() => dispensar(p)}>
                Deixar como está
              </button>
            </>
          )}
        </div>
      </li>
    );
  }

  const caixa = 'overflow-hidden rounded-lg border border-slate-200 bg-white';
  return (
    <div className="space-y-5">
      <div className={caixa}>
        <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">
          Ligar pra vender? ({props.perguntas.length})
        </h2>
        {props.perguntas.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            Nenhuma dúvida: tudo que recebeu estoque está ligado pro garçom e pro cliente.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {props.perguntas.map((p) => <Linha key={p.varianteId} p={p} modo="pergunta" />)}
          </ul>
        )}
      </div>

      {props.soDelivery.length > 0 ? (
        <details className={caixa}>
          <summary className="cursor-pointer bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">
            Vende no salão e não está no delivery ({props.soDelivery.length})
          </summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-200">
            {props.soDelivery.map((p) => <Linha key={p.varianteId} p={p} modo="delivery" />)}
          </ul>
        </details>
      ) : null}

      {props.negativos.length > 0 ? (
        <details className={caixa}>
          <summary className="cursor-pointer bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">
            Vendendo com estoque negativo — falta contar ({props.negativos.length})
          </summary>
          <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
            Saldo abaixo de zero é estoque que ninguém conferiu. Depois da contagem, o produto passa a sumir e voltar
            sozinho pelo saldo.
          </p>
          <ul className="divide-y divide-slate-100">
            {props.negativos.map((n) => (
              <li key={n.varianteId} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-800">{n.nome}</span>
                <span className="text-xs text-slate-500">
                  saldo {qtd(n.estoque)} ·{' '}
                  <Link className="underline" href={`/relatorios/extrato-produto?filialId=${props.filialId}&produtoId=${n.estoqueProdutoId}`}>
                    extrato
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {props.dispensados.length > 0 ? (
        <details className={caixa}>
          <summary className="cursor-pointer bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">
            Deixados como estão ({props.dispensados.length})
          </summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-200">
            {props.dispensados.map((p) => <Linha key={p.varianteId} p={p} modo="dispensado" />)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

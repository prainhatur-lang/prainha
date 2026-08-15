'use client';

// Conferência de recebimento do pedido: quem recebe marca item a item quanto
// chegou. Item faltando fica registrado e o valor cobrado-e-não-entregue vira
// aviso vermelho no pedido — pra cobrar o fornecedor com número na mão.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ItemPedido {
  id: string;
  produtoNome: string;
  quantidade: string;
  unidade: string;
  precoUnitario: string | null;
  quantidadeRecebida: string | null;
}

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function ConferirEntrega(props: { pedidoId: string; itens: ItemPedido[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [obs, setObs] = useState('');
  const [qtds, setQtds] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const i of props.itens) {
      // default: o que já foi conferido, senão a quantidade pedida (veio tudo)
      init[i.id] = String(Number(i.quantidadeRecebida ?? i.quantidade)).replace('.', ',');
    }
    return init;
  });

  function num(s: string): number {
    return Number(s.replace(/\./g, '').replace(',', '.'));
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const itens = props.itens.map((i) => {
        const q = num(qtds[i.id] ?? '');
        if (!Number.isFinite(q) || q < 0) {
          throw new Error(`Quantidade inválida em "${i.produtoNome}"`);
        }
        return { itemId: i.id, quantidadeRecebida: q };
      });
      const r = await fetch(`/api/compras/pedidos/${props.pedidoId}/receber`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itens, observacao: obs.trim() || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (Array.isArray(j.faltas) && j.faltas.length > 0) {
        alert(
          `Conferência salva. FALTOU:\n` +
            j.faltas
              .map(
                (f: { produto: string; faltou: number; unidade: string; valor: number }) =>
                  `- ${f.produto}: ${f.faltou.toLocaleString('pt-BR')} ${f.unidade} (${brl(f.valor)})`,
              )
              .join('\n') +
            `\n\nTotal cobrado e não entregue: ${brl(j.valorFaltante)} — cobre o fornecedor (reposição ou crédito).`,
        );
      } else {
        alert('Conferência salva: entrega completa ✓');
      }
      setAberto(false);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
      >
        📦 Conferir entrega
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border-2 border-sky-300 bg-sky-50/50 p-4">
      <p className="mb-2 text-xs text-slate-700">
        Marque quanto <strong>chegou de verdade</strong> de cada item (já vem preenchido como se
        tivesse vindo tudo — só corrija o que faltou; use 0 se não veio nada).
      </p>
      <div className="space-y-1.5">
        {props.itens.map((i) => {
          const recebida = num(qtds[i.id] ?? '');
          const pedida = Number(i.quantidade);
          const faltou = Number.isFinite(recebida) && recebida < pedida;
          return (
            <div key={i.id} className="flex items-center gap-2 text-xs">
              <span className="w-64 truncate font-medium text-slate-900">{i.produtoNome}</span>
              <span className="w-20 text-right text-slate-500">
                pedido: {Number(i.quantidade).toLocaleString('pt-BR')} {i.unidade}
              </span>
              <input
                value={qtds[i.id] ?? ''}
                onChange={(e) => setQtds((p) => ({ ...p, [i.id]: e.target.value }))}
                inputMode="decimal"
                className={`w-20 rounded border px-2 py-1 text-right ${
                  faltou ? 'border-rose-400 bg-rose-50 text-rose-800' : 'border-slate-300 bg-white'
                }`}
              />
              <button
                type="button"
                onClick={() => setQtds((p) => ({ ...p, [i.id]: '0' }))}
                className="rounded border border-rose-200 px-1.5 py-0.5 text-[10px] text-rose-600 hover:bg-rose-50"
                title="Não veio nada deste item"
              >
                não veio
              </button>
              {faltou && (
                <span className="text-[10px] font-semibold text-rose-700">
                  faltando {(pedida - recebida).toLocaleString('pt-BR')} {i.unidade}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="Observação (ex: Fasouto vai repor na terça)"
          className="w-72 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
        />
        <button
          onClick={salvar}
          disabled={salvando}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : 'Salvar conferência'}
        </button>
        <button
          onClick={() => setAberto(false)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
      {erro && <p className="mt-2 rounded bg-rose-100 p-2 text-xs text-rose-800">{erro}</p>}
    </div>
  );
}

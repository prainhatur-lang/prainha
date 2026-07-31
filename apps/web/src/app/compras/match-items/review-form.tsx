'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

interface Sugestao {
  produtoId: string;
  nome: string;
  categoria: string | null;
  unidade: string;
  score: number;
}

export function ReviewItemForm({
  item,
  sugestoes,
}: {
  item: {
    id: string;
    descricao: string;
    ean: string | null;
    codigoProdutoFornecedor: string | null;
    unidade: string | null;
    quantidade: string | null;
    valorUnitario: string | null;
    ncm: string | null;
    notaNumero: number | null;
    dataEmissao: string | null;
    fornecedorNome: string | null;
  };
  sugestoes: Sugestao[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [salvando, setSalvando] = useState(false);
  const [escondido, setEscondido] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<string | null>(
    sugestoes[0]?.produtoId ?? null,
  );

  async function linkar(produtoId: string) {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/nota-compra-item/${item.id}/produto`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ produtoId }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setEscondido(true);
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function rejeitar() {
    // Marcar como "nenhum bate" — pra agora, apenas esconde da review
    // (o item continua sem produto_id, vai cair na proxima rodada).
    // TODO: futuramente adicionar campo "match_rejected" na nota_compra_item
    setEscondido(true);
  }

  if (escondido) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* Cabecalho do item da NF */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-900">{item.descricao}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
            {item.fornecedorNome && <span>{item.fornecedorNome}</span>}
            {item.notaNumero && <span>NFe #{item.notaNumero}</span>}
            {item.dataEmissao && <span>{item.dataEmissao}</span>}
            {item.quantidade && (
              <span>
                Qtd: <strong>{item.quantidade} {item.unidade}</strong>
              </span>
            )}
            {item.valorUnitario && (
              <span>
                Unit: <strong>{brl(Number(item.valorUnitario))}</strong>
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
            {item.ean && <span>EAN: {item.ean}</span>}
            {item.codigoProdutoFornecedor && <span>cProd: {item.codigoProdutoFornecedor}</span>}
            {item.ncm && <span>NCM: {item.ncm}</span>}
          </div>
        </div>
      </div>

      {/* Sugestoes */}
      {sugestoes.length === 0 ? (
        <div className="mb-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
          Nenhuma sugestão encontrada no catálogo. Cadastre um produto novo ou pule.
        </div>
      ) : (
        <div className="space-y-1">
          {sugestoes.map((s) => {
            const confiancaCor =
              s.score >= 0.5
                ? 'border-emerald-300 bg-emerald-50'
                : s.score >= 0.3
                  ? 'border-sky-200 bg-sky-50'
                  : 'border-slate-200 bg-slate-50';
            return (
              <label
                key={s.produtoId}
                className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs ${
                  escolhido === s.produtoId
                    ? 'border-emerald-500 bg-emerald-50'
                    : confiancaCor
                }`}
              >
                <input
                  type="radio"
                  name={`item-${item.id}`}
                  checked={escolhido === s.produtoId}
                  onChange={() => setEscolhido(s.produtoId)}
                  className="h-3.5 w-3.5"
                />
                <span className="flex-1">
                  <span className="font-medium text-slate-900">{s.nome}</span>
                  {s.categoria && (
                    <span className="ml-2 text-[10px] text-slate-500">{s.categoria}</span>
                  )}
                </span>
                <span className="text-[10px] text-slate-500">/{s.unidade}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                    s.score >= 0.5
                      ? 'bg-emerald-200 text-emerald-900'
                      : s.score >= 0.3
                        ? 'bg-sky-200 text-sky-900'
                        : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {(s.score * 100).toFixed(0)}%
                </span>
              </label>
            );
          })}
        </div>
      )}

      {erro && (
        <div className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-800">{erro}</div>
      )}

      {/* Acoes */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={rejeitar}
          disabled={salvando || pending}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Nenhum desses — pular
        </button>
        <button
          type="button"
          onClick={() => escolhido && linkar(escolhido)}
          disabled={!escolhido || salvando || pending}
          className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {salvando ? 'Vinculando...' : 'Vincular'}
        </button>
      </div>
    </div>
  );
}

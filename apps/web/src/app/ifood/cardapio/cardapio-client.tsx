'use client';

import { useCallback, useEffect, useState } from 'react';

interface Item {
  id: string;
  nome: string;
  categoria: string;
  externalCode: string;
  status: string;
  preco: number;
  precoOriginal: number;
  problema: string;
}

interface Resposta {
  filial: { id: string; nome: string };
  codigoPdv: string;
  catalogo: { catalogId: string; contexto: string[] };
  itens: Item[];
  comProblema: number;
}

const reais = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function CardapioIfoodClient({
  filiais,
  inicial,
  podeEditar,
}: {
  filiais: Array<{ id: string; nome: string }>;
  inicial: string;
  podeEditar: boolean;
}) {
  const [filialId, setFilialId] = useState(inicial);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [soProblema, setSoProblema] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async (id: string) => {
    if (!id) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/ifood/cardapio?filialId=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.error ?? `Erro ${r.status}`); setDados(null); return; }
      setDados(d);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(filialId); }, [filialId, carregar]);

  async function mexer(item: Item, mudanca: { status?: string; preco?: number }) {
    setOcupado(item.id);
    try {
      const r = await fetch('/api/ifood/cardapio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, itemId: item.id, ...mudanca }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error ?? `Erro ${r.status}`); return; }
      await carregar(filialId);
    } finally {
      setOcupado(null);
    }
  }

  async function trocarPreco(item: Item) {
    const txt = prompt(`Novo preço de "${item.nome}" (hoje ${reais(item.preco)}):`, String(item.preco).replace('.', ','));
    if (txt == null) return;
    const v = Number(txt.replace(/\./g, '').replace(',', '.'));
    if (!(v > 0)) { alert('preço inválido'); return; }
    if (!confirm(`Mudar "${item.nome}" de ${reais(item.preco)} para ${reais(v)} no iFood?`)) return;
    await mexer(item, { preco: v });
  }

  const itens = dados?.itens ?? [];
  const mostrados = soProblema ? itens.filter((i) => i.problema) : itens;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
          value={filialId}
          onChange={(e) => setFilialId(e.target.value)}
        >
          {filiais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
        <button
          onClick={() => carregar(filialId)}
          disabled={carregando}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40"
        >
          {carregando ? 'lendo…' : 'Recarregar'}
        </button>
        {dados && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4" checked={soProblema} onChange={(e) => setSoProblema(e.target.checked)} />
            só os com problema ({dados.comProblema})
          </label>
        )}
      </div>

      {erro && <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{erro}</p>}

      {dados && (
        <>
          <p className="text-xs text-slate-500">
            catálogo {dados.catalogo.contexto.join(', ') || '—'} · {itens.length} itens · o código de PDV
            está sendo conferido contra o cadastro de <b>{dados.codigoPdv}</b>
          </p>

          {dados.comProblema > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <b>{dados.comProblema} {dados.comProblema === 1 ? 'item' : 'itens'} com código de PDV que não casa.</b>{' '}
              Pedido desses itens entra no Concilia mas não vira prato na cozinha. Corrija o código
              no Portal do Parceiro (ou cadastre o produto no Consumer).
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Categoria</th>
                  <th className="px-3 py-2">Código de PDV</th>
                  <th className="px-3 py-2 text-right">Preço</th>
                  <th className="px-3 py-2">Situação</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {mostrados.map((i) => (
                  <tr key={i.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 text-slate-900">{i.nome}</td>
                    <td className="px-3 py-2 text-slate-600">{i.categoria}</td>
                    <td className="px-3 py-2">
                      <span className={i.problema ? 'text-rose-700' : 'text-slate-600'}>
                        {i.externalCode || '—'}
                      </span>
                      {i.problema && <span className="block text-xs text-rose-600">{i.problema}</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-900">
                      {reais(i.preco)}
                      {i.precoOriginal > i.preco && (
                        <span className="block text-xs text-slate-400 line-through">{reais(i.precoOriginal)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        i.status === 'AVAILABLE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {i.status === 'AVAILABLE' ? 'no ar' : 'pausado'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {podeEditar && (
                        <>
                          <button
                            onClick={() => mexer(i, { status: i.status === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE' })}
                            disabled={ocupado === i.id}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-40"
                          >
                            {i.status === 'AVAILABLE' ? 'pausar' : 'voltar'}
                          </button>
                          <button
                            onClick={() => trocarPreco(i)}
                            disabled={ocupado === i.id}
                            className="ml-2 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-40"
                          >
                            preço
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {mostrados.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">nenhum item</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

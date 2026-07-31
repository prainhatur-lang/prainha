'use client';

import { useState } from 'react';

interface Item {
  id: string;
  produtoNome: string;
  categoria: string;
  quantidade: string;
  unidade: string;
  marcasAceitas: string[] | null;
  observacao: string | null;
}

interface RespostaInicial {
  precoUnitario: string;
  marca: string;
  observacao: string;
}

interface RespostaItem {
  precoUnitario: string;
  marca: string;
  observacao: string;
}

export function PreencherForm(props: {
  token: string;
  itens: Item[];
  respostasIniciais: Record<string, RespostaInicial>;
}) {
  const [respostas, setRespostas] = useState<Record<string, RespostaItem>>(() => {
    const init: Record<string, RespostaItem> = {};
    for (const i of props.itens) {
      init[i.id] = props.respostasIniciais[i.id] ?? { precoUnitario: '', marca: '', observacao: '' };
    }
    return init;
  });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  function setCampo(itemId: string, campo: keyof RespostaItem, valor: string) {
    setRespostas((prev) => ({ ...prev, [itemId]: { ...prev[itemId], [campo]: valor } }));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    const respArr = props.itens
      .map((i) => {
        const r = respostas[i.id];
        const preco = r.precoUnitario.trim().replace(',', '.');
        if (!preco) return null; // pula itens sem preço (= não tem)
        const num = Number(preco);
        if (!Number.isFinite(num) || num < 0) {
          throw new Error(`Preço inválido em "${i.produtoNome}"`);
        }
        return {
          cotacaoItemId: i.id,
          precoUnitario: num,
          marca: r.marca.trim() || null,
          observacao: r.observacao.trim() || null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (respArr.length === 0) {
      setErro('Preencha pelo menos 1 item, ou clique em "não tenho nada essa semana"');
      return;
    }

    setEnviando(true);
    try {
      const r = await fetch(`/api/cotacao/preencher/${props.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ respostas: respArr }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        setEnviando(false);
        return;
      }
      setSucesso(true);
    } catch (err) {
      setErro((err as Error).message);
      setEnviando(false);
    }
  }

  async function naoTemNada() {
    if (!confirm('Confirmar que você não tem nada pra cotar essa semana?')) return;
    setEnviando(true);
    try {
      const r = await fetch(`/api/cotacao/preencher/${props.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ respostas: [] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        setEnviando(false);
        return;
      }
      setSucesso(true);
    } catch (err) {
      setErro((err as Error).message);
      setEnviando(false);
    }
  }

  if (sucesso) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-sm font-semibold text-emerald-800">Resposta enviada. Obrigado!</p>
        <p className="mt-1 text-xs text-emerald-700">
          Pode fechar esta página. A Prainha vai entrar em contato sobre o pedido.
        </p>
      </div>
    );
  }

  // Agrupa por categoria
  const porCategoria: Record<string, Item[]> = {};
  for (const i of props.itens) {
    if (!porCategoria[i.categoria]) porCategoria[i.categoria] = [];
    porCategoria[i.categoria].push(i);
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      {Object.entries(porCategoria)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cat, lista]) => (
          <section key={cat} className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {cat}
            </h3>
            <div className="space-y-3">
              {lista.map((i) => (
                <div key={i.id} className="rounded-md border border-slate-100 p-3">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <div>
                      <span className="font-medium text-slate-900">{i.produtoNome}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        Quantidade: <strong>{i.quantidade} {i.unidade}</strong>
                      </span>
                    </div>
                    {i.marcasAceitas && i.marcasAceitas.length > 0 && (
                      <div className="text-[10px] text-slate-500">
                        Marcas aceitas: {i.marcasAceitas.join(' / ')}
                      </div>
                    )}
                  </div>
                  {i.observacao && (
                    <p className="mb-2 rounded bg-slate-50 p-1.5 text-[11px] text-slate-700">
                      {i.observacao}
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700">
                        Preço unitário (R$ / {i.unidade})
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="ex: 12,50"
                        value={respostas[i.id]?.precoUnitario ?? ''}
                        onChange={(e) => setCampo(i.id, 'precoUnitario', e.target.value)}
                        className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700">
                        Marca {i.marcasAceitas?.length ? '(uma das aceitas)' : ''}
                      </label>
                      <input
                        type="text"
                        list={i.marcasAceitas?.length ? `marcas-${i.id}` : undefined}
                        placeholder={i.marcasAceitas?.[0] ?? 'opcional'}
                        value={respostas[i.id]?.marca ?? ''}
                        onChange={(e) => setCampo(i.id, 'marca', e.target.value)}
                        className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                      {i.marcasAceitas?.length ? (
                        <datalist id={`marcas-${i.id}`}>
                          {i.marcasAceitas.map((m) => <option key={m} value={m} />)}
                        </datalist>
                      ) : null}
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700">
                        Observação
                      </label>
                      <input
                        type="text"
                        placeholder="opcional"
                        value={respostas[i.id]?.observacao ?? ''}
                        onChange={(e) => setCampo(i.id, 'observacao', e.target.value)}
                        className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

      {erro && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {erro}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={naoTemNada}
          disabled={enviando}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Não tenho nada essa semana
        </button>
        <button
          type="submit"
          disabled={enviando}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {enviando ? 'Enviando...' : 'Enviar respostas'}
        </button>
      </div>
    </form>
  );
}

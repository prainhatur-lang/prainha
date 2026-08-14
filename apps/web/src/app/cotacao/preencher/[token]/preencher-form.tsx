'use client';

import { useState } from 'react';

interface Item {
  id: string;
  produtoNome: string;
  categoria: string;
  quantidade: string;
  unidade: string;
  marcasAceitas: string[] | null;
  embalagemEsperada: string | null;
  classificacao: string | null;
  observacao: string | null;
}

interface RespostaInicial {
  precoUnitario: string;
  marca: string;
  embalagem: string;
  qtdPorEmbalagem: string;
  observacao: string;
}

type RespostaItem = RespostaInicial;

const VAZIA: RespostaItem = {
  precoUnitario: '',
  marca: '',
  embalagem: '',
  qtdPorEmbalagem: '',
  observacao: '',
};

/** Máscara de moeda: o fornecedor digita 1749 e vira 17,49. Era daqui que saía
 *  preço 100x errado — "1749" entrava como mil setecentos e quarenta e nove. */
function mascaraMoeda(valor: string): string {
  const digitos = valor.replace(/\D/g, '').slice(0, 11);
  if (!digitos) return '';
  const n = Number(digitos) / 100;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function moedaParaNumero(valor: string): number {
  const limpo = valor.replace(/\./g, '').replace(',', '.');
  return Number(limpo);
}

export function PreencherForm(props: {
  token: string;
  itens: Item[];
  respostasIniciais: Record<string, RespostaInicial>;
}) {
  const [respostas, setRespostas] = useState<Record<string, RespostaItem>>(() => {
    const init: Record<string, RespostaItem> = {};
    for (const i of props.itens) {
      init[i.id] = props.respostasIniciais[i.id] ?? { ...VAZIA };
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

    // Marca é OBRIGATÓRIA em item com preço: a casa não compra marca qualquer.
    // Quando o item tem marcas aceitas, o campo vira lista fechada (select).
    const semMarca = props.itens.filter(
      (i) => respostas[i.id]?.precoUnitario.trim() && !respostas[i.id]?.marca.trim(),
    );
    if (semMarca.length > 0) {
      setErro(
        `Informe a marca de: ${semMarca.map((i) => i.produtoNome).join(', ')}. ` +
          'Se não tiver a marca, deixe o preço em branco.',
      );
      return;
    }

    // Embalagem é obrigatória SÓ quando o item pede embalagem específica
    // (fardo, caixa, balde). Em item vendido na unidade do pedido (ex.:
    // bebidas por garrafa) o campo é opcional — exigir em 35 garrafas fez o
    // Fasouto travar no envio da cotação de bebidas e desistir sem gravar.
    const semEmbalagem = props.itens.filter(
      (i) =>
        i.embalagemEsperada &&
        respostas[i.id]?.precoUnitario.trim() &&
        !respostas[i.id]?.embalagem.trim(),
    );
    if (semEmbalagem.length > 0) {
      setErro(
        `Diga em que embalagem você vende: ${semEmbalagem.map((i) => i.produtoNome).join(', ')}.`,
      );
      return;
    }

    const respArr = props.itens
      .map((i) => {
        const r = respostas[i.id];
        if (!r.precoUnitario.trim()) return null; // sem preço = não tem o item
        const num = moedaParaNumero(r.precoUnitario);
        if (!Number.isFinite(num) || num <= 0) {
          throw new Error(`Preço inválido em "${i.produtoNome}"`);
        }
        // Quanto vem na embalagem, na unidade do pedido (kg/un/l).
        // Vazio = ele vende na mesma unidade do pedido (fator 1).
        const fator = r.qtdPorEmbalagem.trim()
          ? moedaParaNumero(r.qtdPorEmbalagem)
          : 1;
        if (!Number.isFinite(fator) || fator <= 0) {
          throw new Error(`Quantidade por embalagem inválida em "${i.produtoNome}"`);
        }
        return {
          cotacaoItemId: i.id,
          precoUnitario: num,
          marca: r.marca.trim() || null,
          embalagem: r.embalagem.trim() || null,
          qtdPorEmbalagem: fator,
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
                      {i.classificacao && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                          {i.classificacao}
                        </span>
                      )}
                      <span className="ml-2 text-xs text-slate-500">
                        Quero: <strong>{i.quantidade} {i.embalagemEsperada ?? i.unidade}</strong>
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
                        Você vende em qual embalagem?{' '}
                        {i.embalagemEsperada ? <span className="text-rose-600">*</span> : <span className="text-slate-400">(opcional)</span>}
                      </label>
                      <input
                        type="text"
                        placeholder={i.embalagemEsperada ?? 'ex: caixa, fardo, balde, unidade'}
                        value={respostas[i.id]?.embalagem ?? ''}
                        onChange={(e) => setCampo(i.id, 'embalagem', e.target.value)}
                        className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700">
                        Quanto vem nela? ({i.unidade})
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder={`ex: 18 (deixe vazio se vende por ${i.unidade})`}
                        value={respostas[i.id]?.qtdPorEmbalagem ?? ''}
                        onChange={(e) => setCampo(i.id, 'qtdPorEmbalagem', e.target.value)}
                        className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700">
                        Preço da embalagem (R$) <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="0,00"
                        value={respostas[i.id]?.precoUnitario ?? ''}
                        onChange={(e) =>
                          setCampo(i.id, 'precoUnitario', mascaraMoeda(e.target.value))
                        }
                        className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                      {respostas[i.id]?.precoUnitario && respostas[i.id]?.qtdPorEmbalagem && (
                        <p className="mt-0.5 text-[10px] text-emerald-700">
                          ={' '}
                          {(
                            moedaParaNumero(respostas[i.id].precoUnitario) /
                            (moedaParaNumero(respostas[i.id].qtdPorEmbalagem) || 1)
                          ).toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                            maximumFractionDigits: 4,
                          })}{' '}
                          por {i.unidade}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700">
                        Marca <span className="text-rose-600">*</span>{' '}
                        {i.marcasAceitas?.length ? '(só as aceitas)' : ''}
                      </label>
                      {i.marcasAceitas?.length ? (
                        // Lista fechada: item com marca definida não aceita substituto
                        <select
                          value={respostas[i.id]?.marca ?? ''}
                          onChange={(e) => setCampo(i.id, 'marca', e.target.value)}
                          className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                        >
                          <option value="">selecione…</option>
                          {i.marcasAceitas.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder="obrigatório"
                          value={respostas[i.id]?.marca ?? ''}
                          onChange={(e) => setCampo(i.id, 'marca', e.target.value)}
                          className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                        />
                      )}
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

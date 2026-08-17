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
  /** Pré-definições da tabela de conversões (produto_embalagem): o fornecedor
   *  escolhe "fardo 30 kg" / "caixa 12x1L" com o fator JÁ calculado. */
  embalagens: Array<{ nome: string; qtd: number }>;
}

interface RespostaInicial {
  precoUnitario: string;
  marca: string;
  embalagem: string;
  qtdPorEmbalagem: string;
  observacao: string;
}

/** tipoPreco: DE QUÊ é o preço digitado. O fornecedor ESCOLHE em vez de
 *  escrever — foi texto livre que deixou "Und" + "vêm 12" dividir o preço da
 *  garrafa por 12. 'unidade' = 1 un/kg/L (default); 'ml' = embalagem em
 *  mililitros (só item em litro); 'pacote' = caixa/fardo fechado (pede quantos
 *  un/kg/L vêm). O fator de conversão sai calculado, nunca digitado solto. */
interface RespostaItem extends RespostaInicial {
  tipoPreco: string;
}

const VAZIA: RespostaItem = {
  precoUnitario: '',
  marca: '',
  embalagem: '',
  qtdPorEmbalagem: '',
  observacao: '',
  tipoPreco: 'unidade',
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

function ehLitro(unidade: string): boolean {
  const t = unidade.toLowerCase();
  return t === 'l' || t === 'lt' || t === 'litro';
}

function nomeUnidade(unidade: string): string {
  const t = unidade.toLowerCase();
  if (t === 'un' || t === 'und' || t === 'unid') return 'unidade';
  if (ehLitro(t)) return 'litro';
  if (t === 'g') return 'grama';
  return unidade;
}

/** Unidade que NÃO diz o tamanho (un/cx/pct): o fornecedor precisa DESCREVER
 *  a embalagem que está vendendo — "1 un" de manteiga pode ser pote de 200 g
 *  ou balde de 15 kg, e sem isso a comparação de preço não vale nada. */
function unidadeIndefinida(unidade: string): boolean {
  const t = unidade.toLowerCase();
  return !['kg', 'g', 'l', 'lt', 'litro', 'ml'].includes(t);
}

function nomePacote(unidade: string): string {
  const t = unidade.toLowerCase();
  if (t === 'un' || t === 'und' || t === 'unid') return 'caixa/pacote fechado (várias unidades)';
  if (t === 'kg') return 'fardo/saco/caixa (vários kg)';
  if (ehLitro(t)) return 'caixa/fardo (vários litros)';
  return 'embalagem fechada (mais de 1)';
}

/** Fator de conversão calculado a partir da escolha estruturada.
 *  tipoPreco 'emb:N' = N-ésima embalagem pré-definida do item (fator pronto). */
function fatorDe(r: RespostaItem, item: Item): number {
  if (r.tipoPreco.startsWith('emb:')) {
    const emb = item.embalagens[Number(r.tipoPreco.slice(4))];
    return emb ? emb.qtd : NaN;
  }
  if (r.tipoPreco === 'ml') {
    const ml = moedaParaNumero(r.qtdPorEmbalagem);
    return ml > 0 ? ml / 1000 : NaN;
  }
  if (r.tipoPreco === 'pacote') {
    const q = moedaParaNumero(r.qtdPorEmbalagem);
    return q > 0 ? q : NaN;
  }
  return 1;
}

function rotuloEmbalagem(r: RespostaItem, item: Item): string {
  if (r.tipoPreco.startsWith('emb:')) {
    const emb = item.embalagens[Number(r.tipoPreco.slice(4))];
    if (emb) return emb.nome.slice(0, 40);
  }
  if (r.tipoPreco === 'ml') return `embalagem ${r.qtdPorEmbalagem} ml`;
  if (r.tipoPreco === 'pacote') return `embalagem c/ ${r.qtdPorEmbalagem} ${item.unidade}`;
  // 'unidade' com descrição do fornecedor ("pote 500 g", "cx c/ 24")
  if (r.embalagem.trim()) return r.embalagem.trim().slice(0, 40);
  return item.unidade;
}

export function PreencherForm(props: {
  token: string;
  itens: Item[];
  respostasIniciais: Record<string, RespostaInicial>;
  freteInicial?: string;
}) {
  const [respostas, setRespostas] = useState<Record<string, RespostaItem>>(() => {
    const init: Record<string, RespostaItem> = {};
    for (const i of props.itens) {
      const r = props.respostasIniciais[i.id];
      if (!r) {
        init[i.id] = { ...VAZIA };
        continue;
      }
      // Deriva a escolha estruturada da resposta gravada (fator salvo)
      const fator = r.qtdPorEmbalagem.trim() ? moedaParaNumero(r.qtdPorEmbalagem) : 1;
      if (!Number.isFinite(fator) || fator === 1 || fator <= 0) {
        init[i.id] = { ...r, qtdPorEmbalagem: '', tipoPreco: 'unidade' };
      } else if (ehLitro(i.unidade) && fator < 1) {
        init[i.id] = {
          ...r,
          qtdPorEmbalagem: String(Math.round(fator * 1000)),
          tipoPreco: 'ml',
        };
      } else {
        init[i.id] = { ...r, tipoPreco: 'pacote' };
      }
    }
    return init;
  });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  // Frete é UM valor total da entrega (o "táxi"), não por item. Começa em
  // 0,00 explícito: o fornecedor declara zero ou troca pelo valor que cobra.
  const [frete, setFrete] = useState(props.freteInicial || '0,00');

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

    // A escolha estruturada ("o preço é de: 1 kg | fardo com X kg | ...") já
    // elimina a ambiguidade que os campos livres de embalagem tinham — a única
    // validação necessária é a quantidade da embalagem fechada.
    const semQuantidade = props.itens.filter((i) => {
      const r = respostas[i.id];
      if (!r?.precoUnitario.trim()) return false;
      if (r.tipoPreco === 'unidade' || r.tipoPreco.startsWith('emb:')) return false;
      return !(moedaParaNumero(r.qtdPorEmbalagem) > 0);
    });
    if (semQuantidade.length > 0) {
      setErro(
        `Diga quanto vem na embalagem de: ${semQuantidade
          .map((i) => i.produtoNome)
          .join(', ')} (ml, kg ou unidades — conforme o que você escolheu).`,
      );
      return;
    }

    // Embalagem é OBRIGATÓRIA quando a unidade não diz o tamanho ("1 un" de
    // quê?): o fornecedor descreve o que está vendendo — pote 500 g, cx c/ 24.
    const semEmbalagem = props.itens.filter((i) => {
      const r = respostas[i.id];
      if (!r?.precoUnitario.trim()) return false;
      if (r.tipoPreco !== 'unidade') return false;
      if (!unidadeIndefinida(i.unidade)) return false;
      return !r.embalagem.trim();
    });
    if (semEmbalagem.length > 0) {
      setErro(
        `Descreva a embalagem que você está vendendo em: ${semEmbalagem
          .map((i) => i.produtoNome)
          .join(', ')} (ex: pote 500 g, garrafa 750 ml, caixa com 24).`,
      );
      return;
    }

    let respArr: Array<{
      cotacaoItemId: string;
      precoUnitario: number;
      marca: string | null;
      embalagem: string | null;
      qtdPorEmbalagem: number;
      observacao: string | null;
    }>;
    try {
      respArr = props.itens
        .map((i) => {
          const r = respostas[i.id];
          if (!r.precoUnitario.trim()) return null; // sem preço = não tem o item
          const num = moedaParaNumero(r.precoUnitario);
          if (!Number.isFinite(num) || num <= 0) {
            throw new Error(`Preço inválido em "${i.produtoNome}"`);
          }
          const fator = fatorDe(r, i);
          if (!Number.isFinite(fator) || fator <= 0) {
            throw new Error(`Quantidade por embalagem inválida em "${i.produtoNome}"`);
          }
          return {
            cotacaoItemId: i.id,
            precoUnitario: num,
            marca: r.marca.trim() || null,
            embalagem: rotuloEmbalagem(r, i),
            qtdPorEmbalagem: fator,
            observacao: r.observacao.trim() || null,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    } catch (err) {
      setErro((err as Error).message);
      return;
    }

    if (respArr.length === 0) {
      setErro('Preencha pelo menos 1 item, ou clique em "não tenho nada essa semana"');
      return;
    }

    setEnviando(true);
    try {
      const r = await fetch(`/api/cotacao/preencher/${props.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          respostas: respArr,
          taxaFrete: frete.trim() ? moedaParaNumero(frete) : null,
        }),
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
      {/* Regra importantíssima do dono: preço é o valor FINAL. Frete à parte
          tem campo próprio, em cima, pra não vir escondido no preço depois. */}
      <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">
          ⚠ IMPORTANTE: informe o valor FINAL de cada item — com todos os impostos e o frete
          já incluídos.
        </p>
        <div className="mt-3">
          <label className="block text-[11px] font-medium text-amber-900">
            Taxa de frete/entrega (valor TOTAL da entrega, não por item — ex: táxi). Se não
            cobra, deixe 0,00:
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={frete}
            onChange={(e) => setFrete(mascaraMoeda(e.target.value))}
            className="mt-1 w-48 rounded border border-amber-300 bg-white px-2 py-1 text-sm"
          />
        </div>
      </div>

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
                    {i.observacao && (
                      <div className="mt-0.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                        ⚠ {i.observacao}
                      </div>
                    )}
                  </div>
                  {/* A observação do item É a instrução pro fornecedor (marca
                      exigida, caixa fechada, peso da embalagem). Dado interno
                      (estoque/última compra) não entra aqui — fica fora do
                      form por construção. */}
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700">
                        O preço que você vai dar é de:
                      </label>
                      {/* Escolha fechada em vez de texto livre: o default é a
                          unidade base (1 un / 1 kg / 1 L) e a embalagem fechada
                          pergunta quantos vêm — o fator sai calculado. */}
                      <select
                        value={respostas[i.id]?.tipoPreco ?? 'unidade'}
                        onChange={(e) => setCampo(i.id, 'tipoPreco', e.target.value)}
                        className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                      >
                        <option value="unidade">1 {nomeUnidade(i.unidade)}</option>
                        {/* Pré-definições da casa (tabela de conversões): fator pronto */}
                        {i.embalagens.map((e, idx) => (
                          <option key={idx} value={`emb:${idx}`}>
                            {e.nome} ({e.qtd} {i.unidade})
                          </option>
                        ))}
                        {ehLitro(i.unidade) && (
                          <option value="ml">embalagem em ml (750 ml, 600 ml…)</option>
                        )}
                        <option value="pacote">outra: {nomePacote(i.unidade)}</option>
                      </select>
                      {i.embalagemEsperada && (
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          A casa costuma comprar: {i.embalagemEsperada}
                        </p>
                      )}
                    </div>
                    {(respostas[i.id]?.tipoPreco ?? 'unidade') === 'unidade' &&
                      unidadeIndefinida(i.unidade) && (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-700">
                            Qual embalagem/tamanho você está vendendo?{' '}
                            <span className="text-rose-600">*</span>
                          </label>
                          <input
                            type="text"
                            placeholder="ex: pote 500 g, garrafa 750 ml, cx c/ 24"
                            value={respostas[i.id]?.embalagem ?? ''}
                            onChange={(e) => setCampo(i.id, 'embalagem', e.target.value)}
                            className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                          />
                        </div>
                      )}
                    {['ml', 'pacote'].includes(respostas[i.id]?.tipoPreco ?? 'unidade') && (
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700">
                          {respostas[i.id]?.tipoPreco === 'ml'
                            ? 'Quantos ml tem a embalagem?'
                            : `Quantos ${i.unidade} vêm na embalagem?`}{' '}
                          <span className="text-rose-600">*</span>
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder={respostas[i.id]?.tipoPreco === 'ml' ? 'ex: 750' : 'ex: 12'}
                          value={respostas[i.id]?.qtdPorEmbalagem ?? ''}
                          onChange={(e) => setCampo(i.id, 'qtdPorEmbalagem', e.target.value)}
                          className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700">
                        {(respostas[i.id]?.tipoPreco ?? 'unidade') === 'unidade'
                          ? `Preço de 1 ${nomeUnidade(i.unidade)} (R$)`
                          : 'Preço da embalagem (R$)'}{' '}
                        <span className="text-rose-600">*</span>
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
                      {(() => {
                        const r = respostas[i.id];
                        if (!r?.precoUnitario.trim()) return null;
                        const f = fatorDe(r, i);
                        if (!Number.isFinite(f) || f <= 0 || f === 1) return null;
                        return (
                          <p className="mt-0.5 text-[10px] text-emerald-700">
                            ={' '}
                            {(moedaParaNumero(r.precoUnitario) / f).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                              maximumFractionDigits: 4,
                            })}{' '}
                            por {i.unidade}
                          </p>
                        );
                      })()}
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

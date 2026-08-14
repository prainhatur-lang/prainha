'use client';

// Matriz item × fornecedor da cotação:
//  - vê todos os preços respondidos lado a lado (menor válido em verde)
//  - ✕ tira um item da cotação de UM fornecedor (some do link dele e não disputa)
//  - "Colar resposta" → IA interpreta o texto do WhatsApp → gestor confere
//    ("esse preço é de quê?") → grava como resposta do fornecedor

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Mesma normalização de marca de @/lib/cotacao-alocacao (duplicada aqui
 *  porque aquele módulo importa o driver do banco e não pode ir pro client). */
function normalizaMarca(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
}

function moedaParaNumero(s: string): number {
  return Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
}

interface Item {
  id: string;
  produtoNome: string;
  categoria: string;
  quantidade: string;
  unidade: string;
  marcasAceitas: string[];
  embalagemEsperada: string | null;
  classificacao: string | null;
}
interface Forn {
  cfId: string;
  nome: string;
  status: string;
  respondidoEm: string | null;
  linkAbertoEm: string | null;
}
interface Resp {
  cfId: string;
  itemId: string;
  preco: number | null;
  precoNorm: number | null;
  fator: number;
  embalagem: string | null;
  marca: string | null;
  observacao: string | null;
}

interface LinhaConferencia {
  cotacaoItemId: string;
  preco: string; // texto com vírgula
  embalagem: string;
  qtd: string; // texto com vírgula
  marca: string;
  observacao: string;
  confianca: 'alta' | 'media' | 'baixa' | 'existente';
}

export function RespostasClient(props: {
  cotacaoId: string;
  podeEditar: boolean;
  itens: Item[];
  fornecedores: Forn[];
  respostas: Resp[];
  exclusoesIniciais: Record<string, string[]>;
}) {
  const router = useRouter();
  const [exclusoes, setExclusoes] = useState<Record<string, Set<string>>>(() => {
    const m: Record<string, Set<string>> = {};
    for (const [cfId, lista] of Object.entries(props.exclusoesIniciais)) m[cfId] = new Set(lista);
    return m;
  });
  const [salvandoExclusao, setSalvandoExclusao] = useState<string | null>(null);

  // ----- modal colar resposta -----
  const [modalForn, setModalForn] = useState<Forn | null>(null);
  const [texto, setTexto] = useState('');
  const [interpretando, setInterpretando] = useState(false);
  const [erroModal, setErroModal] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<LinhaConferencia[] | null>(null);
  const [naoIdentificados, setNaoIdentificados] = useState<string[]>([]);
  const [gravando, setGravando] = useState(false);

  const respostaDe = useMemo(() => {
    const m = new Map<string, Resp>();
    for (const r of props.respostas) m.set(`${r.cfId}:${r.itemId}`, r);
    return m;
  }, [props.respostas]);

  function estaExcluido(cfId: string, itemId: string): boolean {
    return exclusoes[cfId]?.has(itemId) ?? false;
  }

  function marcaValida(item: Item, marca: string | null): boolean {
    if (item.marcasAceitas.length === 0) return true;
    const m = normalizaMarca(marca);
    return !!m && item.marcasAceitas.some((a) => normalizaMarca(a) === m);
  }

  /** Menor preço normalizado válido do item (marca ok, não excluído). */
  const melhorPorItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of props.itens) {
      let melhor = Infinity;
      for (const f of props.fornecedores) {
        if (estaExcluido(f.cfId, item.id)) continue;
        const r = respostaDe.get(`${f.cfId}:${item.id}`);
        if (!r || r.precoNorm == null) continue;
        if (!marcaValida(item, r.marca)) continue;
        if (r.precoNorm < melhor) melhor = r.precoNorm;
      }
      if (melhor < Infinity) m.set(item.id, melhor);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.itens, props.fornecedores, respostaDe, exclusoes]);

  async function alternarExclusao(cfId: string, itemId: string, excluir: boolean) {
    const chave = `${cfId}:${itemId}`;
    setSalvandoExclusao(chave);
    try {
      const resp = await fetch(`/api/cotacao/${props.cotacaoId}/excluir-item`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cotacaoFornecedorId: cfId, cotacaoItemId: itemId, excluir }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      setExclusoes((prev) => {
        const novo = { ...prev };
        const set = new Set(novo[cfId] ?? []);
        if (excluir) set.add(itemId);
        else set.delete(itemId);
        novo[cfId] = set;
        return novo;
      });
      router.refresh();
    } catch (e) {
      alert(`Não consegui ${excluir ? 'excluir' : 'restaurar'}: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSalvandoExclusao(null);
    }
  }

  function abrirModal(f: Forn) {
    setModalForn(f);
    setTexto('');
    setLinhas(null);
    setNaoIdentificados([]);
    setErroModal(null);
  }

  async function interpretar() {
    if (!modalForn) return;
    setInterpretando(true);
    setErroModal(null);
    try {
      const resp = await fetch(`/api/cotacao/${props.cotacaoId}/interpretar-resposta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cotacaoFornecedorId: modalForn.cfId, texto }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j.error ?? `HTTP ${resp.status}`);

      const interpretadas = (j.respostas ?? []) as Array<{
        cotacaoItemId: string;
        precoEmbalagem: number;
        embalagem: string;
        qtdPorEmbalagem: number;
        marca: string | null;
        observacao: string | null;
        confianca: 'alta' | 'media' | 'baixa';
      }>;
      const porItem = new Map(interpretadas.map((r) => [r.cotacaoItemId, r]));

      // Mescla com o que o fornecedor JÁ tinha respondido: o que a IA achou
      // substitui; o resto fica como estava (gravar substitui a resposta toda).
      const resultado: LinhaConferencia[] = [];
      for (const item of props.itens) {
        if (estaExcluido(modalForn.cfId, item.id)) continue;
        const nova = porItem.get(item.id);
        if (nova) {
          resultado.push({
            cotacaoItemId: item.id,
            preco: nova.precoEmbalagem.toFixed(2).replace('.', ','),
            embalagem: nova.embalagem || item.unidade,
            qtd: String(nova.qtdPorEmbalagem || 1).replace('.', ','),
            marca: nova.marca ?? '',
            observacao: nova.observacao ?? '',
            confianca: nova.confianca,
          });
          continue;
        }
        const existente = respostaDe.get(`${modalForn.cfId}:${item.id}`);
        if (existente && existente.preco != null) {
          resultado.push({
            cotacaoItemId: item.id,
            preco: existente.preco.toFixed(2).replace('.', ','),
            embalagem: existente.embalagem ?? item.unidade,
            qtd: String(existente.fator || 1).replace('.', ','),
            marca: existente.marca ?? '',
            observacao: existente.observacao ?? '',
            confianca: 'existente',
          });
        }
      }
      setLinhas(resultado);
      setNaoIdentificados((j.naoIdentificados ?? []) as string[]);
    } catch (e) {
      setErroModal(e instanceof Error ? e.message : String(e));
    } finally {
      setInterpretando(false);
    }
  }

  async function gravar() {
    if (!modalForn || !linhas) return;
    setGravando(true);
    setErroModal(null);
    try {
      const payload = linhas
        .filter((l) => moedaParaNumero(l.preco) > 0)
        .map((l) => ({
          cotacaoItemId: l.cotacaoItemId,
          precoUnitario: moedaParaNumero(l.preco),
          marca: l.marca.trim() || null,
          embalagem: l.embalagem.trim() || null,
          qtdPorEmbalagem: moedaParaNumero(l.qtd) || 1,
          observacao: l.observacao.trim() || null,
        }));
      const resp = await fetch(`/api/cotacao/${props.cotacaoId}/registrar-resposta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cotacaoFornecedorId: modalForn.cfId, respostas: payload }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j.error ?? `HTTP ${resp.status}`);
      if (Array.isArray(j.avisos) && j.avisos.length > 0) {
        alert(`Gravado com avisos:\n\n${j.avisos.join('\n')}`);
      }
      setModalForn(null);
      router.refresh();
    } catch (e) {
      setErroModal(e instanceof Error ? e.message : String(e));
    } finally {
      setGravando(false);
    }
  }

  function setLinha(
    idx: number,
    campo: 'preco' | 'embalagem' | 'qtd' | 'marca' | 'observacao',
    valor: string,
  ) {
    setLinhas((prev) => {
      if (!prev) return prev;
      const novo = [...prev];
      novo[idx] = { ...novo[idx], [campo]: valor } as LinhaConferencia;
      return novo;
    });
  }

  const itemPorId = useMemo(() => new Map(props.itens.map((i) => [i.id, i])), [props.itens]);

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium">
                Item
              </th>
              {props.fornecedores.map((f) => (
                <th key={f.cfId} className="min-w-[150px] px-3 py-2 text-left align-top font-medium">
                  <div className="text-slate-900">{f.nome}</div>
                  <div className="mt-0.5 text-[10px] font-normal text-slate-500">
                    {f.status === 'RESPONDIDA'
                      ? `✓ respondeu ${f.respondidoEm ?? ''}`
                      : f.linkAbertoEm
                        ? `abriu ${f.linkAbertoEm}, não enviou`
                        : 'não abriu o link'}
                  </div>
                  {props.podeEditar && (
                    <button
                      onClick={() => abrirModal(f)}
                      className="mt-1 rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 hover:bg-sky-100"
                    >
                      📋 Colar resposta
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.itens.map((item) => {
              const melhor = melhorPorItem.get(item.id);
              return (
                <tr key={item.id} className="border-t border-slate-100 align-top">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2">
                    <div className="font-medium text-slate-900">{item.produtoNome}</div>
                    <div className="text-[10px] text-slate-500">
                      {item.quantidade} {item.embalagemEsperada ?? item.unidade}
                      {item.classificacao && ` · ${item.classificacao}`}
                    </div>
                    {item.marcasAceitas.length > 0 && (
                      <div className="text-[10px] text-slate-400">
                        {item.marcasAceitas.join(' / ')}
                      </div>
                    )}
                  </td>
                  {props.fornecedores.map((f) => {
                    const excluido = estaExcluido(f.cfId, item.id);
                    const r = respostaDe.get(`${f.cfId}:${item.id}`);
                    const chave = `${f.cfId}:${item.id}`;
                    const salvando = salvandoExclusao === chave;
                    if (excluido) {
                      return (
                        <td key={f.cfId} className="bg-slate-100 px-3 py-2 text-slate-400">
                          <div className="text-[10px] line-through">excluído</div>
                          {props.podeEditar && (
                            <button
                              disabled={salvando}
                              onClick={() => alternarExclusao(f.cfId, item.id, false)}
                              className="mt-0.5 text-[10px] text-sky-700 underline disabled:opacity-50"
                            >
                              {salvando ? '…' : 'devolver'}
                            </button>
                          )}
                        </td>
                      );
                    }
                    const marcaOk = r ? marcaValida(item, r.marca) : true;
                    const ehMelhor =
                      r?.precoNorm != null && melhor != null && marcaOk && r.precoNorm <= melhor + 1e-9;
                    return (
                      <td
                        key={f.cfId}
                        className={`group px-3 py-2 ${ehMelhor ? 'bg-emerald-50' : ''}`}
                      >
                        {r && r.precoNorm != null ? (
                          <div>
                            <div
                              className={`font-semibold ${
                                !marcaOk
                                  ? 'text-rose-600'
                                  : ehMelhor
                                    ? 'text-emerald-700'
                                    : 'text-slate-900'
                              }`}
                            >
                              {brl(r.precoNorm)}
                              <span className="font-normal text-slate-400">/{item.unidade}</span>
                            </div>
                            {r.fator !== 1 && r.preco != null && (
                              <div className="text-[10px] text-slate-500">
                                {r.embalagem ?? 'embalagem'}: {brl(r.preco)}
                              </div>
                            )}
                            {r.marca && (
                              <div className={`text-[10px] ${marcaOk ? 'text-slate-500' : 'text-rose-600'}`}>
                                {r.marca}
                                {!marcaOk && ' — marca não aceita'}
                              </div>
                            )}
                            {r.observacao && (
                              <div className="text-[10px] italic text-slate-400">{r.observacao}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                        {props.podeEditar && (
                          <button
                            disabled={salvando}
                            title={`Tirar ${item.produtoNome} da cotação de ${f.nome}`}
                            onClick={() => alternarExclusao(f.cfId, item.id, true)}
                            className="mt-0.5 hidden rounded border border-rose-200 px-1 py-0.5 text-[10px] text-rose-600 hover:bg-rose-50 group-hover:inline-block disabled:opacity-50"
                          >
                            {salvando ? '…' : '✕ tirar'}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal: colar resposta do WhatsApp */}
      {modalForn && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-8 w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Colar resposta — {modalForn.nome}
              </h2>
              <button
                onClick={() => setModalForn(null)}
                className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            {linhas === null ? (
              <>
                <p className="mb-2 text-xs text-slate-600">
                  Cole a mensagem do WhatsApp do jeito que o fornecedor mandou. A IA casa cada
                  preço com o item da cotação e você confere antes de gravar.
                </p>
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={12}
                  placeholder={'Ex:\nPanko Alpha 17,49\nMerluza cx 13kg 26,89 o kg\nArroz Camil fardo 30kg 128,00\n...'}
                  className="w-full rounded border border-slate-300 p-2 font-mono text-xs"
                />
                {erroModal && (
                  <p className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-700">{erroModal}</p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={() => setModalForn(null)}
                    className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={interpretando || !texto.trim()}
                    onClick={interpretar}
                    className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    {interpretando ? 'Interpretando… (até 1 min)' : 'Interpretar com IA'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-2 text-xs text-slate-600">
                  Confira antes de gravar — principalmente <strong>&quot;o preço é de quê?&quot;</strong>{' '}
                  (unidade, kg, garrafa 750 ml, caixa c/ 12, fardo c/ 30 kg…) e a marca. Linha sem
                  preço não é gravada.
                </p>
                {naoIdentificados.length > 0 && (
                  <div className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                    <strong>Não casaram com nenhum item:</strong> {naoIdentificados.join(' · ')}
                  </div>
                )}
                <div className="max-h-[50vh] overflow-y-auto rounded border border-slate-200">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">Item</th>
                        <th className="px-2 py-1.5 text-left font-medium">Preço (R$)</th>
                        <th className="px-2 py-1.5 text-left font-medium">É de quê?</th>
                        <th className="px-2 py-1.5 text-left font-medium">Qtd nela</th>
                        <th className="px-2 py-1.5 text-left font-medium">Marca</th>
                        <th className="px-2 py-1.5 text-left font-medium">=</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((l, idx) => {
                        const item = itemPorId.get(l.cotacaoItemId);
                        if (!item) return null;
                        const preco = moedaParaNumero(l.preco);
                        const qtd = moedaParaNumero(l.qtd) || 1;
                        return (
                          <tr
                            key={l.cotacaoItemId}
                            className={`border-t border-slate-100 ${
                              l.confianca === 'baixa'
                                ? 'bg-amber-50'
                                : l.confianca === 'existente'
                                  ? 'bg-slate-50'
                                  : ''
                            }`}
                          >
                            <td className="px-2 py-1">
                              <div className="font-medium text-slate-900">{item.produtoNome}</div>
                              <div className="text-[10px] text-slate-400">
                                {l.confianca === 'existente'
                                  ? 'já estava gravado'
                                  : `confiança ${l.confianca}`}
                                {item.marcasAceitas.length > 0 &&
                                  ` · aceita: ${item.marcasAceitas.join('/')}`}
                              </div>
                            </td>
                            <td className="px-2 py-1">
                              <input
                                value={l.preco}
                                onChange={(e) => setLinha(idx, 'preco', e.target.value)}
                                className="w-20 rounded border border-slate-200 px-1 py-0.5"
                                inputMode="decimal"
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                value={l.embalagem}
                                onChange={(e) => setLinha(idx, 'embalagem', e.target.value)}
                                className="w-28 rounded border border-slate-200 px-1 py-0.5"
                                placeholder={item.unidade}
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                value={l.qtd}
                                onChange={(e) => setLinha(idx, 'qtd', e.target.value)}
                                className="w-14 rounded border border-slate-200 px-1 py-0.5"
                                inputMode="decimal"
                                title={`Quantos ${item.unidade} vêm nessa embalagem`}
                              />
                            </td>
                            <td className="px-2 py-1">
                              {item.marcasAceitas.length > 0 ? (
                                <select
                                  value={l.marca}
                                  onChange={(e) => setLinha(idx, 'marca', e.target.value)}
                                  className="w-28 rounded border border-slate-200 px-1 py-0.5"
                                >
                                  <option value="">—</option>
                                  {item.marcasAceitas.map((m) => (
                                    <option key={m} value={m}>
                                      {m}
                                    </option>
                                  ))}
                                  {l.marca && !item.marcasAceitas.includes(l.marca) && (
                                    <option value={l.marca}>{l.marca} (fora da lista)</option>
                                  )}
                                </select>
                              ) : (
                                <input
                                  value={l.marca}
                                  onChange={(e) => setLinha(idx, 'marca', e.target.value)}
                                  className="w-28 rounded border border-slate-200 px-1 py-0.5"
                                />
                              )}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1 text-slate-600">
                              {preco > 0 ? `${brl(preco / qtd)}/${item.unidade}` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {erroModal && (
                  <p className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-700">{erroModal}</p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <button
                    onClick={() => setLinhas(null)}
                    className="text-xs text-slate-500 underline"
                  >
                    ← voltar e colar de novo
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setModalForn(null)}
                      className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                    <button
                      disabled={gravando || linhas.length === 0}
                      onClick={gravar}
                      className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {gravando
                        ? 'Gravando…'
                        : `Gravar ${linhas.filter((l) => moedaParaNumero(l.preco) > 0).length} resposta(s)`}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

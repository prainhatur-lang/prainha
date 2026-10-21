'use client';

// Matriz item × fornecedor da cotação:
//  - vê todos os preços respondidos lado a lado (menor válido em verde)
//  - ✕ tira um item da cotação de UM fornecedor (some do link dele e não disputa)
//  - "Colar resposta" → IA interpreta o texto do WhatsApp → gestor confere
//    ("esse preço é de quê?") → grava como resposta do fornecedor

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { alertaUnidadeResposta, qtdDentroDaObservacao } from '@/lib/cotacao-alerta-unidade';

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
  /** Instrução de compra ("corte fino", "caixa grande") — visível pro gestor e pro fornecedor */
  observacao: string | null;
}
interface Forn {
  cfId: string;
  nome: string;
  status: string;
  respondidoEm: string | null;
  linkAbertoEm: string | null;
  /** Observação da convocação — hoje carrega "Taxa de frete: R$ X" */
  frete: string | null;
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

interface NotaRef {
  data: string;
  casa: string;
  fornecedor: string;
  descricao: string;
  unidade: string;
  qtd: number;
  vu: number;
  vt: number;
}

/** Resposta que não se compara com o pedido — regra em lib/cotacao-alerta-unidade. */
function alertaUnidade(item: Item, r: Resp): string | null {
  return alertaUnidadeResposta(item.unidade, r.embalagem, r.fator, r.observacao);
}

function fmtQtd(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

/** Média ponderada (total ÷ quantidade) na unidade mais frequente das notas. */
function mediaNotas(notas: NotaRef[]): { unidade: string; valor: number } | null {
  const por = new Map<string, { q: number; t: number; n: number }>();
  for (const n of notas) {
    if (!(n.qtd > 0) || !(n.vt > 0)) continue;
    const u = n.unidade.toUpperCase() || '?';
    const a = por.get(u) ?? { q: 0, t: 0, n: 0 };
    a.q += n.qtd;
    a.t += n.vt;
    a.n += 1;
    por.set(u, a);
  }
  const melhor = [...por.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  if (!melhor) return null;
  return { unidade: melhor[0], valor: melhor[1].t / melhor[1].q };
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
  /** Últimas notas fiscais do item (referência pro gestor, nunca vai pro fornecedor) */
  notasPorItem?: Record<string, NotaRef[]>;
}) {
  const router = useRouter();
  const [exclusoes, setExclusoes] = useState<Record<string, Set<string>>>(() => {
    const m: Record<string, Set<string>> = {};
    for (const [cfId, lista] of Object.entries(props.exclusoesIniciais)) m[cfId] = new Set(lista);
    return m;
  });
  const [salvandoExclusao, setSalvandoExclusao] = useState<string | null>(null);
  // Zerar resposta: confirmação em 2 cliques no próprio botão (sem dialog
  // nativo). 1º clique arma, 2º executa; desarma sozinho em 5s.
  const [confirmandoZerar, setConfirmandoZerar] = useState<string | null>(null);
  const [zerando, setZerando] = useState(false);

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
        // Preço do kg num item em cx/peça não disputa o verde (não compara)
        if (alertaUnidade(item, r)) continue;
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

  // itemId -> feedback do auto-save. NUNCA alert(): erro em blur repetido vira
  // tempestade de pop-up e "derruba" a página — o aviso é inline e discreto.
  const [qtdStatus, setQtdStatus] = useState<
    Record<string, { tipo: 'salvando' | 'ok' | 'erro'; msg?: string }>
  >({});

  function limparQtdStatus(itemId: string, aposMs: number) {
    setTimeout(
      () =>
        setQtdStatus((p) => {
          const novo = { ...p };
          delete novo[itemId];
          return novo;
        }),
      aposMs,
    );
  }

  async function salvarQuantidade(item: Item, valor: string) {
    const qtd = moedaParaNumero(valor);
    if (!Number.isFinite(qtd) || qtd <= 0 || qtd === Number(item.quantidade)) return;
    setQtdStatus((p) => ({ ...p, [item.id]: { tipo: 'salvando' } }));
    try {
      const resp = await fetch(`/api/cotacao/${props.cotacaoId}/alterar-item`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cotacaoItemId: item.id, quantidade: qtd }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j.error ?? `HTTP ${resp.status}`);
      setQtdStatus((p) => ({ ...p, [item.id]: { tipo: 'ok' } }));
      limparQtdStatus(item.id, 3000);
      router.refresh();
    } catch (e) {
      setQtdStatus((p) => ({
        ...p,
        [item.id]: { tipo: 'erro', msg: e instanceof Error ? e.message : String(e) },
      }));
      limparQtdStatus(item.id, 6000);
    }
  }

  // Acerto de resposta com ⚠ (preço do kg sem peso / "c/ N cx"): chave cfId:itemId.
  const [pesoDigitado, setPesoDigitado] = useState<Record<string, string>>({});
  // "Preço da unidade de dentro" (óleo 8,99 a garrafa, cx com 20): quantas vêm na {un}.
  const [qtdDentroDigitada, setQtdDentroDigitada] = useState<Record<string, string>>({});
  const [abrirDentro, setAbrirDentro] = useState<Record<string, boolean>>({});
  const [ajusteStatus, setAjusteStatus] = useState<
    Record<string, { tipo: 'salvando' | 'erro'; msg?: string }>
  >({});

  async function ajustarResposta(
    f: Forn,
    item: Item,
    modo: 'peso' | 'preco_da_unidade' | 'uma_de_n_kg' | 'uma_de_n_un' | 'juntas' | 'unidade_de_dentro',
    qtdSugerida?: number | null,
  ) {
    const k = `${f.cfId}:${item.id}`;
    const qtdDentro =
      modo === 'unidade_de_dentro'
        ? Number((qtdDentroDigitada[k] ?? (qtdSugerida ? String(qtdSugerida) : '')).trim().replace(',', '.')) || 0
        : undefined;
    if (modo === 'unidade_de_dentro' && !(qtdDentro! >= 1)) {
      setAjusteStatus((p) => ({ ...p, [k]: { tipo: 'erro', msg: `digite quantas unidades vêm em 1 ${item.unidade}` } }));
      return;
    }
    const pesoKg = modo === 'peso' ? Number((pesoDigitado[k] ?? '').trim().replace(',', '.')) || 0 : undefined; // "2,5" ou "2.5" = 2,5 kg
    if (modo === 'peso' && !(pesoKg! > 0)) {
      setAjusteStatus((p) => ({ ...p, [k]: { tipo: 'erro', msg: `digite quantos kg tem 1 ${item.unidade}` } }));
      return;
    }
    setAjusteStatus((p) => ({ ...p, [k]: { tipo: 'salvando' } }));
    try {
      const resp = await fetch(`/api/cotacao/${props.cotacaoId}/ajustar-resposta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cotacaoFornecedorId: f.cfId, cotacaoItemId: item.id, modo, pesoKg, qtdDentro }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j.error ?? `HTTP ${resp.status}`);
      setAjusteStatus((p) => {
        const novo = { ...p };
        delete novo[k];
        return novo;
      });
      setAbrirDentro((p) => ({ ...p, [k]: false }));
      router.refresh();
    } catch (e) {
      setAjusteStatus((p) => ({ ...p, [k]: { tipo: 'erro', msg: e instanceof Error ? e.message : String(e) } }));
    }
  }

  /** Campo "1 {un} tem [N] un" → preço da {un} = preço × N. Sugere o N da observação. */
  function caixaDentro(f: Forn, item: Item, r: Resp) {
    const k = `${f.cfId}:${item.id}`;
    const sugerida = qtdDentroDaObservacao(r.observacao);
    const valor = qtdDentroDigitada[k] ?? (sugerida ? String(sugerida) : '');
    const n = Number(valor.replace(',', '.'));
    const ocupado = ajusteStatus[k]?.tipo === 'salvando';
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1 text-[10px] text-amber-900">
          1 {item.unidade} tem
          <input
            inputMode="numeric"
            placeholder="?"
            value={valor}
            onChange={(e) => setQtdDentroDigitada((p) => ({ ...p, [k]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void ajustarResposta(f, item, 'unidade_de_dentro', sugerida);
            }}
            className="w-10 rounded border border-amber-300 px-1 py-0.5 text-[10px]"
            title={`Quantas unidades (garrafa, pacote, lata) vêm em 1 ${item.unidade}`}
          />
          un
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void ajustarResposta(f, item, 'unidade_de_dentro', sugerida)}
            className="rounded border border-amber-300 bg-white px-1 py-0.5 text-[10px] text-amber-800 hover:bg-amber-50 disabled:opacity-50"
          >
            OK
          </button>
        </div>
        {n > 1 && r.preco != null && (
          <span className="text-[10px] text-amber-800">
            = {brl(r.preco * n)}/{item.unidade}
          </span>
        )}
      </div>
    );
  }

  async function zerarResposta(f: Forn) {
    if (confirmandoZerar !== f.cfId) {
      setConfirmandoZerar(f.cfId);
      setTimeout(() => setConfirmandoZerar((atual) => (atual === f.cfId ? null : atual)), 5000);
      return;
    }
    setConfirmandoZerar(null);
    setZerando(true);
    try {
      const resp = await fetch(`/api/cotacao/${props.cotacaoId}/zerar-resposta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cotacaoFornecedorId: f.cfId }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j.error ?? `HTTP ${resp.status}`);
      alert(
        `Respostas de ${f.nome} apagadas — ele pode preencher de novo pelo MESMO link.` +
          (j.novaFechaEm
            ? ` A cotação estava fechada e foi reaberta até ${new Date(j.novaFechaEm).toLocaleString('pt-BR')}.`
            : ''),
      );
      router.refresh();
    } catch (e) {
      alert(`Não consegui zerar: ${e instanceof Error ? e.message : e}`);
    } finally {
      setZerando(false);
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
                  {f.frete && (
                    <div className="mt-0.5 text-[10px] font-semibold text-amber-700">
                      🚚 {f.frete}
                    </div>
                  )}
                  {props.podeEditar && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      <button
                        onClick={() => abrirModal(f)}
                        className="rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 hover:bg-sky-100"
                      >
                        📋 Colar resposta
                      </button>
                      {f.status === 'RESPONDIDA' && (
                        <button
                          onClick={() => zerarResposta(f)}
                          disabled={zerando}
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium disabled:opacity-50 ${
                            confirmandoZerar === f.cfId
                              ? 'border-rose-500 bg-rose-600 text-white'
                              : 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
                          }`}
                        >
                          {confirmandoZerar === f.cfId ? 'confirma apagar tudo?' : '🗑 zerar resposta'}
                        </button>
                      )}
                    </div>
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
                    {item.observacao && (
                      <div className="max-w-[180px] text-[10px] font-medium text-amber-800">
                        ⚠ {item.observacao}
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-[10px] text-slate-500">
                      {props.podeEditar ? (
                        // Quantidade editável direto aqui: corrige "1 kg" que
                        // era pra ser 20 antes de aprovar (Enter ou sair salva)
                        <input
                          defaultValue={item.quantidade}
                          inputMode="decimal"
                          className="w-14 rounded border border-slate-200 px-1 py-0.5 text-[10px]"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          onBlur={(e) => salvarQuantidade(item, e.target.value)}
                          title="Quantidade do pedido — edite e saia do campo pra salvar"
                        />
                      ) : (
                        <span>{item.quantidade}</span>
                      )}
                      {qtdStatus[item.id]?.tipo === 'salvando' && (
                        <span className="text-slate-400">salvando…</span>
                      )}
                      {qtdStatus[item.id]?.tipo === 'ok' && (
                        <span className="font-semibold text-emerald-600">✓ salvo</span>
                      )}
                      {qtdStatus[item.id]?.tipo === 'erro' && (
                        <span className="font-semibold text-rose-600" title={qtdStatus[item.id]?.msg}>
                          ⚠ {qtdStatus[item.id]?.msg?.slice(0, 60) ?? 'não salvou'}
                        </span>
                      )}
                      <span>
                        {item.embalagemEsperada ?? item.unidade}
                        {item.classificacao && ` · ${item.classificacao}`}
                      </span>
                    </div>
                    {item.marcasAceitas.length > 0 && (
                      <div className="text-[10px] text-slate-400">
                        {item.marcasAceitas.join(' / ')}
                      </div>
                    )}
                    {(() => {
                      const notas = props.notasPorItem?.[item.id];
                      if (!notas?.length) return null;
                      const media = mediaNotas(notas);
                      return (
                        <details className="mt-1 max-w-[260px] text-[10px] text-slate-600">
                          <summary className="cursor-pointer text-sky-700">
                            📄 últimas notas ({notas.length})
                            {media && ` · média ${brl(media.valor)}/${media.unidade}`}
                          </summary>
                          <ul className="mt-0.5 space-y-0.5">
                            {notas.map((n, k) => (
                              <li key={k} className="border-l-2 border-slate-200 pl-1">
                                <span className="text-slate-400">
                                  {n.data.slice(8, 10)}/{n.data.slice(5, 7)} · {n.casa.replace(/^Prainha\s*/i, '').slice(0, 10)} ·{' '}
                                  {n.fornecedor.slice(0, 18)}
                                </span>
                                <div>{n.descricao.slice(0, 48)}</div>
                                <div className="font-medium text-slate-700">
                                  {fmtQtd(n.qtd)} {n.unidade} × {brl(n.vu)} = {brl(n.vt)}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </details>
                      );
                    })()}
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
                    const alerta = r ? alertaUnidade(item, r) : null;
                    const ehMelhor =
                      r?.precoNorm != null && melhor != null && marcaOk && !alerta && r.precoNorm <= melhor + 1e-9;
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
                            {alerta && (
                              <div className="max-w-[160px] text-[10px] font-semibold text-amber-700">
                                ⚠ {alerta}
                              </div>
                            )}
                            {alerta && props.podeEditar && (() => {
                              const k = `${f.cfId}:${item.id}`;
                              const st = ajusteStatus[k];
                              const ocupado = st?.tipo === 'salvando';
                              const btn =
                                'rounded border border-amber-300 bg-white px-1 py-0.5 text-[10px] text-amber-800 hover:bg-amber-50 disabled:opacity-50';
                              const nCx = (r.embalagem ?? '').match(/c\/\s*([\d.,]+)/)?.[1] ?? '';
                              return (
                                <div className="mt-1 flex max-w-[180px] flex-col gap-1 rounded bg-amber-50 p-1">
                                  {alerta.startsWith('preço da unidade') ? (
                                    <>
                                      {caixaDentro(f, item, r)}
                                      <button
                                        type="button"
                                        disabled={ocupado}
                                        onClick={() => void ajustarResposta(f, item, 'preco_da_unidade')}
                                        className={btn}
                                        title={`O número já é o preço da ${item.unidade} inteira`}
                                      >
                                        já é o preço da {item.unidade}
                                      </button>
                                    </>
                                  ) : alerta.startsWith('preço do kg') ? (
                                    <>
                                      <div className="flex items-center gap-1">
                                        <input
                                          inputMode="decimal"
                                          placeholder={`kg na ${item.unidade}`}
                                          value={pesoDigitado[k] ?? ''}
                                          onChange={(e) => setPesoDigitado((p) => ({ ...p, [k]: e.target.value }))}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') void ajustarResposta(f, item, 'peso');
                                          }}
                                          className="w-16 rounded border border-amber-300 px-1 py-0.5 text-[10px]"
                                          title={`Quantos kg pesa 1 ${item.unidade}? O preço da ${item.unidade} vira kg × peso`}
                                        />
                                        <button
                                          type="button"
                                          disabled={ocupado}
                                          onClick={() => void ajustarResposta(f, item, 'peso')}
                                          className={btn}
                                        >
                                          OK
                                        </button>
                                      </div>
                                      <button
                                        type="button"
                                        disabled={ocupado}
                                        onClick={() => void ajustarResposta(f, item, 'preco_da_unidade')}
                                        className={btn}
                                        title={`O número já é o preço da ${item.unidade} inteira`}
                                      >
                                        já é o preço da {item.unidade}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        disabled={ocupado}
                                        onClick={() => void ajustarResposta(f, item, 'uma_de_n_un')}
                                        className={btn}
                                        title={`${brl(r.preco ?? 0)} é o preço de 1 ${item.unidade} com ${nCx} unidades dentro`}
                                      >
                                        1 {item.unidade} de {nCx} un
                                      </button>
                                      <button
                                        type="button"
                                        disabled={ocupado}
                                        onClick={() => void ajustarResposta(f, item, 'uma_de_n_kg')}
                                        className={btn}
                                        title={`${brl(r.preco ?? 0)} é o preço de 1 ${item.unidade} de ${nCx} kg`}
                                      >
                                        1 {item.unidade} de {nCx} kg
                                      </button>
                                      <button
                                        type="button"
                                        disabled={ocupado}
                                        onClick={() => void ajustarResposta(f, item, 'juntas')}
                                        className={btn}
                                      >
                                        {nCx} {item.unidade} juntas
                                      </button>
                                    </>
                                  )}
                                  {ocupado && <span className="text-[10px] text-slate-500">salvando…</span>}
                                  {st?.tipo === 'erro' && (
                                    <span className="text-[10px] font-semibold text-rose-600">⚠ {st.msg?.slice(0, 60)}</span>
                                  )}
                                </div>
                              );
                            })()}
                            {!alerta && props.podeEditar && r.fator === 1 && (() => {
                              const k = `${f.cfId}:${item.id}`;
                              const st = ajusteStatus[k];
                              if (!abrirDentro[k])
                                return (
                                  <button
                                    type="button"
                                    onClick={() => setAbrirDentro((p) => ({ ...p, [k]: true }))}
                                    className="mt-0.5 hidden rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 group-hover:inline-block"
                                    title={`O fornecedor deu o preço de 1 unidade de dentro (garrafa, pacote), não da ${item.unidade} inteira`}
                                  >
                                    🔧 é preço da unidade?
                                  </button>
                                );
                              return (
                                <div className="mt-1 flex max-w-[180px] flex-col gap-1 rounded bg-amber-50 p-1">
                                  {caixaDentro(f, item, r)}
                                  <button
                                    type="button"
                                    onClick={() => setAbrirDentro((p) => ({ ...p, [k]: false }))}
                                    className="text-left text-[10px] text-slate-500 underline"
                                  >
                                    fechar
                                  </button>
                                  {st?.tipo === 'salvando' && <span className="text-[10px] text-slate-500">salvando…</span>}
                                  {st?.tipo === 'erro' && (
                                    <span className="text-[10px] font-semibold text-rose-600">⚠ {st.msg?.slice(0, 60)}</span>
                                  )}
                                </div>
                              );
                            })()}
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

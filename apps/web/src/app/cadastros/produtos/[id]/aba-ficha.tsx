'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { normalizaBusca } from '@/lib/texto';

interface LinhaFicha {
  id: string;
  insumoId: string;
  insumoNome: string;
  insumoTipo: string;
  insumoUnidade: string;
  insumoControla: boolean;
  quantidade: string;
  baixaEstoque: boolean;
  observacao: string | null;
  /** Receita POR TAMANHO: null = vale pro produto inteiro. */
  tamanho?: string | null;
  codigoVariante?: number | null;
  unidade?: string | null;
  origem?: string | null;
  varianteId?: string | null;
  /** Custo da linha (qtd convertida × custo médio do insumo), calculado no server. */
  custo?: number;
  semCusto?: boolean;
}

interface Tamanho {
  varianteId: string;
  codigo: number | null;
  tamanho: string | null;
  precoVenda: number | null;
  pausado: boolean;
}

/** Um bloco da ficha: um tamanho, ou a receita "base" (sem tamanho). */
interface Grupo {
  chave: string;
  varianteId: string | null;
  titulo: string;
  precoVenda: number | null;
  pausado: boolean;
  linhas: LinhaFicha[];
  ehBase: boolean;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface UsadoEm {
  id: string;
  produtoId: string;
  produtoNome: string;
  quantidade: string;
}

interface InsumoOpcao {
  id: string;
  nome: string;
  tipo: string;
  unidade: string;
}

export function AbaFicha({
  produtoId,
  produtoTipo,
  linhas,
  tamanhos = [],
  usadoEm,
  insumosDisponiveis,
}: {
  produtoId: string;
  produtoTipo: string;
  linhas: LinhaFicha[];
  tamanhos?: Tamanho[];
  usadoEm: UsadoEm[];
  insumosDisponiveis: InsumoOpcao[];
}) {
  const router = useRouter();
  const [adicionar, setAdicionar] = useState<Grupo | null>(null);
  const [busca, setBusca] = useState('');
  const [insumoId, setInsumoId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [baixaEstoque, setBaixaEstoque] = useState(true);
  const [observacao, setObservacao] = useState('');
  const [pending, start] = useTransition();
  const [copiando, setCopiando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Monta os blocos: 1 por tamanho + a base (sem tamanho) quando existir ou
  // quando o produto nem tem tamanho. Linha de tamanho que sumiu do PDV vai
  // pra um bloco próprio pra não esconder receita.
  const grupos = useMemo<Grupo[]>(() => {
    const out: Grupo[] = [];
    const usadas = new Set<string>();
    for (const t of tamanhos) {
      const ls = linhas.filter(
        (l) => l.varianteId === t.varianteId || (l.varianteId == null && l.codigoVariante != null && l.codigoVariante === t.codigo),
      );
      ls.forEach((l) => usadas.add(l.id));
      out.push({
        chave: t.varianteId,
        varianteId: t.varianteId,
        titulo: t.tamanho || `Tamanho ${t.codigo ?? ''}`.trim(),
        precoVenda: t.precoVenda,
        pausado: t.pausado,
        linhas: ls,
        ehBase: false,
      });
    }
    const base = linhas.filter((l) => !usadas.has(l.id) && l.varianteId == null && l.codigoVariante == null);
    base.forEach((l) => usadas.add(l.id));
    if (base.length > 0 || tamanhos.length === 0) {
      out.push({
        chave: 'base',
        varianteId: null,
        titulo: tamanhos.length ? 'Receita geral (sem tamanho)' : 'Receita',
        precoVenda: tamanhos.length === 1 ? tamanhos[0]!.precoVenda : null,
        pausado: false,
        linhas: base,
        ehBase: true,
      });
    }
    const orfas = linhas.filter((l) => !usadas.has(l.id));
    if (orfas.length > 0) {
      out.push({
        chave: 'orfas',
        varianteId: '__orfas__',
        titulo: 'Tamanho que não existe mais no PDV',
        precoVenda: null,
        pausado: true,
        linhas: orfas,
        ehBase: false,
      });
    }
    return out;
  }, [linhas, tamanhos]);
  const temBase = grupos.some((g) => g.ehBase && g.linhas.length > 0);

  const idsJaNaFicha = useMemo(
    () => new Set((adicionar?.linhas ?? []).map((l) => l.insumoId)),
    [adicionar],
  );
  const opcoesFiltradas = useMemo(() => {
    const b = normalizaBusca(busca);
    return insumosDisponiveis
      .filter((i) => !idsJaNaFicha.has(i.id))
      .filter((i) => (b ? normalizaBusca(i.nome).includes(b) : true))
      .slice(0, 50);
  }, [busca, insumosDisponiveis, idsJaNaFicha]);

  const insumoEscolhido = insumosDisponiveis.find((i) => i.id === insumoId) ?? null;

  async function postLinha(body: Record<string, unknown>) {
    const r = await fetch('/api/ficha', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ produtoId, ...body }),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok ? null : ((d.error as string) ?? `HTTP ${r.status}`);
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!insumoId || !adicionar) return;
    const q = Number(quantidade.replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) {
      setErro('Quantidade inválida');
      return;
    }
    setErro(null);
    try {
      const falha = await postLinha({
        insumoId,
        quantidade: q,
        baixaEstoque,
        observacao: observacao.trim() || undefined,
        varianteId: adicionar.varianteId ?? undefined,
      });
      if (falha) {
        setErro(falha);
        return;
      }
      setAdicionar(null);
      setInsumoId('');
      setBusca('');
      setQuantidade('');
      setObservacao('');
      setBaixaEstoque(true);
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  /** Copia as linhas de outro bloco pra este (pula insumo que já está nele). */
  async function copiar(destino: Grupo, origem: Grupo) {
    const ja = new Set(destino.linhas.map((l) => l.insumoId));
    const novas = origem.linhas.filter((l) => !ja.has(l.insumoId));
    if (novas.length === 0) {
      alert('Nada pra copiar — os insumos já estão neste tamanho.');
      return;
    }
    if (!confirm(`Copiar ${novas.length} insumo(s) de "${origem.titulo}" para "${destino.titulo}"? Depois é só ajustar as quantidades.`)) return;
    setCopiando(destino.chave);
    const erros: string[] = [];
    for (const l of novas) {
      const falha = await postLinha({
        insumoId: l.insumoId,
        quantidade: Number(l.quantidade),
        unidade: l.unidade ?? undefined,
        baixaEstoque: l.baixaEstoque,
        observacao: l.observacao ?? undefined,
        varianteId: destino.varianteId ?? undefined,
      });
      if (falha) erros.push(`${l.insumoNome}: ${falha}`);
    }
    setCopiando(null);
    if (erros.length) alert(`Algumas não copiaram:\n${erros.join('\n')}`);
    start(() => router.refresh());
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/ficha/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return false;
    }
    return true;
  }

  async function remover(id: string, nome: string, onde: string) {
    if (!confirm(`Remover "${nome}" da receita "${onde}"?`)) return;
    const r = await fetch(`/api/ficha/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return;
    }
    start(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      {produtoTipo === 'INSUMO' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Este produto é um <strong>INSUMO</strong>. Normalmente só aparece nas fichas de
          outros produtos. Veja a seção "Usado em" abaixo.
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-slate-900">Insumos consumidos</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Quantidade consumida por 1 unidade vendida (na unidade de estoque do insumo). Linhas
          com <em>baixa</em> desligada não geram movimento de estoque.
          {tamanhos.length > 1 && (
            <>
              {' '}Cada <strong>tamanho</strong> tem a sua receita e o seu custo: a venda baixa a
              receita do tamanho vendido
              {temBase ? '; a receita geral só vale pro tamanho que não tiver a própria' : ''}.
            </>
          )}
        </p>
      </div>

      {grupos.map((g) => {
        const custo = g.linhas.reduce((s, l) => s + (l.custo ?? 0), 0);
        const semCusto = g.linhas.filter((l) => l.semCusto).map((l) => l.insumoNome);
        const cmv = g.precoVenda && g.precoVenda > 0 && custo > 0 ? (custo / g.precoVenda) * 100 : null;
        const outros = grupos.filter((o) => o.chave !== g.chave && o.linhas.length > 0);
        const vazioSemBase = !g.ehBase && g.linhas.length === 0 && g.varianteId !== '__orfas__';
        return (
          <div key={g.chave} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-slate-900">{g.titulo}</span>
                {g.pausado && g.varianteId !== '__orfas__' && (
                  <span className="rounded bg-slate-200 px-1 py-0.5 text-[10px] text-slate-600">pausado</span>
                )}
                {g.precoVenda != null && (
                  <span className="text-xs text-slate-500">venda {brl(g.precoVenda)}</span>
                )}
                <span className="text-xs text-slate-700">
                  custo <strong className="font-semibold">{brl(custo)}</strong>
                </span>
                {cmv != null && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      cmv <= 30 ? 'bg-emerald-100 text-emerald-800' : cmv <= 40 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                    }`}
                    title="custo dos insumos ÷ preço de venda"
                  >
                    CMV {cmv.toFixed(1)}%
                  </span>
                )}
              </div>
              {g.varianteId !== '__orfas__' && (
                <div className="flex items-center gap-2">
                  {outros.length > 0 && (
                    <select
                      value=""
                      disabled={copiando !== null || pending}
                      onChange={(e) => {
                        const o = outros.find((x) => x.chave === e.target.value);
                        if (o) copiar(g, o);
                      }}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      <option value="">{copiando === g.chave ? 'Copiando...' : '⧉ Copiar de...'}</option>
                      {outros.map((o) => (
                        <option key={o.chave} value={o.chave}>
                          {o.titulo}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setErro(null);
                      setAdicionar(g);
                    }}
                    className="rounded-lg border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    + Adicionar insumo
                  </button>
                </div>
              )}
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Insumo</th>
                  <th className="px-4 py-2 text-right">Quantidade</th>
                  <th className="px-4 py-2">Un.</th>
                  <th className="px-4 py-2 text-right">Custo</th>
                  <th className="px-4 py-2">Baixa estoque</th>
                  <th className="px-4 py-2">Obs</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {g.linhas.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-4 text-center text-xs text-slate-500">
                      {vazioSemBase
                        ? temBase
                          ? 'Sem receita própria — usa a receita geral.'
                          : 'Sem receita: a venda deste tamanho não baixa nenhum insumo.'
                        : 'Nenhum insumo na receita.'}
                    </td>
                  </tr>
                ) : (
                  g.linhas.map((l) => (
                    <LinhaFichaRow
                      key={l.id}
                      linha={l}
                      onChange={async (patchBody) => {
                        const ok = await patch(l.id, patchBody);
                        if (ok) start(() => router.refresh());
                      }}
                      onRemove={() => remover(l.id, l.insumoNome, g.titulo)}
                    />
                  ))
                )}
              </tbody>
            </table>
            {semCusto.length > 0 && (
              <div className="border-t border-amber-100 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-800">
                Sem custo cadastrado (entra como R$ 0): {semCusto.join(', ')}. Dá entrada por nota ou
                ajuste o custo em Saldo &amp; Custo do insumo.
              </div>
            )}
          </div>
        );
      })}

      {usadoEm.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-900">
            Usado em {usadoEm.length} {usadoEm.length === 1 ? 'produto' : 'produtos'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Produtos compostos que consomem este como insumo.
          </p>
          <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Produto</th>
                  <th className="px-4 py-2 text-right">Qtd por unidade</th>
                </tr>
              </thead>
              <tbody>
                {usadoEm.map((u) => (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-xs">
                      <Link
                        href={`/cadastros/produtos/${u.produtoId}`}
                        className="text-slate-800 hover:text-slate-900 hover:underline"
                      >
                        {u.produtoNome}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                      {Number(u.quantidade)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adicionar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setAdicionar(null)}
        >
          <form
            onSubmit={criar}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <h2 className="text-sm font-semibold text-slate-900">
              Adicionar insumo — <span className="text-indigo-700">{adicionar.titulo}</span>
            </h2>


            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Buscar insumo
              </label>
              <input
                type="text"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setInsumoId('');
                }}
                autoFocus
                placeholder="Digite pra filtrar..."
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              {busca.trim() && !insumoId && (
                <div className="mt-1 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-white">
                  {opcoesFiltradas.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-slate-500">
                      Nenhum insumo encontrado. Crie em{' '}
                      <Link href="/cadastros/produtos" className="text-slate-700 underline">
                        Produtos → Novo insumo
                      </Link>
                      .
                    </div>
                  ) : (
                    opcoesFiltradas.map((o) => (
                      <button
                        type="button"
                        key={o.id}
                        onClick={() => {
                          setInsumoId(o.id);
                          setBusca(o.nome);
                        }}
                        className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-left text-xs last:border-b-0 hover:bg-slate-50"
                      >
                        <span className="text-slate-800">{o.nome}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                            {o.tipo === 'INSUMO' ? 'insumo' : o.tipo === 'VENDA_SIMPLES' ? 'simples' : o.tipo}
                          </span>
                          <span className="font-mono text-[10px] text-slate-500">{o.unidade}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {insumoEscolhido && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{insumoEscolhido.nome}</span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {insumoEscolhido.unidade}
                  </span>
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Quantidade {insumoEscolhido ? `(${insumoEscolhido.unidade})` : ''} *
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                placeholder="Ex: 50 (ml), 1 (un), 0.3 (kg)"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                required
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={baixaEstoque}
                onChange={(e) => setBaixaEstoque(e.target.checked)}
              />
              Baixa estoque nesta linha (desmarcar pra decoração simbólica)
            </label>

            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Observação
              </label>
              <input
                type="text"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Ex: copo 300ml, decorar com casca"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>

            {erro && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {erro}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdicionar(null)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending || !insumoId || !quantidade.trim()}
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {pending ? 'Adicionando...' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function LinhaFichaRow({
  linha,
  onChange,
  onRemove,
}: {
  linha: LinhaFicha;
  onChange: (body: Record<string, unknown>) => Promise<void>;
  onRemove: () => void;
}) {
  const [editQtd, setEditQtd] = useState(false);
  const [qtd, setQtd] = useState(String(Number(linha.quantidade)));
  const [savingFlag, setSavingFlag] = useState(false);

  async function salvarQtd() {
    const q = Number(qtd.replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) {
      alert('Quantidade inválida');
      return;
    }
    await onChange({ quantidade: q });
    setEditQtd(false);
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2 text-xs">
        <Link
          href={`/cadastros/produtos/${linha.insumoId}`}
          className="text-slate-800 hover:underline"
        >
          {linha.insumoNome}
        </Link>
        {linha.insumoTipo !== 'INSUMO' && (
          <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-500">
            {linha.insumoTipo === 'VENDA_SIMPLES' ? 'simples' : linha.insumoTipo}
          </span>
        )}
        {!linha.insumoControla && (
          <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] text-amber-800">
            não controla
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-right font-mono text-xs">
        {editQtd ? (
          <input
            type="text"
            value={qtd}
            onChange={(e) => setQtd(e.target.value)}
            onBlur={salvarQtd}
            onKeyDown={(e) => {
              if (e.key === 'Enter') salvarQtd();
              if (e.key === 'Escape') {
                setQtd(String(Number(linha.quantidade)));
                setEditQtd(false);
              }
            }}
            autoFocus
            className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right text-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditQtd(true)}
            className="hover:bg-slate-50 px-1"
          >
            {Number(linha.quantidade)}
          </button>
        )}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-slate-500">
        {linha.unidade && linha.unidade !== linha.insumoUnidade ? (
          <span title={`convertido pra ${linha.insumoUnidade} na baixa`}>{linha.unidade} →{linha.insumoUnidade}</span>
        ) : (
          linha.insumoUnidade
        )}
      </td>
      <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
        {linha.semCusto ? (
          <span className="text-amber-700" title="insumo sem custo cadastrado">—</span>
        ) : (
          brl(linha.custo ?? 0)
        )}
      </td>
      <td className="px-4 py-2">
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={linha.baixaEstoque}
            disabled={savingFlag}
            onChange={async (e) => {
              setSavingFlag(true);
              await onChange({ baixaEstoque: e.target.checked });
              setSavingFlag(false);
            }}
          />
          {linha.baixaEstoque ? 'Sim' : 'Não'}
        </label>
      </td>
      <td className="px-4 py-2 text-xs text-slate-500">
        {linha.observacao || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-4 py-2 text-right">
        <button
          type="button"
          onClick={onRemove}
          className="text-[10px] text-rose-600 hover:text-rose-800 hover:underline"
        >
          remover
        </button>
      </td>
    </tr>
  );
}

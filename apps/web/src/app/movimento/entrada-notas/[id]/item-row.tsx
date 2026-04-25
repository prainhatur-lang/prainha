'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { brl } from '@/lib/format';

interface Item {
  id: string;
  numeroItem: number;
  codigoProdutoFornecedor: string | null;
  ean: string | null;
  descricao: string | null;
  unidade: string | null;
  quantidade: string | null;
  valorUnitario: string | null;
  valorTotal: string | null;
  produtoId: string | null;
  produtoNome: string | null;
  produtoTipo: string | null;
  produtoUnidade: string | null;
  produtoFornecedorId: string | null;
  fatorConversao: string | null;
  lancado: boolean;
}

interface ProdutoOpcao {
  id: string;
  nome: string;
  tipo: string;
  unidade: string;
  codigo: string | null;
}

/** Tenta extrair o fator de conversao da descricao do item da NFe.
 *  Cobre casos comuns:
 *   - "OLEO ALGODAO LIZA 15,8L"     → { num: 15.8, un: 'L' }
 *   - "ARROZ TIO JOAO 5KG"          → { num: 5,    un: 'KG' }
 *   - "REFRI COCA 2L"               → { num: 2,    un: 'L' }
 *   - "AGUA MIN 500ML"              → { num: 500,  un: 'ML' }
 *
 *  Retorna o fator ja convertido pra unidade do produto interno quando possivel:
 *   - desc=15,8L  + produtoUnidade=l  → fator 15.8
 *   - desc=2L     + produtoUnidade=ml → fator 2000
 *   - desc=5KG    + produtoUnidade=g  → fator 5000
 *   - desc=500ML  + produtoUnidade=l  → fator 0.5
 *   - sem match ou unidades incompativeis → fator 1 (default neutro)
 */
function sugerirFator(
  descricao: string | null,
  produtoUnidade: string | null,
): { fator: number; explicacao: string | null } {
  if (!descricao) return { fator: 1, explicacao: null };
  // Regex tolerante: numero (vírgula ou ponto) + unidade (L|ML|KG|G), com ou sem espaço.
  const m = descricao.toUpperCase().match(/(\d+(?:[.,]\d+)?)\s*(KG|ML|L|G)\b/);
  if (!m) return { fator: 1, explicacao: null };

  const num = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return { fator: 1, explicacao: null };
  const un = m[2];

  const u = (produtoUnidade ?? '').toLowerCase();

  // Mesma unidade
  if ((un === 'L' && u === 'l') || (un === 'ML' && u === 'ml') ||
      (un === 'KG' && u === 'kg') || (un === 'G' && u === 'g')) {
    return { fator: num, explicacao: `${num}${un.toLowerCase()} por embalagem` };
  }

  // Conversoes
  if (un === 'L' && u === 'ml') return { fator: num * 1000, explicacao: `${num}L = ${num * 1000}ml` };
  if (un === 'ML' && u === 'l') return { fator: num / 1000, explicacao: `${num}ml = ${(num / 1000).toFixed(3)}l` };
  if (un === 'KG' && u === 'g') return { fator: num * 1000, explicacao: `${num}kg = ${num * 1000}g` };
  if (un === 'G' && u === 'kg') return { fator: num / 1000, explicacao: `${num}g = ${(num / 1000).toFixed(3)}kg` };

  // Unidade interna eh 'un': nao da pra converter automatico.
  return { fator: 1, explicacao: null };
}

export function ItemRow({
  item,
  produtosDisponiveis,
  filialId,
}: {
  item: Item;
  produtosDisponiveis: ProdutoOpcao[];
  filialId: string;
}) {
  const router = useRouter();
  const [modal, setModal] = useState(false);
  const [editandoFator, setEditandoFator] = useState(false);
  const [pending, start] = useTransition();

  async function vincular(produtoId: string | null, fator?: number) {
    const r = await fetch(`/api/nota-compra-item/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ produtoId, fator }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return false;
    }
    setModal(false);
    start(() => router.refresh());
    return true;
  }

  const qtd = Number(item.quantidade ?? 0);
  const unit = Number(item.valorUnitario ?? 0);
  const fatorAtual = Number(item.fatorConversao ?? 1);
  const fatorDiferenteDeUm = Math.abs(fatorAtual - 1) > 1e-9;

  return (
    <tr
      className={`border-t border-slate-100 ${item.lancado ? 'bg-slate-50/60 text-slate-500' : ''}`}
    >
      <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{item.numeroItem}</td>
      <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
        {item.codigoProdutoFornecedor || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
        {item.ean || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2 text-xs">
        <div className="max-w-xs truncate" title={item.descricao ?? ''}>
          {item.descricao || '—'}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">{qtd}</td>
      <td className="px-3 py-2 font-mono text-[10px] text-slate-500">
        {item.unidade || '—'}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">{brl(unit)}</td>
      <td className="px-3 py-2 text-right font-mono text-xs font-medium">
        {brl(Number(item.valorTotal ?? 0))}
      </td>
      <td className="px-3 py-2 text-xs">
        {item.produtoId && item.produtoNome ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Link
                href={`/cadastros/produtos/${item.produtoId}`}
                className="max-w-[180px] truncate text-slate-800 hover:underline"
                title={item.produtoNome}
              >
                {item.produtoNome}
              </Link>
              {item.produtoTipo === 'INSUMO' && (
                <span className="rounded bg-sky-100 px-1 py-0.5 text-[9px] text-sky-800">
                  insumo
                </span>
              )}
              {item.lancado ? (
                <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] text-emerald-800">
                  ✓ lançado
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setModal(true)}
                  className="text-[10px] text-slate-500 hover:text-slate-800 hover:underline"
                >
                  trocar
                </button>
              )}
            </div>
            {/* Fator de conversao — so quando ainda nao lancou e pode editar */}
            {!item.lancado && item.produtoFornecedorId && (
              <FatorInline
                produtoFornecedorId={item.produtoFornecedorId}
                fatorAtual={fatorAtual}
                qtdNota={qtd}
                produtoUnidade={item.produtoUnidade ?? ''}
                unidadeNota={item.unidade ?? ''}
                editando={editandoFator}
                setEditando={setEditandoFator}
                onSalvo={() => start(() => router.refresh())}
              />
            )}
            {/* Quando ja lancou, so mostra o fator usado (read-only) */}
            {item.lancado && fatorDiferenteDeUm && (
              <span className="text-[10px] text-slate-500">
                fator ×{fatorAtual} → {(qtd * fatorAtual).toLocaleString('pt-BR')}{' '}
                {item.produtoUnidade}
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setModal(true)}
            className="rounded border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-500 hover:border-slate-500 hover:text-slate-800"
          >
            vincular produto
          </button>
        )}
      </td>

      {modal && (
        <ModalVincular
          item={item}
          produtosDisponiveis={produtosDisponiveis}
          filialId={filialId}
          onFechar={() => setModal(false)}
          onVincular={vincular}
        />
      )}
    </tr>
  );
}

/** Edicao inline do fator de conversao apos o item ja estar vinculado.
 *  Usa PATCH /api/produto-fornecedor/[id] (existente).
 */
function FatorInline({
  produtoFornecedorId,
  fatorAtual,
  qtdNota,
  produtoUnidade,
  unidadeNota,
  editando,
  setEditando,
  onSalvo,
}: {
  produtoFornecedorId: string;
  fatorAtual: number;
  qtdNota: number;
  produtoUnidade: string;
  unidadeNota: string;
  editando: boolean;
  setEditando: (v: boolean) => void;
  onSalvo: () => void;
}) {
  const [valor, setValor] = useState(String(fatorAtual));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    const num = Number(valor.replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) {
      setErro('fator inválido');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/produto-fornecedor/${produtoFornecedorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fatorConversao: num }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setEditando(false);
      onSalvo();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const qtdInterna = qtdNota * fatorAtual;
  const fatorDiferente = Math.abs(fatorAtual - 1) > 1e-9;

  if (!editando) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-slate-500">
        {fatorDiferente ? (
          <span>
            fator <span className="font-mono font-medium text-slate-700">×{fatorAtual}</span>
            {' → '}
            <span className="font-mono font-medium text-slate-700">
              {qtdInterna.toLocaleString('pt-BR')} {produtoUnidade}
            </span>
          </span>
        ) : (
          <span className="text-slate-400">
            fator ×1 (sem conversão entre {unidadeNota || '?'} e {produtoUnidade || '?'})
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setValor(String(fatorAtual));
            setEditando(true);
          }}
          className="text-slate-500 hover:text-slate-800 hover:underline"
        >
          editar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-slate-500">fator ×</span>
        <input
          type="text"
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className="w-20 rounded border border-slate-300 px-1.5 py-0.5 font-mono text-xs"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') salvar();
            if (e.key === 'Escape') setEditando(false);
          }}
        />
        <button
          type="button"
          disabled={salvando}
          onClick={salvar}
          className="rounded bg-slate-900 px-2 py-0.5 text-[10px] text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {salvando ? '...' : 'salvar'}
        </button>
        <button
          type="button"
          onClick={() => setEditando(false)}
          className="text-[10px] text-slate-500 hover:underline"
        >
          cancelar
        </button>
      </div>
      {erro && <span className="text-[10px] text-rose-600">{erro}</span>}
      <span className="text-[9px] text-slate-400">
        {qtdNota} {unidadeNota} × {valor || '?'} = qtd no estoque ({produtoUnidade})
      </span>
    </div>
  );
}

function ModalVincular({
  item,
  produtosDisponiveis,
  filialId,
  onFechar,
  onVincular,
}: {
  item: Item;
  produtosDisponiveis: ProdutoOpcao[];
  filialId: string;
  onFechar: () => void;
  onVincular: (produtoId: string | null, fator?: number) => Promise<boolean>;
}) {
  const [busca, setBusca] = useState((item.descricao ?? '').slice(0, 30));
  const [pending, start] = useTransition();
  const [aba, setAba] = useState<'vincular' | 'criar'>('vincular');

  // Aba "criar insumo" state
  const [nomeInsumo, setNomeInsumo] = useState(item.descricao ?? '');
  const [unidadeInsumo, setUnidadeInsumo] = useState<'un' | 'ml' | 'g' | 'kg' | 'l'>('un');
  const [erroCriar, setErroCriar] = useState<string | null>(null);

  // Produto selecionado pra ver/editar fator antes de vincular.
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProdutoOpcao | null>(null);
  const [fatorTexto, setFatorTexto] = useState<string>('1');

  const opcoes = useMemo(() => {
    const b = busca.trim().toLowerCase();
    if (!b) return produtosDisponiveis.slice(0, 30);
    return produtosDisponiveis
      .filter((p) => {
        const nome = p.nome.toLowerCase();
        const cod = (p.codigo ?? '').toLowerCase();
        return nome.includes(b) || cod.includes(b);
      })
      .slice(0, 50);
  }, [busca, produtosDisponiveis]);

  function escolherProduto(p: ProdutoOpcao) {
    setProdutoSelecionado(p);
    const sug = sugerirFator(item.descricao, p.unidade);
    setFatorTexto(String(sug.fator));
  }

  async function confirmarVinculo() {
    if (!produtoSelecionado) return;
    const num = Number(fatorTexto.replace(',', '.'));
    const fator = Number.isFinite(num) && num > 0 ? num : 1;
    start(async () => {
      await onVincular(produtoSelecionado.id, fator);
    });
  }

  async function criarEVincular(e: React.FormEvent) {
    e.preventDefault();
    if (!nomeInsumo.trim()) return;
    setErroCriar(null);
    try {
      const r = await fetch('/api/produtos/insumo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId,
          nome: nomeInsumo.trim(),
          unidadeEstoque: unidadeInsumo,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErroCriar(d.error ?? `HTTP ${r.status}`);
        return;
      }
      if (d.id) {
        // Sugere fator pelo insumo recém-criado e a descrição da NFe.
        const sug = sugerirFator(item.descricao, unidadeInsumo);
        await onVincular(d.id, sug.fator);
      }
    } catch (err) {
      setErroCriar((err as Error).message);
    }
  }

  // Calcula a previa em vivo
  const qtdNota = Number(item.quantidade ?? 0);
  const fatorPrev = Number(fatorTexto.replace(',', '.'));
  const fatorPrevValido = Number.isFinite(fatorPrev) && fatorPrev > 0;
  const qtdInterna = fatorPrevValido ? qtdNota * fatorPrev : 0;

  return (
    <td colSpan={9} className="p-0">
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
        onClick={onFechar}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Vincular produto</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Item #{item.numeroItem}:{' '}
              <span className="font-medium text-slate-700">{item.descricao}</span>
            </p>
            <p className="font-mono text-[10px] text-slate-400">
              EAN {item.ean || '—'} · Cód {item.codigoProdutoFornecedor || '—'} ·{' '}
              {qtdNota} {item.unidade || '?'}
            </p>
          </div>

          <div className="flex gap-1 border-b border-slate-200">
            <button
              type="button"
              onClick={() => {
                setAba('vincular');
                setProdutoSelecionado(null);
              }}
              className={`border-b-2 px-3 py-1.5 text-xs ${
                aba === 'vincular'
                  ? 'border-slate-900 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Vincular existente
            </button>
            <button
              type="button"
              onClick={() => {
                setAba('criar');
                setProdutoSelecionado(null);
              }}
              className={`border-b-2 px-3 py-1.5 text-xs ${
                aba === 'criar'
                  ? 'border-slate-900 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Criar novo insumo
            </button>
          </div>

          {aba === 'vincular' ? (
            <>
              {!produtoSelecionado ? (
                <>
                  <div>
                    <input
                      type="text"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      autoFocus
                      placeholder="Buscar por nome ou código..."
                      className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </div>

                  <div className="max-h-80 overflow-y-auto rounded-md border border-slate-200">
                    {opcoes.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-slate-500">
                        Nenhum produto encontrado. Tente criar um novo insumo.
                      </div>
                    ) : (
                      opcoes.map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          disabled={pending}
                          onClick={() => escolherProduto(p)}
                          className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-slate-50"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-slate-800">{p.nome}</div>
                            {p.codigo && (
                              <div className="font-mono text-[10px] text-slate-400">
                                {p.codigo}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                              {p.tipo === 'INSUMO'
                                ? 'insumo'
                                : p.tipo === 'VENDA_SIMPLES'
                                  ? 'produto'
                                  : p.tipo.toLowerCase()}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500">
                              {p.unidade}
                            </span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : (
                // Tela de confirmacao com fator
                <ConfirmarFator
                  produto={produtoSelecionado}
                  qtdNota={qtdNota}
                  unidadeNota={item.unidade ?? ''}
                  descricao={item.descricao ?? ''}
                  fatorTexto={fatorTexto}
                  setFatorTexto={setFatorTexto}
                  qtdInterna={qtdInterna}
                  fatorValido={fatorPrevValido}
                  onVoltar={() => setProdutoSelecionado(null)}
                  onConfirmar={confirmarVinculo}
                  pending={pending}
                />
              )}
            </>
          ) : (
            <form onSubmit={criarEVincular} className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Nome do insumo *
                </label>
                <input
                  type="text"
                  value={nomeInsumo}
                  onChange={(e) => setNomeInsumo(e.target.value)}
                  autoFocus
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Unidade de estoque *
                </label>
                <select
                  value={unidadeInsumo}
                  onChange={(e) => setUnidadeInsumo(e.target.value as typeof unidadeInsumo)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <option value="un">un</option>
                  <option value="ml">ml</option>
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                  <option value="l">l</option>
                </select>
              </div>
              {/* Previa do fator pra unidade escolhida */}
              {(() => {
                const sug = sugerirFator(item.descricao, unidadeInsumo);
                if (sug.fator !== 1 && sug.explicacao) {
                  return (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
                      <strong>Fator detectado:</strong> ×{sug.fator} ({sug.explicacao}).<br />
                      Cada {item.unidade || 'UN'} da NFe vai virar {sug.fator}{' '}
                      {unidadeInsumo} no estoque.
                    </div>
                  );
                }
                return (
                  <p className="text-[10px] text-slate-500">
                    Fator de conversão será 1 por padrão (1 {item.unidade || 'UN'} da
                    NFe = 1 {unidadeInsumo} no estoque). Editável depois.
                  </p>
                );
              })()}
              <p className="text-[10px] text-slate-500">
                Insumo será criado como "nuvem" e já vinculado a este item. O
                código/EAN do fornecedor vão pro mapeamento de fornecedor
                automaticamente.
              </p>
              {erroCriar && (
                <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  {erroCriar}
                </div>
              )}
              <button
                type="submit"
                disabled={pending || !nomeInsumo.trim()}
                className="w-full rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {pending ? 'Criando...' : 'Criar insumo + vincular'}
              </button>
            </form>
          )}

          <div className="flex justify-between border-t border-slate-100 pt-3">
            {item.produtoId ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => { await onVincular(null); })}
                className="text-[11px] text-rose-600 hover:text-rose-800 hover:underline"
              >
                Desvincular
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onFechar}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </td>
  );
}

/** Tela intermediaria: produto escolhido, mostra/edita fator antes de gravar. */
function ConfirmarFator({
  produto,
  qtdNota,
  unidadeNota,
  descricao,
  fatorTexto,
  setFatorTexto,
  qtdInterna,
  fatorValido,
  onVoltar,
  onConfirmar,
  pending,
}: {
  produto: ProdutoOpcao;
  qtdNota: number;
  unidadeNota: string;
  descricao: string;
  fatorTexto: string;
  setFatorTexto: (v: string) => void;
  qtdInterna: number;
  fatorValido: boolean;
  onVoltar: () => void;
  onConfirmar: () => void;
  pending: boolean;
}) {
  const sug = sugerirFator(descricao, produto.unidade);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Produto interno
        </p>
        <p className="mt-1 text-sm font-medium text-slate-900">{produto.nome}</p>
        <p className="mt-0.5 font-mono text-[10px] text-slate-500">
          unidade de estoque: <span className="font-semibold">{produto.unidade}</span>
        </p>
      </div>

      <div>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Fator de conversão
        </label>
        <p className="mt-0.5 text-[10px] text-slate-500">
          Quantos <span className="font-semibold">{produto.unidade}</span> entram em 1{' '}
          <span className="font-semibold">{unidadeNota || 'UN'}</span> da NFe?
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-sm text-slate-500">×</span>
          <input
            type="text"
            inputMode="decimal"
            value={fatorTexto}
            onChange={(e) => setFatorTexto(e.target.value)}
            className="w-32 rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-sm"
            autoFocus
          />
          {sug.fator !== 1 && Number(fatorTexto.replace(',', '.')) !== sug.fator && (
            <button
              type="button"
              onClick={() => setFatorTexto(String(sug.fator))}
              className="text-[10px] text-sky-700 hover:underline"
              title="Aplica a sugestão automática extraída da descrição"
            >
              usar sugestão ×{sug.fator}
            </button>
          )}
        </div>
        {sug.explicacao && (
          <p className="mt-1 text-[10px] text-emerald-700">
            ✓ Detectado na descrição: {sug.explicacao}
          </p>
        )}
      </div>

      <div
        className={`rounded-lg border p-3 ${
          fatorValido
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-rose-200 bg-rose-50'
        }`}
      >
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-700">
          Vai entrar no estoque
        </p>
        {fatorValido ? (
          <p className="mt-1 font-mono text-sm">
            <span className="text-slate-500">{qtdNota} {unidadeNota || 'UN'} ×{' '}</span>
            <span className="font-semibold text-slate-900">{fatorTexto}</span>{' '}
            <span className="text-slate-500">=</span>{' '}
            <span className="font-bold text-emerald-900">
              {qtdInterna.toLocaleString('pt-BR')} {produto.unidade}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-xs text-rose-800">Fator inválido (precisa ser positivo).</p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onVoltar}
          disabled={pending}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          ← Voltar
        </button>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={pending || !fatorValido}
          className="flex-1 rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? 'Vinculando...' : 'Vincular com este fator'}
        </button>
      </div>
    </div>
  );
}

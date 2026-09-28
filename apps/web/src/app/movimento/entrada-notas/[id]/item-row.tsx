'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { brl } from '@/lib/format';
import { normalizaBusca } from '@/lib/texto';
import { BotaoConfirmarConversao, ConversaoEmbalagem, resumoEntrada, textoConversao } from '@/components/conversao-embalagem';

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
  /** ml por embalagem (garrafa de 1L = 1000) — fator quando a NF não diz o volume. */
  volumeMl?: number | null;
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
  volumeMl: number | null = null,
): { fator: number; explicacao: string | null } {
  const u0 = (produtoUnidade ?? '').toLowerCase();
  // Insumo em ml com volume cadastrado: "CAMPARI" (sem litragem na NF) = 1 garrafa.
  const peloCadastro = volumeMl && volumeMl > 0 && (u0 === 'ml' || u0 === 'l')
    ? { fator: u0 === 'ml' ? volumeMl : volumeMl / 1000, explicacao: `1 embalagem = ${volumeMl}ml (cadastro)` }
    : null;
  if (!descricao) return peloCadastro ?? { fator: 1, explicacao: null };
  // Regex tolerante: numero (vírgula ou ponto) + unidade (L|ML|KG|G), com ou sem espaço.
  const m = descricao.toUpperCase().match(/(\d+(?:[.,]\d+)?)\s*(KG|ML|L|G)\b/);
  if (!m) return peloCadastro ?? { fator: 1, explicacao: null };

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
  return peloCadastro ?? { fator: 1, explicacao: null };
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
                produtoNome={item.produtoNome ?? ''}
                editando={editandoFator}
                setEditando={setEditandoFator}
                onSalvo={() => start(() => router.refresh())}
              />
            )}
            {/* Quando ja lancou, so mostra o fator usado (read-only) */}
            {item.lancado && fatorDiferenteDeUm && (
              <span className="text-[10px] text-slate-500">
                {textoConversao(item.unidade || 'UN', fatorAtual, item.produtoUnidade ?? '')} → entrou{' '}
                {(qtd * fatorAtual).toLocaleString('pt-BR')} {item.produtoUnidade}
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
  produtoNome,
  editando,
  setEditando,
  onSalvo,
}: {
  produtoFornecedorId: string;
  fatorAtual: number;
  qtdNota: number;
  produtoUnidade: string;
  unidadeNota: string;
  produtoNome: string;
  editando: boolean;
  setEditando: (v: boolean) => void;
  onSalvo: () => void;
}) {
  const [fator, setFator] = useState<number | null>(fatorAtual);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const medida = ['ml', 'l', 'g', 'kg'].includes(produtoUnidade.toLowerCase());

  async function salvar() {
    if (!fator || fator <= 0) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/produto-fornecedor/${produtoFornecedorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fatorConversao: fator }),
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
        {fatorDiferente || !medida ? (
          <span>
            {textoConversao(unidadeNota || 'UN', fatorAtual, produtoUnidade)}
            {' → vão entrar '}
            <span className="font-mono font-medium text-slate-700">
              {qtdInterna.toLocaleString('pt-BR')} {produtoUnidade}
            </span>
          </span>
        ) : (
          // Estoque em ml/g e 1 garrafa = 1 ml: quase sempre é o tamanho que faltou.
          <span className="font-medium text-amber-700">
            ⚠ falta dizer quantos {produtoUnidade} tem cada {unidadeNota || 'UN'}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setFator(fatorDiferente ? fatorAtual : null);
            setEditando(true);
          }}
          className="text-slate-500 hover:text-slate-800 hover:underline"
        >
          {fatorDiferente || !medida ? 'corrigir' : 'responder'}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1 w-80 max-w-full space-y-2 rounded-md border border-slate-200 bg-white p-2">
      <ConversaoEmbalagem
        unidadeCompra={unidadeNota || 'UN'}
        unidadeEstoque={produtoUnidade}
        fatorInicial={fatorDiferente ? fatorAtual : null}
        qtdCompra={qtdNota}
        onChange={setFator}
      />
      {erro && <span className="text-[10px] text-rose-600">{erro}</span>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setEditando(false)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] hover:bg-slate-50"
        >
          cancelar
        </button>
        <BotaoConfirmarConversao
          rotulo="Salvar"
          pending={salvando}
          onConfirmar={salvar}
          resumo={resumoEntrada({
            qtdCompra: qtdNota,
            unidadeCompra: unidadeNota,
            fator,
            unidadeEstoque: produtoUnidade,
            produto: produtoNome || 'este insumo',
          })}
        />
      </div>
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
  const [fatorNovo, setFatorNovo] = useState<number | null>(null);

  const opcoes = useMemo(() => {
    const b = normalizaBusca(busca);
    if (!b) return produtosDisponiveis.slice(0, 30);
    return produtosDisponiveis
      .filter((p) => {
        const nome = normalizaBusca(p.nome);
        const cod = normalizaBusca(p.codigo ?? '');
        return nome.includes(b) || cod.includes(b);
      })
      .slice(0, 50);
  }, [busca, produtosDisponiveis]);

  function escolherProduto(p: ProdutoOpcao) {
    setProdutoSelecionado(p);
    const sug = sugerirFator(item.descricao, p.unidade, p.volumeMl ?? null);
    // Insumo em ml/g sem tamanho detectado: começa vazio e obriga a responder
    // "a garrafa tem quantos ml?" (fator 1 = 1 garrafa virando 1 ml).
    const medida = ['ml', 'l', 'g', 'kg'].includes((p.unidade ?? '').toLowerCase());
    setFatorTexto(medida && sug.fator === 1 ? '' : String(sug.fator));
  }

  async function confirmarVinculo() {
    if (!produtoSelecionado) return;
    const num = Number(fatorTexto.replace(',', '.'));
    const fator = Number.isFinite(num) && num > 0 ? num : 1;
    start(async () => {
      await onVincular(produtoSelecionado.id, fator);
    });
  }

  async function criarEVincular() {
    if (!nomeInsumo.trim() || !fatorNovo) return;
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
        // Fator respondido na tela ("a garrafa tem quantos ml?") e conferido.
        await onVincular(d.id, fatorNovo);
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
            <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
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
              {(() => {
                const sug = sugerirFator(item.descricao, unidadeInsumo);
                const detectado = sug.fator !== 1 && sug.explicacao ? sug : null;
                return (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    {detectado && (
                      <p className="mb-2 text-[10px] text-emerald-700">
                        ✓ Lido na descrição da nota: {detectado.explicacao}. Confira no rótulo.
                      </p>
                    )}
                    <ConversaoEmbalagem
                      key={unidadeInsumo}
                      unidadeCompra={item.unidade || 'UN'}
                      unidadeEstoque={unidadeInsumo}
                      fatorInicial={detectado || unidadeInsumo === 'un' ? sug.fator : null}
                      qtdCompra={Number(item.quantidade ?? 0)}
                      onChange={setFatorNovo}
                    />
                  </div>
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
              <div className="flex">
                <BotaoConfirmarConversao
                  rotulo="Criar insumo + vincular"
                  pending={pending}
                  onConfirmar={() => start(criarEVincular)}
                  resumo={
                    nomeInsumo.trim()
                      ? resumoEntrada({
                          qtdCompra: Number(item.quantidade ?? 0),
                          unidadeCompra: item.unidade,
                          fator: fatorNovo,
                          unidadeEstoque: unidadeInsumo,
                          produto: nomeInsumo.trim(),
                        })
                      : null
                  }
                />
              </div>
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
  const sug = sugerirFator(descricao, produto.unidade, produto.volumeMl ?? null);

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
        {sug.explicacao && sug.fator !== 1 && (
          <p className="mb-2 text-[10px] text-emerald-700">
            ✓ Lido na descrição da nota: {sug.explicacao}. Confira no rótulo.
          </p>
        )}
        <ConversaoEmbalagem
          unidadeCompra={unidadeNota || 'UN'}
          unidadeEstoque={produto.unidade}
          fatorInicial={Number(fatorTexto.replace(',', '.')) || null}
          qtdCompra={qtdNota}
          onChange={(f) => setFatorTexto(f == null ? '' : String(f))}
        />
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
        <BotaoConfirmarConversao
          rotulo="Continuar"
          pending={pending}
          onConfirmar={onConfirmar}
          resumo={
            fatorValido
              ? resumoEntrada({
                  qtdCompra: qtdNota,
                  unidadeCompra: unidadeNota,
                  fator: qtdInterna / (qtdNota || 1) || Number(fatorTexto.replace(',', '.')),
                  unidadeEstoque: produto.unidade,
                  produto: produto.nome,
                })
              : null
          }
        />
      </div>
    </div>
  );
}

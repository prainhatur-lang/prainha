'use client';

// Editor do cardápio do delivery.
//
// Dois caminhos pra montar o cardápio:
//  1. "Trazer produtos" — abre o cardápio do salão inteiro numa janela, você
//     marca no checkbox o que quer e escolhe (ou cria) a categoria destino.
//     Visível sempre, inclusive com zero categorias.
//  2. "+ Item" dentro de uma categoria — cadastro do zero.
//
// Cada item carrega os três preços do negócio: salão (só leitura, ao vivo do
// PDV), delivery próprio (o que o site cobra) e iFood.

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { comprimirImagem } from '@/lib/comprimir-imagem';

interface Categoria {
  id: string;
  nome: string;
  ordem: number;
  ativo: boolean;
}

interface Item {
  id: string;
  categoriaId: string;
  nome: string;
  descricao: string | null;
  preco: string;
  precoIfood: string | null;
  checarEstoque: boolean;
  varianteId: string | null;
  fotoUrl: string | null;
  ativo: boolean;
  esgotado: boolean;
  destaque: boolean;
  ordem: number;
  precoSalaoCentavos: number | null;
  estoqueControlado: boolean;
  estoqueAtual: number | null;
}

interface Props {
  filialId: string;
  filialNome: string;
  filiais: Array<{ id: string; nome: string }>;
  categorias: Categoria[];
  itens: Item[];
  podeCriar: boolean;
  podeEditar: boolean;
  podeDeletar: boolean;
}

interface ItemSalao {
  varianteId: string;
  nome: string;
  descricao: string | null;
  precoCentavos: number;
  estoqueControlado: boolean;
  estoqueAtual: number | null;
  jaNoCardapio: boolean;
}

const brl = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 focus:border-sky-500 focus:outline-none sm:py-2 sm:text-sm';
const lblCls = 'text-xs font-medium text-slate-600';

/** Estoque em texto curto pro painel. */
function estoqueLabel(controlado: boolean, saldo: number | null): string | null {
  if (!controlado) return null;
  const n = saldo ?? 0;
  return n > 0 ? `${n} em estoque` : 'sem estoque';
}

export function CardapioAdminClient({
  filialId,
  filialNome,
  filiais,
  categorias,
  itens,
  podeCriar,
  podeEditar,
  podeDeletar,
}: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [novaCategoria, setNovaCategoria] = useState('');
  const [editando, setEditando] = useState<Item | null>(null);
  const [novoEm, setNovoEm] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // janela "Trazer produtos"
  const [janelaAberta, setJanelaAberta] = useState(false);
  const [salao, setSalao] = useState<ItemSalao[] | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [buscaSalao, setBuscaSalao] = useState('');
  const [esconderJaTem, setEsconderJaTem] = useState(true);
  const [soComEstoque, setSoComEstoque] = useState(false);
  const [destinoId, setDestinoId] = useState<string>('');
  const [destinoNova, setDestinoNova] = useState('');

  function ok(texto: string) {
    setMsg(texto);
    setErro(null);
    start(() => router.refresh());
  }

  const api = useCallback(async (url: string, method: string, body?: unknown): Promise<boolean> => {
    setErro(null);
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(d.error ?? `Erro ${r.status}`);
      return false;
    }
    return true;
  }, []);

  async function criarCategoria() {
    if (!novaCategoria.trim()) return;
    const maiorOrdem = categorias.reduce((m, c) => Math.max(m, c.ordem), 0);
    if (
      await api('/api/delivery-admin/categoria', 'POST', {
        filialId,
        nome: novaCategoria,
        ordem: maiorOrdem + 1,
      })
    ) {
      setNovaCategoria('');
      ok('Categoria criada.');
    }
  }

  async function salvarItem(item: Partial<Item> & { categoriaId: string }) {
    setSalvando(true);
    try {
      const novo = !item.id;
      const corpo = {
        ...(novo ? { filialId } : { id: item.id }),
        categoriaId: item.categoriaId,
        nome: item.nome,
        descricao: item.descricao ?? '',
        preco: item.preco,
        precoIfood: item.precoIfood ?? null,
        checarEstoque: item.checarEstoque !== false,
        fotoUrl: item.fotoUrl ?? '',
        destaque: item.destaque === true,
      };
      if (await api('/api/delivery-admin/item', novo ? 'POST' : 'PATCH', corpo)) {
        setEditando(null);
        setNovoEm(null);
        ok(novo ? 'Item adicionado.' : 'Item salvo.');
      }
    } finally {
      setSalvando(false);
    }
  }

  async function enviarFoto(arquivo: File): Promise<{ url: string; path: string } | null> {
    try {
      const { arquivo: comprimido } = await comprimirImagem(arquivo, {
        maxLado: 1200,
        qualidade: 0.82,
      });
      const form = new FormData();
      form.append('arquivo', comprimido);
      form.append('filialId', filialId);
      const r = await fetch('/api/delivery-admin/foto', { method: 'POST', body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? 'Falha no upload da foto.');
        return null;
      }
      return { url: d.url, path: d.path };
    } catch {
      setErro('Não consegui processar essa imagem.');
      return null;
    }
  }

  const abrirJanela = useCallback(
    async (categoriaPreferida?: string) => {
      setJanelaAberta(true);
      setSalao(null);
      setSelecionados(new Set());
      setBuscaSalao('');
      setDestinoId(categoriaPreferida ?? categorias[0]?.id ?? '');
      setDestinoNova('');
      const r = await fetch(`/api/delivery-admin/importar-salao?filialId=${filialId}`, {
        cache: 'no-store',
      });
      const d = await r.json().catch(() => ({ itens: [] }));
      setSalao(d.itens ?? []);
    },
    [filialId, categorias],
  );

  // Abre a janela direto quando a URL tem ?produtos=1 (link de "Trazer produtos")
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('produtos=1')) {
      void abrirJanela();
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const salaoFiltrado = useMemo(() => {
    const busca = buscaSalao.trim().toLowerCase();
    return (salao ?? []).filter((s) => {
      if (busca && !s.nome.toLowerCase().includes(busca)) return false;
      if (esconderJaTem && s.jaNoCardapio && !selecionados.has(s.varianteId)) return false;
      if (soComEstoque && (!s.estoqueControlado || (s.estoqueAtual ?? 0) <= 0)) return false;
      return true;
    });
  }, [salao, buscaSalao, esconderJaTem, soComEstoque, selecionados]);

  async function importarSelecionados() {
    if (selecionados.size === 0 || !salao) return;
    if (!destinoId && !destinoNova.trim()) {
      setErro('Escolha a categoria de destino (ou digite o nome de uma nova).');
      return;
    }
    setSalvando(true);
    try {
      const escolhidos = salao
        .filter((s) => selecionados.has(s.varianteId))
        .map((s) => ({
          varianteId: s.varianteId,
          nome: s.nome,
          descricao: s.descricao,
          preco: (s.precoCentavos / 100).toFixed(2),
        }));
      const r = await fetch('/api/delivery-admin/importar-salao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          categoriaId: destinoNova.trim() ? undefined : destinoId,
          categoriaNova: destinoNova.trim() || undefined,
          itens: escolhidos,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      setJanelaAberta(false);
      setSalao(null);
      setSelecionados(new Set());
      ok(
        `${escolhidos.length} produto(s) trazido(s) com o preço do salão — agora ajuste o preço do delivery e do iFood.`,
      );
    } finally {
      setSalvando(false);
    }
  }

  const botaoTrazer = podeCriar ? (
    <button
      onClick={() => void abrirJanela()}
      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
    >
      ＋ Trazer produtos do cardápio
    </button>
  ) : null;

  return (
    <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/delivery-admin" className="text-sm text-sky-700">
            ◂ Pedidos
          </Link>
          <h1 className="mt-1 text-xl font-bold text-slate-900">Cardápio do delivery</h1>
          <p className="text-sm text-slate-500">
            {filialNome} · {itens.length} itens · preço do delivery e do iFood são independentes do
            salão
          </p>
        </div>
        {botaoTrazer}
      </div>

      {filiais.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {filiais.map((f) => (
            <Link
              key={f.id}
              href={`/delivery-admin/cardapio?filialId=${f.id}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                f.id === filialId
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              {f.nome}
            </Link>
          ))}
        </div>
      ) : null}

      {msg ? (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">{msg}</p>
      ) : null}
      {erro ? (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{erro}</p>
      ) : null}

      {podeCriar ? (
        <div className="mt-4 flex gap-2">
          <input
            value={novaCategoria}
            onChange={(e) => setNovaCategoria(e.target.value)}
            placeholder="Nova categoria (ex: Petiscos)"
            className={`${inputCls} mt-0 flex-1`}
          />
          <button
            onClick={() => void criarCategoria()}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Criar categoria
          </button>
        </div>
      ) : null}

      {categorias.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-600">
            Cardápio vazio. O caminho mais rápido é trazer os produtos que você já tem cadastrados
            no PDV e ir marcando quais entram no delivery.
          </p>
          <div className="mt-4 flex justify-center">{botaoTrazer}</div>
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {categorias.map((cat) => {
          const doCat = itens.filter((i) => i.categoriaId === cat.id);
          return (
            <section key={cat.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900">
                  {cat.nome}{' '}
                  <span className="text-xs font-normal text-slate-400">({doCat.length})</span>
                  {!cat.ativo ? (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                      oculta
                    </span>
                  ) : null}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {podeCriar ? (
                    <>
                      <button
                        onClick={() => void abrirJanela(cat.id)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        ＋ Trazer produtos
                      </button>
                      <button
                        onClick={() => {
                          setNovoEm(cat.id);
                          setEditando(null);
                        }}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        + Item do zero
                      </button>
                    </>
                  ) : null}
                  {podeEditar ? (
                    <button
                      onClick={async () => {
                        if (
                          await api('/api/delivery-admin/categoria', 'PATCH', {
                            id: cat.id,
                            ativo: !cat.ativo,
                          })
                        )
                          ok(cat.ativo ? 'Categoria oculta.' : 'Categoria visível.');
                      }}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      {cat.ativo ? 'Ocultar' : 'Mostrar'}
                    </button>
                  ) : null}
                  {podeDeletar && doCat.length === 0 ? (
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Apagar a categoria "${cat.nome}"?`)) return;
                        if (await api(`/api/delivery-admin/categoria?id=${cat.id}`, 'DELETE'))
                          ok('Categoria apagada.');
                      }}
                      className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                    >
                      Apagar
                    </button>
                  ) : null}
                </div>
              </header>

              {novoEm === cat.id ? (
                <FormItem
                  categoriaId={cat.id}
                  salvando={salvando}
                  onCancelar={() => setNovoEm(null)}
                  onSalvar={salvarItem}
                  onFoto={enviarFoto}
                />
              ) : null}

              <ul className="mt-3 divide-y divide-slate-100">
                {doCat.map((i) =>
                  editando?.id === i.id ? (
                    <li key={i.id} className="py-2">
                      <FormItem
                        item={i}
                        categoriaId={cat.id}
                        salvando={salvando}
                        onCancelar={() => setEditando(null)}
                        onSalvar={salvarItem}
                        onFoto={enviarFoto}
                      />
                    </li>
                  ) : (
                    <li key={i.id} className="flex items-center gap-3 py-2.5">
                      {i.fotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={i.fotoUrl}
                          alt={i.nome}
                          className="h-12 w-12 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-100" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {i.nome}
                          {i.destaque ? <span className="ml-1">⭐</span> : null}
                          {!i.ativo ? (
                            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                              oculto
                            </span>
                          ) : null}
                          {i.esgotado ? (
                            <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] text-rose-700">
                              esgotado
                            </span>
                          ) : null}
                          {i.estoqueControlado ? (
                            <span
                              className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
                                (i.estoqueAtual ?? 0) > 0
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-rose-100 text-rose-700'
                              }`}
                            >
                              {estoqueLabel(i.estoqueControlado, i.estoqueAtual)}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                          {i.precoSalaoCentavos != null ? (
                            <span className="text-slate-400">
                              salão {brl(i.precoSalaoCentavos / 100)}
                            </span>
                          ) : null}
                          <span className="font-semibold text-slate-900">
                            delivery {brl(i.preco)}
                          </span>
                          <span className="text-slate-500">
                            iFood {i.precoIfood ? brl(i.precoIfood) : '—'}
                          </span>
                        </p>
                      </div>
                      {podeEditar ? (
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={async () => {
                              if (
                                await api('/api/delivery-admin/item', 'PATCH', {
                                  id: i.id,
                                  esgotado: !i.esgotado,
                                })
                              )
                                ok(i.esgotado ? 'Item disponível de novo.' : 'Item marcado esgotado.');
                            }}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                            title={i.esgotado ? 'Voltar a vender' : 'Marcar esgotado hoje'}
                          >
                            {i.esgotado ? '↺' : '🚫'}
                          </button>
                          <button
                            onClick={() => {
                              setEditando(i);
                              setNovoEm(null);
                            }}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                          >
                            ✎
                          </button>
                          {podeDeletar ? (
                            <button
                              onClick={async () => {
                                if (!window.confirm(`Apagar "${i.nome}"?`)) return;
                                if (await api(`/api/delivery-admin/item?id=${i.id}`, 'DELETE'))
                                  ok('Item apagado.');
                              }}
                              className="rounded-md border border-rose-200 bg-white px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                            >
                              ✕
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ),
                )}
                {doCat.length === 0 && novoEm !== cat.id ? (
                  <li className="py-4 text-center text-xs text-slate-400">
                    Nenhum item nessa categoria ainda.
                  </li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>

      {/* ---- janela: produtos do salão ---- */}
      {janelaAberta ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Produtos do seu cardápio
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Marque o que vai vender no delivery. O preço entra igual ao do salão e depois
                  você ajusta.
                </p>
              </div>
              <button
                onClick={() => setJanelaAberta(false)}
                className="shrink-0 rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <input
              value={buscaSalao}
              onChange={(e) => setBuscaSalao(e.target.value)}
              placeholder="🔎 Buscar produto…"
              className={inputCls}
              autoFocus
            />

            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={esconderJaTem}
                  onChange={(e) => setEsconderJaTem(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                esconder os que já estão no delivery
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={soComEstoque}
                  onChange={(e) => setSoComEstoque(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                só com estoque
              </label>
              <span className="ml-auto font-medium text-slate-500">
                {salaoFiltrado.length} produto(s) · {selecionados.size} marcado(s)
              </span>
            </div>

            <div className="mt-1 flex gap-2 text-xs">
              <button
                onClick={() =>
                  setSelecionados((prev) => {
                    const n = new Set(prev);
                    for (const s of salaoFiltrado) n.add(s.varianteId);
                    return n;
                  })
                }
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-600 hover:bg-slate-50"
              >
                marcar todos da lista
              </button>
              <button
                onClick={() => setSelecionados(new Set())}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-600 hover:bg-slate-50"
              >
                limpar seleção
              </button>
            </div>

            <div className="mt-2 flex-1 overflow-y-auto rounded-lg border border-slate-200">
              {salao === null ? (
                <p className="p-6 text-center text-sm text-slate-500">Carregando produtos…</p>
              ) : salaoFiltrado.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-500">
                  Nada encontrado com esses filtros.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {salaoFiltrado.map((s) => {
                    const marcado = selecionados.has(s.varianteId);
                    const est = estoqueLabel(s.estoqueControlado, s.estoqueAtual);
                    return (
                      <li key={s.varianteId}>
                        <label
                          className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 ${
                            marcado ? 'bg-sky-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={(e) =>
                              setSelecionados((prev) => {
                                const n = new Set(prev);
                                if (e.target.checked) n.add(s.varianteId);
                                else n.delete(s.varianteId);
                                return n;
                              })
                            }
                            className="h-4 w-4 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-slate-800">{s.nome}</span>
                            <span className="flex flex-wrap gap-x-2 text-[11px]">
                              {est ? (
                                <span
                                  className={
                                    (s.estoqueAtual ?? 0) > 0 ? 'text-emerald-700' : 'text-rose-600'
                                  }
                                >
                                  {est}
                                </span>
                              ) : (
                                <span className="text-slate-400">sem controle de estoque</span>
                              )}
                              {s.jaNoCardapio ? (
                                <span className="text-amber-700">já no delivery</span>
                              ) : null}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-medium text-slate-600">
                            {brl(s.precoCentavos / 100)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-3 border-t border-slate-100 pt-3">
              <label className={lblCls}>Colocar em qual categoria?</label>
              <div className="mt-1 flex flex-wrap gap-2">
                <select
                  value={destinoNova.trim() ? '' : destinoId}
                  onChange={(e) => {
                    setDestinoId(e.target.value);
                    setDestinoNova('');
                  }}
                  disabled={categorias.length === 0}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {categorias.length === 0 ? (
                    <option value="">(nenhuma categoria criada)</option>
                  ) : (
                    categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))
                  )}
                </select>
                <input
                  value={destinoNova}
                  onChange={(e) => setDestinoNova(e.target.value)}
                  placeholder="…ou criar nova: ex. Bebidas"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setJanelaAberta(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={() => void importarSelecionados()}
                disabled={selecionados.size === 0 || salvando}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {salvando ? 'Trazendo…' : `Trazer ${selecionados.size} produto(s)`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FormItem({
  item,
  categoriaId,
  salvando,
  onCancelar,
  onSalvar,
  onFoto,
}: {
  item?: Item;
  categoriaId: string;
  salvando: boolean;
  onCancelar: () => void;
  onSalvar: (i: Partial<Item> & { categoriaId: string }) => void;
  onFoto: (f: File) => Promise<{ url: string; path: string } | null>;
}) {
  const [nome, setNome] = useState(item?.nome ?? '');
  const [descricao, setDescricao] = useState(item?.descricao ?? '');
  const [preco, setPreco] = useState(item?.preco ?? '');
  const [precoIfood, setPrecoIfood] = useState(item?.precoIfood ?? '');
  const [checarEstoque, setChecarEstoque] = useState(item?.checarEstoque !== false);
  const [fotoUrl, setFotoUrl] = useState(item?.fotoUrl ?? '');
  const [destaque, setDestaque] = useState(item?.destaque ?? false);
  const [subindo, setSubindo] = useState(false);

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={lblCls}>Nome</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={lblCls}>Descrição</label>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex: 500g, serve 2 pessoas"
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className={lblCls}>Preço no salão</label>
          <div className="mt-1 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-500">
            {item?.precoSalaoCentavos != null
              ? brl(item.precoSalaoCentavos / 100)
              : 'sem vínculo com o PDV'}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">vem do PDV, não editável aqui</p>
        </div>
        <div>
          <label className={lblCls}>Preço no delivery (R$)</label>
          <input
            value={preco}
            onChange={(e) => setPreco(e.target.value.replace(',', '.'))}
            inputMode="decimal"
            placeholder="49.90"
            className={inputCls}
          />
          <p className="mt-0.5 text-[11px] text-slate-400">é o que o site cobra</p>
        </div>
        <div>
          <label className={lblCls}>Preço no iFood (R$)</label>
          <input
            value={precoIfood}
            onChange={(e) => setPrecoIfood(e.target.value.replace(',', '.'))}
            inputMode="decimal"
            placeholder="opcional"
            className={inputCls}
          />
          <p className="mt-0.5 text-[11px] text-slate-400">guardado pra quando o iFood ligar</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={destaque}
            onChange={(e) => setDestaque(e.target.checked)}
            className="h-4 w-4"
          />
          ⭐ Destaque
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={checarEstoque}
            onChange={(e) => setChecarEstoque(e.target.checked)}
            className="h-4 w-4"
          />
          Esgotar sozinho quando o estoque zerar
        </label>
        <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
          {subindo ? 'Enviando…' : fotoUrl ? 'Trocar foto' : '📷 Adicionar foto'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setSubindo(true);
              const r = await onFoto(f);
              if (r) setFotoUrl(r.url);
              setSubindo(false);
            }}
          />
        </label>
        {fotoUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fotoUrl} alt="prévia" className="h-12 w-12 rounded-lg object-cover" />
            <button onClick={() => setFotoUrl('')} className="text-xs text-rose-600">
              remover foto
            </button>
          </>
        ) : null}
      </div>

      {item && !item.estoqueControlado && item.varianteId ? (
        <p className="mt-2 text-[11px] text-slate-400">
          Este produto não controla estoque no PDV — a trava acima não tem efeito nele; use o botão
          🚫 pra marcar esgotado no dia.
        </p>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onCancelar}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
        >
          Cancelar
        </button>
        <button
          onClick={() =>
            onSalvar({
              id: item?.id,
              categoriaId,
              nome,
              descricao,
              preco,
              precoIfood: precoIfood.trim() ? precoIfood : null,
              checarEstoque,
              fotoUrl,
              destaque,
            })
          }
          disabled={salvando || !nome.trim() || !preco}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}

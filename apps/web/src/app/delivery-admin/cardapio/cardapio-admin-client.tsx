'use client';

// Editor do cardápio do delivery: categorias + itens (preço próprio, foto,
// esgotado, destaque) e importação em lote do cardápio do salão.

import { useState, useTransition } from 'react';
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
  fotoUrl: string | null;
  ativo: boolean;
  esgotado: boolean;
  destaque: boolean;
  ordem: number;
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
  jaNoCardapio: boolean;
}

const brl = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 focus:border-sky-500 focus:outline-none sm:py-2 sm:text-sm';
const lblCls = 'text-xs font-medium text-slate-600';

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
  const [importando, setImportando] = useState<string | null>(null);
  const [salao, setSalao] = useState<ItemSalao[] | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [buscaSalao, setBuscaSalao] = useState('');
  const [salvando, setSalvando] = useState(false);

  function ok(texto: string) {
    setMsg(texto);
    setErro(null);
    start(() => router.refresh());
  }

  async function api(url: string, method: string, body?: unknown): Promise<boolean> {
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
  }

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
      const url = '/api/delivery-admin/item';
      const body = novo
        ? {
            filialId,
            categoriaId: item.categoriaId,
            nome: item.nome,
            descricao: item.descricao ?? '',
            preco: item.preco,
            fotoUrl: item.fotoUrl ?? '',
            destaque: item.destaque === true,
          }
        : {
            id: item.id,
            categoriaId: item.categoriaId,
            nome: item.nome,
            descricao: item.descricao ?? '',
            preco: item.preco,
            fotoUrl: item.fotoUrl ?? '',
            destaque: item.destaque === true,
          };
      if (await api(url, novo ? 'POST' : 'PATCH', body)) {
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

  async function abrirImportacao(categoriaId: string) {
    setImportando(categoriaId);
    setSalao(null);
    setSelecionados(new Set());
    const r = await fetch(`/api/delivery-admin/importar-salao?filialId=${filialId}`, {
      cache: 'no-store',
    });
    const d = await r.json().catch(() => ({ itens: [] }));
    setSalao(d.itens ?? []);
  }

  async function importarSelecionados() {
    if (!importando || !salao || selecionados.size === 0) return;
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
      if (
        await api('/api/delivery-admin/importar-salao', 'POST', {
          filialId,
          categoriaId: importando,
          itens: escolhidos,
        })
      ) {
        setImportando(null);
        setSalao(null);
        setSelecionados(new Set());
        ok(`${escolhidos.length} item(ns) importado(s) — confira os preços do delivery.`);
      }
    } finally {
      setSalvando(false);
    }
  }

  const salaoFiltrado = (salao ?? []).filter((s) =>
    buscaSalao.trim() ? s.nome.toLowerCase().includes(buscaSalao.trim().toLowerCase()) : true,
  );

  return (
    <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/delivery-admin" className="text-sm text-sky-700">
            ◂ Pedidos
          </Link>
          <h1 className="mt-1 text-xl font-bold text-slate-900">Cardápio do delivery</h1>
          <p className="text-sm text-slate-500">
            {filialNome} · {itens.length} itens · o preço aqui é o do delivery e pode ser diferente
            do salão
          </p>
        </div>
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

      {/* nova categoria */}
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
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Criar
          </button>
        </div>
      ) : null}

      {categorias.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          Crie a primeira categoria (ex: &quot;Petiscos&quot;) e depois adicione os itens — do zero
          ou importando do cardápio do salão.
        </div>
      ) : null}

      {/* categorias + itens */}
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
                        onClick={() => {
                          setNovoEm(cat.id);
                          setEditando(null);
                        }}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        + Item
                      </button>
                      <button
                        onClick={() => void abrirImportacao(cat.id)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        ⤓ Importar do salão
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
                        </p>
                        {i.descricao ? (
                          <p className="truncate text-xs text-slate-500">{i.descricao}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-slate-900">
                        {brl(i.preco)}
                      </span>
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

      {/* modal de importação do salão */}
      {importando ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white p-5">
            <h3 className="text-base font-semibold text-slate-900">Importar do cardápio do salão</h3>
            <p className="mt-1 text-xs text-slate-500">
              Os preços vêm do salão como sugestão — depois você ajusta o preço do delivery item a
              item.
            </p>
            <input
              value={buscaSalao}
              onChange={(e) => setBuscaSalao(e.target.value)}
              placeholder="Buscar produto…"
              className={inputCls}
            />
            <div className="mt-2 flex-1 overflow-y-auto rounded-lg border border-slate-200">
              {salao === null ? (
                <p className="p-4 text-center text-sm text-slate-500">Carregando…</p>
              ) : salaoFiltrado.length === 0 ? (
                <p className="p-4 text-center text-sm text-slate-500">Nada encontrado.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {salaoFiltrado.map((s) => (
                    <li key={s.varianteId} className="flex items-center gap-2 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selecionados.has(s.varianteId)}
                        onChange={(e) =>
                          setSelecionados((prev) => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(s.varianteId);
                            else n.delete(s.varianteId);
                            return n;
                          })
                        }
                        className="h-4 w-4"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                        {s.nome}
                        {s.jaNoCardapio ? (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
                            já no cardápio
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {brl(s.precoCentavos / 100)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  setImportando(null);
                  setSalao(null);
                }}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={() => void importarSelecionados()}
                disabled={selecionados.size === 0 || salvando}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {salvando ? 'Importando…' : `Importar ${selecionados.size}`}
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
          <label className={lblCls}>Preço no delivery (R$)</label>
          <input
            value={preco}
            onChange={(e) => setPreco(e.target.value.replace(',', '.'))}
            inputMode="decimal"
            placeholder="49.90"
            className={inputCls}
          />
        </div>
      </div>
      <div className="mt-3">
        <label className={lblCls}>Descrição</label>
        <input
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Ex: 500g, serve 2 pessoas, acompanha arroz"
          className={inputCls}
        />
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

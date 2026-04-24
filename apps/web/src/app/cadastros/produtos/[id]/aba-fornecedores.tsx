'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

interface LinhaForn {
  id: string;
  fornecedorId: string;
  fornecedorNome: string;
  fornecedorCnpj: string | null;
  codigoFornecedor: string | null;
  ean: string | null;
  descricaoFornecedor: string | null;
  unidadeFornecedor: string | null;
  fatorConversao: string;
  ultimoPrecoCusto: string | null;
  ultimoPrecoCustoUnidade: string | null;
  ultimaCompraEm: string | null;
}

interface FornOpcao {
  id: string;
  nome: string;
  cnpj: string | null;
}

export function AbaFornecedores({
  produtoId,
  produtoUnidade,
  linhas,
  fornecedoresDisponiveis,
}: {
  produtoId: string;
  produtoUnidade: string;
  linhas: LinhaForn[];
  fornecedoresDisponiveis: FornOpcao[];
}) {
  const router = useRouter();
  const [adicionar, setAdicionar] = useState(false);
  const [editando, setEditando] = useState<LinhaForn | null>(null);
  const [pending, start] = useTransition();

  async function remover(id: string, nome: string) {
    if (!confirm(`Remover mapeamento do fornecedor "${nome}"?`)) return;
    const r = await fetch(`/api/produto-fornecedor/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return;
    }
    start(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Fornecedores mapeados</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Como cada fornecedor identifica este produto (código, EAN) e o fator de
            conversão pra chegar na unidade interna ({produtoUnidade}).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdicionar(true)}
          className="rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          + Adicionar fornecedor
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Fornecedor</th>
              <th className="px-4 py-2">Código forn.</th>
              <th className="px-4 py-2">EAN</th>
              <th className="px-4 py-2">Unid. forn.</th>
              <th className="px-4 py-2 text-right">Fator</th>
              <th className="px-4 py-2 text-right">Últ. custo</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-500">
                  Nenhum fornecedor mapeado. Adicione pra que NFes de entrada
                  reconheçam automaticamente este produto.
                </td>
              </tr>
            ) : (
              linhas.map((l) => {
                const fator = Number(l.fatorConversao);
                const custo = l.ultimoPrecoCustoUnidade
                  ? Number(l.ultimoPrecoCustoUnidade)
                  : null;
                return (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-xs">
                      <div className="text-slate-800">{l.fornecedorNome}</div>
                      {l.fornecedorCnpj && (
                        <div className="font-mono text-[10px] text-slate-400">
                          {l.fornecedorCnpj}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">
                      {l.codigoFornecedor || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">
                      {l.ean || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">
                      {l.unidadeFornecedor || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                      {fator}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                      {custo !== null ? (
                        <span title={`${produtoUnidade}`}>{brl(custo)}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setEditando(l)}
                        className="mr-2 text-[10px] text-slate-600 hover:text-slate-900 hover:underline"
                      >
                        editar
                      </button>
                      <button
                        type="button"
                        onClick={() => remover(l.id, l.fornecedorNome)}
                        className="text-[10px] text-rose-600 hover:text-rose-800 hover:underline"
                      >
                        remover
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {adicionar && (
        <ModalForn
          produtoId={produtoId}
          produtoUnidade={produtoUnidade}
          fornecedoresDisponiveis={fornecedoresDisponiveis.filter(
            (f) => !linhas.some((l) => l.fornecedorId === f.id),
          )}
          onFechar={() => setAdicionar(false)}
          onOk={() => {
            setAdicionar(false);
            start(() => router.refresh());
          }}
        />
      )}

      {editando && (
        <ModalFornEdit
          linha={editando}
          produtoUnidade={produtoUnidade}
          onFechar={() => setEditando(null)}
          onOk={() => {
            setEditando(null);
            start(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

function ModalForn({
  produtoId,
  produtoUnidade,
  fornecedoresDisponiveis,
  onFechar,
  onOk,
}: {
  produtoId: string;
  produtoUnidade: string;
  fornecedoresDisponiveis: FornOpcao[];
  onFechar: () => void;
  onOk: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [fornecedorId, setFornecedorId] = useState('');
  const [codigo, setCodigo] = useState('');
  const [ean, setEan] = useState('');
  const [unidadeForn, setUnidadeForn] = useState('');
  const [descricao, setDescricao] = useState('');
  const [fator, setFator] = useState('1');
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const opcoes = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return fornecedoresDisponiveis
      .filter((f) => (b ? f.nome.toLowerCase().includes(b) || (f.cnpj ?? '').includes(b) : true))
      .slice(0, 50);
  }, [busca, fornecedoresDisponiveis]);

  const escolhido = fornecedoresDisponiveis.find((f) => f.id === fornecedorId);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!fornecedorId) return;
    const f = Number(fator.replace(',', '.'));
    if (!Number.isFinite(f) || f <= 0) {
      setErro('Fator de conversão inválido');
      return;
    }
    setErro(null);
    const r = await fetch('/api/produto-fornecedor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        produtoId,
        fornecedorId,
        codigoFornecedor: codigo.trim() || null,
        ean: ean.trim() || null,
        descricaoFornecedor: descricao.trim() || null,
        unidadeFornecedor: unidadeForn.trim() || null,
        fatorConversao: f,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(d.error ?? `HTTP ${r.status}`);
      return;
    }
    start(onOk);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onFechar}
    >
      <form
        onSubmit={enviar}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
      >
        <h2 className="text-sm font-semibold text-slate-900">Adicionar fornecedor</h2>

        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Buscar fornecedor
          </label>
          <input
            type="text"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setFornecedorId('');
            }}
            autoFocus
            placeholder="Nome ou CNPJ..."
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          {busca.trim() && !fornecedorId && (
            <div className="mt-1 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-white">
              {opcoes.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-500">
                  Nenhum fornecedor encontrado.
                </div>
              ) : (
                opcoes.map((o) => (
                  <button
                    type="button"
                    key={o.id}
                    onClick={() => {
                      setFornecedorId(o.id);
                      setBusca(o.nome);
                    }}
                    className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-left text-xs last:border-b-0 hover:bg-slate-50"
                  >
                    <span className="text-slate-800">{o.nome}</span>
                    {o.cnpj && (
                      <span className="font-mono text-[10px] text-slate-400">{o.cnpj}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {escolhido && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <div className="font-medium text-slate-900">{escolhido.nome}</div>
            {escolhido.cnpj && (
              <div className="font-mono text-[10px] text-slate-500">{escolhido.cnpj}</div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Código do fornecedor
            </label>
            <input
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="cProd da NFe"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              EAN
            </label>
            <input
              type="text"
              value={ean}
              onChange={(e) => setEan(e.target.value)}
              placeholder="7894..."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Descrição no fornecedor
          </label>
          <input
            type="text"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Como vem escrito na NF do fornecedor"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>

        <div className="flex gap-2">
          <div className="w-28">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Unid. forn.
            </label>
            <input
              type="text"
              value={unidadeForn}
              onChange={(e) => setUnidadeForn(e.target.value)}
              placeholder="CX, FD, UN"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono uppercase"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Fator × {produtoUnidade} *
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={fator}
              onChange={(e) => setFator(e.target.value)}
              placeholder="Ex: 1000 (1L → 1000ml), 12 (fd 12un)"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              required
            />
          </div>
        </div>

        <p className="text-[10px] text-slate-500">
          <strong>Fator:</strong> quantas unidades internas ({produtoUnidade}) equivalem
          a 1 unidade do fornecedor. Ex: compra 1 garrafa 1L → fator 1000 se produto é ml.
        </p>

        {erro && (
          <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending || !fornecedorId}
            className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? 'Salvando...' : 'Adicionar'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ModalFornEdit({
  linha,
  produtoUnidade,
  onFechar,
  onOk,
}: {
  linha: LinhaForn;
  produtoUnidade: string;
  onFechar: () => void;
  onOk: () => void;
}) {
  const [codigo, setCodigo] = useState(linha.codigoFornecedor ?? '');
  const [ean, setEan] = useState(linha.ean ?? '');
  const [unidadeForn, setUnidadeForn] = useState(linha.unidadeFornecedor ?? '');
  const [descricao, setDescricao] = useState(linha.descricaoFornecedor ?? '');
  const [fator, setFator] = useState(String(Number(linha.fatorConversao)));
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const f = Number(fator.replace(',', '.'));
    if (!Number.isFinite(f) || f <= 0) {
      setErro('Fator de conversão inválido');
      return;
    }
    setErro(null);
    const body: Record<string, unknown> = {
      codigoFornecedor: codigo.trim() || null,
      ean: ean.trim() || null,
      descricaoFornecedor: descricao.trim() || null,
      unidadeFornecedor: unidadeForn.trim() || null,
      fatorConversao: f,
    };
    const r = await fetch(`/api/produto-fornecedor/${linha.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(d.error ?? `HTTP ${r.status}`);
      return;
    }
    start(onOk);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onFechar}
    >
      <form
        onSubmit={enviar}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Editar mapeamento — {linha.fornecedorNome}
          </h2>
          {linha.fornecedorCnpj && (
            <div className="font-mono text-[10px] text-slate-500">{linha.fornecedorCnpj}</div>
          )}
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Código do fornecedor
            </label>
            <input
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              EAN
            </label>
            <input
              type="text"
              value={ean}
              onChange={(e) => setEan(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Descrição no fornecedor
          </label>
          <input
            type="text"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>

        <div className="flex gap-2">
          <div className="w-28">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Unid. forn.
            </label>
            <input
              type="text"
              value={unidadeForn}
              onChange={(e) => setUnidadeForn(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono uppercase"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Fator × {produtoUnidade} *
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={fator}
              onChange={(e) => setFator(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              required
            />
          </div>
        </div>

        {erro && (
          <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const UNIDADES = ['un', 'ml', 'g', 'kg', 'l'] as const;
const TIPOS = [
  { value: 'VENDA_SIMPLES', label: 'Produto (venda)' },
  { value: 'INSUMO', label: 'Insumo (só compra)' },
  { value: 'COMPLEMENTO', label: 'Complemento' },
  { value: 'COMBO', label: 'Combo' },
  { value: 'VARIANTE', label: 'Produto por tamanho' },
  { value: 'SERVICO', label: 'Serviço (sem estoque)' },
] as const;

interface Produto {
  id: string;
  nome: string | null;
  tipo: string;
  unidadeEstoque: string;
  controlaEstoque: boolean;
  estoqueMinimo: string | null;
  descontinuado: boolean | null;
  criadoNaNuvem: boolean;
}

export function EditarProdutoButton({ produto }: { produto: Produto }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(produto.nome ?? '');
  const [tipo, setTipo] = useState(produto.tipo);
  const [unidade, setUnidade] = useState(produto.unidadeEstoque);
  const [controla, setControla] = useState(produto.controlaEstoque);
  const [estoqueMinimo, setEstoqueMinimo] = useState(
    produto.estoqueMinimo ? String(Number(produto.estoqueMinimo)) : '',
  );
  const [descontinuado, setDescontinuado] = useState(produto.descontinuado ?? false);
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function fechar() {
    setAberto(false);
    setErro(null);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const body: Record<string, unknown> = {};
    if (produto.criadoNaNuvem && nome.trim() && nome.trim() !== produto.nome) {
      body.nome = nome.trim();
    }
    if (tipo !== produto.tipo) body.tipo = tipo;
    if (unidade !== produto.unidadeEstoque) body.unidadeEstoque = unidade;
    if (controla !== produto.controlaEstoque) body.controlaEstoque = controla;
    if (descontinuado !== (produto.descontinuado ?? false)) body.descontinuado = descontinuado;

    const minAtual = produto.estoqueMinimo ? Number(produto.estoqueMinimo) : 0;
    const minNovo = estoqueMinimo.trim() ? Number(estoqueMinimo.replace(',', '.')) : 0;
    if (!Number.isFinite(minNovo) || minNovo < 0) {
      setErro('Estoque mínimo inválido');
      return;
    }
    if (minNovo !== minAtual) body.estoqueMinimo = minNovo;

    if (Object.keys(body).length === 0) {
      fechar();
      return;
    }

    try {
      const r = await fetch(`/api/produtos/${produto.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      fechar();
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
      >
        Editar
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={fechar}
        >
          <form
            onSubmit={enviar}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Editar {produto.nome ?? 'produto'}
              </h2>
              {!produto.criadoNaNuvem && (
                <p className="mt-0.5 text-xs text-slate-500">
                  Nome, preço e código vêm do Consumer — não são editáveis aqui.
                </p>
              )}
            </div>

            {produto.criadoNaNuvem && (
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Nome
                </label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
            )}

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Tipo
                </label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  {TIPOS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-24">
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Unidade
                </label>
                <select
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  {UNIDADES.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Estoque mínimo
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={estoqueMinimo}
                onChange={(e) => setEstoqueMinimo(e.target.value)}
                placeholder="0"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={controla}
                onChange={(e) => setControla(e.target.checked)}
              />
              Controla estoque (gera movimento por compra/venda)
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={descontinuado}
                onChange={(e) => setDescontinuado(e.target.checked)}
              />
              Descontinuado
            </label>

            {erro && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {erro}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={fechar}
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
      )}
    </>
  );
}

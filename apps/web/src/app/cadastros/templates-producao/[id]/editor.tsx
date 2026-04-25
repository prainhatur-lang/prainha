'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Template {
  id: string;
  nome: string;
  descricaoPadrao: string | null;
  observacao: string | null;
  ativo: boolean;
  vezesUsado: number;
}

interface LinhaEntrada {
  id: string;
  produtoId: string;
  produtoNome: string;
  produtoUnidade: string;
  quantidadePadrao: string;
}

interface LinhaSaida {
  id: string;
  tipo: string;
  produtoId: string | null;
  produtoNome: string | null;
  produtoUnidade: string | null;
  quantidadePadrao: string;
  pesoRelativo: string;
  observacao: string | null;
}

interface ProdutoOpcao {
  id: string;
  nome: string;
  tipo: string;
  unidade: string;
  precoCusto: string | null;
}

export function TemplateEditor({
  template,
  entradas,
  saidas,
  produtosDisponiveis,
}: {
  template: Template;
  entradas: LinhaEntrada[];
  saidas: LinhaSaida[];
  produtosDisponiveis: ProdutoOpcao[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editandoNome, setEditandoNome] = useState(false);
  const [nome, setNome] = useState(template.nome);
  const [editandoDesc, setEditandoDesc] = useState(false);
  const [desc, setDesc] = useState(template.descricaoPadrao ?? '');

  async function patchTpl(body: Record<string, unknown>) {
    const r = await fetch(`/api/template-op/${template.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return false;
    }
    start(() => router.refresh());
    return true;
  }

  async function deletarLinha(tipo: 'entrada' | 'saida', id: string, nomeLinha: string) {
    if (!confirm(`Remover "${nomeLinha}"?`)) return;
    const rota = tipo === 'entrada' ? 'template-op-entrada' : 'template-op-saida';
    const r = await fetch(`/api/${rota}/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return;
    }
    start(() => router.refresh());
  }

  async function arquivar() {
    if (!confirm('Arquivar template? Ele não aparecerá mais no menu, mas histórico fica.')) return;
    const r = await fetch(`/api/template-op/${template.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return;
    }
    start(() => router.push('/cadastros/templates-producao'));
  }

  return (
    <>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="flex-1">
          {editandoNome ? (
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onBlur={async () => {
                if (nome.trim() && nome.trim() !== template.nome) {
                  await patchTpl({ nome: nome.trim() });
                }
                setEditandoNome(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setNome(template.nome);
                  setEditandoNome(false);
                }
              }}
              autoFocus
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-2xl font-bold"
            />
          ) : (
            <h1
              onClick={() => template.ativo && setEditandoNome(true)}
              className="text-2xl font-bold text-slate-900 hover:bg-slate-100 px-1 -mx-1 rounded cursor-text"
            >
              {template.nome}
            </h1>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            {template.ativo ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
                Ativo
              </span>
            ) : (
              <span className="rounded bg-slate-200 px-1.5 py-0.5 font-medium text-slate-700">
                Arquivado
              </span>
            )}
            <span>Usado {template.vezesUsado}x</span>
          </div>

          {/* Descrição padrão */}
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Descrição padrão
            </span>
            {editandoDesc ? (
              <input
                type="text"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                onBlur={async () => {
                  const lim = desc.trim();
                  if (lim !== (template.descricaoPadrao ?? '')) {
                    await patchTpl({ descricaoPadrao: lim || null });
                  }
                  setEditandoDesc(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') {
                    setDesc(template.descricaoPadrao ?? '');
                    setEditandoDesc(false);
                  }
                }}
                autoFocus
                placeholder="Texto pré-preenchido em cada OP nova"
                className="flex-1 rounded-md border border-slate-300 px-2 py-0.5"
              />
            ) : (
              <button
                type="button"
                onClick={() => template.ativo && setEditandoDesc(true)}
                className="text-slate-700 hover:underline"
              >
                {template.descricaoPadrao ?? <span className="italic text-slate-400">— adicionar</span>}
              </button>
            )}
          </div>
        </div>
        {template.ativo && (
          <button
            type="button"
            onClick={arquivar}
            disabled={pending}
            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            Arquivar
          </button>
        )}
      </div>

      {/* Entradas */}
      <div className="mt-8">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Entradas (insumos consumidos)</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Quantidade-padrão. Ao criar OP, escala todas proporcionalmente.
            </p>
          </div>
          {template.ativo && (
            <AdicionarLinhaBtn
              tipo="entrada"
              templateId={template.id}
              produtosDisponiveis={produtosDisponiveis}
            />
          )}
        </div>
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Produto</th>
                <th className="px-4 py-2 text-right">Qtd padrão</th>
                <th className="px-4 py-2">Un.</th>
                {template.ativo && <th className="px-4 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {entradas.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-xs text-slate-500">
                    Nenhuma entrada. Adicione pelo menos uma.
                  </td>
                </tr>
              ) : (
                entradas.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-xs text-slate-800">{e.produtoNome}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {Number(e.quantidadePadrao)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">
                      {e.produtoUnidade}
                    </td>
                    {template.ativo && (
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => deletarLinha('entrada', e.id, e.produtoNome)}
                          className="text-[10px] text-rose-600 hover:underline"
                        >
                          remover
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Saídas */}
      <div className="mt-8">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Saídas (produtos + perdas)</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Cortes gerados. Peso relativo: 1 = comum, 3 = nobre, 0.5 = popular.
              Perda absorve custo automaticamente.
            </p>
          </div>
          {template.ativo && (
            <AdicionarLinhaBtn
              tipo="saida"
              templateId={template.id}
              produtosDisponiveis={produtosDisponiveis}
            />
          )}
        </div>
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Produto</th>
                <th className="px-4 py-2 text-right">Qtd padrão</th>
                <th className="px-4 py-2">Un.</th>
                <th className="px-4 py-2 text-right">Peso</th>
                {template.ativo && <th className="px-4 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {saidas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-xs text-slate-500">
                    Nenhuma saída. Adicione pelo menos uma.
                  </td>
                </tr>
              ) : (
                saidas.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-t border-slate-100 ${s.tipo === 'PERDA' ? 'bg-rose-50/30' : ''}`}
                  >
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          s.tipo === 'PRODUTO'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {s.tipo === 'PRODUTO' ? 'Produto' : 'Perda'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {s.produtoNome ?? (
                        <span className="text-slate-500 italic">
                          {s.observacao ?? 'perda sem produto'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {Number(s.quantidadePadrao)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">
                      {s.produtoUnidade ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {s.tipo === 'PERDA' ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span
                          className={
                            Number(s.pesoRelativo) === 1
                              ? 'text-slate-400'
                              : 'font-semibold text-slate-700'
                          }
                        >
                          {Number(s.pesoRelativo)}
                        </span>
                      )}
                    </td>
                    {template.ativo && (
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            deletarLinha('saida', s.id, s.produtoNome ?? '(perda)')
                          }
                          className="text-[10px] text-rose-600 hover:underline"
                        >
                          remover
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function AdicionarLinhaBtn({
  tipo,
  templateId,
  produtosDisponiveis,
}: {
  tipo: 'entrada' | 'saida';
  templateId: string;
  produtosDisponiveis: ProdutoOpcao[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [produtoId, setProdutoId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [tipoSaida, setTipoSaida] = useState<'PRODUTO' | 'PERDA'>('PRODUTO');
  const [pesoRel, setPesoRel] = useState('1');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [_pending, start] = useTransition();

  const escolhido = produtosDisponiveis.find((p) => p.id === produtoId);

  const opcoes = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return produtosDisponiveis
      .filter((p) => (b ? p.nome.toLowerCase().includes(b) : true))
      .slice(0, 30);
  }, [busca, produtosDisponiveis]);

  function fechar() {
    setAberto(false);
    setBusca('');
    setProdutoId('');
    setQuantidade('');
    setTipoSaida('PRODUTO');
    setPesoRel('1');
    setObservacao('');
    setErro(null);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const q = Number(quantidade.replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) {
      setErro('Quantidade inválida');
      return;
    }

    const body: Record<string, unknown> = { quantidadePadrao: q };

    if (tipo === 'entrada') {
      if (!produtoId) {
        setErro('Selecione um produto');
        return;
      }
      body.produtoId = produtoId;
    } else {
      body.tipo = tipoSaida;
      if (tipoSaida === 'PRODUTO') {
        if (!produtoId) {
          setErro('Selecione um produto');
          return;
        }
        body.produtoId = produtoId;
        const p = Number((pesoRel || '1').replace(',', '.'));
        if (!Number.isFinite(p) || p <= 0) {
          setErro('Peso relativo inválido');
          return;
        }
        body.pesoRelativo = p;
      } else {
        body.produtoId = produtoId || null;
        if (observacao.trim()) body.observacao = observacao.trim();
      }
    }

    setSalvando(true);
    setErro(null);
    try {
      const rota = tipo === 'entrada' ? 'entrada' : 'saida';
      const r = await fetch(`/api/template-op/${templateId}/${rota}`, {
        method: 'POST',
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
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
      >
        + {tipo === 'entrada' ? 'Adicionar entrada' : 'Adicionar saída'}
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={fechar}
        >
          <form
            onSubmit={enviar}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <h2 className="text-sm font-semibold text-slate-900">
              {tipo === 'entrada' ? 'Adicionar entrada (insumo)' : 'Adicionar saída (produto/perda)'}
            </h2>

            {tipo === 'saida' && (
              <div className="flex gap-2">
                <label className="flex flex-1 items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-xs">
                  <input
                    type="radio"
                    name="tipoSaida"
                    checked={tipoSaida === 'PRODUTO'}
                    onChange={() => setTipoSaida('PRODUTO')}
                  />
                  Produto (gera estoque)
                </label>
                <label className="flex flex-1 items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-xs">
                  <input
                    type="radio"
                    name="tipoSaida"
                    checked={tipoSaida === 'PERDA'}
                    onChange={() => setTipoSaida('PERDA')}
                  />
                  Perda (sem estoque)
                </label>
              </div>
            )}

            {(tipo === 'entrada' || tipoSaida === 'PRODUTO' || tipoSaida === 'PERDA') && (
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Produto {tipo === 'saida' && tipoSaida === 'PERDA' ? '(opcional)' : '*'}
                </label>
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => {
                    setBusca(e.target.value);
                    setProdutoId('');
                  }}
                  autoFocus
                  placeholder="Buscar produto..."
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
                {busca.trim() && !produtoId && (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white">
                    {opcoes.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-500">
                        Nenhum produto encontrado.
                      </div>
                    ) : (
                      opcoes.map((o) => (
                        <button
                          type="button"
                          key={o.id}
                          onClick={() => {
                            setProdutoId(o.id);
                            setBusca(o.nome);
                          }}
                          className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-left text-xs last:border-b-0 hover:bg-slate-50"
                        >
                          <span className="text-slate-800">{o.nome}</span>
                          <span className="flex items-center gap-1.5">
                            <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                              {o.tipo === 'INSUMO'
                                ? 'insumo'
                                : o.tipo === 'VENDA_SIMPLES'
                                  ? 'produto'
                                  : o.tipo.toLowerCase()}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500">
                              {o.unidade}
                            </span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
                {escolhido && (
                  <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
                    <span className="font-medium text-slate-900">{escolhido.nome}</span>
                    <span className="ml-2 font-mono text-[10px] text-slate-500">
                      {escolhido.unidade}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Quantidade padrão {escolhido ? `(${escolhido.unidade})` : ''} *
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  placeholder="Ex: 3000 (g), 3 (kg)"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  required
                />
              </div>
              {tipo === 'saida' && tipoSaida === 'PRODUTO' && (
                <div className="w-32">
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Peso relativo
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={pesoRel}
                    onChange={(e) => setPesoRel(e.target.value)}
                    placeholder="1"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
              )}
            </div>

            {tipo === 'saida' && tipoSaida === 'PERDA' && (
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Observação
                </label>
                <input
                  type="text"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Ex: aparas, gordura, perda por limpeza"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
            )}

            {erro && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</div>
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
                disabled={salvando}
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

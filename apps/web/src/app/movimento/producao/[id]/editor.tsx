'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { brl } from '@/lib/format';

interface Op {
  id: string;
  descricao: string | null;
  observacao: string | null;
  status: string;
  dataHora: string | null;
  concluidaEm: string | null;
  custoTotalEntradas: string | null;
  divergenciaPercentual: string | null;
}

interface LinhaEntrada {
  id: string;
  produtoId: string;
  produtoNome: string;
  produtoUnidade: string;
  quantidade: string | null;
  precoUnitario: string | null;
  valorTotal: string | null;
}

interface LinhaSaida {
  id: string;
  tipo: string;
  produtoId: string | null;
  produtoNome: string | null;
  produtoUnidade: string | null;
  quantidade: string | null;
  custoRateado: string | null;
  valorTotal: string | null;
  observacao: string | null;
}

interface ProdutoOpcao {
  id: string;
  nome: string;
  tipo: string;
  unidade: string;
  precoCusto: string | null;
}

export function EditorProducao({
  op,
  badge,
  entradas,
  saidas,
  produtosDisponiveis,
}: {
  op: Op;
  badge: { label: string; cls: string };
  entradas: LinhaEntrada[];
  saidas: LinhaSaida[];
  produtosDisponiveis: ProdutoOpcao[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const editavel = op.status === 'RASCUNHO';

  // Balanço em tempo real
  const qtdEntradas = entradas.reduce((s, e) => s + Number(e.quantidade ?? 0), 0);
  const valorEntradas = entradas.reduce((s, e) => s + Number(e.valorTotal ?? 0), 0);
  const saidasProduto = saidas.filter((s) => s.tipo === 'PRODUTO');
  const saidasPerda = saidas.filter((s) => s.tipo === 'PERDA');
  const qtdSaidasProduto = saidasProduto.reduce((s, r) => s + Number(r.quantidade ?? 0), 0);
  const qtdSaidasPerda = saidasPerda.reduce((s, r) => s + Number(r.quantidade ?? 0), 0);
  const qtdSaidas = qtdSaidasProduto + qtdSaidasPerda;
  const divergencia = qtdEntradas > 0 ? ((qtdEntradas - qtdSaidas) / qtdEntradas) * 100 : 0;
  const custoUnitarioUtil = qtdSaidasProduto > 0 ? valorEntradas / qtdSaidasProduto : 0;

  async function patchOp(body: Record<string, unknown>) {
    const r = await fetch(`/api/ordem-producao/${op.id}`, {
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

  async function concluir() {
    if (qtdSaidasProduto === 0) {
      if (
        !confirm(
          'A OP não tem saídas do tipo PRODUTO — só perdas. O custo das entradas será descartado. Concluir mesmo assim?',
        )
      )
        return;
    } else if (Math.abs(divergencia) > 5) {
      if (
        !confirm(
          `Divergência grande: ${divergencia.toFixed(2)}%. Quer concluir mesmo assim?`,
        )
      )
        return;
    } else {
      if (!confirm('Concluir OP? Isso gera movimentos de estoque e não pode ser desfeito.')) return;
    }
    setLoading('concluir');
    setMsg(null);
    try {
      const r = await fetch(`/api/ordem-producao/${op.id}/concluir`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
      } else {
        setMsg({ tipo: 'ok', texto: `✓ OP concluída. Custo total ${brl(Number(d.custoTotal))}.` });
        start(() => router.refresh());
      }
    } finally {
      setLoading(null);
    }
  }

  async function cancelar() {
    if (!confirm('Cancelar esta OP? Não gera estoque e não pode ser reaberta.')) return;
    setLoading('cancelar');
    setMsg(null);
    try {
      const r = await fetch(`/api/ordem-producao/${op.id}/cancelar`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
      else start(() => router.refresh());
    } finally {
      setLoading(null);
    }
  }

  async function deletarLinha(tipo: 'entrada' | 'saida', id: string, nome: string) {
    if (!confirm(`Remover "${nome}"?`)) return;
    const rota = tipo === 'entrada' ? 'ordem-producao-entrada' : 'ordem-producao-saida';
    const r = await fetch(`/api/${rota}/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return;
    }
    start(() => router.refresh());
  }

  return (
    <>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {op.descricao ?? 'Ordem de produção'}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className={`rounded px-1.5 py-0.5 font-medium ${badge.cls}`}>
              {badge.label}
            </span>
            {op.dataHora && (
              <span>
                Aberta em{' '}
                <span className="font-mono">
                  {new Date(op.dataHora).toLocaleString('pt-BR')}
                </span>
              </span>
            )}
            {op.concluidaEm && (
              <span>
                Concluída em{' '}
                <span className="font-mono">
                  {new Date(op.concluidaEm).toLocaleString('pt-BR')}
                </span>
              </span>
            )}
          </div>
        </div>
        {editavel && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancelar}
              disabled={loading !== null || pending}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading === 'cancelar' ? 'Cancelando...' : 'Cancelar OP'}
            </button>
            <button
              type="button"
              onClick={concluir}
              disabled={
                loading !== null ||
                pending ||
                entradas.length === 0 ||
                saidas.length === 0
              }
              className="rounded-lg border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading === 'concluir' ? 'Concluindo...' : '✓ Concluir OP'}
            </button>
          </div>
        )}
      </div>

      {msg && (
        <div
          className={`mt-3 rounded px-3 py-2 text-xs ${
            msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
          }`}
        >
          {msg.texto}
        </div>
      )}

      {/* Balanço em tempo real */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <CardKpi label="Qtd entradas" valor={qtdEntradas} precisao={3} />
        <CardKpi label="Qtd saídas" valor={qtdSaidas} precisao={3} hint={`${qtdSaidasProduto} úteis + ${qtdSaidasPerda} perdas`} />
        <CardKpi
          label="Divergência"
          valor={divergencia}
          precisao={2}
          sufixo="%"
          highlight={
            Math.abs(divergencia) < 1
              ? 'ok'
              : Math.abs(divergencia) < 5
                ? 'warn'
                : 'err'
          }
        />
        <CardKpi
          label="Custo total entradas"
          valorBrl={valorEntradas}
          hint={
            qtdSaidasProduto > 0
              ? `${brl(custoUnitarioUtil)} por unidade útil`
              : 'sem saídas úteis'
          }
        />
      </div>

      {editavel && op.descricao === null && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => {
              const d = prompt('Descrição da OP:');
              if (d !== null) patchOp({ descricao: d.trim() || null });
            }}
            className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-500 hover:border-slate-500"
          >
            + adicionar descrição
          </button>
        </div>
      )}

      {/* Entradas */}
      <div className="mt-8">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Entradas (insumos consumidos)</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Matérias-primas que entram na OP. Preço unitário padrão vem do cadastro
              do produto — pode ajustar se necessário.
            </p>
          </div>
          {editavel && (
            <AdicionarLinhaBtn
              tipo="entrada"
              opId={op.id}
              produtosDisponiveis={produtosDisponiveis}
            />
          )}
        </div>
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Produto</th>
                <th className="px-4 py-2 text-right">Qtd</th>
                <th className="px-4 py-2">Un.</th>
                <th className="px-4 py-2 text-right">Unit.</th>
                <th className="px-4 py-2 text-right">Total</th>
                {editavel && <th className="px-4 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {entradas.length === 0 ? (
                <tr>
                  <td colSpan={editavel ? 6 : 5} className="px-4 py-4 text-center text-xs text-slate-500">
                    Nenhuma entrada. Adicione pelo menos uma pra concluir.
                  </td>
                </tr>
              ) : (
                entradas.map((e) => (
                  <LinhaEntradaRow
                    key={e.id}
                    linha={e}
                    editavel={editavel}
                    onDelete={() => deletarLinha('entrada', e.id, e.produtoNome)}
                  />
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
              Produtos gerados (entram no estoque) e perdas (descarte, resfriamento,
              aparas). Custo se rateia proporcionalmente entre as saídas úteis.
            </p>
          </div>
          {editavel && (
            <AdicionarLinhaBtn
              tipo="saida"
              opId={op.id}
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
                <th className="px-4 py-2 text-right">Qtd</th>
                <th className="px-4 py-2">Un.</th>
                <th className="px-4 py-2 text-right">Custo unit.</th>
                <th className="px-4 py-2 text-right">Total</th>
                {editavel && <th className="px-4 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {saidas.length === 0 ? (
                <tr>
                  <td colSpan={editavel ? 7 : 6} className="px-4 py-4 text-center text-xs text-slate-500">
                    Nenhuma saída. Adicione pelo menos uma pra concluir.
                  </td>
                </tr>
              ) : (
                saidas.map((s) => (
                  <LinhaSaidaRow
                    key={s.id}
                    linha={s}
                    editavel={editavel}
                    custoPreviaUnit={
                      s.tipo === 'PRODUTO' && !op.concluidaEm ? custoUnitarioUtil : null
                    }
                    onDelete={() =>
                      deletarLinha('saida', s.id, s.produtoNome ?? `(perda ${s.id.slice(0, 6)})`)
                    }
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {op.observacao && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Observação
          </p>
          <p className="mt-1 whitespace-pre-wrap">{op.observacao}</p>
        </div>
      )}
    </>
  );
}

function CardKpi({
  label,
  valor,
  valorBrl,
  hint,
  precisao = 0,
  sufixo = '',
  highlight,
}: {
  label: string;
  valor?: number;
  valorBrl?: number;
  hint?: string;
  precisao?: number;
  sufixo?: string;
  highlight?: 'ok' | 'warn' | 'err';
}) {
  const cor =
    highlight === 'ok'
      ? 'text-slate-500'
      : highlight === 'warn'
        ? 'text-amber-700'
        : highlight === 'err'
          ? 'text-rose-700'
          : 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${cor}`}>
        {valorBrl !== undefined
          ? brl(valorBrl)
          : `${(valor ?? 0).toFixed(precisao)}${sufixo}`}
      </p>
      {hint && <p className="mt-1 text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

function LinhaEntradaRow({
  linha,
  editavel,
  onDelete,
}: {
  linha: LinhaEntrada;
  editavel: boolean;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [_pending, start] = useTransition();
  const [editQtd, setEditQtd] = useState(false);
  const [editPreco, setEditPreco] = useState(false);
  const [qtd, setQtd] = useState(String(Number(linha.quantidade ?? 0)));
  const [preco, setPreco] = useState(String(Number(linha.precoUnitario ?? 0)));

  async function salvar(body: Record<string, unknown>) {
    const r = await fetch(`/api/ordem-producao-entrada/${linha.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return;
    }
    start(() => router.refresh());
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2 text-xs">
        <Link
          href={`/cadastros/produtos/${linha.produtoId}`}
          className="text-slate-800 hover:underline"
        >
          {linha.produtoNome}
        </Link>
      </td>
      <td className="px-4 py-2 text-right font-mono text-xs">
        {editavel && editQtd ? (
          <input
            type="text"
            value={qtd}
            onChange={(e) => setQtd(e.target.value)}
            onBlur={async () => {
              const n = Number(qtd.replace(',', '.'));
              if (Number.isFinite(n) && n > 0 && n !== Number(linha.quantidade)) {
                await salvar({ quantidade: n });
              }
              setEditQtd(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setQtd(String(Number(linha.quantidade ?? 0)));
                setEditQtd(false);
              }
            }}
            autoFocus
            className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right text-xs"
          />
        ) : (
          <button
            type="button"
            disabled={!editavel}
            onClick={() => setEditQtd(true)}
            className={editavel ? 'hover:bg-slate-50 px-1' : ''}
          >
            {Number(linha.quantidade ?? 0)}
          </button>
        )}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-slate-500">{linha.produtoUnidade}</td>
      <td className="px-4 py-2 text-right font-mono text-xs">
        {editavel && editPreco ? (
          <input
            type="text"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            onBlur={async () => {
              const n = Number(preco.replace(',', '.'));
              if (Number.isFinite(n) && n >= 0 && n !== Number(linha.precoUnitario)) {
                await salvar({ precoUnitario: n });
              }
              setEditPreco(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setPreco(String(Number(linha.precoUnitario ?? 0)));
                setEditPreco(false);
              }
            }}
            autoFocus
            className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right text-xs"
          />
        ) : (
          <button
            type="button"
            disabled={!editavel}
            onClick={() => setEditPreco(true)}
            className={editavel ? 'hover:bg-slate-50 px-1' : ''}
          >
            {brl(Number(linha.precoUnitario ?? 0))}
          </button>
        )}
      </td>
      <td className="px-4 py-2 text-right font-mono text-xs font-medium">
        {brl(Number(linha.valorTotal ?? 0))}
      </td>
      {editavel && (
        <td className="px-4 py-2 text-right">
          <button
            type="button"
            onClick={onDelete}
            className="text-[10px] text-rose-600 hover:text-rose-800 hover:underline"
          >
            remover
          </button>
        </td>
      )}
    </tr>
  );
}

function LinhaSaidaRow({
  linha,
  editavel,
  custoPreviaUnit,
  onDelete,
}: {
  linha: LinhaSaida;
  editavel: boolean;
  custoPreviaUnit: number | null;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [_pending, start] = useTransition();
  const [editQtd, setEditQtd] = useState(false);
  const [qtd, setQtd] = useState(String(Number(linha.quantidade ?? 0)));

  async function salvar(body: Record<string, unknown>) {
    const r = await fetch(`/api/ordem-producao-saida/${linha.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return;
    }
    start(() => router.refresh());
  }

  const custoUnit =
    linha.custoRateado !== null
      ? Number(linha.custoRateado)
      : custoPreviaUnit !== null && linha.tipo === 'PRODUTO'
        ? custoPreviaUnit
        : 0;
  const valorTotal =
    linha.valorTotal !== null
      ? Number(linha.valorTotal)
      : custoUnit * Number(linha.quantidade ?? 0);
  const previa = linha.custoRateado === null;

  return (
    <tr className={`border-t border-slate-100 ${linha.tipo === 'PERDA' ? 'bg-rose-50/30' : ''}`}>
      <td className="px-4 py-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            linha.tipo === 'PRODUTO'
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-rose-100 text-rose-800'
          }`}
        >
          {linha.tipo === 'PRODUTO' ? 'Produto' : 'Perda'}
        </span>
      </td>
      <td className="px-4 py-2 text-xs">
        {linha.produtoId ? (
          <Link
            href={`/cadastros/produtos/${linha.produtoId}`}
            className="text-slate-800 hover:underline"
          >
            {linha.produtoNome}
          </Link>
        ) : (
          <span className="text-slate-500">
            {linha.observacao || <em>perda sem produto</em>}
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-right font-mono text-xs">
        {editavel && editQtd ? (
          <input
            type="text"
            value={qtd}
            onChange={(e) => setQtd(e.target.value)}
            onBlur={async () => {
              const n = Number(qtd.replace(',', '.'));
              if (Number.isFinite(n) && n > 0 && n !== Number(linha.quantidade)) {
                await salvar({ quantidade: n });
              }
              setEditQtd(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setQtd(String(Number(linha.quantidade ?? 0)));
                setEditQtd(false);
              }
            }}
            autoFocus
            className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right text-xs"
          />
        ) : (
          <button
            type="button"
            disabled={!editavel}
            onClick={() => setEditQtd(true)}
            className={editavel ? 'hover:bg-slate-50 px-1' : ''}
          >
            {Number(linha.quantidade ?? 0)}
          </button>
        )}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-slate-500">
        {linha.produtoUnidade || '—'}
      </td>
      <td className={`px-4 py-2 text-right font-mono text-xs ${previa ? 'italic text-slate-400' : ''}`}>
        {linha.tipo === 'PERDA' && !linha.custoRateado ? (
          <span className="text-slate-300">—</span>
        ) : (
          brl(custoUnit)
        )}
      </td>
      <td className={`px-4 py-2 text-right font-mono text-xs font-medium ${previa ? 'italic text-slate-400' : ''}`}>
        {linha.tipo === 'PERDA' && !linha.custoRateado ? (
          <span className="text-slate-300">—</span>
        ) : (
          brl(valorTotal)
        )}
      </td>
      {editavel && (
        <td className="px-4 py-2 text-right">
          <button
            type="button"
            onClick={onDelete}
            className="text-[10px] text-rose-600 hover:text-rose-800 hover:underline"
          >
            remover
          </button>
        </td>
      )}
    </tr>
  );
}

function AdicionarLinhaBtn({
  tipo,
  opId,
  produtosDisponiveis,
}: {
  tipo: 'entrada' | 'saida';
  opId: string;
  produtosDisponiveis: ProdutoOpcao[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [produtoId, setProdutoId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [precoUnit, setPrecoUnit] = useState('');
  const [tipoSaida, setTipoSaida] = useState<'PRODUTO' | 'PERDA'>('PRODUTO');
  const [observacao, setObservacao] = useState('');
  const [_pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

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
    setPrecoUnit('');
    setTipoSaida('PRODUTO');
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
    setErro(null);

    const body: Record<string, unknown> = { quantidade: q };

    if (tipo === 'entrada') {
      if (!produtoId) {
        setErro('Selecione um produto');
        return;
      }
      body.produtoId = produtoId;
      if (precoUnit.trim()) {
        const p = Number(precoUnit.replace(',', '.'));
        if (!Number.isFinite(p) || p < 0) {
          setErro('Preço inválido');
          return;
        }
        body.precoUnitario = p;
      }
    } else {
      body.tipo = tipoSaida;
      if (tipoSaida === 'PRODUTO') {
        if (!produtoId) {
          setErro('Selecione um produto');
          return;
        }
        body.produtoId = produtoId;
      } else {
        body.produtoId = produtoId || null;
        if (observacao.trim()) body.observacao = observacao.trim();
      }
    }

    const rota = tipo === 'entrada' ? 'entrada' : 'saida';
    const r = await fetch(`/api/ordem-producao/${opId}/${rota}`, {
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
                            if (tipo === 'entrada' && o.precoCusto) {
                              setPrecoUnit(String(Number(o.precoCusto)));
                            }
                          }}
                          className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-left text-xs last:border-b-0 hover:bg-slate-50"
                        >
                          <span className="text-slate-800">{o.nome}</span>
                          <span className="flex items-center gap-1.5">
                            <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                              {o.tipo === 'INSUMO' ? 'insumo' : o.tipo === 'VENDA_SIMPLES' ? 'produto' : o.tipo.toLowerCase()}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500">{o.unidade}</span>
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
                  Quantidade {escolhido ? `(${escolhido.unidade})` : ''} *
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
              {tipo === 'entrada' && (
                <div className="w-40">
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Preço unit. (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={precoUnit}
                    onChange={(e) => setPrecoUnit(e.target.value)}
                    placeholder={escolhido?.precoCusto ? String(Number(escolhido.precoCusto)) : '0'}
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
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                Adicionar
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

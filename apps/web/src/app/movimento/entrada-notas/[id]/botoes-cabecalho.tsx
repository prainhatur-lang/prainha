'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

interface Duplicata {
  id: string;
  numero: string | null;
  dataVencimento: string;
  valor: string;
  jaCriadaContaPagar: boolean;
}

interface Categoria {
  id: string;
  descricao: string;
  tipo: string | null;
}

export function BotoesCabecalho({
  notaId,
  totalItens,
  mapeados,
  lancados,
  canLancar,
  duplicatas,
  categorias,
  temFornecedor,
}: {
  notaId: string;
  totalItens: number;
  mapeados: number;
  lancados: number;
  canLancar: boolean;
  duplicatas: Duplicata[];
  categorias: Categoria[];
  temFornecedor: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState<'match' | 'lancar' | 'excluir' | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [modalLancar, setModalLancar] = useState(false);
  const [categoriaId, setCategoriaId] = useState<string>('');

  // Filtra duplicatas que ainda nao viraram conta_pagar
  const duplicatasPendentes = useMemo(
    () => duplicatas.filter((d) => !d.jaCriadaContaPagar),
    [duplicatas],
  );

  // Categoria so eh necessaria se for criar contas a pagar
  const precisaCategoria = duplicatasPendentes.length > 0 && temFornecedor;

  async function excluir() {
    const aviso = lancados > 0
      ? `Excluir esta nota?\n\nVai REVERTER ${lancados} lancamento(s) no estoque (subtrai a quantidade do saldo) e apagar a nota.\n\nApos excluir, voce pode re-importar o XML pra refazer.`
      : `Excluir esta nota?\n\nA nota ainda nao foi lancada — so o registro vai sumir. Apos excluir, voce pode re-importar o XML.`;
    if (!confirm(aviso)) return;

    setLoading('excluir');
    setMsg(null);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 409 && Array.isArray(d.conflitos)) {
          const lista = d.conflitos
            .map((c: { nome: string; atual: number; aReverter: number }) =>
              `• ${c.nome}: estoque ${c.atual} < ${c.aReverter} a reverter`)
            .join('\n');
          setMsg({
            tipo: 'erro',
            texto: `Nao da pra reverter (estoque ja foi consumido):\n${lista}\n\nFaca um ajuste manual no estoque antes.`,
          });
        } else {
          setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        }
        return;
      }
      router.push('/movimento/entrada-notas');
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setLoading(null);
    }
  }

  async function matchAuto() {
    setLoading('match');
    setMsg(null);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}/match-auto`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
      } else {
        setMsg({
          tipo: 'ok',
          texto: `✓ ${d.matched} novo(s) vinculado(s). Total mapeado: ${d.mapeadosTotal}/${d.total}.`,
        });
        start(() => router.refresh());
      }
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setLoading(null);
    }
  }

  async function confirmarLancamento() {
    setLoading('lancar');
    setMsg(null);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}/lancar-estoque`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoriaId: categoriaId || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
      } else {
        const partes: string[] = [];
        if (d.lancados > 0) partes.push(`✓ ${d.lancados} item(ns) lançado(s) no estoque`);
        if (d.pulados > 0) partes.push(`${d.pulados} pulado(s) (já lançados)`);
        if (d.contasPagarCriadas > 0) {
          partes.push(`💰 ${d.contasPagarCriadas} conta(s) a pagar criada(s)`);
        }
        setMsg({ tipo: 'ok', texto: partes.join(' · ') });
        setModalLancar(false);
        start(() => router.refresh());
      }
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={excluir}
          disabled={loading !== null || pending}
          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          title={
            lancados > 0
              ? 'Reverte os lançamentos no estoque e apaga a nota — você pode re-importar o XML pra refazer'
              : 'Apaga a nota — você pode re-importar o XML pra refazer'
          }
        >
          {loading === 'excluir' ? 'Excluindo...' : '🗑 Excluir nota'}
        </button>
        <button
          type="button"
          onClick={matchAuto}
          disabled={loading !== null || pending || totalItens === mapeados}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="Tenta vincular automaticamente via EAN e código do fornecedor"
        >
          {loading === 'match' ? 'Vinculando...' : '⚡ Match automático'}
        </button>
        <button
          type="button"
          onClick={() => setModalLancar(true)}
          disabled={!canLancar || loading !== null || pending}
          className="rounded-lg border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading === 'lancar' ? 'Lançando...' : '✓ Lançar no estoque'}
        </button>
      </div>
      {msg && (
        <div
          className={`max-w-md whitespace-pre-line rounded px-2 py-1 text-[11px] ${
            msg.tipo === 'ok'
              ? 'bg-emerald-50 text-emerald-800'
              : 'bg-rose-50 text-rose-800'
          }`}
        >
          {msg.texto}
        </div>
      )}

      {modalLancar && (
        <ModalLancar
          totalMapeados={mapeados}
          jaLancados={lancados}
          duplicatasPendentes={duplicatasPendentes}
          categorias={categorias}
          categoriaId={categoriaId}
          setCategoriaId={setCategoriaId}
          temFornecedor={temFornecedor}
          precisaCategoria={precisaCategoria}
          loading={loading === 'lancar'}
          onConfirmar={confirmarLancamento}
          onFechar={() => setModalLancar(false)}
        />
      )}
    </div>
  );
}

function ModalLancar({
  totalMapeados,
  jaLancados,
  duplicatasPendentes,
  categorias,
  categoriaId,
  setCategoriaId,
  temFornecedor,
  precisaCategoria,
  loading,
  onConfirmar,
  onFechar,
}: {
  totalMapeados: number;
  jaLancados: number;
  duplicatasPendentes: Duplicata[];
  categorias: Categoria[];
  categoriaId: string;
  setCategoriaId: (v: string) => void;
  temFornecedor: boolean;
  precisaCategoria: boolean;
  loading: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  const pendentes = totalMapeados - jaLancados;
  const totalDuplicatas = duplicatasPendentes.reduce((s, d) => s + Number(d.valor || 0), 0);

  // Categorias filtradas: prioriza DESPESA. Se nao tiver tipo definido, mostra junto.
  const opcoesCategoria = useMemo(() => {
    return categorias.filter((c) => c.tipo === 'DESPESA' || c.tipo == null);
  }, [categorias]);

  const podeConfirmar = !precisaCategoria || categoriaId !== '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onFechar}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Lançar no estoque</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Vai criar {pendentes} movimento(s) de entrada e atualizar o saldo dos
            produtos.
            {jaLancados > 0 && ` ${jaLancados} item(ns) já lançado(s) serão pulados.`}
          </p>
        </div>

        {/* Seção de duplicatas */}
        {duplicatasPendentes.length > 0 ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
            <h3 className="text-xs font-semibold text-sky-900">
              💰 Contas a pagar (do XML)
            </h3>
            <p className="mt-0.5 text-[10px] text-sky-800">
              {duplicatasPendentes.length} parcela(s) detectada(s) na NFe — total{' '}
              <span className="font-mono font-semibold">{brl(totalDuplicatas)}</span>.
              Vão virar contas a pagar automaticamente.
            </p>
            <div className="mt-2 space-y-1 text-[11px]">
              {duplicatasPendentes.slice(0, 5).map((d, i) => (
                <div key={d.id} className="flex justify-between font-mono text-slate-700">
                  <span>
                    Parcela {i + 1}/{duplicatasPendentes.length}{d.numero ? ` (${d.numero})` : ''}
                  </span>
                  <span>
                    {new Date(d.dataVencimento + 'T00:00').toLocaleDateString('pt-BR')}
                  </span>
                  <span className="font-semibold">{brl(Number(d.valor))}</span>
                </div>
              ))}
              {duplicatasPendentes.length > 5 && (
                <div className="text-[10px] text-sky-700">
                  + {duplicatasPendentes.length - 5} parcela(s) ocultada(s)…
                </div>
              )}
            </div>
            {!temFornecedor && (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
                ⚠ Esta nota não tem fornecedor vinculado — não dá pra criar
                contas a pagar. Vincule um fornecedor antes ou os pagamentos
                ficarão de fora.
              </p>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">
            ℹ A NFe não tem duplicatas (compra à vista, ou o fornecedor não preencheu
            a cobrança no XML). Nenhuma conta a pagar será criada.
          </p>
        )}

        {/* Seletor de categoria */}
        {precisaCategoria && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Plano de contas (categoria) *
            </label>
            <p className="mt-0.5 text-[10px] text-slate-500">
              Em qual conta do plano de contas as parcelas vão entrar?
            </p>
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="">-- escolha uma categoria --</option>
              {opcoesCategoria.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.descricao}
                </option>
              ))}
            </select>
            {opcoesCategoria.length === 0 && (
              <p className="mt-1 text-[10px] text-amber-700">
                Nenhuma categoria do tipo DESPESA encontrada. Sincronize o plano de
                contas do Consumer ou cadastre manualmente.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onFechar}
            disabled={loading}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={loading || !podeConfirmar}
            className="rounded-md border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            title={!podeConfirmar ? 'Escolha uma categoria primeiro' : ''}
          >
            {loading ? 'Lançando...' : '✓ Confirmar lançamento'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { brl } from '@/lib/format';
import { EnviarCozinheiroBtn } from './enviar-cozinheiro';

interface Op {
  id: string;
  descricao: string | null;
  responsavel: string | null;
  observacao: string | null;
  status: string;
  dataHora: string | null;
  concluidaEm: string | null;
  custoTotalEntradas: string | null;
  divergenciaPercentual: string | null;
  enviadaEm: string | null;
  marcadaProntaEm: string | null;
  marcadaProntaPor: string | null;
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
  pesoRelativo: string | null;
  pesoTotalKg: string | null;
  custoRateado: string | null;
  valorTotal: string | null;
  observacao: string | null;
}

/** Converte uma linha de entrada/saida pra kg pra reconciliacao por peso.
 *  - kg/g: usa quantidade direto (g convertido)
 *  - un/l/ml com produto: usa pesoTotalKg
 *  - PERDA livre (sem produto): assume quantidade ja eh kg
 *  - sem peso preenchido: NaN (nao conta no fechamento) */
function quantidadeEmKg(opts: {
  quantidade: number;
  unidade: string | null;
  pesoTotalKg: number | null;
  ehPerdaLivre: boolean;
}): number {
  const { quantidade, unidade, pesoTotalKg, ehPerdaLivre } = opts;
  if (ehPerdaLivre) return quantidade;
  const u = (unidade ?? '').toLowerCase();
  if (u === 'kg') return quantidade;
  if (u === 'g') return quantidade / 1000;
  return pesoTotalKg ?? NaN;
}

interface ProdutoOpcao {
  id: string;
  nome: string;
  tipo: string;
  unidade: string;
  precoCusto: string | null;
}

interface FotoOp {
  id: string;
  tipo: string;
  url: string | null;
  observacao: string | null;
  enviadaEm: string | null;
}

export function EditorProducao({
  op,
  badge,
  entradas,
  saidas,
  produtosDisponiveis,
  colaboradores,
  filialId,
  fotos,
}: {
  op: Op;
  badge: { label: string; cls: string };
  entradas: LinhaEntrada[];
  saidas: LinhaSaida[];
  produtosDisponiveis: ProdutoOpcao[];
  colaboradores: string[];
  filialId: string;
  fotos: FotoOp[];
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

  // Reconciliacao em KG (mais robusta que comparar quantidades quando ha
  // mistura de unidades — ex: entrada 20kg de file vs saida 100un de isca).
  const kgEntradas = entradas.reduce((acc, e) => {
    const v = quantidadeEmKg({
      quantidade: Number(e.quantidade ?? 0),
      unidade: e.produtoUnidade,
      pesoTotalKg: null,
      ehPerdaLivre: false,
    });
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
  const kgSaidasProduto = saidasProduto.reduce((acc, s) => {
    const v = quantidadeEmKg({
      quantidade: Number(s.quantidade ?? 0),
      unidade: s.produtoUnidade,
      pesoTotalKg: s.pesoTotalKg ? Number(s.pesoTotalKg) : null,
      ehPerdaLivre: false,
    });
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
  const kgSaidasPerda = saidasPerda.reduce((acc, s) => {
    const v = quantidadeEmKg({
      quantidade: Number(s.quantidade ?? 0),
      unidade: s.produtoUnidade,
      pesoTotalKg: s.pesoTotalKg ? Number(s.pesoTotalKg) : null,
      ehPerdaLivre: !s.produtoId,
    });
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
  const kgSaidasTotal = kgSaidasProduto + kgSaidasPerda;

  // Detecta se ha alguma saida em un/l/ml SEM peso (produto) — nesse caso
  // nao da pra reconciliar por peso confiavel; cai no comparativo de quantidade.
  const temSaidaSemPeso = [...saidasProduto, ...saidasPerda].some((s) => {
    const u = (s.produtoUnidade ?? '').toLowerCase();
    if (u === 'kg' || u === 'g') return false;
    if (s.tipo === 'PERDA' && !s.produtoId) return false; // perda livre = kg
    return !s.pesoTotalKg || Number(s.pesoTotalKg) <= 0;
  });

  // Modo de reconciliacao:
  //  - 'peso' quando todas as saidas tem peso ou sao kg/g/perda livre
  //  - 'quantidade' fallback quando faltam pesos
  const modoReconciliacao: 'peso' | 'quantidade' = temSaidaSemPeso
    ? 'quantidade'
    : 'peso';

  const divergenciaPesoKg = kgEntradas > 0 ? kgEntradas - kgSaidasTotal : 0;
  const divergenciaPesoPct = kgEntradas > 0 ? (divergenciaPesoKg / kgEntradas) * 100 : 0;
  const divergenciaQtdPct =
    qtdEntradas > 0 ? ((qtdEntradas - qtdSaidas) / qtdEntradas) * 100 : 0;
  const divergencia =
    modoReconciliacao === 'peso' ? divergenciaPesoPct : divergenciaQtdPct;
  // Soma de unidades-peso (qtd × pesoRelativo) só pras saídas PRODUTO.
  // É o denominador do rateio. Perdas absorvem custo automaticamente.
  const unidadesPesoUtil = saidasProduto.reduce(
    (s, r) => s + Number(r.quantidade ?? 0) * Number(r.pesoRelativo ?? 1),
    0,
  );
  // Custo por unidade-peso. Cortes nobres (peso>1) absorvem mais.
  const custoPorUnidadePeso = unidadesPesoUtil > 0 ? valorEntradas / unidadesPesoUtil : 0;
  // Custo médio simples (pra hint quando todos os pesos = 1)
  const custoUnitarioUtil = qtdSaidasProduto > 0 ? valorEntradas / qtdSaidasProduto : 0;
  const todosPesoUm = saidasProduto.every((s) => Number(s.pesoRelativo ?? 1) === 1);

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

  async function duplicar() {
    const novoResp = prompt(
      'Responsável da nova OP (deixe em branco pra preencher depois):',
      '',
    );
    // null = user clicou Cancelar; '' = user clicou OK sem digitar
    if (novoResp === null) return;
    setLoading('duplicar');
    setMsg(null);
    try {
      const r = await fetch(`/api/ordem-producao/${op.id}/duplicar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ responsavel: novoResp.trim() || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      // Vai direto pra OP nova
      router.push(`/movimento/producao/${d.id}`);
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
        <div className="flex-1">
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
          <ResponsavelEditor
            opId={op.id}
            editavel={editavel}
            valorInicial={op.responsavel}
            colaboradores={colaboradores}
            filialId={filialId}
          />
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {editavel && (
            <EnviarCozinheiroBtn
              opId={op.id}
              responsavel={op.responsavel}
              descricao={op.descricao}
            />
          )}
          <button
            type="button"
            onClick={duplicar}
            disabled={loading !== null || pending}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Cria uma OP nova com as mesmas entradas e saídas — útil pra dividir trabalho entre cozinheiros"
          >
            {loading === 'duplicar' ? 'Duplicando...' : '⧉ Duplicar'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            title="Imprimir ficha de produção (sem botões/menus)"
          >
            🖨 Imprimir
          </button>
          {editavel && (
            <>
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
            </>
          )}
        </div>
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

      {/* Banner: cozinheiro marcou como pronta */}
      {editavel && op.marcadaProntaEm && (
        <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 print:hidden">
          <p className="text-sm font-bold text-amber-900">
            ⏳ Cozinheiro marcou como pronta
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {op.marcadaProntaPor ? (
              <>
                <strong>{op.marcadaProntaPor}</strong>
                {op.responsavel &&
                  op.responsavel !== op.marcadaProntaPor &&
                  !op.responsavel.includes(op.marcadaProntaPor) && (
                    <span className="text-amber-700">
                      {' '}
                      (responsável: {op.responsavel})
                    </span>
                  )}
              </>
            ) : op.responsavel ? (
              <strong>{op.responsavel}</strong>
            ) : (
              'O cozinheiro'
            )}{' '}
            sinalizou que terminou em{' '}
            <span className="font-mono">
              {new Date(op.marcadaProntaEm).toLocaleString('pt-BR')}
            </span>
            . Revise as quantidades e clique em <strong>✓ Concluir OP</strong> pra
            gerar os movimentos de estoque.
          </p>
        </div>
      )}

      {editavel && op.enviadaEm && !op.marcadaProntaEm && (
        <div className="mt-4 rounded-xl border border-sky-300 bg-sky-50 p-3 print:hidden">
          <p className="text-xs text-sky-900">
            📱 Enviada pro cozinheiro em{' '}
            <span className="font-mono">
              {new Date(op.enviadaEm).toLocaleString('pt-BR')}
            </span>
            . Aguardando ele marcar como pronta.
          </p>
        </div>
      )}

      {/* Galerias de fotos do cozinheiro */}
      {fotos.length > 0 && <FotosViewer fotos={fotos} />}

      {/* Balanço em tempo real */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <CardKpi label="Qtd entradas" valor={qtdEntradas} precisao={3} />
        <CardKpi label="Qtd saídas" valor={qtdSaidas} precisao={3} hint={`${qtdSaidasProduto} úteis + ${qtdSaidasPerda} perdas`} />
        <CardKpi
          label={modoReconciliacao === 'peso' ? 'Divergência (peso)' : 'Divergência (qtd)'}
          valor={divergencia}
          precisao={2}
          sufixo="%"
          hint={
            modoReconciliacao === 'peso'
              ? `${kgEntradas.toFixed(2)} kg → ${kgSaidasTotal.toFixed(2)} kg`
              : 'preencha pesos pra fechar'
          }
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
            <div className="print:hidden">
              <AdicionarLinhaBtn
                tipo="entrada"
                opId={op.id}
                produtosDisponiveis={produtosDisponiveis}
              />
            </div>
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
                {editavel && <th className="px-4 py-2 print:hidden"></th>}
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
              Produtos gerados (entram no estoque) e perdas (descarte, aparas).
              Custo total das entradas se distribui pelas <strong>unidades-peso</strong>{' '}
              das saídas úteis: peso 3 = corte 3× mais caro que peso 1. Perda absorve
              custo automaticamente.
              {!todosPesoUm && qtdSaidasProduto > 0 && custoPorUnidadePeso > 0 && (
                <span className="ml-1 text-slate-700">
                  Custo/unidade-peso ≈ <strong>{brl(custoPorUnidadePeso)}</strong>.
                </span>
              )}
            </p>
          </div>
          {editavel && (
            <div className="print:hidden">
              <AdicionarLinhaBtn
                tipo="saida"
                opId={op.id}
                produtosDisponiveis={produtosDisponiveis}
              />
            </div>
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
                <th className="px-4 py-2 text-right" title="Peso relativo no rateio. Maior = corte mais nobre.">Peso</th>
                <th className="px-4 py-2 text-right">Custo unit.</th>
                <th className="px-4 py-2 text-right">Total</th>
                {editavel && <th className="px-4 py-2 print:hidden"></th>}
              </tr>
            </thead>
            <tbody>
              {saidas.length === 0 ? (
                <tr>
                  <td colSpan={editavel ? 8 : 7} className="px-4 py-4 text-center text-xs text-slate-500">
                    Nenhuma saída. Adicione pelo menos uma pra concluir.
                  </td>
                </tr>
              ) : (
                saidas.map((s) => {
                  const peso = Number(s.pesoRelativo ?? 1);
                  // Custo previa: qtd*peso*custoPorUnidadePeso quando OP em rascunho
                  const custoPreviaUnit =
                    s.tipo === 'PRODUTO' && !op.concluidaEm
                      ? peso * custoPorUnidadePeso
                      : null;
                  return (
                    <LinhaSaidaRow
                      key={s.id}
                      linha={s}
                      editavel={editavel}
                      custoPreviaUnit={custoPreviaUnit}
                      onDelete={() =>
                        deletarLinha('saida', s.id, s.produtoNome ?? `(perda ${s.id.slice(0, 6)})`)
                      }
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ObservacaoEditor
        opId={op.id}
        editavel={editavel}
        valorInicial={op.observacao}
      />
    </>
  );
}

function FotosViewer({ fotos }: { fotos: FotoOp[] }) {
  const [zoom, setZoom] = useState<FotoOp | null>(null);
  const entradas = fotos.filter((f) => f.tipo === 'ENTRADA');
  const saidas = fotos.filter((f) => f.tipo === 'SAIDA');

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-4 print:hidden">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-violet-900">
          📷 Fotos do cozinheiro
        </h3>
        <span className="text-[10px] text-violet-700">
          {fotos.length} foto{fotos.length === 1 ? '' : 's'}
        </span>
      </div>

      {entradas.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-violet-700">
            Material recebido ({entradas.length})
          </p>
          <div className="mt-1 grid grid-cols-4 gap-2 sm:grid-cols-6">
            {entradas.map((f) =>
              f.url ? (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setZoom(f)}
                  className="aspect-square overflow-hidden rounded-lg border border-violet-300 bg-white"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.url}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              ) : null,
            )}
          </div>
        </div>
      )}

      {saidas.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-violet-700">
            Produtos prontos ({saidas.length})
          </p>
          <div className="mt-1 grid grid-cols-4 gap-2 sm:grid-cols-6">
            {saidas.map((f) =>
              f.url ? (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setZoom(f)}
                  className="aspect-square overflow-hidden rounded-lg border border-violet-300 bg-white"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.url}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              ) : null,
            )}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {zoom && zoom.url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setZoom(null)}
        >
          <div className="flex max-h-full max-w-full flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={zoom.url}
              alt=""
              className="max-h-[85vh] max-w-full rounded-lg object-contain"
            />
            <p className="text-xs text-white">
              {zoom.tipo === 'ENTRADA' ? 'Material recebido' : 'Produto pronto'}
              {zoom.enviadaEm &&
                ` · ${new Date(zoom.enviadaEm).toLocaleString('pt-BR')}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setZoom(null)}
            className="absolute right-4 top-4 rounded-full bg-white/20 px-3 py-1.5 text-sm text-white"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function ResponsavelEditor({
  opId,
  editavel,
  valorInicial,
  colaboradores,
  filialId,
}: {
  opId: string;
  editavel: boolean;
  valorInicial: string | null;
  colaboradores: string[];
  filialId: string;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(valorInicial ?? '');
  const [salvando, setSalvando] = useState(false);
  const [destacado, setDestacado] = useState(0);
  const [_pending, start] = useTransition();

  const sugestoes = useMemo(() => {
    const q = valor.trim().toLowerCase();
    if (!q) return colaboradores.slice(0, 8);
    return colaboradores
      .filter((c) => c.toLowerCase().includes(q))
      .slice(0, 8);
  }, [valor, colaboradores]);

  const exato = colaboradores.some((c) => c.toLowerCase() === valor.trim().toLowerCase());
  const podeAdicionar = valor.trim().length > 0 && !exato;

  async function salvar(nomeOverride?: string) {
    const valorLimpo = (nomeOverride ?? valor).trim();
    if ((valorInicial ?? '') === valorLimpo) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    try {
      // Se nome novo (não tá na lista), cadastra primeiro
      if (
        valorLimpo &&
        !colaboradores.some((c) => c.toLowerCase() === valorLimpo.toLowerCase())
      ) {
        const novo = await fetch('/api/colaborador', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filialId, nome: valorLimpo, tipo: 'COZINHA' }),
        });
        if (!novo.ok) {
          const d = await novo.json().catch(() => ({}));
          alert(`Erro ao cadastrar colaborador: ${d.error ?? novo.status}`);
          return;
        }
      }

      const r = await fetch(`/api/ordem-producao/${opId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ responsavel: valorLimpo || null }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(`Erro: ${d.error ?? r.status}`);
        return;
      }
      setEditando(false);
      start(() => router.refresh());
    } finally {
      setSalvando(false);
    }
  }

  function escolherSugestao(nome: string) {
    setValor(nome);
    salvar(nome);
  }

  if (!editavel && !valorInicial) return null;

  if (editando) {
    return (
      <div className="relative mt-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Responsável
          </span>
          <input
            type="text"
            value={valor}
            onChange={(e) => {
              setValor(e.target.value);
              setDestacado(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setValor(valorInicial ?? '');
                setEditando(false);
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setDestacado(Math.min(destacado + 1, sugestoes.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setDestacado(Math.max(destacado - 1, 0));
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                if (sugestoes[destacado] && !exato) {
                  escolherSugestao(sugestoes[destacado]);
                } else {
                  salvar();
                }
              }
            }}
            maxLength={100}
            autoFocus
            placeholder="Nome do cozinheiro"
            className="w-56 rounded-md border border-slate-300 px-2 py-0.5 text-xs"
          />
          <button
            type="button"
            onClick={() => salvar()}
            disabled={salvando || !valor.trim()}
            className="rounded border border-slate-900 bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {salvando ? '...' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={() => {
              setValor(valorInicial ?? '');
              setEditando(false);
            }}
            disabled={salvando}
            className="text-[10px] text-slate-500 hover:text-slate-700"
          >
            cancelar
          </button>
        </div>
        {(sugestoes.length > 0 || podeAdicionar) && (
          <div className="absolute left-24 top-full z-20 mt-1 max-h-56 w-56 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
            {sugestoes.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => escolherSugestao(s)}
                onMouseEnter={() => setDestacado(i)}
                className={`block w-full px-3 py-1.5 text-left text-xs ${
                  i === destacado ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
              >
                {s}
              </button>
            ))}
            {podeAdicionar && (
              <button
                type="button"
                onClick={() => salvar()}
                className="block w-full border-t border-slate-100 bg-emerald-50 px-3 py-1.5 text-left text-xs font-medium text-emerald-800 hover:bg-emerald-100"
              >
                + cadastrar &ldquo;{valor.trim()}&rdquo;
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Responsável
      </span>
      <span className={valorInicial ? 'font-medium text-slate-800' : 'italic text-slate-400'}>
        {valorInicial ?? 'Não informado'}
      </span>
      {editavel && (
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 print:hidden"
        >
          {valorInicial ? 'editar' : '+ informar'}
        </button>
      )}
    </div>
  );
}

function ObservacaoEditor({
  opId,
  editavel,
  valorInicial,
}: {
  opId: string;
  editavel: boolean;
  valorInicial: string | null;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(valorInicial ?? '');
  const [salvando, setSalvando] = useState(false);
  const [_pending, start] = useTransition();

  async function salvar() {
    const valorLimpo = valor.trim();
    if ((valorInicial ?? '') === valorLimpo) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    try {
      const r = await fetch(`/api/ordem-producao/${opId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ observacao: valorLimpo || null }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(`Erro: ${d.error ?? r.status}`);
        return;
      }
      setEditando(false);
      start(() => router.refresh());
    } finally {
      setSalvando(false);
    }
  }

  if (!editavel && !valorInicial) return null;

  if (editando) {
    return (
      <div className="mt-6 rounded-lg border border-slate-300 bg-white p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Observação
        </p>
        <textarea
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setValor(valorInicial ?? '');
              setEditando(false);
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              salvar();
            }
          }}
          rows={3}
          maxLength={1000}
          autoFocus
          placeholder="Notas da produção (responsável, observações, lote...)"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">
            {valor.length}/1000 · Esc cancela · ⌘+Enter salva
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setValor(valorInicial ?? '');
                setEditando(false);
              }}
              disabled={salvando}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={salvando}
              className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Observação
          </p>
          {valorInicial ? (
            <p className="mt-1 whitespace-pre-wrap">{valorInicial}</p>
          ) : (
            <p className="mt-1 text-slate-400 italic">Sem observação</p>
          )}
        </div>
        {editavel && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="shrink-0 rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
          >
            {valorInicial ? 'Editar' : '+ adicionar'}
          </button>
        )}
      </div>
    </div>
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
        <td className="px-4 py-2 text-right print:hidden">
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
  const [editPeso, setEditPeso] = useState(false);
  const [qtd, setQtd] = useState(String(Number(linha.quantidade ?? 0)));
  const [peso, setPeso] = useState(String(Number(linha.pesoRelativo ?? 1)));

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

  const pesoNum = Number(linha.pesoRelativo ?? 1);

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
      <td className="px-4 py-2 text-right font-mono text-xs">
        {linha.tipo === 'PERDA' ? (
          <span className="text-slate-300">—</span>
        ) : editavel && editPeso ? (
          <input
            type="text"
            value={peso}
            onChange={(e) => setPeso(e.target.value)}
            onBlur={async () => {
              const n = Number(peso.replace(',', '.'));
              if (Number.isFinite(n) && n > 0 && n !== pesoNum) {
                await salvar({ pesoRelativo: n });
              }
              setEditPeso(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setPeso(String(pesoNum));
                setEditPeso(false);
              }
            }}
            autoFocus
            className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right text-xs"
          />
        ) : (
          <button
            type="button"
            disabled={!editavel}
            onClick={() => setEditPeso(true)}
            className={`${editavel ? 'hover:bg-slate-50 px-1' : ''} ${pesoNum === 1 ? 'text-slate-400' : 'font-semibold text-slate-700'}`}
            title={pesoNum === 1 ? 'Sem rateio diferenciado' : `Absorve ${pesoNum}× o custo médio`}
          >
            {pesoNum.toFixed(pesoNum === Math.round(pesoNum) ? 0 : 2)}
          </button>
        )}
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
        <td className="px-4 py-2 text-right print:hidden">
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
  const [pesoRel, setPesoRel] = useState('1');
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
              {tipo === 'saida' && tipoSaida === 'PRODUTO' && (
                <div className="w-32">
                  <label
                    className="block text-[11px] font-medium uppercase tracking-wide text-slate-500"
                    title="Maior = corte mais nobre, absorve mais custo. Exemplo: lâmina 3, cabeça 1, aparas 0.5"
                  >
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
                  <p className="mt-1 text-[10px] text-slate-400">
                    1 = corte comum · 3 = nobre · 0.5 = popular
                  </p>
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

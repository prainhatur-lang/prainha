'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { brl } from '@/lib/format';

interface Movimento {
  id: string;
  tipo: string;
  quantidade: string;
  precoUnitario: string | null;
  valorTotal: string | null;
  dataHora: string | null;
  observacao: string | null;
  notaCompraItemId: string | null;
  ordemProducaoId: string | null;
  pedidoItemId: string | null;
}

const TIPO_LABEL: Record<string, { label: string; cls: string; ehEntrada: boolean }> = {
  ENTRADA_COMPRA: { label: 'Compra (NFe)', cls: 'bg-emerald-100 text-emerald-800', ehEntrada: true },
  ENTRADA_PRODUCAO: { label: 'Produção', cls: 'bg-emerald-50 text-emerald-700', ehEntrada: true },
  ENTRADA_DEVOLUCAO: { label: 'Devolução', cls: 'bg-sky-100 text-sky-800', ehEntrada: true },
  ENTRADA_AJUSTE: { label: 'Ajuste +', cls: 'bg-violet-100 text-violet-800', ehEntrada: true },
  SAIDA_VENDA: { label: 'Venda', cls: 'bg-rose-100 text-rose-800', ehEntrada: false },
  SAIDA_FICHA_TECNICA: { label: 'Ficha técn.', cls: 'bg-rose-50 text-rose-700', ehEntrada: false },
  SAIDA_PRODUCAO: { label: 'OP (consumo)', cls: 'bg-amber-50 text-amber-700', ehEntrada: false },
  SAIDA_DEVOLUCAO: { label: 'Devol. saída', cls: 'bg-rose-50 text-rose-600', ehEntrada: false },
  SAIDA_AJUSTE: { label: 'Ajuste −', cls: 'bg-violet-50 text-violet-700', ehEntrada: false },
  PERDA: { label: 'Perda', cls: 'bg-rose-200 text-rose-900', ehEntrada: false },
};

export function AbaSaldo({
  produtoId,
  produtoNome,
  unidadeEstoque,
  estoqueAtual,
  estoqueMinimo,
  precoCusto,
  movimentos,
}: {
  produtoId: string;
  produtoNome: string;
  unidadeEstoque: string;
  estoqueAtual: string | null;
  estoqueMinimo: string | null;
  precoCusto: string | null;
  movimentos: Movimento[];
}) {
  const saldoAtual = Number(estoqueAtual ?? 0);
  const minimo = Number(estoqueMinimo ?? 0);
  const custoAtual = Number(precoCusto ?? 0);
  const valorEmEstoque = saldoAtual * custoAtual;
  const abaixoMinimo = minimo > 0 && saldoAtual < minimo;

  // Reconstrói histórico de saldo + custo médio iterando movimentos do mais
  // antigo pro mais recente. Movimentos vêm desc; viramos pra reconstruir.
  // Útil pra mostrar "como o custo mudou ao longo do tempo".
  const historico = useMemo(() => {
    const ordenado = [...movimentos].reverse(); // do mais antigo pro mais recente
    let saldoAcum = 0;
    let custoAcum = 0;
    return ordenado.map((m) => {
      const qtd = Number(m.quantidade); // assinada (- pra saída)
      const preco = Number(m.precoUnitario ?? 0);
      const ehEntrada = qtd > 0;
      const saldoAnterior = saldoAcum;
      const custoAnterior = custoAcum;

      if (ehEntrada) {
        // MPM
        const novoSaldo = saldoAcum + qtd;
        if (saldoAcum <= 0 || novoSaldo <= 0) {
          custoAcum = preco;
        } else {
          custoAcum = (saldoAcum * custoAcum + qtd * preco) / novoSaldo;
        }
        saldoAcum = novoSaldo;
      } else {
        // Saída: só decrementa saldo, custo não muda
        saldoAcum = saldoAcum + qtd; // qtd é negativo aqui
      }

      return {
        ...m,
        saldoAnterior,
        custoAnterior,
        saldoApos: saldoAcum,
        custoApos: custoAcum,
        delta: qtd,
      };
    }).reverse(); // volta pra desc
  }, [movimentos]);

  // KPIs do histórico
  const kpis = useMemo(() => {
    const entradas = movimentos.filter((m) => Number(m.quantidade) > 0);
    const saidas = movimentos.filter((m) => Number(m.quantidade) < 0);
    const totalEntradas = entradas.reduce((s, m) => s + Number(m.quantidade), 0);
    const totalSaidas = saidas.reduce((s, m) => s + Math.abs(Number(m.quantidade)), 0);
    const valorEntradas = entradas.reduce(
      (s, m) => s + Number(m.valorTotal ?? 0),
      0,
    );
    const custoMedioCompras = totalEntradas > 0 ? valorEntradas / totalEntradas : 0;
    return { totalEntradas, totalSaidas, custoMedioCompras };
  }, [movimentos]);

  return (
    <div className="space-y-6">
      {/* KPIs principais */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div
          className={`rounded-xl border p-4 ${
            saldoAtual <= 0
              ? 'border-rose-300 bg-rose-50'
              : abaixoMinimo
                ? 'border-amber-300 bg-amber-50'
                : 'border-slate-200 bg-white'
          }`}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Saldo atual
          </p>
          <p
            className={`mt-1 font-mono text-2xl font-bold ${
              saldoAtual <= 0 ? 'text-rose-700' : abaixoMinimo ? 'text-amber-700' : 'text-slate-900'
            }`}
          >
            {saldoAtual.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}{' '}
            <span className="text-sm font-normal text-slate-500">{unidadeEstoque}</span>
          </p>
          {minimo > 0 && (
            <p className="mt-0.5 text-[10px] text-slate-500">
              mínimo: {minimo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
              {abaixoMinimo && <span className="ml-1 font-medium text-amber-700">⚠ baixo</span>}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p
            className="text-[11px] font-medium uppercase tracking-wide text-slate-500"
            title="Custo unitário ponderado de todo o estoque atual (média móvel)"
          >
            Custo médio (MPM)
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900">
            {brl(custoAtual)}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">por {unidadeEstoque}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Valor em estoque
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{brl(valorEmEstoque)}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">saldo × custo médio</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Movimento histórico
          </p>
          <p className="mt-1 font-mono text-sm font-bold text-emerald-700">
            +{kpis.totalEntradas.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
          </p>
          <p className="font-mono text-sm font-bold text-rose-700">
            −{kpis.totalSaidas.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
          </p>
        </div>
      </div>

      {/* Botão ajustar */}
      <AjustarSaldoBtn
        produtoId={produtoId}
        produtoNome={produtoNome}
        unidadeEstoque={unidadeEstoque}
        custoAtual={custoAtual}
      />

      {/* Histórico de movimentos com saldo + custo médio reconstruídos */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          Histórico ({movimentos.length} movimento{movimentos.length === 1 ? '' : 's'})
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Cada linha mostra o saldo e custo médio resultante após o evento.
          Limitado às 200 últimas movimentações.
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Data/hora</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2 text-right">Qtd</th>
                <th className="px-4 py-2 text-right">Custo unit.</th>
                <th className="px-4 py-2 text-right">Saldo após</th>
                <th className="px-4 py-2 text-right">Custo médio após</th>
                <th className="px-4 py-2">Origem / motivo</th>
              </tr>
            </thead>
            <tbody>
              {historico.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-500">
                    Nenhuma movimentação ainda.
                  </td>
                </tr>
              ) : (
                historico.map((h) => {
                  const cfg = TIPO_LABEL[h.tipo] ?? {
                    label: h.tipo,
                    cls: 'bg-slate-100 text-slate-700',
                    ehEntrada: false,
                  };
                  const delta = Number(h.delta);
                  const ehEntrada = delta > 0;
                  const origem = h.notaCompraItemId ? (
                    <span className="text-slate-600">NFe</span>
                  ) : h.ordemProducaoId ? (
                    <Link
                      href={`/movimento/producao/${h.ordemProducaoId}`}
                      className="text-sky-700 hover:underline"
                    >
                      OP
                    </Link>
                  ) : h.pedidoItemId ? (
                    <span className="text-slate-600">Venda</span>
                  ) : (
                    <span className="text-slate-600">{h.observacao ?? '—'}</span>
                  );
                  return (
                    <tr key={h.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-[11px] text-slate-600">
                        {h.dataHora
                          ? new Date(h.dataHora).toLocaleString('pt-BR', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                              timeZone: 'America/Sao_Paulo',
                            })
                          : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cfg.cls}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono text-xs font-medium ${
                          ehEntrada ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {ehEntrada ? '+' : ''}
                        {delta.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                        {h.precoUnitario && Number(h.precoUnitario) > 0
                          ? brl(Number(h.precoUnitario))
                          : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-900">
                        {h.saldoApos.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-900">
                        {brl(h.custoApos)}
                        {ehEntrada && h.custoApos !== h.custoAnterior && h.custoAnterior > 0 && (
                          <span
                            className={`ml-1 text-[9px] ${
                              h.custoApos > h.custoAnterior ? 'text-rose-600' : 'text-emerald-600'
                            }`}
                          >
                            {h.custoApos > h.custoAnterior ? '↑' : '↓'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-[11px] text-slate-600">
                        {origem}
                        {h.observacao && !h.notaCompraItemId && !h.ordemProducaoId && !h.pedidoItemId
                          ? null // já mostrado em "origem"
                          : h.observacao && (
                              <span className="ml-1 text-[10px] text-slate-400">
                                · {h.observacao.slice(0, 40)}
                                {h.observacao.length > 40 ? '...' : ''}
                              </span>
                            )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AjustarSaldoBtn({
  produtoId,
  produtoNome,
  unidadeEstoque,
  custoAtual,
}: {
  produtoId: string;
  produtoNome: string;
  unidadeEstoque: string;
  custoAtual: number;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<'ENTRADA_AJUSTE' | 'SAIDA_AJUSTE' | 'PERDA'>(
    'ENTRADA_AJUSTE',
  );
  const [quantidade, setQuantidade] = useState('');
  const [custoUnit, setCustoUnit] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [_pending, start] = useTransition();

  function fechar() {
    setAberto(false);
    setQuantidade('');
    setCustoUnit('');
    setMotivo('');
    setTipo('ENTRADA_AJUSTE');
    setErro(null);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const q = Number(quantidade.replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) {
      setErro('Quantidade inválida');
      return;
    }
    if (motivo.trim().length < 3) {
      setErro('Motivo obrigatório (mínimo 3 caracteres)');
      return;
    }
    const ehEntrada = tipo === 'ENTRADA_AJUSTE';
    let custo: number | undefined = undefined;
    if (ehEntrada && custoUnit.trim()) {
      const c = Number(custoUnit.replace(',', '.'));
      if (!Number.isFinite(c) || c < 0) {
        setErro('Custo inválido');
        return;
      }
      custo = c;
    }

    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/produto/${produtoId}/ajustar-saldo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tipo,
          quantidade: q,
          custoUnitario: custo,
          motivo: motivo.trim(),
        }),
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
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        ⚖ Ajustar saldo
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
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Ajustar saldo</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Movimento manual em <strong>{produtoNome}</strong>. Use pra inventário,
                quebras, ou reconciliar saldo divergente. Custo médio (MPM) é
                recalculado automaticamente em entradas.
              </p>
            </div>

            {/* Tipo */}
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { v: 'ENTRADA_AJUSTE', l: '+ Entrada', desc: 'Aumenta saldo' },
                  { v: 'SAIDA_AJUSTE', l: '− Saída', desc: 'Inventário, quebra' },
                  { v: 'PERDA', l: '✕ Perda', desc: 'Vencimento, descarte' },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setTipo(o.v)}
                  className={`rounded-md border px-3 py-2 text-left text-xs ${
                    tipo === o.v
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-medium">{o.l}</div>
                  <div className={`mt-0.5 text-[10px] ${tipo === o.v ? 'text-slate-300' : 'text-slate-500'}`}>
                    {o.desc}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Quantidade ({unidadeEstoque}) *
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  autoFocus
                  placeholder="0"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              {tipo === 'ENTRADA_AJUSTE' && (
                <div className="w-40">
                  <label
                    className="block text-[11px] font-medium uppercase tracking-wide text-slate-500"
                    title="Se vazio, usa o custo médio atual"
                  >
                    Custo unit. (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={custoUnit}
                    onChange={(e) => setCustoUnit(e.target.value)}
                    placeholder={`Atual: ${custoAtual.toFixed(4)}`}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    vazio = usa atual
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Motivo *
              </label>
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex: Inventário 25/04, vencimento, quebra de embalagem"
                maxLength={500}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              <p className="mt-1 text-[10px] text-slate-500">
                Fica salvo no histórico pra rastreabilidade.
              </p>
            </div>

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
                disabled={salvando}
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {salvando ? 'Aplicando...' : 'Aplicar ajuste'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

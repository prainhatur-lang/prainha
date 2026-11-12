'use client';

// Card "Pago no cartão de crédito" da nota de entrada (dono, 12/11/2026):
// informa/troca/tira o cartão e mostra as parcelas já achadas nas faturas.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { brl } from '@/lib/format';

export interface CartaoOpcaoUi {
  banco: string;
  final: string;
}

export interface ParcelaAchadaUi {
  id: string;
  parcela: number | null;
  totalParcelas: number | null;
  valor: number;
  dataCompra: string | null;
  estabelecimento: string;
  cartaoFinal: string | null;
  vencimentoFatura: string | null;
}

const dataBr = (ymd: string | null) => (ymd ? ymd.slice(0, 10).split('-').reverse().join('/') : '—');

export function CartaoNota({
  notaId,
  cartoes,
  atual,
  valorTotal,
  achadas,
  contasAbertas,
}: {
  notaId: string;
  cartoes: CartaoOpcaoUi[];
  atual: { banco: string; final: string; parcelas: number } | null;
  valorTotal: number;
  achadas: ParcelaAchadaUi[];
  /** Contas a pagar que esta nota já gerou (aviso de pagar duas vezes). */
  contasAbertas: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editando, setEditando] = useState(false);
  const [cartao, setCartao] = useState(atual ? `${atual.banco}|${atual.final}` : '');
  const [parcelas, setParcelas] = useState(String(atual?.parcelas ?? 1));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(limpar: boolean) {
    setErro(null);
    const [banco, final] = cartao.split('|');
    const n = Number(parcelas);
    if (!limpar && (!banco || !final || !Number.isInteger(n) || n < 1)) {
      setErro('Escolha o cartão e o número de parcelas.');
      return;
    }
    setSalvando(true);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}/cartao`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cartao: limpar ? null : { banco, final, parcelas: n } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setEditando(false);
      start(() => router.refresh());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const form = (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="text-[11px] text-slate-600">
        Cartão
        <select
          value={cartao}
          onChange={(e) => setCartao(e.target.value)}
          className="mt-0.5 block rounded-md border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="">-- escolha --</option>
          {cartoes.map((c) => (
            <option key={`${c.banco}|${c.final}`} value={`${c.banco}|${c.final}`}>
              {c.banco} final {c.final}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[11px] text-slate-600">
        Parcelas
        <input
          type="number"
          min={1}
          max={36}
          value={parcelas}
          onChange={(e) => setParcelas(e.target.value)}
          className="mt-0.5 block w-16 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
      </label>
      <button
        type="button"
        onClick={() => salvar(false)}
        disabled={salvando || pending}
        className="rounded-md border border-violet-700 bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
      >
        {salvando ? 'Salvando…' : 'Salvar'}
      </button>
      <button
        type="button"
        onClick={() => setEditando(false)}
        disabled={salvando}
        className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50"
      >
        Cancelar
      </button>
      {erro && <span className="text-[11px] text-rose-700">{erro}</span>}
    </div>
  );

  if (!atual) {
    return (
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
        <div className="flex items-center justify-between gap-4">
          <span>💳 Esta compra foi paga no cartão de crédito?</span>
          {!editando && (
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50"
            >
              Informar cartão
            </button>
          )}
        </div>
        {editando && form}
        {editando && cartoes.length === 0 && (
          <p className="mt-1 text-[11px] text-amber-700">
            Nenhum cartão ainda: envie uma fatura em Financeiro → Cartões.
          </p>
        )}
      </div>
    );
  }

  const valorParcela = atual.parcelas > 0 ? valorTotal / atual.parcelas : valorTotal;
  return (
    <div className="mt-4 rounded-xl border border-violet-300 bg-violet-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="text-xs text-violet-900">
          <div className="text-sm font-semibold">
            💳 Pago no cartão {atual.banco} final {atual.final}
          </div>
          <div className="mt-0.5">
            {atual.parcelas}x de <span className="font-mono font-semibold">{brl(valorParcela)}</span> · não gera
            conta a pagar (quem paga é a fatura)
          </div>
        </div>
        {!editando && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="rounded-md border border-violet-300 bg-white px-2 py-1 text-[11px] text-violet-800 hover:bg-violet-100"
            >
              Trocar
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm('Tirar a marcação de cartão desta nota?')) void salvar(true);
              }}
              disabled={salvando || pending}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Não foi no cartão
            </button>
          </div>
        )}
      </div>
      {editando && form}
      {!editando && erro && <p className="mt-1 text-[11px] text-rose-700">{erro}</p>}

      {contasAbertas > 0 && (
        <p className="mt-2 rounded bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900">
          ⚠ Esta nota também tem {contasAbertas} conta(s) a pagar. Se foi tudo no cartão, exclua as parcelas
          pra não pagar duas vezes.
        </p>
      )}

      <div className="mt-3 border-t border-violet-200 pt-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-800">
          Encontro com a fatura — {achadas.length} de {atual.parcelas} parcela(s) achada(s)
        </div>
        {achadas.length === 0 ? (
          <p className="mt-1 text-[11px] text-violet-800">
            Ainda não apareceu em nenhuma fatura enviada deste cartão. Quando a fatura entrar em{' '}
            <Link href="/financeiro/cartoes" className="underline">
              Financeiro → Cartões
            </Link>
            , a parcela aparece aqui.
          </p>
        ) : (
          <div className="mt-1 space-y-0.5 text-[11px]">
            {achadas.map((p) => (
              <div key={p.id} className="flex flex-wrap justify-between gap-x-3 font-mono text-slate-700">
                <span>
                  ✓ Parcela {p.parcela ?? 1}/{p.totalParcelas ?? 1}
                </span>
                <span>fatura venc. {dataBr(p.vencimentoFatura)}</span>
                <span className="min-w-0 flex-1 truncate font-sans">
                  {p.estabelecimento}
                  {p.cartaoFinal && p.cartaoFinal !== atual.final ? ` · cartão ${p.cartaoFinal}` : ''}
                </span>
                <span className="font-semibold">{brl(p.valor)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

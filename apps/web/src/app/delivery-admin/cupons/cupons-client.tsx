'use client';

// CRUD de cupons do delivery: percentual, valor fixo ou frete grátis, com
// validade, mínimo do pedido, limite de usos e "só primeira compra".

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Cupom {
  id: string;
  codigo: string;
  tipo: string;
  valor: string;
  minimoPedido: string | null;
  validadeInicio: string | null;
  validadeFim: string | null;
  usosMax: number | null;
  usosPorCliente: number | null;
  usados: number;
  primeiraCompraApenas: boolean;
  ativo: boolean;
}

interface Props {
  filialId: string;
  filialNome: string;
  filiais: Array<{ id: string; nome: string }>;
  cupons: Cupom[];
  podeCriar: boolean;
  podeEditar: boolean;
  podeDeletar: boolean;
}

const brl = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 focus:border-sky-500 focus:outline-none sm:py-2 sm:text-sm';
const lblCls = 'text-xs font-medium text-slate-600';

function descreve(c: Cupom): string {
  if (c.tipo === 'frete_gratis') return 'Frete grátis';
  if (c.tipo === 'percentual') return `${Number(c.valor).toFixed(0)}% de desconto`;
  return `${brl(c.valor)} de desconto`;
}

function fmtData(ymd: string | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export function CuponsClient({
  filialId,
  filialNome,
  filiais,
  cupons,
  podeCriar,
  podeEditar,
  podeDeletar,
}: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [codigo, setCodigo] = useState('');
  const [tipo, setTipo] = useState<'percentual' | 'fixo' | 'frete_gratis'>('percentual');
  const [valor, setValor] = useState('10');
  const [minimoPedido, setMinimoPedido] = useState('');
  const [validadeFim, setValidadeFim] = useState('');
  const [usosMax, setUsosMax] = useState('');
  const [usosPorCliente, setUsosPorCliente] = useState('1');
  const [primeiraCompraApenas, setPrimeiraCompraApenas] = useState(false);

  async function criar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/delivery-admin/cupom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          codigo,
          tipo,
          valor: tipo === 'frete_gratis' ? 0 : Number(valor.replace(',', '.')),
          minimoPedido: minimoPedido ? Number(minimoPedido.replace(',', '.')) : undefined,
          validadeFim: validadeFim || undefined,
          usosMax: usosMax ? Number(usosMax) : undefined,
          usosPorCliente: usosPorCliente ? Number(usosPorCliente) : null,
          primeiraCompraApenas,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      setCriando(false);
      setCodigo('');
      setMsg('Cupom criado.');
      start(() => router.refresh());
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(c: Cupom) {
    const r = await fetch('/api/delivery-admin/cupom', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id, ativo: !c.ativo }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErro(d.error ?? 'Não consegui atualizar.');
      return;
    }
    setMsg(c.ativo ? 'Cupom desativado.' : 'Cupom ativado.');
    start(() => router.refresh());
  }

  async function apagar(c: Cupom) {
    if (!window.confirm(`Apagar o cupom ${c.codigo}?`)) return;
    const r = await fetch(`/api/delivery-admin/cupom?id=${c.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErro(d.error ?? 'Não consegui apagar.');
      return;
    }
    setMsg('Cupom apagado.');
    start(() => router.refresh());
  }

  return (
    <section className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/delivery-admin" className="text-sm text-sky-700">
            ◂ Pedidos
          </Link>
          <h1 className="mt-1 text-xl font-bold text-slate-900">Cupons do delivery</h1>
          <p className="text-sm text-slate-500">
            {filialNome} · {cupons.length} cupons
          </p>
        </div>
        {podeCriar ? (
          <button
            onClick={() => setCriando((v) => !v)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {criando ? 'Fechar' : '+ Novo cupom'}
          </button>
        ) : null}
      </div>

      {filiais.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {filiais.map((f) => (
            <Link
              key={f.id}
              href={`/delivery-admin/cupons?filialId=${f.id}`}
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

      {criando ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={lblCls}>Código</label>
              <input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/\s/g, ''))}
                placeholder="PRAINHA10"
                className={`${inputCls} uppercase`}
              />
            </div>
            <div>
              <label className={lblCls}>Tipo</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as typeof tipo)}
                className={inputCls}
              >
                <option value="percentual">% de desconto</option>
                <option value="fixo">R$ de desconto</option>
                <option value="frete_gratis">Frete grátis</option>
              </select>
            </div>
            {tipo !== 'frete_gratis' ? (
              <div>
                <label className={lblCls}>{tipo === 'percentual' ? 'Percentual' : 'Valor (R$)'}</label>
                <input
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  inputMode="decimal"
                  className={inputCls}
                />
              </div>
            ) : null}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <div>
              <label className={lblCls}>Pedido mínimo (R$)</label>
              <input
                value={minimoPedido}
                onChange={(e) => setMinimoPedido(e.target.value)}
                inputMode="decimal"
                placeholder="opcional"
                className={inputCls}
              />
            </div>
            <div>
              <label className={lblCls}>Vale até</label>
              <input
                type="date"
                value={validadeFim}
                onChange={(e) => setValidadeFim(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={lblCls}>Usos totais</label>
              <input
                value={usosMax}
                onChange={(e) => setUsosMax(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="ilimitado"
                className={inputCls}
              />
            </div>
            <div>
              <label className={lblCls}>Usos por cliente</label>
              <input
                value={usosPorCliente}
                onChange={(e) => setUsosPorCliente(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="ilimitado"
                className={inputCls}
              />
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={primeiraCompraApenas}
              onChange={(e) => setPrimeiraCompraApenas(e.target.checked)}
              className="h-4 w-4"
            />
            Só vale na primeira compra do cliente
          </label>
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => void criar()}
              disabled={salvando || !codigo.trim()}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {salvando ? 'Criando…' : 'Criar cupom'}
            </button>
          </div>
        </div>
      ) : null}

      {cupons.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          Nenhum cupom ainda. Crie um pra usar nas campanhas do Instagram.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {cupons.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900">
                  {c.codigo}
                  {!c.ativo ? (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500">
                      inativo
                    </span>
                  ) : null}
                  {c.primeiraCompraApenas ? (
                    <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-normal text-violet-700">
                      1ª compra
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-slate-500">
                  {descreve(c)}
                  {c.minimoPedido ? ` · mín ${brl(c.minimoPedido)}` : ''}
                  {c.validadeFim ? ` · até ${fmtData(c.validadeFim)}` : ''}
                  {` · usado ${c.usados}${c.usosMax ? `/${c.usosMax}` : ''}`}
                  {c.usosPorCliente ? ` · ${c.usosPorCliente}× por cliente` : ''}
                </p>
              </div>
              {podeEditar ? (
                <button
                  onClick={() => void alternar(c)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {c.ativo ? 'Desativar' : 'Ativar'}
                </button>
              ) : null}
              {podeDeletar ? (
                <button
                  onClick={() => void apagar(c)}
                  className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                >
                  Apagar
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

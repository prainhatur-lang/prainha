'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export type ProdutoInventario = { id: string; descricao: string; ean: string | null; unidade: string; custo: number; saldo: number };
export type AjusteFeito = { id: string; descricao: string; quantidade: number; observacao: string | null; criado_por: string | null; quando: string };

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const limpa = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const RASCUNHO = 'lelis-inventario-rascunho';

function ler(txt: string): number | null {
  const t = txt.trim().replace(/\./g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function InventarioLelis({ produtos, ajustes }: { produtos: ProdutoInventario[]; ajustes: AjusteFeito[] }) {
  const router = useRouter();
  const [contagem, setContagem] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState('');
  const [soComSaldo, setSoComSaldo] = useState(false);
  const [zerarResto, setZerarResto] = useState(false);
  const [obs, setObs] = useState('');
  const [gravando, setGravando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  // rascunho no aparelho: fechar a tela no meio da contagem não perde o digitado
  useEffect(() => {
    try {
      const r = localStorage.getItem(RASCUNHO);
      if (r) setContagem(JSON.parse(r));
    } catch {}
  }, []);
  function digitar(id: string, v: string) {
    setContagem((a) => {
      const n = { ...a, [id]: v };
      if (v.trim() === '') delete n[id];
      try { localStorage.setItem(RASCUNHO, JSON.stringify(n)); } catch {}
      return n;
    });
  }
  function limpar() {
    setContagem({});
    try { localStorage.removeItem(RASCUNHO); } catch {}
  }

  const vistos = useMemo(() => {
    const termos = limpa(busca).split(/\s+/).filter(Boolean);
    return produtos.filter((p) => {
      if (soComSaldo && p.saldo === 0 && !(p.id in contagem)) return false;
      if (termos.length === 0) return true;
      const alvo = limpa(`${p.descricao} ${p.ean ?? ''}`);
      return termos.every((t) => alvo.includes(t));
    });
  }, [produtos, busca, soComSaldo, contagem]);

  // o que vai ser gravado: o digitado + (se marcado) zero pra quem tem saldo e ficou em branco
  const itens = useMemo(() => {
    const l: Array<{ p: ProdutoInventario; contado: number }> = [];
    for (const p of produtos) {
      const txt = contagem[p.id];
      if (txt !== undefined) {
        const n = ler(txt);
        if (n !== null) l.push({ p, contado: n });
      } else if (zerarResto && p.saldo !== 0) l.push({ p, contado: 0 });
    }
    return l;
  }, [produtos, contagem, zerarResto]);
  const invalidos = produtos.filter((p) => contagem[p.id] !== undefined && ler(contagem[p.id]) === null).length;
  const comDiferenca = itens.filter((i) => Math.abs(i.contado - i.p.saldo) > 0.00005);
  const sobra = comDiferenca.filter((i) => i.contado > i.p.saldo).reduce((s, i) => s + (i.contado - i.p.saldo) * i.p.custo, 0);
  const falta = comDiferenca.filter((i) => i.contado < i.p.saldo).reduce((s, i) => s + (i.p.saldo - i.contado) * i.p.custo, 0);

  async function gravar() {
    if (itens.length === 0 || invalidos > 0) return;
    const aviso =
      `Gravar o inventário?\n\n${itens.length} produto(s) contado(s), ${comDiferenca.length} com diferença.\n` +
      `O estoque desses produtos passa a ser o contado.`;
    if (!window.confirm(aviso)) return;
    setGravando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/lelis/inventario', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itens: itens.map((i) => ({ produtoId: i.p.id, contado: i.contado })), observacao: obs.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'Não gravou');
      setMsg({ ok: true, texto: `Inventário gravado: ${j.ajustados} produto(s) ajustado(s), ${j.iguais} já batiam.` });
      limpar();
      setZerarResto(false);
      setObs('');
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, texto: e instanceof Error ? e.message : 'Não gravou' });
    } finally {
      setGravando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar produto ou código de barras…"
          className="min-w-64 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={soComSaldo} onChange={(e) => setSoComSaldo(e.target.checked)} />
          Só o que tem estoque no sistema
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2 text-right">No sistema</th>
              <th className="px-3 py-2 text-right">Contado</th>
              <th className="px-3 py-2 text-right">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {vistos.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-500">Nenhum produto nessa busca.</td>
              </tr>
            )}
            {vistos.map((p) => {
              const txt = contagem[p.id];
              const n = txt !== undefined ? ler(txt) : zerarResto && p.saldo !== 0 ? 0 : null;
              const ruim = txt !== undefined && ler(txt) === null;
              const dif = n === null ? null : n - p.saldo;
              return (
                <tr key={p.id} className={`border-b border-slate-100 ${txt !== undefined ? 'bg-sky-50/40' : ''}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{p.descricao}</div>
                    {p.ean && <div className="text-xs text-slate-500">EAN {p.ean}</div>}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-mono ${p.saldo < 0 ? 'text-red-700' : p.saldo === 0 ? 'text-slate-400' : 'text-slate-900'}`}>
                    {qtd(p.saldo)} <span className="text-xs text-slate-500">{p.unidade}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      value={txt ?? ''}
                      onChange={(e) => digitar(p.id, e.target.value)}
                      inputMode="decimal"
                      placeholder={zerarResto && p.saldo !== 0 ? '0' : '—'}
                      className={`w-24 rounded-md border px-2 py-1.5 text-right font-mono text-sm ${ruim ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'}`}
                    />
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-mono font-semibold ${dif === null || Math.abs(dif) < 0.00005 ? 'text-slate-400' : dif > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {dif === null ? '—' : Math.abs(dif) < 0.00005 ? 'bate' : `${dif > 0 ? '+' : '−'}${qtd(Math.abs(dif))}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-700">
          <span><b>{itens.length}</b> contado(s)</span>
          <span><b>{comDiferenca.length}</b> com diferença</span>
          {sobra > 0 && <span className="text-emerald-700">sobrando {brl(sobra)} a custo</span>}
          {falta > 0 && <span className="text-red-700">faltando {brl(falta)} a custo</span>}
          {invalidos > 0 && <span className="font-medium text-red-700">{invalidos} campo(s) com número inválido</span>}
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={zerarResto} onChange={(e) => setZerarResto(e.target.checked)} />
          <span>
            Contei tudo: o que ficou em branco e tem estoque no sistema <b>vai pra zero</b>.
            <span className="block text-xs text-slate-500">Desmarcado, o que ficou em branco não muda.</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            maxLength={200}
            placeholder="Observação (quem contou, por quê) — opcional"
            className="min-w-64 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <button onClick={limpar} disabled={gravando || Object.keys(contagem).length === 0} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Limpar contagem
          </button>
          <button onClick={gravar} disabled={gravando || itens.length === 0 || invalidos > 0} className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
            {gravando ? 'Gravando…' : 'Gravar inventário'}
          </button>
        </div>
        {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.texto}</p>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Ajustes de inventário já gravados</h2>
        {ajustes.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nenhum inventário gravado por esta tela ainda.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {ajustes.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5">
                <span className="text-slate-900">
                  {a.descricao}{' '}
                  <b className={a.quantidade > 0 ? 'text-emerald-700' : 'text-red-700'}>
                    {a.quantidade > 0 ? '+' : '−'}{qtd(Math.abs(a.quantidade))}
                  </b>
                </span>
                <span className="text-xs text-slate-500">{a.quando} · {a.criado_por} · {a.observacao}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

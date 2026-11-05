'use client';

// Botão "Lançar pagamentos da folha": mostra o que vira conta a pagar na casa
// (simulação) e só grava depois do "Lançar".

import { useState } from 'react';

interface Item {
  ref: string;
  empresa: string;
  tipo: 'repasse_eb' | 'repasse_lelis' | 'direto';
  descricao: string;
  pessoas: { nome: string; liquido: number }[];
  valor: number;
  jaLancadaId: string | null;
  pareceLancada: string | null;
  semFavorecido: string[];
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function LancarPagamentosFolha({ filialId, comp }: { filialId: string; comp: string }) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [itens, setItens] = useState<Item[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [venc, setVenc] = useState('');
  const [semSalario, setSemSalario] = useState<string[]>([]);
  const [previa, setPrevia] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/rh/folha-contador/pagamentos?filialId=${filialId}&comp=${comp}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'erro');
      setItens(j.itens);
      setVenc(j.vencimento);
      setSemSalario(j.semSalario ?? []);
      setPrevia(!!j.previa);
      setMarcados(new Set((j.itens as Item[]).filter((i) => !i.jaLancadaId && !i.pareceLancada).map((i) => i.ref)));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'erro');
    } finally {
      setCarregando(false);
    }
  }

  async function lancar() {
    if (!marcados.size) return;
    const soma = (itens ?? []).filter((i) => marcados.has(i.ref)).reduce((s, i) => s + i.valor, 0);
    if (!confirm(`Lançar ${marcados.size} conta(s) a pagar, total ${brl(soma)}, vencimento ${venc.split('-').reverse().join('/')}?`)) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch('/api/rh/folha-contador/pagamentos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId, comp, refs: [...marcados], vencimento: venc }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'erro');
      setMsg(`${j.criadas} conta(s) lançada(s), ${brl(j.total)}.${j.puladas ? ` ${j.puladas} já estava(m) lançada(s).` : ''}`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'erro');
    } finally {
      setCarregando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => {
          setAberto(true);
          void carregar();
        }}
        className="mt-2 inline-block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        💸 Lançar pagamentos da folha
      </button>
    );
  }

  const selecionados = (itens ?? []).filter((i) => marcados.has(i.ref));
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold text-slate-900">Pagamentos da folha → contas a pagar</p>
        <button type="button" onClick={() => setAberto(false)} className="text-xs text-slate-500 hover:underline">
          fechar
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Líquido da nossa folha (ponto + salário do cadastro), o mesmo do imprimir. E.B.: uma conta de repasse pra E.B. (ela paga as pessoas). Lelis: repasse por pessoa. Empresa da própria casa: uma conta por funcionário.
      </p>
      {previa && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">Mês ainda não fechou: dá pra ver, mas só lança depois do dia 1º do mês seguinte.</p>
      )}
      {semSalario.length > 0 && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          Fora da folha por falta de salário/valor da hora no cadastro: {semSalario.join(', ')}. Acerte o cadastro antes de lançar.
        </p>
      )}
      {carregando && !itens && <p className="text-xs text-slate-500">Carregando…</p>}
      {itens && itens.length === 0 && <p className="text-xs text-slate-500">Nada pra lançar nesta casa neste mês.</p>}
      {itens && itens.length > 0 && (
        <>
          <table className="w-full text-xs">
            <tbody>
              {itens.map((i) => (
                <tr key={i.ref} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      disabled={!!i.jaLancadaId}
                      checked={marcados.has(i.ref)}
                      onChange={(e) => {
                        const n = new Set(marcados);
                        if (e.target.checked) n.add(i.ref);
                        else n.delete(i.ref);
                        setMarcados(n);
                      }}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <p className="text-slate-800">{i.descricao}</p>
                    <p className="text-[11px] text-slate-400">
                      {i.empresa} · {i.pessoas.length} pessoa(s)
                    </p>
                    {i.jaLancadaId && <p className="text-[11px] text-emerald-700">✓ já lançada</p>}
                    {i.pareceLancada && !i.jaLancadaId && (
                      <p className="text-[11px] text-amber-700">Parece já lançada à mão: {i.pareceLancada}</p>
                    )}
                    {i.semFavorecido.length > 0 && (
                      <p className="text-[11px] text-amber-700">Sem favorecido no cadastro: a conta sai sem fornecedor.</p>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-medium text-slate-900">{brl(i.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
            <label className="text-xs text-slate-600">
              Vencimento{' '}
              <input
                type="date"
                value={venc}
                onChange={(e) => setVenc(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              />
            </label>
            <span className="text-xs text-slate-600">
              {selecionados.length} marcada(s) · {brl(selecionados.reduce((s, i) => s + i.valor, 0))}
            </span>
            <button
              type="button"
              disabled={carregando || previa || !marcados.size || !venc}
              onClick={() => void lancar()}
              className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Lançar contas a pagar
            </button>
          </div>
        </>
      )}
      {msg && <p className="mt-2 text-xs text-emerald-700">{msg}</p>}
      {erro && <p className="mt-2 text-xs text-red-700">{erro}</p>}
    </div>
  );
}

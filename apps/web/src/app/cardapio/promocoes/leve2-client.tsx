'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RegraLeve2Salva } from '@/lib/promo-leve2';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type Form = {
  produtoId: string;
  ativa: boolean;
  dias: number[];
  horaInicio: string;
  horaFim: string;
  excetoFeriados: boolean;
};

const NOVO: Form = { produtoId: '', ativa: true, dias: [1, 2, 3, 4, 5], horaInicio: '12:00', horaFim: '20:00', excetoFeriados: true };

function resumoDias(d: number[]) {
  if (d.length === 0) return 'todo dia';
  if (d.length === 7) return 'todo dia';
  return [...d].sort().map((x) => DIAS[x]).join(', ');
}

export function Leve2Client(props: {
  filialId: string;
  regras: RegraLeve2Salva[];
  produtos: Array<{ id: string; nome: string; dobrado: boolean }>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const comRegra = useMemo(() => new Set(props.regras.map((r) => r.produtoId)), [props.regras]);
  const achados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q.length < 2) return [];
    return props.produtos.filter((p) => p.nome.toLowerCase().includes(q)).slice(0, 12);
  }, [busca, props.produtos]);
  const nomeDe = (id: string) => props.produtos.find((p) => p.id === id)?.nome ?? props.regras.find((r) => r.produtoId === id)?.nome ?? '';

  async function salvar() {
    if (!form) return;
    setErro(null);
    if (!form.produtoId) return setErro('escolha o produto');
    setSalvando(true);
    const r = await fetch('/api/cardapio/promo-leve2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filialId: props.filialId, ...form }),
    }).then((x) => x.json()).catch(() => ({ ok: false, erro: 'falhou' }));
    setSalvando(false);
    if (!r.ok) return setErro(r.erro ?? 'falhou');
    setForm(null);
    setBusca('');
    router.refresh();
  }

  async function excluir(produtoId: string) {
    if (!confirm('Tirar a promoção paga 1 leva 2 deste produto?')) return;
    await fetch(`/api/cardapio/promo-leve2?filialId=${props.filialId}&produtoId=${produtoId}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-3">
      {props.regras.length === 0 && !form && (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">
          Nenhum produto com paga 1 leva 2 por horário nesta casa.
        </p>
      )}
      {props.regras.map((r) => (
        <div key={r.produtoId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3">
          <div>
            <div className="font-medium text-slate-900">
              {r.nome} {!r.ativa && <span className="ml-1 rounded bg-slate-100 px-1.5 text-xs text-slate-500">desligada</span>}
            </div>
            <div className="text-xs text-slate-500">
              {resumoDias(r.dias)} · {r.horaInicio}–{r.horaFim}
              {r.excetoFeriados ? ' · exceto feriados' : ''}
            </div>
            <div className="mt-1 text-xs">
              {r.dobradoAgora ? (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">🍺 agora: paga 1 leva 2</span>
              ) : (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">agora: preço normal (1 por 1)</span>
              )}
              {r.aplicadoEm && <span className="ml-2 text-slate-400">última virada {r.aplicadoEm}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
              onClick={() => {
                setErro(null);
                setForm({
                  produtoId: r.produtoId,
                  ativa: r.ativa,
                  dias: r.dias,
                  horaInicio: r.horaInicio ?? '12:00',
                  horaFim: r.horaFim ?? '20:00',
                  excetoFeriados: r.excetoFeriados,
                });
              }}
            >
              Editar
            </button>
            <button type="button" className="rounded-md border border-red-200 px-3 py-1 text-sm text-red-700 hover:bg-red-50" onClick={() => excluir(r.produtoId)}>
              Tirar
            </button>
          </div>
        </div>
      ))}

      {!form && (
        <button
          type="button"
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          onClick={() => {
            setErro(null);
            setForm({ ...NOVO });
          }}
        >
          + Paga 1 leva 2 num produto
        </button>
      )}

      {form && (
        <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <div>
            <label className="text-xs font-medium text-slate-700">Produto</label>
            {form.produtoId ? (
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span className="font-medium">{nomeDe(form.produtoId)}</span>
                {!comRegra.has(form.produtoId) && (
                  <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setForm({ ...form, produtoId: '' })}>
                    trocar
                  </button>
                )}
              </div>
            ) : (
              <>
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Digite o nome (ex.: chope)"
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                {achados.length > 0 && (
                  <div className="mt-1 max-h-60 overflow-auto rounded-md border border-slate-200 bg-white">
                    {achados.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="block w-full px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                        onClick={() => setForm({ ...form, produtoId: p.id })}
                      >
                        {p.nome}
                        {comRegra.has(p.id) && <span className="ml-2 text-xs text-amber-700">(já tem regra — vai editar)</span>}
                        {p.dobrado && !comRegra.has(p.id) && <span className="ml-2 text-xs text-slate-500">(hoje já sai dobrado sempre)</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">Dias</label>
            <div className="mt-1 flex flex-wrap gap-1">
              {DIAS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setForm({ ...form, dias: form.dias.includes(i) ? form.dias.filter((x) => x !== i) : [...form.dias, i] })}
                  className={`rounded-md border px-2 py-1 text-sm ${form.dias.includes(i) ? 'border-amber-500 bg-amber-100 font-medium' : 'border-slate-300 bg-white'}`}
                >
                  {d}
                </button>
              ))}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">Nenhum dia marcado = todo dia.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-slate-700">
              Das
              <input type="time" value={form.horaInicio} onChange={(e) => setForm({ ...form, horaInicio: e.target.value })} className="ml-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-700">
              às
              <input type="time" value={form.horaFim} onChange={(e) => setForm({ ...form, horaFim: e.target.value })} className="ml-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={form.excetoFeriados} onChange={(e) => setForm({ ...form, excetoFeriados: e.target.checked })} />
              exceto feriados
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={form.ativa} onChange={(e) => setForm({ ...form, ativa: e.target.checked })} />
              ligada
            </label>
          </div>
          {erro && <p className="text-sm text-red-700">{erro}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={salvando} onClick={salvar} className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
            <button type="button" onClick={() => setForm(null)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Destaque } from '@/lib/cardapio-destaque';

type Item = { codigo: number; nome: string; preco: number; noQr: boolean };
type Form = {
  id: string | null;
  titulo: string;
  texto: string;
  dias: number[];
  horaInicio: string;
  horaFim: string;
  codigos: number[];
  mostrar: boolean;
  excetoFeriados: boolean;
  ordem: number;
};

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SUGESTOES = ['Almoço executivo', 'Almoço convidativo', 'Happy hour'];

function vazio(ordem: number): Form {
  return { id: null, titulo: '', texto: '', dias: [1, 2, 3, 4, 5], horaInicio: '11:00', horaFim: '15:00', codigos: [], mostrar: false, excetoFeriados: true, ordem };
}

function deDestaque(d: Destaque): Form {
  return {
    id: d.id,
    titulo: d.titulo,
    texto: d.texto ?? '',
    dias: d.dias,
    horaInicio: d.horaInicio ?? '',
    horaFim: d.horaFim ?? '',
    codigos: d.codigos,
    mostrar: d.mostrar,
    excetoFeriados: d.excetoFeriados,
    ordem: d.ordem,
  };
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function DestaquesClient(props: { filialId: string; inicial: Destaque[]; itens: Item[] }) {
  const router = useRouter();
  const [lista, setLista] = useState<Form[]>(props.inicial.map(deDestaque));
  const porCodigo = useMemo(() => new Map(props.itens.map((i) => [i.codigo, i])), [props.itens]);

  return (
    <div className="mt-5 space-y-4">
      {lista.map((f, i) => (
        <Cartao
          key={f.id ?? `novo-${i}`}
          filialId={props.filialId}
          inicial={f}
          itens={props.itens}
          porCodigo={porCodigo}
          onSalvo={() => router.refresh()}
          onExcluido={() => {
            setLista((l) => l.filter((_, j) => j !== i));
            router.refresh();
          }}
        />
      ))}
      <button
        type="button"
        onClick={() => setLista((l) => [...l, vazio(l.length + 1)])}
        className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
      >
        + Novo destaque
      </button>
    </div>
  );
}

function Cartao(props: {
  filialId: string;
  inicial: Form;
  itens: Item[];
  porCodigo: Map<number, Item>;
  onSalvo: () => void;
  onExcluido: () => void;
}) {
  const [f, setF] = useState<Form>(props.inicial);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const achados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q.length < 2) return [];
    return props.itens
      .filter((i) => !f.codigos.includes(i.codigo) && (i.nome.toLowerCase().includes(q) || String(i.codigo) === q))
      .slice(0, 12);
  }, [busca, props.itens, f.codigos]);

  const set = (p: Partial<Form>) => {
    setF((x) => ({ ...x, ...p }));
    setMsg(null);
  };

  async function salvar(extra?: Partial<Form>) {
    const dados = { ...f, ...extra };
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/cardapio/destaques', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: dados.id,
          filialId: props.filialId,
          titulo: dados.titulo,
          texto: dados.texto.trim() || null,
          dias: dados.dias,
          horaInicio: dados.horaInicio || null,
          horaFim: dados.horaFim || null,
          codigos: dados.codigos,
          mostrar: dados.mostrar,
          excetoFeriados: dados.excetoFeriados,
          ordem: dados.ordem,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setMsg({ ok: false, t: j.erro || 'não salvou' });
        return;
      }
      setF({ ...dados, id: j.id });
      setMsg({ ok: true, t: 'Salvo. A loja pega em até 10 min.' });
      props.onSalvo();
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!f.id) {
      props.onExcluido();
      return;
    }
    if (!confirm(`Excluir o destaque "${f.titulo}"?`)) return;
    const r = await fetch(`/api/cardapio/destaques?filialId=${props.filialId}&id=${f.id}`, { method: 'DELETE' });
    if (r.ok) props.onExcluido();
  }

  return (
    <div className={`rounded-lg border bg-white p-4 shadow-sm ${f.mostrar ? 'border-emerald-300' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={f.titulo}
          onChange={(e) => set({ titulo: e.target.value })}
          placeholder="Ex.: Almoço executivo"
          list="sugestoes-destaque"
          className="min-w-[220px] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-base font-semibold"
        />
        <datalist id="sugestoes-destaque">
          {SUGESTOES.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.mostrar}
            disabled={salvando}
            onChange={(e) => {
              const mostrar = e.target.checked;
              set({ mostrar });
              if (f.id) void salvar({ mostrar });
            }}
            className="h-4 w-4"
          />
          <span className={f.mostrar ? 'font-medium text-emerald-700' : 'text-slate-600'}>
            Mostrar no cardápio do QR
          </span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {DIAS.map((d, i) => {
          const on = f.dias.includes(i);
          return (
            <button
              key={d}
              type="button"
              onClick={() => set({ dias: on ? f.dias.filter((x) => x !== i) : [...f.dias, i].sort() })}
              className={`rounded-md border px-2.5 py-1 text-sm ${
                on ? 'border-blue-500 bg-blue-50 font-medium text-blue-700' : 'border-slate-200 text-slate-500'
              }`}
            >
              {d}
            </button>
          );
        })}
        <span className="ml-2 text-sm text-slate-500">das</span>
        <input type="time" value={f.horaInicio} onChange={(e) => set({ horaInicio: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <span className="text-sm text-slate-500">às</span>
        <input type="time" value={f.horaFim} onChange={(e) => set({ horaFim: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={f.excetoFeriados} onChange={(e) => set({ excetoFeriados: e.target.checked })} className="h-4 w-4" />
        Exceto feriados <span className="text-xs text-slate-400">(nacionais, de Sergipe e de Aracaju — no feriado o QR avisa que hoje não tem)</span>
      </label>
      <p className="mt-1 text-xs text-slate-400">Nenhum dia marcado = todos os dias. Sem hora = o dia inteiro.</p>

      <textarea
        value={f.texto}
        onChange={(e) => set({ texto: e.target.value })}
        placeholder="Texto pro cliente (opcional). Ex.: Prato do dia + suco ou refrigerante."
        rows={2}
        className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />

      <div className="mt-3">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Itens que o cliente pede</div>
        <div className="mt-1 flex flex-wrap gap-2">
          {f.codigos.length === 0 && <span className="text-sm text-slate-400">nenhum item ligado</span>}
          {f.codigos.map((c) => {
            const it = props.porCodigo.get(c);
            return (
              <span key={c} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm">
                {it ? it.nome : `#${c} (não achado)`}
                {it && it.preco > 0 && <span className="text-xs text-slate-400">{brl(it.preco)}</span>}
                <button type="button" onClick={() => set({ codigos: f.codigos.filter((x) => x !== c) })} className="ml-1 text-slate-400 hover:text-rose-600" aria-label="tirar">
                  ×
                </button>
              </span>
            );
          })}
        </div>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar item pelo nome ou código pra ligar…"
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {achados.length > 0 && (
          <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-slate-200">
            {achados.map((i) => (
              <button
                key={i.codigo}
                type="button"
                onClick={() => {
                  set({ codigos: [...f.codigos, i.codigo] });
                  setBusca('');
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <span>
                  {i.nome} <span className="text-xs text-slate-400">#{i.codigo}</span>
                </span>
                <span className="text-xs text-slate-500">{i.preco > 0 ? brl(i.preco) : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={salvando || f.titulo.trim().length < 2}
          onClick={() => void salvar()}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={() => void excluir()} className="text-sm text-slate-400 hover:text-rose-600">
          Excluir
        </button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.t}</span>}
      </div>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RegraPrecoSalva } from '@/lib/preco-horario';

type Item = { codigo: number; nome: string; preco: number; noQr: boolean };
type Form = {
  codigo: number | null;
  ativa: boolean;
  precoNormal: string;
  precoHorario: string;
  dias: number[];
  horaInicio: string;
  horaFim: string;
  excetoFeriados: boolean;
};

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const txt = (n: number) => n.toFixed(2).replace('.', ',');

function novo(): Form {
  return { codigo: null, ativa: true, precoNormal: '', precoHorario: '', dias: [1, 2, 3, 4, 5], horaInicio: '12:00', horaFim: '20:00', excetoFeriados: true };
}

function deRegra(r: RegraPrecoSalva): Form {
  return {
    codigo: r.codigo,
    ativa: r.ativa,
    precoNormal: txt(r.precoNormal),
    precoHorario: txt(r.precoHorario),
    dias: r.dias,
    horaInicio: r.horaInicio ?? '',
    horaFim: r.horaFim ?? '',
    excetoFeriados: r.excetoFeriados,
  };
}

export function PrecoHorarioClient(props: { filialId: string; regras: RegraPrecoSalva[]; itens: Item[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<Form | null>(null);
  const comRegra = new Set(props.regras.map((r) => r.codigo));

  return (
    <div className="mt-5 space-y-3">
      {props.regras.length === 0 && !editando && (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
          Nenhum produto com preço por horário nesta casa.
        </p>
      )}
      {props.regras.map((r) =>
        editando?.codigo === r.codigo ? null : (
          <div key={r.codigo} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium text-slate-900">
                  {r.nome} <span className="text-xs text-slate-400">#{r.codigo}</span>
                </div>
                <div className="mt-1 text-sm text-slate-700">
                  {brl(r.precoNormal)} → <strong className="text-emerald-700">{brl(r.precoHorario)}</strong>{' '}
                  · {r.dias.length === 0 || r.dias.length === 7 ? 'todos os dias' : r.dias.map((d) => DIAS[d]).join(', ')} ·{' '}
                  {r.horaInicio}–{r.horaFim}
                  {r.excetoFeriados ? ' · exceto feriados' : ''}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {!r.ativa ? (
                    <span className="text-slate-400">Desligada — vale o preço normal.</span>
                  ) : (
                    <>
                      Agora: {r.precoAgora == null ? '—' : brl(r.precoAgora)}
                      {r.naFila ? ' (aguardando a loja aplicar)' : ''}
                      {r.estadoAplicado === 'dentro' ? ' · no horário' : r.estadoAplicado === 'fora' ? ' · fora do horário' : ''}
                      {r.aplicadoEm ? ` · última troca ${r.aplicadoEm}` : ''}
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => setEditando(deRegra(r))}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Editar
              </button>
            </div>
          </div>
        ),
      )}

      {editando ? (
        <Formulario
          filialId={props.filialId}
          inicial={editando}
          itens={props.itens.filter((i) => i.codigo === editando.codigo || !comRegra.has(i.codigo))}
          existe={editando.codigo != null && comRegra.has(editando.codigo)}
          onFim={() => {
            setEditando(null);
            router.refresh();
          }}
          onCancelar={() => setEditando(null)}
        />
      ) : (
        <button
          onClick={() => setEditando(novo())}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Produto com preço por horário
        </button>
      )}
    </div>
  );
}

function Formulario(props: {
  filialId: string;
  inicial: Form;
  itens: Item[];
  existe: boolean;
  onFim: () => void;
  onCancelar: () => void;
}) {
  const [f, setF] = useState<Form>(props.inicial);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const item = props.itens.find((i) => i.codigo === f.codigo) ?? null;
  const achados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q.length < 2) return [];
    return props.itens.filter((i) => i.nome.toLowerCase().includes(q) || String(i.codigo) === q).slice(0, 12);
  }, [busca, props.itens]);

  async function salvar() {
    setErro(null);
    if (f.codigo == null) return setErro('escolha o produto');
    const precoNormal = num(f.precoNormal);
    const precoHorario = num(f.precoHorario);
    if (!(precoNormal > 0) || !(precoHorario > 0)) return setErro('preencha os dois preços');
    setSalvando(true);
    const r = await fetch('/api/cardapio/preco-horario', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filialId: props.filialId,
        codigo: f.codigo,
        ativa: f.ativa,
        precoNormal,
        precoHorario,
        dias: f.dias,
        horaInicio: f.horaInicio || null,
        horaFim: f.horaFim || null,
        excetoFeriados: f.excetoFeriados,
      }),
    }).then((x) => x.json()).catch(() => ({ ok: false, erro: 'sem conexão' }));
    setSalvando(false);
    if (!r.ok) return setErro(r.erro ?? 'falhou');
    props.onFim();
  }

  async function apagar() {
    if (f.codigo == null || !confirm('Apagar o preço por horário? Se estiver no horário, volta pro preço normal.')) return;
    setSalvando(true);
    await fetch(`/api/cardapio/preco-horario?filialId=${props.filialId}&codigo=${f.codigo}`, { method: 'DELETE' });
    setSalvando(false);
    props.onFim();
  }

  return (
    <div className="space-y-3 rounded-lg border border-blue-300 bg-white p-4">
      <div>
        <label className="text-xs font-medium text-slate-600">Produto</label>
        {item ? (
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className="font-medium">{item.nome}</span>
            <span className="text-slate-400">#{item.codigo} · hoje {brl(item.preco)}</span>
            {!props.existe && (
              <button onClick={() => setF({ ...f, codigo: null })} className="text-xs text-blue-600 hover:underline">
                trocar
              </button>
            )}
          </div>
        ) : (
          <>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pelo nome ou código"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            {achados.length > 0 && (
              <div className="mt-1 max-h-60 overflow-auto rounded-md border border-slate-200">
                {achados.map((i) => (
                  <button
                    key={i.codigo}
                    onClick={() => {
                      setF({ ...f, codigo: i.codigo, precoNormal: f.precoNormal || txt(i.preco) });
                      setBusca('');
                    }}
                    className="flex w-full justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span>{i.nome} <span className="text-slate-400">#{i.codigo}</span></span>
                    <span className="text-slate-500">{brl(i.preco)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
        <label className="text-xs font-medium text-slate-600">
          Preço normal (R$)
          <input
            value={f.precoNormal}
            onChange={(e) => setF({ ...f, precoNormal: e.target.value })}
            inputMode="decimal"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Preço no horário (R$)
          <input
            value={f.precoHorario}
            onChange={(e) => setF({ ...f, precoHorario: e.target.value })}
            inputMode="decimal"
            placeholder="49,00"
            className="mt-1 w-full rounded-md border border-emerald-400 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div>
        <div className="text-xs font-medium text-slate-600">Dias</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {DIAS.map((d, i) => {
            const on = f.dias.includes(i);
            return (
              <button
                key={d}
                onClick={() => setF({ ...f, dias: on ? f.dias.filter((x) => x !== i) : [...f.dias, i].sort() })}
                className={`rounded-md border px-2.5 py-1 text-sm ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-600">
          Das
          <input type="time" value={f.horaInicio} onChange={(e) => setF({ ...f, horaInicio: e.target.value })}
            className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Às
          <input type="time" value={f.horaFim} onChange={(e) => setF({ ...f, horaFim: e.target.value })}
            className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={f.excetoFeriados} onChange={(e) => setF({ ...f, excetoFeriados: e.target.checked })} />
          Exceto feriados
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={f.ativa} onChange={(e) => setF({ ...f, ativa: e.target.checked })} />
          Ligada
        </label>
      </div>

      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <button onClick={salvar} disabled={salvando}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button onClick={props.onCancelar} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700">
          Cancelar
        </button>
        {props.existe && (
          <button onClick={apagar} disabled={salvando} className="ml-auto rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50">
            Apagar
          </button>
        )}
      </div>
    </div>
  );
}

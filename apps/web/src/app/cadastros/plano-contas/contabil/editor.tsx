'use client';

import { useMemo, useState } from 'react';

export interface LinhaCategoria {
  id: string;
  codigo: number;
  descricao: string;
  grupo: string | null;
  tipo: string | null;
  contaContabil: string | null;
  situacao: string | null;
  obs: string | null;
  qtd: number;
  pago: number;
}

export interface ContaContador {
  classificacao: string;
  reduzido: number | null;
  nome: string;
  sintetica: boolean;
}

const SITUACOES = [
  { v: 'ok', rot: 'Pronta', cor: 'bg-emerald-100 text-emerald-800' },
  { v: 'conferir', rot: 'Conferir', cor: 'bg-amber-100 text-amber-800' },
  { v: 'decidir', rot: 'Decidir', cor: 'bg-rose-100 text-rose-800' },
] as const;

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Filtro = 'todas' | 'ok' | 'conferir' | 'decidir' | 'sem';

export function ContabilEditor(props: {
  filialId: string;
  linhas: LinhaCategoria[];
  contas: ContaContador[];
  podeEditar: boolean;
  deInicial: string;
  ateInicial: string;
}) {
  const [linhas, setLinhas] = useState(props.linhas);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [rasc, setRasc] = useState({ conta: '', situacao: 'ok', obs: '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [de, setDe] = useState(props.deInicial);
  const [ate, setAte] = useState(props.ateInicial);

  const contaPorClass = useMemo(() => new Map(props.contas.map((c) => [c.classificacao, c])), [props.contas]);
  const analiticas = useMemo(() => props.contas.filter((c) => !c.sintetica), [props.contas]);

  const contagem = useMemo(() => {
    const c = { todas: linhas.length, ok: 0, conferir: 0, decidir: 0, sem: 0 };
    for (const l of linhas) {
      if (!l.contaContabil) c.sem++;
      if (l.situacao === 'ok') c.ok++;
      else if (l.situacao === 'conferir') c.conferir++;
      else if (l.situacao === 'decidir') c.decidir++;
    }
    return c;
  }, [linhas]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (filtro === 'sem' && l.contaContabil) return false;
      if (filtro !== 'todas' && filtro !== 'sem' && l.situacao !== filtro) return false;
      if (!q) return true;
      const conta = l.contaContabil ? contaPorClass.get(l.contaContabil)?.nome ?? '' : '';
      return `${l.descricao} ${l.grupo ?? ''} ${l.contaContabil ?? ''} ${conta} #${l.codigo}`.toLowerCase().includes(q);
    });
  }, [linhas, filtro, busca, contaPorClass]);

  function abrir(l: LinhaCategoria) {
    setErro(null);
    setEditando(l.id);
    setRasc({ conta: l.contaContabil ?? '', situacao: l.situacao ?? 'ok', obs: l.obs ?? '' });
  }

  async function salvar(id: string) {
    // Aceita "3.1.01.001 - NOME" vindo do datalist: fica só a classificação.
    const conta = rasc.conta.split(' - ')[0].trim();
    if (conta && !contaPorClass.has(conta)) {
      setErro(`Conta ${conta} não existe no plano do contador.`);
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/plano-contas/contabil', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId: props.filialId,
          categoriaId: id,
          contaContabil: conta || null,
          situacao: rasc.situacao,
          obs: rasc.obs.trim() || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
      setLinhas((ls) =>
        ls.map((l) =>
          l.id === id ? { ...l, contaContabil: conta || null, situacao: rasc.situacao, obs: rasc.obs.trim() || null } : l,
        ),
      );
      setEditando(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  const urlExport = (modo: 'resumo' | 'detalhe') =>
    `/api/plano-contas/exportar?filialId=${props.filialId}&de=${de}&ate=${ate}&modo=${modo}`;

  const filtros: { v: Filtro; rot: string }[] = [
    { v: 'todas', rot: 'Todas' },
    { v: 'ok', rot: 'Prontas' },
    { v: 'conferir', rot: 'Conferir' },
    { v: 'decidir', rot: 'Decidir' },
    { v: 'sem', rot: 'Sem conta' },
  ];

  return (
    <>
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Exportar para o contador</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Contas pagas no período (pela data de pagamento), somadas por conta contábil. Abre no Excel.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col text-xs text-slate-600">
            De
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            Até
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <a href={urlExport('resumo')} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">
            ⬇ Resumo por conta contábil
          </a>
          <a href={urlExport('detalhe')} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            ⬇ Detalhado (cada pagamento)
          </a>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {filtros.map((f) => (
          <button
            key={f.v}
            onClick={() => setFiltro(f.v)}
            className={`rounded-md border px-3 py-1 text-xs ${
              filtro === f.v ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {f.rot} ({contagem[f.v]})
          </button>
        ))}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar categoria ou conta…"
          className="ml-auto w-64 rounded-md border border-slate-300 px-3 py-1 text-sm"
        />
      </div>

      {erro && <p className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{erro}</p>}

      <datalist id="contas-contador">
        {analiticas.map((c) => (
          <option key={c.classificacao} value={`${c.classificacao} - ${c.nome}`} />
        ))}
      </datalist>

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Categoria (nossa)</th>
              <th className="px-3 py-2">Conta do contador</th>
              <th className="px-3 py-2 w-24">Situação</th>
              <th className="px-3 py-2 text-right w-16">Qtd</th>
              <th className="px-3 py-2 text-right w-32">Pago total</th>
              {props.podeEditar && <th className="px-3 py-2 w-20" />}
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-500">Nada neste filtro.</td>
              </tr>
            )}
            {visiveis.map((l) => {
              const conta = l.contaContabil ? contaPorClass.get(l.contaContabil) : undefined;
              const sit = SITUACOES.find((s) => s.v === l.situacao);
              if (editando === l.id) {
                return (
                  <tr key={l.id} className="border-t border-slate-100 bg-sky-50/50">
                    <td className="px-3 py-2 align-top">
                      <p className="text-xs font-medium text-slate-900">{l.descricao}</p>
                      <p className="text-[10px] text-slate-500">{l.grupo ? `${l.grupo} · ` : ''}#{l.codigo}</p>
                    </td>
                    <td className="px-3 py-2 align-top" colSpan={2}>
                      <input
                        list="contas-contador"
                        value={rasc.conta}
                        onChange={(e) => setRasc({ ...rasc, conta: e.target.value })}
                        placeholder="Digite o número ou o nome da conta"
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                        autoFocus
                      />
                      <div className="mt-1 flex gap-2">
                        <select
                          value={rasc.situacao}
                          onChange={(e) => setRasc({ ...rasc, situacao: e.target.value })}
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          {SITUACOES.map((s) => (
                            <option key={s.v} value={s.v}>{s.rot}</option>
                          ))}
                        </select>
                        <input
                          value={rasc.obs}
                          onChange={(e) => setRasc({ ...rasc, obs: e.target.value })}
                          placeholder="Observação (opcional)"
                          className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right align-top font-mono text-xs text-slate-500">{l.qtd || '—'}</td>
                    <td className="px-3 py-2 text-right align-top font-mono text-xs text-slate-700">{l.pago ? brl(l.pago) : '—'}</td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        <button
                          disabled={salvando}
                          onClick={() => salvar(l.id)}
                          className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                        >
                          {salvando ? '…' : 'Salvar'}
                        </button>
                        <button onClick={() => setEditando(null)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600">
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <p className="text-xs font-medium text-slate-900">{l.descricao}</p>
                    <p className="text-[10px] text-slate-500">{l.grupo ? `${l.grupo} · ` : ''}#{l.codigo}</p>
                  </td>
                  <td className="px-3 py-2">
                    {l.contaContabil ? (
                      <>
                        <p className="font-mono text-xs text-slate-800">
                          {l.contaContabil}
                          {conta?.reduzido != null && <span className="ml-1 text-[10px] text-slate-400">({conta.reduzido})</span>}
                        </p>
                        <p className="text-[11px] text-slate-600">{conta?.nome ?? '⚠ conta não encontrada no plano'}</p>
                        {conta?.sintetica && l.qtd > 0 && (
                          <p className="text-[10px] text-amber-700">
                            ⚠ conta de grupo — lançamento direto aqui vai pro contador sem conta analítica
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">— sem conta</span>
                    )}
                    {l.obs && <p className="mt-0.5 text-[10px] italic text-slate-500">{l.obs}</p>}
                  </td>
                  <td className="px-3 py-2">
                    {sit ? (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${sit.cor}`}>{sit.rot}</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-500">{l.qtd || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-700">{l.pago ? brl(l.pago) : '—'}</td>
                  {props.podeEditar && (
                    <td className="px-3 py-2">
                      <button onClick={() => abrir(l)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                        Ajustar
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

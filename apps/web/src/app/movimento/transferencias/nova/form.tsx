'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ProdOpc {
  id: string;
  nome: string;
  unidade: string;
  custo: number;
  saldo: number;
}
export interface ItemInicial {
  produtoOrigemId: string;
  quantidade: number;
}

interface Linha {
  key: number;
  produtoOrigemId: string;
  produtoDestinoId: string | null;
  quantidade: string;
  custoInformado: string;
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numBr = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

/** Mesmo produto na outra casa: nome normalizado + unidade; senão só o nome. */
function acharNoDestino(p: ProdOpc | undefined, lista: ProdOpc[]): string | null {
  if (!p) return null;
  const n = norm(p.nome);
  return (
    lista.find((d) => norm(d.nome) === n && d.unidade === p.unidade)?.id ??
    lista.find((d) => norm(d.nome) === n)?.id ??
    null
  );
}

function buscar(lista: ProdOpc[], q: string, max = 12): ProdOpc[] {
  const ws = norm(q).split(' ').filter(Boolean);
  if (!ws.length) return [];
  return lista.filter((p) => ws.every((w) => norm(p.nome).includes(w))).slice(0, max);
}

export function NovaTransferenciaForm(props: {
  origemId: string;
  destinos: Array<{ id: string; nome: string }>;
  produtosOrigem: ProdOpc[];
  produtosDestino: Record<string, ProdOpc[]>;
  itensIniciais: ItemInicial[];
  notaCompraId: string | null;
  hoje: string;
}) {
  const router = useRouter();
  const origemPor = useMemo(() => new Map(props.produtosOrigem.map((p) => [p.id, p])), [props.produtosOrigem]);
  const [destinoId, setDestinoId] = useState(props.destinos[0]?.id ?? '');
  const listaDestino = props.produtosDestino[destinoId] ?? [];
  const destinoPor = useMemo(() => new Map(listaDestino.map((p) => [p.id, p])), [listaDestino]);

  const [seq, setSeq] = useState(props.itensIniciais.length);
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    props.itensIniciais
      .filter((i) => origemPor.has(i.produtoOrigemId))
      .map((i, k) => ({
        key: k,
        produtoOrigemId: i.produtoOrigemId,
        produtoDestinoId: acharNoDestino(
          origemPor.get(i.produtoOrigemId),
          props.produtosDestino[props.destinos[0]?.id ?? ''] ?? [],
        ),
        quantidade: String(Math.round(i.quantidade * 1000) / 1000).replace('.', ','),
        custoInformado: '',
      })),
  );
  const [busca, setBusca] = useState('');
  const [trocando, setTrocando] = useState<number | null>(null);
  const [buscaDest, setBuscaDest] = useState('');
  const [data, setData] = useState(props.hoje);
  const [obs, setObs] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function trocarDestino(id: string) {
    setDestinoId(id);
    const lista = props.produtosDestino[id] ?? [];
    setLinhas((ls) => ls.map((l) => ({ ...l, produtoDestinoId: acharNoDestino(origemPor.get(l.produtoOrigemId), lista) })));
  }

  function adicionar(p: ProdOpc) {
    setLinhas((ls) => [
      ...ls,
      { key: seq, produtoOrigemId: p.id, produtoDestinoId: acharNoDestino(p, listaDestino), quantidade: '', custoInformado: '' },
    ]);
    setSeq((s) => s + 1);
    setBusca('');
  }

  const calc = linhas.map((l) => {
    const po = origemPor.get(l.produtoOrigemId);
    const q = numBr(l.quantidade);
    const custo = po && po.custo > 0 ? po.custo : numBr(l.custoInformado);
    const valor = q > 0 && custo > 0 ? Math.round(q * custo * 100) / 100 : 0;
    return { l, po, q, custo, valor, semCusto: !po || po.custo <= 0 };
  });
  const total = calc.reduce((s, c) => s + c.valor, 0);
  const pendencias = calc.filter((c) => !(c.q > 0) || !(c.custo > 0) || !c.l.produtoDestinoId);
  const nomeDestino = props.destinos.find((d) => d.id === destinoId)?.nome ?? '';

  async function salvar() {
    setErro(null);
    if (!linhas.length) return setErro('Adicione pelo menos um produto.');
    if (pendencias.length) return setErro('Tem item sem quantidade, sem custo ou sem produto na casa de destino.');
    if (!confirm(`Transferir ${linhas.length} item(ns) (${brl(total)}) pra ${nomeDestino}? ${nomeDestino} fica devendo esse valor.`)) return;
    setBusy(true);
    const r = await fetch('/api/transferencias', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filialOrigemId: props.origemId,
        filialDestinoId: destinoId,
        data,
        notaCompraId: props.notaCompraId,
        observacao: obs || null,
        itens: calc.map((c) => ({
          produtoOrigemId: c.l.produtoOrigemId,
          produtoDestinoId: c.l.produtoDestinoId,
          quantidade: c.q,
          ...(c.semCusto ? { custoUnitario: c.custo } : {}),
        })),
      }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErro(j.error ?? 'Erro ao salvar');
    router.push(`/movimento/transferencias?filialId=${props.origemId}&comp=${data.slice(0, 7)}`);
    router.refresh();
  }

  const achados = buscar(props.produtosOrigem, busca);
  const achadosDest = buscar(listaDestino, buscaDest, 10);

  return (
    <div className="mt-6 space-y-4">
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <label className="text-sm">
          <span className="text-xs font-medium text-slate-500">Casa que recebe</span>
          <select
            value={destinoId}
            onChange={(e) => trocarDestino(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
          >
            {props.destinos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-xs font-medium text-slate-500">Data</span>
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="text-xs font-medium text-slate-500">Observação</span>
          <input
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="ex.: nota faturada no CNPJ errado"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
          />
        </label>
      </div>

      <div className="relative rounded-xl border border-slate-200 bg-white p-4">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="🔎 Adicionar produto do estoque…"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {achados.length > 0 && (
          <ul className="absolute left-4 right-4 z-10 mt-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
            {achados.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => adicionar(p)}
                  className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span>{p.nome}</span>
                  <span className="whitespace-nowrap text-xs text-slate-500">
                    saldo {p.saldo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {p.unidade} · {p.custo > 0 ? brl(p.custo) : 'sem custo'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Produto (sai)</th>
              <th className="px-3 py-2">Qtd</th>
              <th className="px-3 py-2 text-right">Custo médio</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Entra em {nomeDestino} como</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {calc.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  Busque acima os produtos que vão pra outra casa.
                </td>
              </tr>
            )}
            {calc.map(({ l, po, custo, valor, semCusto }) => {
              const pd = l.produtoDestinoId ? destinoPor.get(l.produtoDestinoId) : undefined;
              return (
                <tr key={l.key} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{po?.nome}</div>
                    <div className="text-xs text-slate-500">
                      saldo {po?.saldo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {po?.unidade}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <input
                        value={l.quantidade}
                        inputMode="decimal"
                        onChange={(e) =>
                          setLinhas((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantidade: e.target.value } : x)))
                        }
                        className="w-20 rounded border border-slate-300 px-2 py-1 text-right"
                      />
                      <span className="text-xs text-slate-500">{po?.unidade}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {semCusto ? (
                      <div>
                        <input
                          value={l.custoInformado}
                          inputMode="decimal"
                          placeholder="custo"
                          onChange={(e) =>
                            setLinhas((ls) => ls.map((x) => (x.key === l.key ? { ...x, custoInformado: e.target.value } : x)))
                          }
                          className="w-24 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-right"
                        />
                        <div className="text-[10px] text-amber-700">sem custo médio — informe</div>
                      </div>
                    ) : (
                      brl(custo)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{valor > 0 ? brl(valor) : '—'}</td>
                  <td className="relative px-3 py-2">
                    {trocando === l.key ? (
                      <div>
                        <input
                          autoFocus
                          value={buscaDest}
                          onChange={(e) => setBuscaDest(e.target.value)}
                          placeholder={`buscar em ${nomeDestino}…`}
                          className="w-full rounded border border-slate-300 px-2 py-1"
                        />
                        <ul className="absolute left-3 right-3 z-10 mt-1 max-h-60 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
                          {achadosDest.map((d) => (
                            <li key={d.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setLinhas((ls) => ls.map((x) => (x.key === l.key ? { ...x, produtoDestinoId: d.id } : x)));
                                  setTrocando(null);
                                  setBuscaDest('');
                                }}
                                className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                              >
                                {d.nome} <span className="text-xs text-slate-500">({d.unidade})</span>
                              </button>
                            </li>
                          ))}
                          <li>
                            <button
                              type="button"
                              onClick={() => setTrocando(null)}
                              className="w-full px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50"
                            >
                              fechar
                            </button>
                          </li>
                        </ul>
                      </div>
                    ) : pd ? (
                      <button
                        type="button"
                        onClick={() => {
                          setTrocando(l.key);
                          setBuscaDest('');
                        }}
                        className="text-left"
                        title="trocar"
                      >
                        <span className="text-slate-800">{pd.nome}</span>{' '}
                        <span className="text-xs text-slate-500">({pd.unidade})</span>
                        {po && pd.unidade !== po.unidade && (
                          <div className="text-[10px] text-amber-700">⚠ unidade diferente ({po.unidade} → {pd.unidade})</div>
                        )}
                        <div className="text-[10px] text-sky-700">trocar</div>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setTrocando(l.key);
                          setBuscaDest(po?.nome.split(' ').slice(0, 2).join(' ') ?? '');
                        }}
                        className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800"
                      >
                        não achei — escolher produto
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setLinhas((ls) => ls.filter((x) => x.key !== l.key))}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      tirar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {calc.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50">
                <td colSpan={3} className="px-3 py-2 text-right text-sm text-slate-600">
                  {nomeDestino} fica devendo
                </td>
                <td className="px-3 py-2 text-right text-base font-bold">{brl(total)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {erro && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>}
      <div className="flex justify-end">
        <button
          onClick={salvar}
          disabled={busy || !linhas.length}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? 'Transferindo…' : `Transferir ${total > 0 ? brl(total) : ''}`}
        </button>
      </div>
    </div>
  );
}

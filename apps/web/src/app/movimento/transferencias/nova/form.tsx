'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ProdOpc {
  id: string;
  nome: string;
  unidade: string;
  custo: number;
  saldo: number;
  /** Descontinuado ("* Excluído *"): fica fora das buscas e do casamento automático */
  inativo?: boolean;
  /** Sem custo médio: custo estimado (última compra / outra casa) e de onde veio */
  custoEstimado?: number;
  fonteEstimativa?: string;
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
/** custo estimado → texto do campo ("12,5") */
const custoTxt = (p: ProdOpc | undefined) =>
  p && p.custo <= 0 && p.custoEstimado && p.custoEstimado > 0
    ? String(Math.round(p.custoEstimado * 10000) / 10000).replace('.', ',')
    : '';

/** Mesmo produto na outra casa: de/para salvo; senão nome normalizado +
 *  unidade; senão só o nome. null = não existe lá (cadastra ao transferir). */
function acharNoDestino(
  p: ProdOpc | undefined,
  lista: ProdOpc[],
  depara: Record<string, string> = {},
): string | null {
  if (!p) return null;
  const salvo = depara[p.id];
  if (salvo && lista.some((d) => d.id === salvo)) return salvo;
  const n = norm(p.nome);
  return (
    lista.find((d) => !d.inativo && norm(d.nome) === n && d.unidade === p.unidade)?.id ??
    lista.find((d) => !d.inativo && norm(d.nome) === n)?.id ??
    null
  );
}

function buscar(lista: ProdOpc[], q: string, max = 12): ProdOpc[] {
  const ws = norm(q).split(' ').filter(Boolean);
  if (!ws.length) return [];
  return lista.filter((p) => !p.inativo && ws.every((w) => norm(p.nome).includes(w))).slice(0, max);
}

export function NovaTransferenciaForm(props: {
  origemId: string;
  /** semAcesso: casa da mesma empresa que o usuário não acessa — só dá pra
   *  enviar; quem recebe confere e dá a entrada. */
  destinos: Array<{ id: string; nome: string; semAcesso?: boolean }>;
  origemNome?: string;
  produtosOrigem: ProdOpc[];
  produtosDestino: Record<string, ProdOpc[]>;
  /** destinoId → produtoOrigemId → produtoDestinoId */
  depara: Record<string, Record<string, string>>;
  itensIniciais: ItemInicial[];
  notaCompraId: string | null;
  hoje: string;
}) {
  const router = useRouter();
  const origemPor = useMemo(() => new Map(props.produtosOrigem.map((p) => [p.id, p])), [props.produtosOrigem]);
  const [destinoId, setDestinoId] = useState(props.destinos[0]?.id ?? '');
  const listaDestino = props.produtosDestino[destinoId] ?? [];
  const destinoPor = useMemo(() => new Map(listaDestino.map((p) => [p.id, p])), [listaDestino]);
  const deparaDestino = props.depara[destinoId] ?? {};

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
          props.depara[props.destinos[0]?.id ?? ''],
        ),
        quantidade: String(Math.round(i.quantidade * 1000) / 1000).replace('.', ','),
        custoInformado: custoTxt(origemPor.get(i.produtoOrigemId)),
      })),
  );
  const [busca, setBusca] = useState('');
  const [trocando, setTrocando] = useState<number | null>(null);
  const [buscaDest, setBuscaDest] = useState('');
  const [data, setData] = useState(props.hoje);
  const [obs, setObs] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Vindo de uma nota lançada a mercadoria já está na outra casa (nota no CNPJ
  // errado): entra direto. Avulsa: vai em trânsito e a casa que recebe confere.
  const [jaEstaLa, setJaEstaLa] = useState(!!props.notaCompraId);
  const [feito, setFeito] = useState<{ id: string; numero: number; status: string; valorTotal: number } | null>(null);
  const semAcessoDestino = props.destinos.find((d) => d.id === destinoId)?.semAcesso === true;
  const entradaImediata = jaEstaLa && !semAcessoDestino;

  function trocarDestino(id: string) {
    setDestinoId(id);
    const lista = props.produtosDestino[id] ?? [];
    setLinhas((ls) =>
      ls.map((l) => ({ ...l, produtoDestinoId: acharNoDestino(origemPor.get(l.produtoOrigemId), lista, props.depara[id]) })),
    );
  }

  function adicionar(p: ProdOpc) {
    setLinhas((ls) => [
      ...ls,
      { key: seq, produtoOrigemId: p.id, produtoDestinoId: acharNoDestino(p, listaDestino, deparaDestino), quantidade: '', custoInformado: custoTxt(p) },
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
  const pendencias = calc.filter((c) => !(c.q > 0) || !(c.custo > 0));
  const aCadastrar = calc.filter((c) => !c.l.produtoDestinoId).length;
  const nomeDestino = props.destinos.find((d) => d.id === destinoId)?.nome ?? '';

  async function salvar() {
    setErro(null);
    if (!linhas.length) return setErro('Adicione pelo menos um produto.');
    if (pendencias.length) return setErro('Tem item sem quantidade ou sem custo.');
    const avisoCad = aCadastrar ? `\n\n${aCadastrar} produto(s) não existem em ${nomeDestino} e vão ser cadastrados lá.` : '';
    const pergunta = entradaImediata
      ? `Transferir ${linhas.length} item(ns) (${brl(total)}) pra ${nomeDestino}? Entra no estoque de lá agora e ${nomeDestino} fica devendo esse valor.`
      : `Enviar ${linhas.length} item(ns) (${brl(total)}) pra ${nomeDestino}? Sai do estoque daqui agora; ${nomeDestino} confere quando chegar e aí entra no estoque de lá.`;
    if (!confirm(`${pergunta}${avisoCad}`)) return;
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
        entradaImediata,
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
    setFeito({ id: j.id, numero: j.numero, status: j.status, valorTotal: Number(j.valorTotal ?? total) });
    router.refresh();
  }
  const urlLista = `/movimento/transferencias?filialId=${props.origemId}&comp=${data.slice(0, 7)}`;

  if (feito) {
    return (
      <div className="mt-6 space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
        <div>
          <p className="text-lg font-semibold text-emerald-900">
            ✓ Transferência #{feito.numero} registrada — {brl(feito.valorTotal)}
          </p>
          <p className="mt-1 text-sm text-emerald-900">
            {feito.status === 'ENVIADA'
              ? `Saiu do estoque${props.origemNome ? ` de ${props.origemNome}` : ''} e está em trânsito. ${nomeDestino} confere a mercadoria em Transferências → "A receber" e aí ela entra no estoque de lá.`
              : `Já entrou no estoque de ${nomeDestino}, que ficou devendo esse valor (compensa no encontro de contas do mês).`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={urlLista}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Ver transferências
          </a>
        </div>
      </div>
    );
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
                    saldo {p.saldo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {p.unidade} ·{' '}
                    {p.custo > 0 ? brl(p.custo) : p.custoEstimado && p.custoEstimado > 0 ? `~${brl(p.custoEstimado)} (estimado)` : 'sem custo'}
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
              <th className="px-3 py-2 text-right">Custo</th>
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
                        <div className="text-[10px] text-amber-700">
                          {po?.custoEstimado && po.custoEstimado > 0
                            ? `estimado (${po.fonteEstimativa ?? 'estimativa'}) — pode ajustar`
                            : 'sem custo médio — informe'}
                        </div>
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
                        <ul className="mt-1 max-h-60 overflow-auto rounded-md border border-slate-200 bg-white shadow-sm">
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
                              onClick={() => {
                                setLinhas((ls) => ls.map((x) => (x.key === l.key ? { ...x, produtoDestinoId: null } : x)));
                                setTrocando(null);
                                setBuscaDest('');
                              }}
                              className="w-full border-t border-slate-100 px-3 py-1.5 text-left text-xs text-emerald-700 hover:bg-slate-50"
                            >
                              ➕ não existe — cadastrar em {nomeDestino}
                            </button>
                          </li>
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
                        {deparaDestino[l.produtoOrigemId] === pd.id && po && norm(po.nome) !== norm(pd.nome) && (
                          <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">de/para</span>
                        )}
                        {po && pd.unidade !== po.unidade && (
                          <div className="text-[10px] text-amber-700">⚠ unidade diferente ({po.unidade} → {pd.unidade})</div>
                        )}
                        <div className="text-[10px] text-sky-700">trocar</div>
                      </button>
                    ) : (
                      <div>
                        <div className="text-xs text-emerald-800">
                          ➕ não achei em {nomeDestino} — <b>cadastra lá</b> ao transferir
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setTrocando(l.key);
                            setBuscaDest(po?.nome.split(' ').slice(0, 2).join(' ') ?? '');
                          }}
                          className="mt-1 rounded border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-800"
                          title="O produto existe lá com outro nome? Escolha — fica salvo como de/para"
                        >
                          existe com outro nome? escolher (de/para)
                        </button>
                      </div>
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

      <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <input
          type="checkbox"
          checked={entradaImediata}
          disabled={semAcessoDestino}
          onChange={(e) => setJaEstaLa(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="font-medium text-slate-800">
            A mercadoria já está em {nomeDestino} — dar entrada no estoque de lá agora (sem conferência)
          </span>
          <span className="block text-xs text-slate-500">
            {semAcessoDestino
              ? `Você não tem acesso a ${nomeDestino}: a transferência vai em trânsito e ${nomeDestino} confere e dá a entrada.`
              : `Desmarcado: sai daqui agora e fica em trânsito; ${nomeDestino} confere os itens quando chegar e aí entra no estoque de lá.`}
          </span>
        </span>
      </label>

      {erro && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>}
      <div className="flex justify-end">
        <button
          onClick={salvar}
          disabled={busy || !linhas.length}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? 'Transferindo…' : `${entradaImediata ? 'Transferir' : 'Enviar pra conferência'} ${total > 0 ? brl(total) : ''}`}
        </button>
      </div>
    </div>
  );
}

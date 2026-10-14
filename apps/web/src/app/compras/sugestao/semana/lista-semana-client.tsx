'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FornecedorOpt } from '../sugestao-client';
import { GRUPOS } from './grupos';


export interface SemanaCol {
  data: string;
  rotulo: string;
}

export interface LinhaLista {
  chave: string;
  listaItemId: string | null;
  produtoId: string | null;
  nome: string;
  textoOriginal: string | null;
  quantidade: number;
  unidade: string;
  observacao: string;
  grupo: string;
  cotacaoNumero: number | null;
  cotacaoId: string | null;
  historico: Record<string, { q: number; u: string | null } | null>;
  estoque: number | null;
  unidadeEstoque: string | null;
  ultEntradaQtd: number | null;
  ultEntradaData: string | null;
  ultEntradaFornecedor: string | null;
}

const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtD = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function ListaSemanaClient(props: {
  filialId: string;
  listaId: string | null;
  dataLista: string | null;
  hoje: string;
  linhas: LinhaLista[];
  semanas: SemanaCol[];
  fornecedores: FornecedorOpt[];
  fornecedoresPorGrupo: Record<string, string[]>;
  cotacaoAnteriorPorGrupo: Record<string, number>;
}) {
  const router = useRouter();
  const [linhas, setLinhas] = useState(props.linhas);
  const [marcado, setMarcado] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(props.linhas.map((l) => [l.chave, !l.cotacaoId && !!l.produtoId])),
  );
  const [forn, setForn] = useState<Record<string, string[]>>(() => {
    const nomes = new Set(props.fornecedores.map((f) => f.id));
    return Object.fromEntries(
      GRUPOS.map((g) => [g.codigo, (props.fornecedoresPorGrupo[g.codigo] ?? []).filter((id) => nomes.has(id))]),
    );
  });
  const [duracao, setDuracao] = useState(24);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [alterado, setAlterado] = useState(false);

  const nomeForn = useMemo(() => new Map(props.fornecedores.map((f) => [f.id, f])), [props.fornecedores]);
  const dataTxt = props.dataLista ? fmtD(props.dataLista) : fmtD(props.hoje);

  function editar(chave: string, campo: 'quantidade' | 'unidade' | 'observacao', valor: string) {
    setAlterado(true);
    setLinhas((ls) =>
      ls.map((l) =>
        l.chave === chave
          ? { ...l, [campo]: campo === 'quantidade' ? Number(valor.replace(',', '.')) || 0 : valor }
          : l,
      ),
    );
  }

  async function salvar(): Promise<string | null> {
    setOcupado('salvar');
    setMsg(null);
    try {
      const r = await fetch('/api/compras/lista-semana', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId: props.filialId,
          listaId: props.listaId,
          itens: linhas
            .filter((l) => l.produtoId)
            .map((l) => ({
              id: l.listaItemId,
              produtoId: l.produtoId,
              quantidade: l.quantidade,
              unidade: l.unidade,
              observacao: l.observacao || null,
              grupo: l.grupo,
            })),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'erro ao salvar');
      setAlterado(false);
      return d.listaId as string;
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
      return null;
    } finally {
      setOcupado(null);
    }
  }

  async function gerarCotacao(grupo: (typeof GRUPOS)[number]) {
    const itens = linhas.filter((l) => l.grupo === grupo.codigo && marcado[l.chave] && l.produtoId && l.quantidade > 0);
    const fornIds = forn[grupo.codigo] ?? [];
    if (!itens.length) return setMsg('Marque pelo menos um item com quantidade.');
    if (!fornIds.length) return setMsg('Escolha pelo menos um fornecedor.');
    if (!confirm(`Criar a cotação de ${grupo.rotulo} com ${itens.length} item(ns) e ${fornIds.length} fornecedor(es)? Os convites NÃO são enviados agora — você envia na tela da cotação.`))
      return;

    // Sugestão pelo histórico ainda não está salva: salva antes, pra ligar a cotação aos itens.
    let listaItemIds = itens.map((l) => l.listaItemId).filter((x): x is string => !!x);
    if (!props.listaId || alterado) {
      const id = await salvar();
      if (!id) return;
      if (!props.listaId) {
        router.push(`?filialId=${props.filialId}&lista=${id}`);
        setMsg('Sugestão salva como lista da semana. Confira e clique de novo em "Gerar cotação".');
        return;
      }
    }
    listaItemIds = itens.map((l) => l.listaItemId).filter((x): x is string => !!x);

    setOcupado(grupo.codigo);
    setMsg(null);
    try {
      const r = await fetch('/api/cotacao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId: props.filialId,
          duracaoHoras: duracao,
          observacao: `${grupo.obs} — lista da cozinha de ${dataTxt}. ${grupo.extra}`,
          itens: itens.map((l) => ({
            produtoId: l.produtoId,
            quantidade: l.quantidade,
            unidade: l.unidade || null,
            observacao: l.observacao || null,
          })),
          fornecedorIds: fornIds,
          listaCompraItemIds: listaItemIds,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'erro ao criar cotação');
      setMsg(`✅ Cotação nº ${d.numero} criada (${grupo.rotulo}). Abra pra enviar os convites.`);
      router.refresh();
      setLinhas((ls) => ls.map((l) => (itens.includes(l) ? { ...l, cotacaoId: d.id, cotacaoNumero: d.numero } : l)));
      setMarcado((m) => ({ ...m, ...Object.fromEntries(itens.map((l) => [l.chave, false])) }));
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setOcupado(null);
    }
  }

  if (!linhas.length)
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Nenhuma lista salva e sem histórico suficiente pra sugerir (precisa de 2 semanas de lista da cozinha).
      </p>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          Prazo de resposta
          <select
            value={duracao}
            onChange={(e) => setDuracao(Number(e.target.value))}
            className="rounded border border-slate-300 px-2 py-1"
          >
            {[4, 8, 12, 24, 48].map((h) => (
              <option key={h} value={h}>
                {h} h
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => salvar().then((id) => id && (props.listaId ? setMsg('✅ Quantidades salvas.') : router.push(`?filialId=${props.filialId}&lista=${id}`)))}
          disabled={!!ocupado || (!alterado && !!props.listaId)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          {ocupado === 'salvar' ? 'Salvando…' : props.listaId ? 'Salvar quantidades' : 'Salvar como lista da semana'}
        </button>
        {msg && <span className="text-xs text-slate-700">{msg}</span>}
      </div>

      {GRUPOS.map((g) => {
        const doGrupo = linhas.filter((l) => l.grupo === g.codigo);
        if (!doGrupo.length) return null;
        const selecionados = forn[g.codigo] ?? [];
        const anterior = props.cotacaoAnteriorPorGrupo[g.codigo];
        return (
          <section key={g.codigo} className="rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">
                {g.rotulo} <span className="font-normal text-slate-400">· {doGrupo.length} item(ns)</span>
              </h2>
              <button
                onClick={() => gerarCotacao(g)}
                disabled={!!ocupado}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {ocupado === g.codigo ? 'Criando…' : 'Gerar cotação deste grupo'}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="w-8 px-2 py-2"></th>
                    <th className="px-2 py-2 text-left">Item</th>
                    {props.semanas.map((s) => (
                      <th key={s.data} className="px-2 py-2 text-right" title={`pedido na semana de ${s.rotulo}`}>
                        {s.rotulo}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right">Estoque</th>
                    <th className="px-2 py-2 text-left">Última entrada</th>
                    <th className="px-2 py-2 text-right">Pedir</th>
                    <th className="px-2 py-2 text-left">Unid.</th>
                    <th className="px-2 py-2 text-left">Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {doGrupo.map((l) => (
                    <tr key={l.chave} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-2">
                        {l.cotacaoId ? (
                          <a href={`/cotacao/${l.cotacaoId}`} className="text-emerald-700" title="já cotado">
                            ✓
                          </a>
                        ) : (
                          <input
                            type="checkbox"
                            disabled={!l.produtoId}
                            checked={!!marcado[l.chave]}
                            onChange={(e) => setMarcado((m) => ({ ...m, [l.chave]: e.target.checked }))}
                          />
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-medium text-slate-800">{l.nome}</div>
                        {l.textoOriginal && <div className="text-[11px] text-slate-400">“{l.textoOriginal}”</div>}
                        {l.cotacaoNumero != null && (
                          <a href={`/cotacao/${l.cotacaoId}`} className="text-[11px] text-emerald-700 underline">
                            na cotação nº {l.cotacaoNumero}
                          </a>
                        )}
                      </td>
                      {props.semanas.map((s) => {
                        const h = l.historico[s.data];
                        return (
                          <td key={s.data} className="px-2 py-2 text-right text-slate-500">
                            {h ? `${fmtQ(h.q)} ${h.u ?? ''}` : '—'}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right text-slate-600">
                        {l.estoque != null ? `${fmtQ(l.estoque)} ${l.unidadeEstoque ?? ''}` : '—'}
                      </td>
                      <td className="px-2 py-2 text-slate-500">
                        {l.ultEntradaData ? (
                          <>
                            {fmtD(l.ultEntradaData)} · {fmtQ(l.ultEntradaQtd ?? 0)}
                            {l.ultEntradaFornecedor && (
                              <div className="max-w-[160px] truncate text-[11px] text-slate-400">{l.ultEntradaFornecedor}</div>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input
                          inputMode="decimal"
                          defaultValue={fmtQ(l.quantidade)}
                          disabled={!!l.cotacaoId}
                          onChange={(e) => editar(l.chave, 'quantidade', e.target.value)}
                          className="w-16 rounded border border-slate-300 px-1.5 py-1 text-right"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          defaultValue={l.unidade}
                          disabled={!!l.cotacaoId}
                          onChange={(e) => editar(l.chave, 'unidade', e.target.value)}
                          className="w-16 rounded border border-slate-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          defaultValue={l.observacao}
                          disabled={!!l.cotacaoId}
                          onChange={(e) => editar(l.chave, 'observacao', e.target.value)}
                          className="w-full min-w-[180px] rounded border border-slate-300 px-1.5 py-1"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-100 px-4 py-3">
              <p className="mb-2 text-[11px] text-slate-500">
                Fornecedores {anterior != null ? `(marcados os da cotação nº ${anterior})` : ''}:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selecionados.map((id) => (
                  <button
                    key={id}
                    onClick={() => setForn((f) => ({ ...f, [g.codigo]: selecionados.filter((x) => x !== id) }))}
                    className="rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-[11px] text-blue-800 hover:bg-blue-100"
                    title="tirar"
                  >
                    {nomeForn.get(id)?.nome ?? id.slice(0, 8)}
                    {nomeForn.get(id)?.outraCasa ? ` (${nomeForn.get(id)?.outraCasa})` : ''} ×
                  </button>
                ))}
                <select
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    setForn((f) => ({ ...f, [g.codigo]: [...selecionados, e.target.value] }))
                  }
                  className="rounded-full border border-slate-300 px-2 py-1 text-[11px] text-slate-600"
                >
                  <option value="">+ adicionar fornecedor</option>
                  {props.fornecedores
                    .filter((f) => !selecionados.includes(f.id))
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                        {f.categoria ? ` · ${f.categoria}` : ''}
                        {f.outraCasa ? ` (${f.outraCasa})` : ''}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

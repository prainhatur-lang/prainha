'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Cat = { catalogId: string; groupId: string; status: string; contexto: string[] };
type Item = {
  id: string; nome: string; descricao: string; externalCode: string; status: string; productId: string;
  preco: number; precoOriginal: number | null; index: number;
  turnos: Array<{ startTime: string; endTime: string } & Record<string, unknown>>;
  contextos: Array<{ contexto: string; itemContextId: string }>;
  grupos: Array<{ id: string; nome: string; min: number; max: number; opcoes: number }>;
};
type Categoria = { id: string; nome: string; externalCode: string; status: string; index: number; template: string; itens: Item[] };
type Opcao = { nome: string; preco: string; codigoPdv: string };
type Grupo = { nome: string; min: string; max: string; opcoes: Opcao[] };
type Msg = { tipo: 'ok' | 'erro'; texto: string; detalhes?: string[] } | null;

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const agora = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const num = (s: string) => Number(String(s).replace(',', '.'));

const itemVazio = () => ({
  itemId: '', productId: '', categoriaId: '', nome: '', descricao: '', preco: '', precoOriginal: '', codigoPdv: '',
  status: 'AVAILABLE' as 'AVAILABLE' | 'UNAVAILABLE', serve: 'NOT_APPLICABLE',
  usaTurno: false, inicio: '11:00', fim: '23:00', dias: [true, true, true, true, true, true, true],
  canais: {} as Record<string, { usa: boolean; status: 'AVAILABLE' | 'UNAVAILABLE'; preco: string }>,
  grupos: [] as Grupo[],
});

export function EditorCardapioClient({ filiais, inicial, podeEditar }: {
  filiais: Array<{ id: string; nome: string }>; inicial: string; podeEditar: boolean;
}) {
  const [filialId, setFilialId] = useState(inicial || filiais[0]?.id || '');
  const [catalogos, setCatalogos] = useState<Cat[]>([]);
  const [catalogId, setCatalogId] = useState('');
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [lidoEm, setLidoEm] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState('');

  const [novaCat, setNovaCat] = useState({ nome: '', externalCode: '', status: 'AVAILABLE' });
  const [f, setF] = useState(itemVazio());
  const [abrirItem, setAbrirItem] = useState(false);

  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [lotePreco, setLotePreco] = useState('');
  const [lote, setLote] = useState<{ batchId: string; status: string; resultados: Array<{ id: string; resultado: string; motivo: string }>; ms: number } | null>(null);

  const contextos = useMemo(() => [...new Set(catalogos.flatMap((k) => k.contexto))], [catalogos]);

  const carregar = useCallback(async (cat?: string) => {
    if (!filialId) return;
    setCarregando(true);
    try {
      const q = new URLSearchParams({ filialId, ...(cat ? { catalogId: cat } : {}) });
      const r = await fetch('/api/ifood/cardapio/editor?' + q);
      const j = await r.json();
      if (!r.ok) { setMsg({ tipo: 'erro', texto: j.error, detalhes: j.detalhes }); setCategorias([]); return; }
      setCatalogos(j.catalogos); setCatalogId(j.catalogId); setCategorias(j.categorias);
      setLidoEm(`${agora()} · ${j.ms} ms`);
    } finally { setCarregando(false); }
  }, [filialId]);

  useEffect(() => { setSel({}); setLote(null); carregar(); }, [carregar]);

  async function post(corpo: Record<string, unknown>, okTexto: string, recarregar = true) {
    setOcupado(true); setMsg(null);
    try {
      const r = await fetch('/api/ifood/cardapio/editor', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filialId, ...corpo }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ tipo: 'erro', texto: j.error, detalhes: j.detalhes }); return null; }
      setMsg({ tipo: 'ok', texto: `${okTexto} — ${j.ms} ms · ${agora()}` });
      if (recarregar) await carregar(catalogId);
      return j;
    } finally { setOcupado(false); }
  }

  // ── categoria ──
  async function criarCat() {
    if (!novaCat.nome.trim()) return setMsg({ tipo: 'erro', texto: 'o nome da categoria é obrigatório' });
    if (novaCat.nome.trim().length > 100) return setMsg({ tipo: 'erro', texto: 'nome da categoria com mais de 100 caracteres' });
    const j = await post({ acao: 'categoria-criar', catalogId, ...novaCat, index: categorias.length }, `categoria "${novaCat.nome}" criada`);
    if (j) setNovaCat({ nome: '', externalCode: '', status: 'AVAILABLE' });
  }
  async function alternarCat(c: Categoria) {
    await post({ acao: 'categoria-editar', catalogId, categoriaId: c.id, status: c.status === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE' },
      `categoria "${c.nome}" ${c.status === 'AVAILABLE' ? 'pausada' : 'disponível'}`);
  }
  async function renomearCat(c: Categoria) {
    const nome = prompt('Novo nome da categoria', c.nome);
    if (nome == null) return;
    await post({ acao: 'categoria-editar', catalogId, categoriaId: c.id, nome }, 'categoria renomeada');
  }

  // ── item ──
  function validar(): string[] {
    const e: string[] = [];
    if (!f.categoriaId) e.push('escolha a categoria');
    if (!f.nome.trim()) e.push('o título é obrigatório');
    if (f.nome.trim().length > 100) e.push(`título com ${f.nome.trim().length} caracteres (máximo 100)`);
    if (f.descricao.length > 500) e.push(`descrição com ${f.descricao.length} caracteres (máximo 500)`);
    if (!(num(f.preco) > 0)) e.push('o preço tem que ser maior que zero');
    if (f.precoOriginal && !(num(f.precoOriginal) > num(f.preco))) e.push('o preço "de" tem que ser maior que o preço de venda');
    if (!f.codigoPdv.trim()) e.push('o código de PDV é obrigatório');
    if (f.usaTurno && f.fim <= f.inicio) e.push('turno: o fim tem que ser depois do início');
    if (f.usaTurno && !f.dias.some(Boolean)) e.push('turno: marque ao menos um dia');
    for (const [k, v] of Object.entries(f.canais)) if (v.usa && v.preco && !(num(v.preco) > 0)) e.push(`preço do canal ${k} tem que ser maior que zero`);
    f.grupos.forEach((g, i) => {
      const t = `complemento ${i + 1}`;
      if (!g.nome.trim()) e.push(`${t}: falta o nome`);
      if (g.opcoes.length === 0) e.push(`${t}: sem opções`);
      if (num(g.min) > num(g.max) || num(g.max) < 1) e.push(`${t}: mínimo/máximo inválido`);
      if (num(g.min) > g.opcoes.length) e.push(`${t}: mínimo maior que o número de opções`);
      g.opcoes.forEach((o, j) => { if (!o.nome.trim()) e.push(`${t}: opção ${j + 1} sem nome`); });
    });
    return e;
  }
  async function salvarItem() {
    const e = validar();
    if (e.length) return setMsg({ tipo: 'erro', texto: 'confira antes de enviar', detalhes: e });
    const item = {
      itemId: f.itemId || undefined, productId: f.productId || undefined,
      categoriaId: f.categoriaId, nome: f.nome, descricao: f.descricao, preco: num(f.preco),
      precoOriginal: f.precoOriginal ? num(f.precoOriginal) : null, codigoPdv: f.codigoPdv, status: f.status, serve: f.serve,
      turno: f.usaTurno ? { inicio: f.inicio, fim: f.fim, dias: f.dias } : null,
      contextos: Object.entries(f.canais).filter(([, v]) => v.usa).map(([k, v]) => ({ contexto: k, status: v.status, preco: v.preco ? num(v.preco) : null })),
      grupos: f.grupos.map((g) => ({ nome: g.nome, min: num(g.min), max: num(g.max), opcoes: g.opcoes.map((o) => ({ nome: o.nome, preco: num(o.preco || '0'), codigoPdv: o.codigoPdv })) })),
    };
    const j = await post({ acao: 'item-salvar', item }, `item "${f.nome}" ${f.itemId ? 'atualizado' : 'criado'}`);
    if (j) { setF(itemVazio()); setAbrirItem(false); }
  }
  function editarItemForm(c: Categoria, i: Item) {
    const t = i.turnos[0];
    const canais: Record<string, { usa: boolean; status: 'AVAILABLE' | 'UNAVAILABLE'; preco: string }> = {};
    for (const k of i.contextos) canais[k.contexto] = { usa: true, status: 'AVAILABLE', preco: '' };
    setF({
      ...itemVazio(), itemId: i.id, productId: i.productId, categoriaId: c.id, nome: i.nome, descricao: i.descricao,
      preco: String(i.preco), precoOriginal: i.precoOriginal && i.precoOriginal > i.preco ? String(i.precoOriginal) : '',
      codigoPdv: i.externalCode, status: i.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE',
      usaTurno: !!t, inicio: t?.startTime?.slice(0, 5) ?? '11:00', fim: t?.endTime?.slice(0, 5) ?? '23:00',
      dias: t ? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => !!t[d]) : itemVazio().dias,
      canais,
    });
    setAbrirItem(true);
    setMsg(i.grupos.length ? { tipo: 'ok', texto: `"${i.nome}" tem ${i.grupos.length} grupo(s) de complemento no iFood — salvar daqui recria os complementos com o que estiver no formulário` } : null);
  }
  async function itemStatus(i: Item) {
    await post({ acao: 'item-editar', itemId: i.id, status: i.status === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE' },
      `"${i.nome}" ${i.status === 'AVAILABLE' ? 'pausado' : 'disponível'}`);
  }
  async function itemCanal(i: Item) {
    if (contextos.length < 2) return setMsg({ tipo: 'erro', texto: 'a loja só tem um canal (contexto) — não há o que separar' });
    const porCanal = contextos.map((k) => ({ contexto: k, status: confirm(`"${i.nome}" disponível no canal ${k}?`) ? 'AVAILABLE' : 'UNAVAILABLE' }));
    const precoTxt = prompt(`Preço por canal (${contextos.join(', ')}), separados por ";" — vazio = não mexe`, contextos.map(() => String(i.preco)).join(';'));
    await post({ acao: 'item-status-canal', itemId: i.id, status: porCanal.some((k) => k.status === 'AVAILABLE') ? 'AVAILABLE' : 'UNAVAILABLE', porCanal }, 'status por canal salvo', !precoTxt);
    if (precoTxt) {
      const precos = precoTxt.split(';').map(num);
      await post({ acao: 'item-preco-canal', itemId: i.id, preco: precos[0], porCanal: contextos.map((k, n) => ({ contexto: k, preco: precos[n] ?? precos[0] })) }, 'preço por canal salvo');
    }
  }
  async function verNoIfood(i: Item) {
    const r = await fetch(`/api/ifood/cardapio/editor?filialId=${filialId}&item=${encodeURIComponent(i.id)}`);
    const j = await r.json();
    if (!r.ok) return setMsg({ tipo: 'erro', texto: j.error, detalhes: j.detalhes });
    setMsg({ tipo: 'ok', texto: `GET /items/${i.id}/flat — ${j.ms} ms`, detalhes: [JSON.stringify(j.item).slice(0, 1500)] });
  }

  // ── lote ──
  const todosItens = categorias.flatMap((c) => c.itens);
  const escolhidos = todosItens.filter((i) => sel[i.id]);
  async function acompanhar(batchId: string, ms: number) {
    for (let n = 0; n < 15; n++) {
      const r = await fetch('/api/ifood/cardapio/editor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filialId, acao: 'lote-resultado', batchId }) });
      const j = await r.json();
      if (!r.ok) { setMsg({ tipo: 'erro', texto: j.error }); return; }
      setLote({ batchId, status: j.status, resultados: j.resultados, ms });
      if (j.status !== 'PROCESSING') break;
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    await carregar(catalogId);
  }
  async function loteStatus(status: 'AVAILABLE' | 'UNAVAILABLE') {
    if (!escolhidos.length) return setMsg({ tipo: 'erro', texto: 'marque ao menos um item' });
    const j = await post({ acao: 'lote-status', catalogId, itens: escolhidos.map((i) => ({ productId: i.productId, status })) },
      `${escolhidos.length} item(ns) enviados (${status === 'AVAILABLE' ? 'disponível' : 'pausado'})`, false);
    if (j?.batchId) await acompanhar(j.batchId, j.ms);
  }
  async function lotePrecoEnviar() {
    if (!escolhidos.length) return setMsg({ tipo: 'erro', texto: 'marque ao menos um item' });
    const p = lotePreco.trim();
    const pct = p.endsWith('%');
    const v = num(p.replace('%', ''));
    if (!p || !Number.isFinite(v) || (!pct && !(v > 0))) return setMsg({ tipo: 'erro', texto: 'informe um preço maior que zero (ex.: 29,90) ou um percentual (ex.: 10% ou -5%)' });
    const itens = escolhidos.map((i) => ({ productId: i.productId, preco: pct ? Math.round(i.preco * (1 + v / 100) * 100) / 100 : v }));
    if (itens.some((i) => !(i.preco > 0))) return setMsg({ tipo: 'erro', texto: 'algum preço ficaria zero ou negativo' });
    const j = await post({ acao: 'lote-preco', catalogId, itens }, `${itens.length} preço(s) enviados`, false);
    if (j?.batchId) await acompanhar(j.batchId, j.ms);
  }

  const filtrar = (i: Item) => !busca || (i.nome + ' ' + i.externalCode).toLowerCase().includes(busca.toLowerCase());
  const inp = 'rounded border border-slate-300 px-2 py-1 text-sm';
  const btn = 'rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50';
  const btn2 = 'rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50';

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select className={inp} value={filialId} onChange={(e) => setFilialId(e.target.value)}>
          {filiais.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select>
        <select className={inp} value={catalogId} onChange={(e) => { setCatalogId(e.target.value); setSel({}); carregar(e.target.value); }}>
          {catalogos.map((k) => (
            <option key={k.catalogId} value={k.catalogId}>
              catálogo {k.contexto.join('/') || '—'} · {k.status} · {k.catalogId.slice(0, 8)}
            </option>
          ))}
        </select>
        <button className={btn2} onClick={() => carregar(catalogId)} disabled={carregando}>{carregando ? 'lendo…' : '↻ recarregar'}</button>
        <span className="text-xs text-slate-500">{catalogos.length} catálogo(s) · canais: {contextos.join(', ') || '—'} {lidoEm && `· lido às ${lidoEm}`}</span>
      </div>

      {msg && (
        <div className={`rounded border px-3 py-2 text-sm ${msg.tipo === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
          {msg.texto}
          {msg.detalhes?.length ? <ul className="mt-1 list-disc pl-5 text-xs break-all">{msg.detalhes.map((d, n) => <li key={n}>{d}</li>)}</ul> : null}
        </div>
      )}

      {podeEditar && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-semibold">Nova categoria</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <input className={inp + ' flex-1'} placeholder="nome (até 100)" maxLength={120} value={novaCat.nome} onChange={(e) => setNovaCat({ ...novaCat, nome: e.target.value })} />
              <input className={inp + ' w-28'} placeholder="código" value={novaCat.externalCode} onChange={(e) => setNovaCat({ ...novaCat, externalCode: e.target.value })} />
              <select className={inp} value={novaCat.status} onChange={(e) => setNovaCat({ ...novaCat, status: e.target.value })}>
                <option value="AVAILABLE">disponível</option><option value="UNAVAILABLE">pausada</option>
              </select>
              <button className={btn} disabled={ocupado || !catalogId} onClick={criarCat}>criar</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">{novaCat.nome.trim().length}/100</p>
          </div>

          <div className="rounded border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-semibold">Em lote ({escolhidos.length} marcado{escolhidos.length === 1 ? '' : 's'})</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={btn2} disabled={ocupado} onClick={() => loteStatus('UNAVAILABLE')}>pausar</button>
              <button className={btn2} disabled={ocupado} onClick={() => loteStatus('AVAILABLE')}>disponível</button>
              <input className={inp + ' w-32'} placeholder="29,90 ou 10%" value={lotePreco} onChange={(e) => setLotePreco(e.target.value)} />
              <button className={btn2} disabled={ocupado} onClick={lotePrecoEnviar}>aplicar preço</button>
              <button className={btn2} onClick={() => setSel(Object.fromEntries(todosItens.filter(filtrar).map((i) => [i.id, true])))}>marcar todos</button>
              <button className={btn2} onClick={() => setSel({})}>limpar</button>
            </div>
            {lote && (
              <div className="mt-2 text-xs text-slate-700">
                lote {lote.batchId.slice(0, 8)} · <b>{lote.status}</b> · envio {lote.ms} ms ·{' '}
                {lote.resultados.filter((x) => x.resultado === 'SUCCESS').length} ok / {lote.resultados.filter((x) => x.resultado !== 'SUCCESS').length} falha
                {lote.resultados.filter((x) => x.resultado !== 'SUCCESS').slice(0, 10).map((x) => (
                  <div key={x.id} className="text-red-700">{todosItens.find((i) => i.productId === x.id)?.nome ?? x.id}: {x.motivo}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {podeEditar && (
        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{f.itemId ? `Editar item — ${f.nome}` : 'Novo item'}</h2>
            <button className={btn2} onClick={() => { if (abrirItem) setF(itemVazio()); setAbrirItem(!abrirItem); }}>{abrirItem ? 'fechar' : '+ novo item'}</button>
          </div>
          {abrirItem && (
            <div className="mt-3 space-y-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex flex-col">categoria
                  <select className={inp} value={f.categoriaId} onChange={(e) => setF({ ...f, categoriaId: e.target.value })}>
                    <option value="">—</option>
                    {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </label>
                <label className="flex flex-col">título <span className="text-xs text-slate-500">{f.nome.trim().length}/100</span>
                  <input className={inp} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
                </label>
                <label className="flex flex-col">código de PDV
                  <input className={inp} value={f.codigoPdv} onChange={(e) => setF({ ...f, codigoPdv: e.target.value })} />
                </label>
              </div>
              <label className="flex flex-col">descrição <span className="text-xs text-slate-500">{f.descricao.length}/500</span>
                <textarea className={inp} rows={2} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
              </label>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col">preço (R$)<input className={inp + ' w-28'} value={f.preco} onChange={(e) => setF({ ...f, preco: e.target.value })} /></label>
                <label className="flex flex-col">preço &quot;de&quot; (opcional)<input className={inp + ' w-28'} value={f.precoOriginal} onChange={(e) => setF({ ...f, precoOriginal: e.target.value })} /></label>
                <label className="flex flex-col">serve
                  <select className={inp} value={f.serve} onChange={(e) => setF({ ...f, serve: e.target.value })}>
                    <option value="NOT_APPLICABLE">não se aplica</option>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={`SERVES_${n}`}>{n} pessoa{n > 1 ? 's' : ''}</option>)}
                  </select>
                </label>
                <label className="flex flex-col">status
                  <select className={inp} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'AVAILABLE' | 'UNAVAILABLE' })}>
                    <option value="AVAILABLE">disponível</option><option value="UNAVAILABLE">pausado</option>
                  </select>
                </label>
              </div>

              <div className="rounded bg-slate-50 p-2">
                <label className="flex items-center gap-2"><input type="checkbox" checked={f.usaTurno} onChange={(e) => setF({ ...f, usaTurno: e.target.checked })} /> só vende em certos horários (turno)</label>
                {f.usaTurno && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="time" className={inp} value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /> até
                    <input type="time" className={inp} value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} />
                    {DIAS.map((d, n) => (
                      <label key={d} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={f.dias[n]} onChange={(e) => setF({ ...f, dias: f.dias.map((x, k) => (k === n ? e.target.checked : x)) })} />{d}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {contextos.length > 0 && (
                <div className="rounded bg-slate-50 p-2">
                  <div className="text-xs font-semibold text-slate-600">Por canal (contextModifiers)</div>
                  {contextos.map((k) => {
                    const v = f.canais[k] ?? { usa: false, status: 'AVAILABLE' as const, preco: '' };
                    const set = (x: Partial<typeof v>) => setF({ ...f, canais: { ...f.canais, [k]: { ...v, ...x } } });
                    return (
                      <div key={k} className="mt-1 flex flex-wrap items-center gap-2">
                        <label className="flex w-32 items-center gap-1"><input type="checkbox" checked={v.usa} onChange={(e) => set({ usa: e.target.checked })} />{k}</label>
                        {v.usa && (
                          <>
                            <select className={inp} value={v.status} onChange={(e) => set({ status: e.target.value as 'AVAILABLE' | 'UNAVAILABLE' })}>
                              <option value="AVAILABLE">disponível</option><option value="UNAVAILABLE">pausado</option>
                            </select>
                            <input className={inp + ' w-28'} placeholder="preço próprio" value={v.preco} onChange={(e) => set({ preco: e.target.value })} />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="rounded bg-slate-50 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">Complementos (grupos com mínimo e máximo)</span>
                  <button className={btn2} onClick={() => setF({ ...f, grupos: [...f.grupos, { nome: '', min: '0', max: '1', opcoes: [{ nome: '', preco: '0', codigoPdv: '' }] }] })}>+ grupo</button>
                </div>
                {f.grupos.map((g, gi) => {
                  const setG = (x: Partial<Grupo>) => setF({ ...f, grupos: f.grupos.map((y, k) => (k === gi ? { ...y, ...x } : y)) });
                  return (
                    <div key={gi} className="mt-2 rounded border border-slate-200 bg-white p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <input className={inp + ' flex-1'} placeholder="nome do grupo (ex.: Escolha o ponto)" value={g.nome} onChange={(e) => setG({ nome: e.target.value })} />
                        mín <input className={inp + ' w-14'} value={g.min} onChange={(e) => setG({ min: e.target.value })} />
                        máx <input className={inp + ' w-14'} value={g.max} onChange={(e) => setG({ max: e.target.value })} />
                        <button className={btn2} onClick={() => setF({ ...f, grupos: f.grupos.filter((_, k) => k !== gi) })}>remover</button>
                      </div>
                      {g.opcoes.map((o, oi) => {
                        const setO = (x: Partial<Opcao>) => setG({ opcoes: g.opcoes.map((y, k) => (k === oi ? { ...y, ...x } : y)) });
                        return (
                          <div key={oi} className="mt-1 flex flex-wrap items-center gap-2 pl-4">
                            <input className={inp + ' flex-1'} placeholder="opção" value={o.nome} onChange={(e) => setO({ nome: e.target.value })} />
                            R$ <input className={inp + ' w-20'} value={o.preco} onChange={(e) => setO({ preco: e.target.value })} />
                            <input className={inp + ' w-24'} placeholder="código PDV" value={o.codigoPdv} onChange={(e) => setO({ codigoPdv: e.target.value })} />
                            <button className={btn2} onClick={() => setG({ opcoes: g.opcoes.filter((_, k) => k !== oi) })}>×</button>
                          </div>
                        );
                      })}
                      <button className={btn2 + ' mt-1 ml-4'} onClick={() => setG({ opcoes: [...g.opcoes, { nome: '', preco: '0', codigoPdv: '' }] })}>+ opção</button>
                    </div>
                  );
                })}
              </div>

              <button className={btn} disabled={ocupado} onClick={salvarItem}>{ocupado ? 'enviando…' : f.itemId ? 'salvar item no iFood' : 'criar item no iFood'}</button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input className={inp + ' w-64'} placeholder="buscar item ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="text-xs text-slate-500">{categorias.length} categorias · {todosItens.length} itens</span>
      </div>

      {categorias.map((c) => (
        <div key={c.id} className="rounded border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
            <b className="text-sm">{c.nome}</b>
            <span className={`rounded px-1.5 text-xs ${c.status === 'AVAILABLE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{c.status}</span>
            <span className="text-xs text-slate-400">{c.externalCode && `cód ${c.externalCode} · `}{c.itens.length} itens</span>
            {podeEditar && (
              <span className="ml-auto flex gap-1">
                <button className={btn2} disabled={ocupado} onClick={() => renomearCat(c)}>renomear</button>
                <button className={btn2} disabled={ocupado} onClick={() => alternarCat(c)}>{c.status === 'AVAILABLE' ? 'pausar' : 'disponível'}</button>
                <button className={btn2} onClick={() => { setF({ ...itemVazio(), categoriaId: c.id }); setAbrirItem(true); }}>+ item</button>
              </span>
            )}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {c.itens.filter(filtrar).map((i) => (
                <tr key={i.id} className="border-b border-slate-50">
                  <td className="w-6 px-3"><input type="checkbox" checked={!!sel[i.id]} onChange={(e) => setSel({ ...sel, [i.id]: e.target.checked })} /></td>
                  <td className="py-1.5">
                    {i.nome}
                    <div className="text-xs text-slate-400">
                      PDV {i.externalCode || '—'}
                      {i.grupos.length > 0 && ` · ${i.grupos.map((g) => `${g.nome} (${g.min}–${g.max})`).join(', ')}`}
                      {i.turnos.length > 0 && ` · turno ${i.turnos[0].startTime}–${i.turnos[0].endTime}`}
                      {i.contextos.length > 0 && ` · canais ${i.contextos.map((k) => k.contexto).join('/')}`}
                    </div>
                  </td>
                  <td className="text-right">{i.precoOriginal && i.precoOriginal > i.preco && <s className="mr-1 text-xs text-slate-400">{brl(i.precoOriginal)}</s>}{brl(i.preco)}</td>
                  <td className="px-2 text-center"><span className={`rounded px-1.5 text-xs ${i.status === 'AVAILABLE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{i.status}</span></td>
                  <td className="whitespace-nowrap px-2 text-right">
                    <button className={btn2} onClick={() => verNoIfood(i)}>ver</button>
                    {podeEditar && (
                      <>
                        {' '}<button className={btn2} disabled={ocupado} onClick={() => editarItemForm(c, i)}>editar</button>
                        {' '}<button className={btn2} disabled={ocupado} onClick={() => itemStatus(i)}>{i.status === 'AVAILABLE' ? 'pausar' : 'disponível'}</button>
                        {contextos.length > 1 && <>{' '}<button className={btn2} disabled={ocupado} onClick={() => itemCanal(i)}>por canal</button></>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

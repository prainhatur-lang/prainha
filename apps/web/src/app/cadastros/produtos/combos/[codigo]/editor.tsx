'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ComboCompleto, ProdutoEscolha } from '@/lib/combos';

type Opcao = { chave: string; codigo?: number; nome: string; extra: string; varianteCodigo: number | null };
type Etapa = { chave: string; codigo?: number; texto: string; min: string; max: string; outros: string[]; opcoes: Opcao[] };

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const fmt = (n: number) => n.toFixed(2).replace('.', ',');
let seq = 0;
const chave = () => `k${++seq}`;

function sem(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function SeletorProduto({
  produtos, valor, onEscolher,
}: {
  produtos: ProdutoEscolha[];
  valor: number | null;
  onEscolher: (p: ProdutoEscolha | null) => void;
}) {
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const atual = valor != null ? produtos.find((p) => p.codigo === valor) : undefined;
  const achados = useMemo(() => {
    const q = sem(busca.trim());
    if (!q) return [];
    const porCodigo = /^\d+$/.test(q) ? produtos.filter((p) => String(p.codigo) === q) : [];
    return [...porCodigo, ...produtos.filter((p) => sem(p.nome).includes(q) && !porCodigo.includes(p))].slice(0, 10);
  }, [busca, produtos]);

  if (valor != null && !aberto) {
    return (
      <button
        type="button"
        onClick={() => { setAberto(true); setBusca(''); }}
        className="w-full truncate rounded-md border border-slate-300 bg-white px-2 py-1 text-left text-sm hover:bg-slate-50"
        title="trocar produto"
      >
        {atual ? atual.nome : `#${valor} (não encontrado)`}
        {atual && <span className="ml-1 text-xs text-slate-400">#{atual.codigo} · {brl(atual.preco)}</span>}
      </button>
    );
  }
  return (
    <div className="relative">
      <input
        autoFocus={aberto}
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        placeholder="buscar produto (nome ou código)…"
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      {achados.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {achados.map((p) => (
            <li key={p.codigo}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onEscolher(p); setBusca(''); setAberto(false); }}
                className="flex w-full justify-between gap-2 px-2 py-1 text-left text-sm hover:bg-slate-100"
              >
                <span className="truncate">{p.nome}</span>
                <span className="shrink-0 text-xs text-slate-400">#{p.codigo} · {brl(p.preco)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {valor != null && (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onEscolher(null)}
          className="mt-1 text-xs text-slate-500 underline">só observação (sem produto)</button>
      )}
    </div>
  );
}

export function EditorCombo({
  filialId, combo, produtos, etiquetas, pracas, salvo,
}: {
  filialId: string;
  salvo?: string;
  combo: ComboCompleto | null;
  produtos: ProdutoEscolha[];
  etiquetas: { codigo: number; nome: string | null }[];
  pracas: { codigo: number; nome: string | null }[];
}) {
  const router = useRouter();
  const [nome, setNome] = useState(combo?.nome ?? '');
  const [preco, setPreco] = useState(combo ? fmt(combo.preco) : '');
  const [etiqueta, setEtiqueta] = useState('');
  const [praca, setPraca] = useState('');
  const [etapas, setEtapas] = useState<Etapa[]>(() =>
    combo && combo.etapas.length
      ? combo.etapas.map((e) => ({
          chave: chave(), codigo: e.codigo, texto: e.texto, min: String(e.min), max: String(e.max), outros: e.outrosProdutos,
          opcoes: e.opcoes.map((o) => ({ chave: chave(), codigo: o.codigo, nome: o.nome, extra: fmt(o.precoExtra), varianteCodigo: o.varianteCodigo })),
        }))
      : [{ chave: chave(), texto: 'Escolha o prato', min: '1', max: '1', outros: [], opcoes: [] }],
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(
    salvo === 'fila'
      ? 'Salvo. Etapas já valem; nome/preço entram assim que a loja confirmar (~1 min).'
      : salvo ? 'Salvo. A loja recebe no próximo catálogo (até ~5 min).' : null,
  );

  const mudaEtapa = (k: string, f: (e: Etapa) => Etapa) => setEtapas((xs) => xs.map((e) => (e.chave === k ? f(e) : e)));
  const mudaOpcao = (ke: string, ko: string, f: (o: Opcao) => Opcao) =>
    mudaEtapa(ke, (e) => ({ ...e, opcoes: e.opcoes.map((o) => (o.chave === ko ? f(o) : o)) }));
  const mover = (k: string, d: -1 | 1) => setEtapas((xs) => {
    const i = xs.findIndex((e) => e.chave === k);
    const j = i + d;
    if (i < 0 || j < 0 || j >= xs.length) return xs;
    const c = [...xs];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });

  const precoN = num(preco);
  // Faixa do que o cliente paga: base + extras mínimos/máximos de cada etapa.
  const faixa = useMemo(() => {
    let lo = Number.isFinite(precoN) ? precoN : 0;
    let hi = lo;
    for (const e of etapas) {
      const extras = e.opcoes.map((o) => num(o.extra) || 0).sort((a, b) => a - b);
      if (!extras.length) continue;
      const mi = Math.max(0, Number(e.min) || 0);
      const ma = Number(e.max) || extras.length;
      lo += extras.slice(0, mi).reduce((s, x) => s + x, 0);
      hi += extras.slice(-Math.min(ma, extras.length)).reduce((s, x) => s + x, 0);
    }
    return { lo, hi };
  }, [precoN, etapas]);

  async function salvar() {
    setErro(null); setOk(null);
    if (nome.trim().length < 2) return setErro('Dê um nome ao combo.');
    if (!(precoN > 0)) return setErro('Preço do combo inválido.');
    for (const e of etapas) {
      if (!e.texto.trim()) return setErro('Toda etapa precisa de uma pergunta.');
      if (e.opcoes.length === 0) return setErro(`"${e.texto}": adicione ao menos uma opção.`);
      for (const o of e.opcoes) {
        if (!o.nome.trim()) return setErro(`"${e.texto}": opção sem nome.`);
        const x = num(o.extra || '0');
        if (!Number.isFinite(x) || x < 0) return setErro(`"${o.nome}": extra inválido.`);
      }
    }
    setSalvando(true);
    try {
      const r = await fetch('/api/cadastros/combos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId,
          varianteCodigo: combo?.varianteCodigo,
          nome: nome.trim(),
          preco: precoN,
          codigoEtiqueta: etiqueta ? Number(etiqueta) : undefined,
          codigoCozinha: praca ? Number(praca) : undefined,
          etapas: etapas.map((e) => ({
            codigo: e.codigo,
            texto: e.texto.trim(),
            min: Number(e.min) || 0,
            max: Number(e.max) || 0,
            opcoes: e.opcoes.map((o) => ({
              codigo: o.codigo,
              nome: o.nome.trim(),
              precoExtra: num(o.extra || '0') || 0,
              varianteCodigo: o.varianteCodigo,
            })),
          })),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.erro || d.error || `erro ${r.status}`);
      // Recarrega do banco: as opções/etapas novas ganharam código, e salvar
      // de novo com o estado velho recriaria tudo.
      router.replace(`/cadastros/produtos/combos/${d.varianteCodigo}?filial=${filialId}&salvo=${d.filaNomePreco ? 'fila' : '1'}`);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <label className="text-sm">
            <span className="text-xs font-medium text-slate-600">Nome do combo</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Almoço executivo"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
          <label className="text-sm">
            <span className="text-xs font-medium text-slate-600">Preço do combo (R$)</span>
            <input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" placeholder="49,90"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-right tabular-nums" />
          </label>
        </div>
        {!combo && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-xs font-medium text-slate-600">Categoria</span>
              <select value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5">
                <option value="">—</option>
                {etiquetas.map((x) => <option key={x.codigo} value={x.codigo}>{x.nome}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-xs font-medium text-slate-600">Praça (KDS)</span>
              <select value={praca} onChange={(e) => setPraca(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5">
                <option value="">—</option>
                {pracas.map((x) => <option key={x.codigo} value={x.codigo}>{x.nome}</option>)}
              </select>
            </label>
          </div>
        )}
        {combo && (
          <p className="mt-2 text-xs text-slate-500">
            Categoria, praça e fotos: na <a className="underline" href={`/cadastros/produtos/${combo.produtoId}?aba=pdv`}>tela do produto</a>.
          </p>
        )}
      </section>

      {etapas.map((e, i) => (
        <section key={e.chave} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <span className="mb-1.5 rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">{i + 1}</span>
            <label className="min-w-[14rem] flex-1 text-sm">
              <span className="text-xs font-medium text-slate-600">Pergunta da etapa</span>
              <input value={e.texto} onChange={(ev) => mudaEtapa(e.chave, (x) => ({ ...x, texto: ev.target.value }))}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
            </label>
            <label className="w-20 text-sm">
              <span className="text-xs font-medium text-slate-600">Mín.</span>
              <input value={e.min} inputMode="numeric" onChange={(ev) => mudaEtapa(e.chave, (x) => ({ ...x, min: ev.target.value }))}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-right" />
            </label>
            <label className="w-20 text-sm">
              <span className="text-xs font-medium text-slate-600">Máx.</span>
              <input value={e.max} inputMode="numeric" onChange={(ev) => mudaEtapa(e.chave, (x) => ({ ...x, max: ev.target.value }))}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-right" title="0 = sem limite" />
            </label>
            <div className="mb-1 flex gap-1 text-xs">
              <button type="button" onClick={() => mover(e.chave, -1)} disabled={i === 0}
                className="rounded border border-slate-300 px-2 py-1 disabled:opacity-30">↑</button>
              <button type="button" onClick={() => mover(e.chave, 1)} disabled={i === etapas.length - 1}
                className="rounded border border-slate-300 px-2 py-1 disabled:opacity-30">↓</button>
              <button type="button" onClick={() => setEtapas((xs) => xs.filter((x) => x.chave !== e.chave))}
                className="rounded border border-rose-200 px-2 py-1 text-rose-700 hover:bg-rose-50">tirar etapa</button>
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Mín. 1 = obrigatória · Máx. 0 = sem limite.
            {e.outros.length > 0 && (
              <span className="ml-1 text-amber-700">
                Esta pergunta também está em {e.outros.join(', ')} — ao salvar, o combo ganha uma cópia e esses ficam como estão.
              </span>
            )}
          </p>

          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="pb-1 font-medium">Produto que sai</th>
                <th className="pb-1 font-medium">Nome na tela</th>
                <th className="w-28 pb-1 text-right font-medium">Extra (R$)</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {e.opcoes.map((o) => (
                <tr key={o.chave} className="align-top">
                  <td className="py-1 pr-2">
                    <SeletorProduto
                      produtos={produtos}
                      valor={o.varianteCodigo}
                      onEscolher={(p) => mudaOpcao(e.chave, o.chave, (x) => ({
                        ...x,
                        varianteCodigo: p?.codigo ?? null,
                        nome: p && (!x.nome || x.nome === produtos.find((q) => q.codigo === x.varianteCodigo)?.nome) ? p.nome : x.nome,
                      }))}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input value={o.nome} onChange={(ev) => mudaOpcao(e.chave, o.chave, (x) => ({ ...x, nome: ev.target.value }))}
                      className="w-full rounded-md border border-slate-300 px-2 py-1" />
                  </td>
                  <td className="py-1 pr-2">
                    <input value={o.extra} inputMode="decimal" onChange={(ev) => mudaOpcao(e.chave, o.chave, (x) => ({ ...x, extra: ev.target.value }))}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-right tabular-nums" placeholder="0,00" />
                  </td>
                  <td className="py-1 text-right">
                    <button type="button" title="tirar opção"
                      onClick={() => mudaEtapa(e.chave, (x) => ({ ...x, opcoes: x.opcoes.filter((y) => y.chave !== o.chave) }))}
                      className="rounded px-2 py-1 text-rose-600 hover:bg-rose-50">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button"
            onClick={() => mudaEtapa(e.chave, (x) => ({ ...x, opcoes: [...x.opcoes, { chave: chave(), nome: '', extra: '0,00', varianteCodigo: null }] }))}
            className="mt-2 rounded-md border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
            + opção
          </button>
        </section>
      ))}

      <button type="button"
        onClick={() => setEtapas((xs) => [...xs, { chave: chave(), texto: xs.length === 0 ? 'Escolha o prato' : 'Escolha a bebida', min: '1', max: '1', outros: [], opcoes: [] }])}
        className="w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm text-slate-700 hover:bg-slate-50">
        + etapa
      </button>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-4 backdrop-blur">
        <div className="text-sm text-slate-700">
          Cliente paga{' '}
          <strong className="tabular-nums">
            {faixa.lo === faixa.hi ? brl(faixa.lo) : `${brl(faixa.lo)} a ${brl(faixa.hi)}`}
          </strong>
          <span className="ml-1 text-xs text-slate-500">(combo + extras escolhidos)</span>
        </div>
        <div className="flex items-center gap-3">
          {erro && <span className="text-sm text-rose-700">{erro}</span>}
          {ok && <span className="text-sm text-emerald-700">{ok}</span>}
          <button type="button" onClick={salvar} disabled={salvando}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
            {salvando ? 'Salvando…' : combo ? 'Salvar combo' : 'Criar combo'}
          </button>
        </div>
      </div>
    </div>
  );
}

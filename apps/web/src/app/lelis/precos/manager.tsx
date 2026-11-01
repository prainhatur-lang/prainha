'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';
import { calcularPreco, cargaPorOrigem } from '@/lib/lelis/preco';
import type { FiscalEndereco, RevendaFiscal } from '@concilia/db/schema';
import { VendaNfe } from './venda';

export interface ProdutoLinha {
  id: string;
  ean: string | null;
  codigoFornecedor: string | null;
  fornecedorNome: string | null;
  descricao: string;
  ncm: string | null;
  cest: string | null;
  unidade: string;
  custoUnit: number;
  pctIpi: number;
  aliqOrigem: number | null;
  pctCarga: number | null;
  cargaComIpi: boolean;
  freteUnit: number;
  pctOperacional: number | null;
  pctMargem: number | null;
  pctImpostosVenda: number | null;
  precoManual: number | null;
  ultimaCompraEm: string | null;
  ativo: boolean;
}

export interface ConfigLelis {
  filialId: string;
  cnpj: string;
  pctOperacional: number;
  pctMargem: number;
  pctImpostosVenda: number;
  fiscal: RevendaFiscal;
  emitente: {
    razaoSocial: string;
    nomeFantasia: string;
    ie: string;
    crt: 1 | 3;
    endereco: FiscalEndereco;
    nfeSerie: number;
    nfeAmbiente: 1 | 2;
    salvo: boolean;
  };
  certificado: { cn: string; validadeFim: string } | null;
}

const inp = 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm';
const inpN = 'w-20 rounded border border-slate-300 px-1 py-0.5 text-right text-sm tabular-nums';
const fmt = (x: number, d = 2) => x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** "12,5" → 12.5; vazio → null */
function lerNum(s: string): number | null {
  const t = s.trim().replace(/\./g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const mostrar = (x: number | null | undefined, d = 2) => (x == null ? '' : fmt(x, d));

function CampoNum(props: { valor: number | null; onChange: (v: number | null) => void; placeholder?: string; casas?: number; largura?: string }) {
  const [txt, setTxt] = useState(mostrar(props.valor, props.casas ?? 2));
  const [foco, setFoco] = useState(false);
  return (
    <input
      inputMode="decimal"
      className={props.largura ?? inpN}
      placeholder={props.placeholder}
      value={foco ? txt : mostrar(props.valor, props.casas ?? 2)}
      onFocus={() => { setTxt(mostrar(props.valor, props.casas ?? 2)); setFoco(true); }}
      onChange={(e) => { setTxt(e.target.value); props.onChange(lerNum(e.target.value)); }}
      onBlur={() => setFoco(false)}
    />
  );
}

export function PrecosLelisManager({ config, produtos }: { config: ConfigLelis; produtos: ProdutoLinha[] }) {
  const router = useRouter();
  const [padrao, setPadrao] = useState({
    pctOperacional: config.pctOperacional,
    pctMargem: config.pctMargem,
    pctImpostosVenda: config.pctImpostosVenda,
  });
  const [linhas, setLinhas] = useState<ProdutoLinha[]>(produtos);
  const [sujos, setSujos] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [qtds, setQtds] = useState<Record<string, number>>({});
  const [mostrarFiscal, setMostrarFiscal] = useState(!config.emitente.salvo || !config.certificado);
  const [novo, setNovo] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const calc = (p: ProdutoLinha) =>
    calcularPreco({
      ...p,
      pctOperacional: p.pctOperacional ?? padrao.pctOperacional,
      pctMargem: p.pctMargem ?? padrao.pctMargem,
      pctImpostosVenda: p.pctImpostosVenda ?? padrao.pctImpostosVenda,
    });

  const visiveis = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return linhas.filter(
      (p) => !b || p.descricao.toLowerCase().includes(b) || (p.ean ?? '').includes(b) || (p.fornecedorNome ?? '').toLowerCase().includes(b),
    );
  }, [linhas, busca]);

  function mudar(id: string, campos: Partial<ProdutoLinha>) {
    setLinhas((ls) => ls.map((p) => (p.id === id ? { ...p, ...campos } : p)));
    setSujos((s) => new Set(s).add(id));
  }

  async function salvarLinha(p: ProdutoLinha) {
    setOcupado(true);
    const r = await fetch('/api/lelis/produtos', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: p.id,
        descricao: p.descricao,
        ncm: p.ncm,
        cest: p.cest,
        unidade: p.unidade,
        custoUnit: p.custoUnit,
        pctIpi: p.pctIpi,
        aliqOrigem: p.aliqOrigem,
        pctCarga: p.pctCarga,
        cargaComIpi: p.cargaComIpi,
        freteUnit: p.freteUnit,
        pctOperacional: p.pctOperacional,
        pctMargem: p.pctMargem,
        pctImpostosVenda: p.pctImpostosVenda,
        precoManual: p.precoManual,
        ativo: p.ativo,
      }),
    });
    setOcupado(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg({ tipo: 'erro', texto: j.error ?? 'erro ao salvar' });
    setSujos((s) => { const n = new Set(s); n.delete(p.id); return n; });
    setMsg({ tipo: 'ok', texto: `Salvo: ${p.descricao}` });
  }

  async function salvarTodos() {
    for (const p of linhas.filter((x) => sujos.has(x.id))) await salvarLinha(p);
  }

  async function salvarPadrao() {
    setOcupado(true);
    const r = await fetch('/api/lelis/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...padrao, fiscal: config.fiscal }),
    });
    setOcupado(false);
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? { tipo: 'ok', texto: 'Percentuais padrão salvos' } : { tipo: 'erro', texto: j.error ?? 'erro' });
  }

  async function importarXml(files: FileList | null) {
    if (!files?.length) return;
    setOcupado(true);
    setMsg(null);
    let ok = 0;
    const erros: string[] = [];
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.set('filialId', config.filialId);
      fd.set('xml', f);
      const r = await fetch('/api/notas/upload', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (r.ok) ok++;
      else erros.push(`${f.name}: ${j.error ?? r.status}`);
    }
    const s = await fetch('/api/lelis/sincronizar', { method: 'POST' });
    const js = await s.json().catch(() => ({}));
    setOcupado(false);
    if (arquivo.current) arquivo.current.value = '';
    setMsg({
      tipo: erros.length ? 'erro' : 'ok',
      texto: `${ok} nota(s) importada(s); ${js.produtos ?? 0} produto(s) atualizados.` + (erros.length ? ' Falhou: ' + erros.join(' · ') : ''),
    });
    router.refresh();
    setTimeout(() => window.location.reload(), 300);
  }

  async function sincronizar() {
    setOcupado(true);
    const s = await fetch('/api/lelis/sincronizar', { method: 'POST' });
    const js = await s.json().catch(() => ({}));
    setOcupado(false);
    if (!s.ok) return setMsg({ tipo: 'erro', texto: js.error ?? 'erro' });
    setMsg({ tipo: 'ok', texto: `${js.produtos} produto(s) conferidos com ${js.itens} item(ns) de nota.` });
    window.location.reload();
  }

  const itensVenda = linhas
    .filter((p) => (qtds[p.id] ?? 0) > 0)
    .map((p) => ({ produto: p, quantidade: qtds[p.id]!, preco: calc(p).preco ?? 0 }));

  return (
    <div className="space-y-5">
      {msg && (
        <p className={`rounded-lg border p-3 text-sm ${msg.tipo === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {msg.texto}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-medium text-slate-900">Percentuais padrão (valem pra todo produto sem % próprio)</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="text-xs text-slate-500">Custo operacional da empresa (%)</span>
            <CampoNum largura={inp} valor={padrao.pctOperacional} onChange={(v) => setPadrao({ ...padrao, pctOperacional: v ?? 0 })} />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Margem de lucro (%)</span>
            <CampoNum largura={inp} valor={padrao.pctMargem} onChange={(v) => setPadrao({ ...padrao, pctMargem: v ?? 0 })} />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Impostos da venda (%) — PIS/COFINS/ICMS que a Lelis paga</span>
            <CampoNum largura={inp} valor={padrao.pctImpostosVenda} onChange={(v) => setPadrao({ ...padrao, pctImpostosVenda: v ?? 0 })} />
          </label>
          <div className="flex items-end">
            <button onClick={salvarPadrao} disabled={ocupado} className="rounded-md bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">
              Salvar padrão
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Soma: {fmt(padrao.pctOperacional + padrao.pctMargem + padrao.pctImpostosVenda)}% do preço. Carga do Decreto
          40.949 na entrada: 10,56% (origem 4%), 6,34% (7%), 3,17% (12% ou compra em SE).
        </p>
      </div>

      <DadosFiscais config={config} aberto={mostrarFiscal} setAberto={setMostrarFiscal} padrao={padrao} />

      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto, EAN, fornecedor…" className="w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <label className={`cursor-pointer rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white ${ocupado ? 'opacity-50' : ''}`}>
          📄 Importar XML de compra
          <input ref={arquivo} type="file" accept=".xml,text/xml" multiple className="hidden" disabled={ocupado} onChange={(e) => importarXml(e.target.files)} />
        </label>
        <button onClick={sincronizar} disabled={ocupado} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50">
          ↻ Atualizar custos das notas
        </button>
        <button onClick={() => setNovo(true)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">+ Produto à mão</button>
        {sujos.size > 0 && (
          <button onClick={salvarTodos} disabled={ocupado} className="rounded-md bg-amber-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            Salvar {sujos.size} alteração(ões)
          </button>
        )}
      </div>

      {novo && <NovoProduto onFechar={() => setNovo(false)} />}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-2 py-2 text-left">Produto</th>
              <th className="px-2 py-2 text-right">Valor nota</th>
              <th className="px-2 py-2 text-right">IPI %</th>
              <th className="px-2 py-2 text-right" title="Alíquota de origem → carga do Decreto 40.949">Origem / carga %</th>
              <th className="px-2 py-2 text-right">Frete un.</th>
              <th className="px-2 py-2 text-right">Custo</th>
              <th className="px-2 py-2 text-right">Oper. %</th>
              <th className="px-2 py-2 text-right">Margem %</th>
              <th className="px-2 py-2 text-right">Imp. %</th>
              <th className="px-2 py-2 text-right">Preço</th>
              <th className="px-2 py-2 text-right">Preço à mão</th>
              <th className="px-2 py-2 text-right">Lucro un.</th>
              <th className="px-2 py-2 text-right">Vender (qtd)</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-6 text-center text-slate-500">
                  Nenhum produto ainda. Importe o XML das notas de compra da Lelis ou cadastre à mão.
                </td>
              </tr>
            )}
            {visiveis.map((p) => {
              const c = calc(p);
              const sujo = sujos.has(p.id);
              return (
                <tr key={p.id} className={`border-t border-slate-100 align-top ${p.ativo ? '' : 'opacity-50'} ${sujo ? 'bg-amber-50' : ''}`}>
                  <td className="max-w-72 px-2 py-1.5">
                    <div className="font-medium text-slate-900">{p.descricao}</div>
                    <div className="text-xs text-slate-500">
                      {p.ean ? `EAN ${p.ean}` : 'sem EAN'} · NCM {p.ncm ?? '—'} · {p.unidade}
                      {p.fornecedorNome ? ` · ${p.fornecedorNome}` : ''}
                      {p.ultimaCompraEm ? ` · compra ${p.ultimaCompraEm.split('-').reverse().join('/')}` : ''}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <CampoNum valor={p.custoUnit} casas={4} onChange={(v) => mudar(p.id, { custoUnit: v ?? 0 })} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <CampoNum valor={p.pctIpi} onChange={(v) => mudar(p.id, { pctIpi: v ?? 0 })} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <select
                      className="rounded border border-slate-300 px-1 py-0.5 text-sm"
                      value={p.aliqOrigem == null ? '' : p.aliqOrigem <= 4 ? '4' : p.aliqOrigem <= 7 ? '7' : p.aliqOrigem <= 12 ? '12' : '18'}
                      onChange={(e) => mudar(p.id, { aliqOrigem: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">?</option>
                      <option value="4">4% (importado)</option>
                      <option value="7">7% (Sul/Sudeste)</option>
                      <option value="12">12%</option>
                      <option value="18">Interna SE</option>
                    </select>
                    <div className="mt-1">
                      <CampoNum valor={p.pctCarga} placeholder={fmt(cargaPorOrigem(p.aliqOrigem))} onChange={(v) => mudar(p.id, { pctCarga: v })} />
                    </div>
                    <div className="text-xs text-slate-500">{brl(c.carga)}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <CampoNum valor={p.freteUnit} casas={4} onChange={(v) => mudar(p.id, { freteUnit: v ?? 0 })} />
                  </td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{brl(c.custo)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <CampoNum valor={p.pctOperacional} placeholder={fmt(padrao.pctOperacional)} onChange={(v) => mudar(p.id, { pctOperacional: v })} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <CampoNum valor={p.pctMargem} placeholder={fmt(padrao.pctMargem)} onChange={(v) => mudar(p.id, { pctMargem: v })} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <CampoNum valor={p.pctImpostosVenda} placeholder={fmt(padrao.pctImpostosVenda)} onChange={(v) => mudar(p.id, { pctImpostosVenda: v })} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {c.erro ? <span className="text-xs text-red-600">{c.erro}</span> : <span className={p.precoManual ? 'text-slate-400 line-through' : 'font-semibold text-slate-900'}>{brl(c.precoCalculado)}</span>}
                    <div className="text-xs text-slate-500">markup {fmt(c.markup, 1)}%</div>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <CampoNum valor={p.precoManual} placeholder="—" onChange={(v) => mudar(p.id, { precoManual: v })} />
                  </td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${c.lucro < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {brl(c.lucro)}
                    <div className="text-xs text-slate-500">{fmt(c.margemReal, 1)}%</div>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <CampoNum valor={qtds[p.id] ?? null} placeholder="0" casas={0} onChange={(v) => setQtds((q) => ({ ...q, [p.id]: v ?? 0 }))} />
                  </td>
                  <td className="space-y-1 px-2 py-1.5 text-right">
                    {sujo && (
                      <button onClick={() => salvarLinha(p)} disabled={ocupado} className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white disabled:opacity-50">
                        Salvar
                      </button>
                    )}
                    <button onClick={() => mudar(p.id, { ativo: !p.ativo })} className="block text-xs text-slate-500 hover:underline">
                      {p.ativo ? 'desativar' : 'ativar'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <VendaNfe config={config} itens={itensVenda} onLimpar={() => setQtds({})} />
    </div>
  );
}

function NovoProduto({ onFechar }: { onFechar: () => void }) {
  const [f, setF] = useState({ descricao: '', ean: '', ncm: '', cest: '', unidade: 'UN', custo: '', ipi: '', origem: '18' });
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    const r = await fetch('/api/lelis/produtos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        descricao: f.descricao,
        ean: f.ean || null,
        ncm: f.ncm || null,
        cest: f.cest || null,
        unidade: f.unidade || 'UN',
        custoUnit: lerNum(f.custo) ?? 0,
        pctIpi: lerNum(f.ipi) ?? 0,
        aliqOrigem: Number(f.origem),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErro(j.error ?? 'erro');
    window.location.reload();
  }
  const campo = (k: keyof typeof f, rotulo: string, cls = '') => (
    <label className={`block ${cls}`}>
      <span className="text-xs text-slate-500">{rotulo}</span>
      <input className={inp} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <h3 className="font-medium">Produto sem nota</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        {campo('descricao', 'Descrição', 'sm:col-span-2')}
        {campo('ean', 'EAN (código de barras)')}
        {campo('unidade', 'Unidade (UN, CX, FD…)')}
        {campo('ncm', 'NCM')}
        {campo('cest', 'CEST')}
        {campo('custo', 'Valor unitário de compra')}
        {campo('ipi', 'IPI %')}
        <label className="block">
          <span className="text-xs text-slate-500">Origem</span>
          <select className={inp} value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })}>
            <option value="4">4% (importado)</option>
            <option value="7">7% (Sul/Sudeste)</option>
            <option value="12">12%</option>
            <option value="18">Compra em SE</option>
          </select>
        </label>
      </div>
      {erro && <p className="mt-2 text-red-600">{erro}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={salvar} disabled={!f.descricao.trim()} className="rounded-md bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Cadastrar</button>
        <button onClick={onFechar} className="rounded-md border border-slate-300 px-3 py-1.5">Cancelar</button>
      </div>
    </div>
  );
}

function DadosFiscais({
  config,
  aberto,
  setAberto,
  padrao,
}: {
  config: ConfigLelis;
  aberto: boolean;
  setAberto: (b: boolean) => void;
  padrao: { pctOperacional: number; pctMargem: number; pctImpostosVenda: number };
}) {
  const [e, setE] = useState(config.emitente);
  const [fi, setFi] = useState<RevendaFiscal>({
    cstIcms: '00',
    aliqIcms: 19,
    csosn: '102',
    cstPis: '01',
    aliqPis: 1.65,
    cstCofins: '01',
    aliqCofins: 7.6,
    ...config.fiscal,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [senha, setSenha] = useState('');
  const pfx = useRef<HTMLInputElement>(null);

  async function salvar() {
    setMsg(null);
    const r = await fetch('/api/lelis/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...padrao,
        fiscal: fi,
        emitente: {
          razaoSocial: e.razaoSocial,
          nomeFantasia: e.nomeFantasia,
          ie: e.ie,
          crt: e.crt,
          endereco: { ...e.endereco, cep: e.endereco.cep.replace(/\D/g, ''), complemento: e.endereco.complemento || undefined, fone: e.endereco.fone || undefined },
          nfeSerie: e.nfeSerie,
          nfeAmbiente: e.nfeAmbiente,
        },
      }),
    });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? 'Dados da nota salvos.' : j.error ?? 'erro');
  }

  async function subirCert() {
    const file = pfx.current?.files?.[0];
    if (!file || !senha) return setMsg('Escolha o arquivo .pfx e digite a senha.');
    const fd = new FormData();
    fd.set('pfx', file);
    fd.set('senha', senha);
    const r = await fetch('/api/lelis/certificado', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(j.error ?? 'erro');
    setMsg(`Certificado de ${j.cn} salvo (vale até ${String(j.validadeFim).split('-').reverse().join('/')}).`);
    setTimeout(() => window.location.reload(), 800);
  }

  const end = (k: keyof FiscalEndereco, rotulo: string) => (
    <label className="block">
      <span className="text-xs text-slate-500">{rotulo}</span>
      <input className={inp} value={(e.endereco[k] as string) ?? ''} onChange={(ev) => setE({ ...e, endereco: { ...e.endereco, [k]: ev.target.value } })} />
    </label>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <button onClick={() => setAberto(!aberto)} className="flex w-full items-center justify-between text-left">
        <span className="font-medium text-slate-900">
          Dados da NF-e de venda (emitente, tributação, certificado)
          {!config.certificado && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">falta o certificado A1</span>}
          {!config.emitente.salvo && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">dados não salvos</span>}
        </span>
        <span className="text-slate-400">{aberto ? '▲' : '▼'}</span>
      </button>
      {aberto && (
        <div className="mt-3 space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block sm:col-span-2">
              <span className="text-xs text-slate-500">Razão social</span>
              <input className={inp} value={e.razaoSocial} onChange={(ev) => setE({ ...e, razaoSocial: ev.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Inscrição estadual</span>
              <input className={inp} value={e.ie} onChange={(ev) => setE({ ...e, ie: ev.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Regime</span>
              <select className={inp} value={e.crt} onChange={(ev) => setE({ ...e, crt: Number(ev.target.value) as 1 | 3 })}>
                <option value={1}>Simples Nacional</option>
                <option value={3}>Regime normal (Presumido/Real)</option>
              </select>
            </label>
            {end('logradouro', 'Rua')}
            {end('numero', 'Número')}
            {end('bairro', 'Bairro')}
            {end('cep', 'CEP')}
            {end('municipio', 'Município')}
            {end('codigoMunicipio', 'Código IBGE (Aracaju 2800308)')}
            {end('uf', 'UF')}
            {end('fone', 'Telefone')}
            <label className="block">
              <span className="text-xs text-slate-500">Série da NF-e</span>
              <input className={inp} value={e.nfeSerie} onChange={(ev) => setE({ ...e, nfeSerie: Number(ev.target.value) || 1 })} />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Ambiente</span>
              <select className={inp} value={e.nfeAmbiente} onChange={(ev) => setE({ ...e, nfeAmbiente: Number(ev.target.value) as 1 | 2 })}>
                <option value={1}>Produção (vale de verdade)</option>
                <option value={2}>Homologação (teste)</option>
              </select>
            </label>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase text-slate-500">Tributação na venda (confirmar com o contador)</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-4">
              {e.crt === 3 ? (
                <>
                  <label className="block">
                    <span className="text-xs text-slate-500">CST do ICMS</span>
                    <select className={inp} value={fi.cstIcms} onChange={(ev) => setFi({ ...fi, cstIcms: ev.target.value })}>
                      <option value="00">00 — tributada (destaca ICMS)</option>
                      <option value="40">40 — isenta</option>
                      <option value="41">41 — não tributada</option>
                      <option value="60">60 — ICMS já retido por ST</option>
                    </select>
                  </label>
                  {fi.cstIcms === '00' && (
                    <label className="block">
                      <span className="text-xs text-slate-500">Alíquota ICMS (%)</span>
                      <CampoNum largura={inp} valor={fi.aliqIcms ?? 0} onChange={(v) => setFi({ ...fi, aliqIcms: v ?? 0 })} />
                    </label>
                  )}
                  <label className="block">
                    <span className="text-xs text-slate-500">CST PIS/COFINS</span>
                    <select className={inp} value={fi.cstPis} onChange={(ev) => setFi({ ...fi, cstPis: ev.target.value, cstCofins: ev.target.value })}>
                      <option value="01">01 — tributada (alíquota)</option>
                      <option value="04">04 — monofásica (revenda a zero)</option>
                      <option value="06">06 — alíquota zero</option>
                      <option value="49">49 — outras saídas</option>
                    </select>
                  </label>
                  {fi.cstPis === '01' && (
                    <>
                      <label className="block">
                        <span className="text-xs text-slate-500">PIS (%)</span>
                        <CampoNum largura={inp} valor={fi.aliqPis ?? 0} onChange={(v) => setFi({ ...fi, aliqPis: v ?? 0 })} />
                      </label>
                      <label className="block">
                        <span className="text-xs text-slate-500">COFINS (%)</span>
                        <CampoNum largura={inp} valor={fi.aliqCofins ?? 0} onChange={(v) => setFi({ ...fi, aliqCofins: v ?? 0 })} />
                      </label>
                    </>
                  )}
                </>
              ) : (
                <label className="block">
                  <span className="text-xs text-slate-500">CSOSN</span>
                  <select className={inp} value={fi.csosn} onChange={(ev) => setFi({ ...fi, csosn: ev.target.value })}>
                    <option value="102">102 — tributada pelo Simples sem crédito</option>
                    <option value="500">500 — ICMS já cobrado por ST</option>
                    <option value="400">400 — não tributada</option>
                  </select>
                </label>
              )}
              <label className="block sm:col-span-4">
                <span className="text-xs text-slate-500">Texto fixo nas informações complementares (ex.: Termo de Acordo, Decreto 40.949/2021)</span>
                <input className={inp} value={fi.infCpl ?? ''} onChange={(ev) => setFi({ ...fi, infCpl: ev.target.value })} />
              </label>
            </div>
          </div>
          <button onClick={salvar} className="rounded-md bg-slate-900 px-3 py-1.5 text-white">Salvar dados da nota</button>

          <div className="border-t border-slate-100 pt-3">
            <h3 className="text-xs font-semibold uppercase text-slate-500">Certificado A1 da Lelis (CNPJ {config.cnpj})</h3>
            {config.certificado ? (
              <p className="mt-1 text-emerald-700">
                ✓ {config.certificado.cn} — vale até {config.certificado.validadeFim.split('-').reverse().join('/')}
              </p>
            ) : (
              <p className="mt-1 text-red-700">Sem certificado: a nota não sai sem ele.</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-xs text-slate-600">1. Arquivo .pfx:{' '}<input ref={pfx} type="file" accept=".pfx,.p12" className="text-xs file:mr-2 file:rounded-md file:border file:border-slate-400 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-200" /></label>
              <input type="password" placeholder="senha do certificado" value={senha} onChange={(ev) => setSenha(ev.target.value)} className="rounded-md border border-slate-300 px-2 py-1" />
              <button onClick={subirCert} className="rounded-md border border-slate-300 px-3 py-1">{config.certificado ? 'Trocar certificado' : 'Enviar certificado'}</button>
            </div>
          </div>
          {msg && <p className="text-sm text-slate-700">{msg}</p>}
        </div>
      )}
    </div>
  );
}

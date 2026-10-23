'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Forn {
  id: string;
  nome: string;
  doc: string | null;
  temPix: boolean;
  zap: string | null;
}
interface Prod {
  id: string;
  nome: string;
  unidade: string | null;
}
interface Item {
  descricao: string;
  quantidade: string;
  unidade: string;
  valorTotal: string;
}
type Tipo = 'ENTRADA' | 'RESTANTE';
type Forma = 'PIX' | 'BOLETO';
type Quando = 'DATA' | 'PRAZO' | 'PRONTO';
interface Parcela {
  tipo: Tipo;
  forma: Forma;
  quando: Quando;
  data: string;
  prazoDias: string;
  valor: string;
}

/** "1.495,00" / "1495.00" / "1495" → número */
function num(s: string): number {
  const t = s.trim();
  if (!t) return 0;
  const v = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  return Number.isFinite(v) ? v : 0;
}
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => r2(v).toFixed(2).replace('.', ',');

const inp = 'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm';

export function NovoPedidoEncomenda(props: { filialId: string; hoje: string; fornecedores: Forn[]; produtos: Prod[] }) {
  const router = useRouter();
  const [fornecedores, setFornecedores] = useState(props.fornecedores);
  const [fornBusca, setFornBusca] = useState('');
  const [fornId, setFornId] = useState<string | null>(null);
  const [novoForn, setNovoForn] = useState(false);
  const [nf, setNf] = useState({ nome: '', doc: '', chavePix: '', pixFavorecido: '', zap: '' });
  const [zap, setZap] = useState('');
  const [referencia, setReferencia] = useState('');
  const [producao, setProducao] = useState('');
  const [transporte, setTransporte] = useState('');
  const [observacao, setObservacao] = useState('');
  const [itens, setItens] = useState<Item[]>([{ descricao: '', quantidade: '', unidade: 'un', valorTotal: '' }]);
  const [frete, setFrete] = useState('');
  const [desconto, setDesconto] = useState('');
  const [parcelas, setParcelas] = useState<Parcela[]>([
    { tipo: 'ENTRADA', forma: 'PIX', quando: 'DATA', data: props.hoje, prazoDias: '30', valor: '' },
    { tipo: 'RESTANTE', forma: 'PIX', quando: 'PRONTO', data: '', prazoDias: '30', valor: '' },
  ]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const produtoPorNome = useMemo(() => {
    const m = new Map<string, Prod>();
    for (const p of props.produtos) m.set(p.nome.trim().toUpperCase(), p);
    return m;
  }, [props.produtos]);

  const fornSel = fornecedores.find((f) => f.id === fornId) ?? null;
  const rotuloForn = (f: Forn) => `${f.nome}${f.doc ? ` — ${f.doc}` : ''}`;

  const somaItens = r2(itens.reduce((a, i) => a + num(i.valorTotal), 0));
  const total = r2(somaItens + num(frete) - num(desconto));
  const somaParcelas = r2(parcelas.reduce((a, p) => a + num(p.valor), 0));
  const falta = r2(total - somaParcelas);

  function escolherForn(texto: string) {
    setFornBusca(texto);
    const f = fornecedores.find((x) => rotuloForn(x) === texto || x.nome === texto);
    setFornId(f?.id ?? null);
    setZap(f?.zap ?? '');
  }

  async function cadastrarForn() {
    setErro(null);
    const doc = nf.doc.replace(/\D/g, '');
    const r = await fetch('/api/fornecedores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filialId: props.filialId,
        nome: nf.nome.trim(),
        cnpjOuCpf: doc || null,
        chavePix: nf.chavePix.trim() || null,
        pixFavorecido: nf.pixFavorecido.trim() || null,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(j.error ?? 'não deu pra cadastrar o fornecedor');
      return;
    }
    const novo: Forn = { id: j.id, nome: j.nome, doc: doc || null, temPix: !!nf.chavePix.trim(), zap: null };
    setZap(nf.zap.trim());
    setFornecedores((fs) => (fs.some((f) => f.id === novo.id) ? fs : [...fs, novo]));
    setFornId(novo.id);
    setFornBusca(rotuloForn(novo));
    setNovoForn(false);
  }

  function setItem(k: number, patch: Partial<Item>) {
    setItens((xs) => xs.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  }
  function setParc(k: number, patch: Partial<Parcela>) {
    setParcelas((xs) => xs.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  }
  /** Entrada = metade, restante = o que falta (dividido nas parcelas de restante). */
  function metadeMetade() {
    if (total <= 0) return;
    const ent = parcelas.filter((p) => p.tipo === 'ENTRADA').length;
    const res = parcelas.filter((p) => p.tipo === 'RESTANTE').length;
    if (!ent || !res) return;
    const vEnt = r2(total / 2 / ent);
    const totalEnt = r2(vEnt * ent);
    const vRes = r2((total - totalEnt) / res);
    let resto = r2(total - totalEnt - vRes * res);
    setParcelas((xs) =>
      xs.map((p, i) => {
        if (p.tipo === 'ENTRADA') return { ...p, valor: fmt(vEnt) };
        const ultimo = xs.findLastIndex((q) => q.tipo === 'RESTANTE') === i;
        const v = ultimo ? r2(vRes + resto) : vRes;
        if (ultimo) resto = 0;
        return { ...p, valor: fmt(v) };
      }),
    );
  }
  function jogarFaltaNaUltima() {
    if (!parcelas.length) return;
    const k = parcelas.length - 1;
    setParc(k, { valor: fmt(num(parcelas[k]!.valor) + falta) });
  }

  async function salvar() {
    setErro(null);
    if (!fornId) return setErro('escolha o fornecedor (ou cadastre um novo)');
    const its = itens.filter((i) => i.descricao.trim() || num(i.valorTotal) > 0);
    if (!its.length) return setErro('coloque pelo menos um item');
    for (const i of its) {
      if (!i.descricao.trim()) return setErro('item sem descrição');
      if (num(i.quantidade) <= 0) return setErro(`quantidade do item "${i.descricao}"`);
    }
    if (Math.abs(falta) > 0.009) return setErro(`as parcelas não fecham com o total: falta ${brl(falta)}`);
    for (const p of parcelas) {
      if (num(p.valor) <= 0) return setErro('parcela sem valor');
      if (p.quando === 'DATA' && !p.data) return setErro('parcela com data escolhida sem data');
    }
    setSalvando(true);
    try {
      const r = await fetch('/api/compras/pedidos/encomenda', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId: props.filialId,
          fornecedorId: fornId,
          whatsapp: zap.trim() || null,
          referencia: referencia.trim() || null,
          observacao: observacao.trim() || null,
          valorFrete: num(frete),
          valorDesconto: num(desconto),
          prazoProducaoDiasUteis: producao ? Number(producao) : null,
          prazoTransporteDiasUteis: transporte ? Number(transporte) : null,
          itens: its.map((i) => {
            const p = produtoPorNome.get(i.descricao.trim().toUpperCase());
            return {
              produtoId: p?.id ?? null,
              descricao: i.descricao.trim(),
              quantidade: num(i.quantidade),
              unidade: i.unidade.trim() || p?.unidade || 'un',
              valorTotal: num(i.valorTotal),
            };
          }),
          parcelas: parcelas.map((p) => ({
            tipo: p.tipo,
            forma: p.forma,
            quando: p.quando,
            data: p.quando === 'DATA' ? p.data : null,
            prazoDias: p.quando === 'PRAZO' ? Number(p.prazoDias || 30) : null,
            valor: num(p.valor),
          })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'erro ao gravar');
      if (j.enviado) alert(`Pedido #${j.numero} gravado e enviado pro fornecedor no WhatsApp ✅`);
      else if (j.envioErro) alert(`Pedido #${j.numero} gravado, mas o WhatsApp não saiu: ${j.envioErro}. Dá pra mandar de novo pela tela do pedido.`);
      router.push(`/compras/pedidos/${j.id}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'erro ao gravar');
      setSalvando(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Fornecedor */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Fornecedor</h2>
        {!novoForn ? (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              list="forn-lista"
              value={fornBusca}
              onChange={(e) => escolherForn(e.target.value)}
              placeholder="Digite o nome ou CNPJ"
              className={inp}
            />
            <datalist id="forn-lista">
              {fornecedores.map((f) => (
                <option key={f.id} value={rotuloForn(f)} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => {
                setNovoForn(true);
                setNf((x) => ({ ...x, nome: fornSel ? '' : fornBusca }));
              }}
              className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              + Cadastrar novo
            </button>
          </div>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input className={inp} placeholder="Nome" value={nf.nome} onChange={(e) => setNf({ ...nf, nome: e.target.value })} />
            <input className={inp} placeholder="CNPJ ou CPF" value={nf.doc} onChange={(e) => setNf({ ...nf, doc: e.target.value })} />
            <input className={inp} placeholder="Chave Pix" value={nf.chavePix} onChange={(e) => setNf({ ...nf, chavePix: e.target.value })} />
            <input
              className={inp}
              placeholder="Quem recebe o Pix (se for outra pessoa)"
              value={nf.pixFavorecido}
              onChange={(e) => setNf({ ...nf, pixFavorecido: e.target.value })}
            />
            <input
              className={inp}
              placeholder="WhatsApp do fornecedor (ex.: 11 99999-9999)"
              inputMode="tel"
              value={nf.zap}
              onChange={(e) => setNf({ ...nf, zap: e.target.value })}
            />
            <div className="flex gap-2 sm:col-span-2">
              <button
                type="button"
                onClick={cadastrarForn}
                disabled={!nf.nome.trim()}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                Cadastrar
              </button>
              <button type="button" onClick={() => setNovoForn(false)} className="px-3 py-1.5 text-xs text-slate-500">
                Cancelar
              </button>
            </div>
          </div>
        )}
        {fornSel && (
          <p className="mt-2 text-xs text-slate-500">
            {fornSel.temPix ? '✅ tem chave Pix no cadastro' : '⚠ sem chave Pix no cadastro — dá pra pôr depois no fornecedor'}
          </p>
        )}
        {fornSel && (
          <label className="mt-2 block text-xs text-slate-600">
            WhatsApp do fornecedor
            <input
              className={inp}
              inputMode="tel"
              value={zap}
              onChange={(e) => setZap(e.target.value)}
              placeholder="ex.: 11 99999-9999"
            />
            <span className="mt-1 block">
              {zap.replace(/\D/g, '').length >= 10
                ? '📱 ao lançar, o pedido vai sozinho pro WhatsApp do fornecedor'
                : 'sem WhatsApp — o pedido fica gravado e não sai sozinho'}
            </span>
          </label>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-slate-600">
            Nº do orçamento
            <input className={inp} value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="ex.: 17351" />
          </label>
          <label className="text-xs text-slate-600">
            Produção (dias úteis)
            <input className={inp} inputMode="numeric" value={producao} onChange={(e) => setProducao(e.target.value.replace(/\D/g, ''))} placeholder="ex.: 20" />
          </label>
          <label className="text-xs text-slate-600">
            Transporte (dias úteis)
            <input className={inp} inputMode="numeric" value={transporte} onChange={(e) => setTransporte(e.target.value.replace(/\D/g, ''))} placeholder="ex.: 10" />
          </label>
        </div>
      </section>

      {/* Itens */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Itens</h2>
        <p className="text-xs text-slate-500">Escreva o que foi pedido. Se for um produto já cadastrado, escolha na lista.</p>
        <datalist id="prod-lista">
          {props.produtos.map((p) => (
            <option key={p.id} value={p.nome} />
          ))}
        </datalist>
        <div className="mt-2 space-y-2">
          {itens.map((it, k) => (
            <div key={k} className="grid grid-cols-12 gap-2">
              <input
                list="prod-lista"
                className={`${inp} col-span-12 sm:col-span-6`}
                placeholder="Descrição (ex.: saco porta-talher 40 g)"
                value={it.descricao}
                onChange={(e) => setItem(k, { descricao: e.target.value })}
              />
              <input className={`${inp} col-span-4 sm:col-span-2`} placeholder="Qtd" inputMode="decimal" value={it.quantidade} onChange={(e) => setItem(k, { quantidade: e.target.value })} />
              <input className={`${inp} col-span-3 sm:col-span-1`} placeholder="un" value={it.unidade} onChange={(e) => setItem(k, { unidade: e.target.value })} />
              <input className={`${inp} col-span-4 sm:col-span-2`} placeholder="Total R$" inputMode="decimal" value={it.valorTotal} onChange={(e) => setItem(k, { valorTotal: e.target.value })} />
              <button
                type="button"
                onClick={() => setItens((xs) => (xs.length > 1 ? xs.filter((_, i) => i !== k) : xs))}
                className="col-span-1 text-xs text-slate-400 hover:text-rose-600"
                title="Tirar item"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setItens((xs) => [...xs, { descricao: '', quantidade: '', unidade: 'un', valorTotal: '' }])}
          className="mt-2 text-xs text-sky-700 hover:underline"
        >
          + item
        </button>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-slate-600">
            Frete R$
            <input className={inp} inputMode="decimal" value={frete} onChange={(e) => setFrete(e.target.value)} />
          </label>
          <label className="text-xs text-slate-600">
            Desconto R$
            <input className={inp} inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} />
          </label>
          <div className="text-xs text-slate-600">
            Total do pedido
            <p className="mt-1 text-lg font-semibold text-slate-900">{brl(total)}</p>
          </div>
        </div>
      </section>

      {/* Parcelas */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Pagamento</h2>
          <button type="button" onClick={metadeMetade} className="text-xs text-sky-700 hover:underline">
            Entrada de 50% + restante
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {parcelas.map((p, k) => (
            <div key={k} className="grid grid-cols-12 items-center gap-2 rounded-md bg-slate-50 p-2">
              <select className={`${inp} col-span-6 sm:col-span-2`} value={p.tipo} onChange={(e) => setParc(k, { tipo: e.target.value as Tipo })}>
                <option value="ENTRADA">Entrada</option>
                <option value="RESTANTE">Restante</option>
              </select>
              <select className={`${inp} col-span-6 sm:col-span-2`} value={p.forma} onChange={(e) => setParc(k, { forma: e.target.value as Forma })}>
                <option value="PIX">Pix</option>
                <option value="BOLETO">Boleto</option>
              </select>
              <select className={`${inp} col-span-6 sm:col-span-3`} value={p.quando} onChange={(e) => setParc(k, { quando: e.target.value as Quando })}>
                <option value="DATA">Na data</option>
                <option value="PRAZO">Em N dias</option>
                <option value="PRONTO">Quando ficar pronto</option>
              </select>
              <div className="col-span-6 sm:col-span-2">
                {p.quando === 'DATA' && (
                  <input type="date" className={inp} value={p.data} onChange={(e) => setParc(k, { data: e.target.value })} />
                )}
                {p.quando === 'PRAZO' && (
                  <input className={inp} inputMode="numeric" value={p.prazoDias} onChange={(e) => setParc(k, { prazoDias: e.target.value.replace(/\D/g, '') })} placeholder="dias" />
                )}
                {p.quando === 'PRONTO' && <span className="text-[11px] text-slate-500">vence quando avisar que ficou pronto</span>}
              </div>
              <input
                className={`${inp} col-span-10 sm:col-span-2`}
                inputMode="decimal"
                placeholder="R$"
                value={p.valor}
                onChange={(e) => setParc(k, { valor: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setParcelas((xs) => (xs.length > 1 ? xs.filter((_, i) => i !== k) : xs))}
                className="col-span-2 text-xs text-slate-400 hover:text-rose-600 sm:col-span-1"
                title="Tirar parcela"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() =>
              setParcelas((xs) => [...xs, { tipo: 'RESTANTE', forma: 'PIX', quando: 'PRAZO', data: '', prazoDias: '30', valor: '' }])
            }
            className="text-sky-700 hover:underline"
          >
            + parcela
          </button>
          <span className={Math.abs(falta) > 0.009 ? 'font-medium text-rose-700' : 'text-emerald-700'}>
            {Math.abs(falta) > 0.009 ? `Falta distribuir ${brl(falta)}` : '✅ Parcelas fecham com o total'}
          </span>
          {Math.abs(falta) > 0.009 && (
            <button type="button" onClick={jogarFaltaNaUltima} className="text-sky-700 hover:underline">
              pôr na última
            </button>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="text-xs text-slate-600">
          Observação
          <textarea className={inp} rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="ex.: entrega no Prainha Bar" />
        </label>
      </section>

      {erro && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>}
      <button
        type="button"
        onClick={salvar}
        disabled={salvando}
        className="w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 sm:w-auto"
      >
        {salvando ? 'Gravando…' : `Lançar pedido (${brl(total)})`}
      </button>
    </div>
  );
}

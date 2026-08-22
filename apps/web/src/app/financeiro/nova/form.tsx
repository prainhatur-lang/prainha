'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hojeBr } from '@/lib/datas';
import { brl, formatValorBr, parseValorBr } from '@/lib/format';

interface Opcao {
  id: string;
  nome: string;
}
interface CategoriaPai extends Opcao {
  filhas: Opcao[];
}

const inputCls = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm';
const labelCls = 'block text-[11px] font-medium uppercase tracking-wide text-slate-500';

/** Busca sem acento e sem caixa — "jose" acha "JOSÉ". */
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Fornecedor com busca por texto: são mais de 2 mil cadastrados e o <select>
 *  nativo não deixava achar ninguém. Digita um pedaço do nome e escolhe na
 *  lista. Texto digitado sem escolher NÃO vira fornecedor — o submit avisa. */
function FornecedorPicker({
  fornecedores,
  fornecedorId,
  texto,
  onTexto,
  onPick,
}: {
  fornecedores: Opcao[];
  fornecedorId: string;
  texto: string;
  onTexto: (t: string) => void;
  onPick: (f: Opcao | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const termo = normalizar(texto.trim());
  const sugestoes = useMemo(() => {
    if (termo.length < 2) return [];
    const achados = fornecedores.filter((f) => normalizar(f.nome).includes(termo));
    // quem começa com o termo vem primeiro
    achados.sort(
      (a, b) =>
        Number(normalizar(b.nome).startsWith(termo)) -
        Number(normalizar(a.nome).startsWith(termo)),
    );
    return achados.slice(0, 30);
  }, [fornecedores, termo]);
  const escolhido = !!fornecedorId;

  return (
    <div className="relative">
      <input
        value={texto}
        onChange={(e) => {
          onTexto(e.target.value);
          onPick(null);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        placeholder="digite um pedaço do nome — ex: petrox, guga"
        className={`${inputCls} pr-8 ${escolhido ? 'border-emerald-400 bg-emerald-50/40' : ''}`}
      />
      {texto && (
        <button
          type="button"
          onClick={() => {
            onTexto('');
            onPick(null);
          }}
          title="Limpar fornecedor"
          className="absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700"
        >
          ✕
        </button>
      )}
      {aberto && !escolhido && termo.length >= 2 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {sugestoes.length === 0 ? (
            <li className="px-3 py-1.5 text-xs text-slate-500">
              Nenhum fornecedor com “{texto.trim()}”. Apague o campo pra lançar sem fornecedor.
            </li>
          ) : (
            sugestoes.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onTexto(f.nome);
                    onPick(f);
                    setAberto(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-slate-50"
                >
                  {f.nome}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export function NovaContaForm({
  filiais,
  filialId,
  categorias,
  fornecedores,
}: {
  filiais: Opcao[];
  filialId: string;
  categorias: CategoriaPai[];
  fornecedores: Opcao[];
}) {
  const router = useRouter();
  const hoje = hojeBr();

  const [paiId, setPaiId] = useState('');
  const [subId, setSubId] = useState('');
  const [fornecedorId, setFornecedorId] = useState('');
  const [fornecedorTexto, setFornecedorTexto] = useState('');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [dataLancamento, setDataLancamento] = useState(hoje);
  const [dataVencimento, setDataVencimento] = useState(hoje);
  const [status, setStatus] = useState<'ABERTA' | 'PAGA'>('ABERTA');
  const [dataPagamento, setDataPagamento] = useState(hoje);
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pai = useMemo(() => categorias.find((c) => c.id === paiId), [categorias, paiId]);
  // categoria efetiva = subcategoria quando escolhida; senão a própria categoria
  const categoriaId = subId || paiId || null;
  // o que o campo de valor vai mandar — mostrado ao vivo embaixo do campo
  const valorNum = parseValorBr(valor);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const v = parseValorBr(valor);
    if (!descricao.trim() || descricao.trim().length < 2) return setErro('Informe o histórico.');
    if (v == null || v <= 0) return setErro('Valor inválido — digite como 3.490,00 ou 3490.');
    if (!fornecedorId && fornecedorTexto.trim()) {
      return setErro(
        'Escolha o fornecedor na lista — ou apague o campo pra lançar sem fornecedor.',
      );
    }
    setSalvando(true);
    try {
      const r = await fetch('/api/financeiro/contas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId,
          descricao: descricao.trim(),
          valor: v,
          dataVencimento,
          dataLancamento,
          dataPagamento: status === 'PAGA' ? dataPagamento : null,
          fornecedorId: fornecedorId || null,
          categoriaId,
          observacao: observacao.trim() || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      router.push(d.id ? `/financeiro/conta/${d.id}` : '/financeiro');
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-5">
      {filiais.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Filial:</span>
          {filiais.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                if (f.id !== filialId) window.location.href = `/financeiro/nova?filialId=${f.id}`;
              }}
              className={`rounded-md border px-3 py-1 text-xs ${
                f.id === filialId
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {f.nome}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Lançamento</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={labelCls}>Histórico *</label>
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: Aluguel agosto, manutenção da chapa, taxa do alvará..."
              required
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Categoria</label>
            <select
              value={paiId}
              onChange={(e) => {
                setPaiId(e.target.value);
                setSubId('');
              }}
              className={inputCls}
            >
              <option value="">— sem categoria —</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Subcategoria</label>
            <select
              value={subId}
              onChange={(e) => setSubId(e.target.value)}
              disabled={!pai || pai.filhas.length === 0}
              className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`}
            >
              <option value="">
                {pai && pai.filhas.length > 0 ? '— usar só a categoria —' : '—'}
              </option>
              {(pai?.filhas ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Fornecedor</label>
            <FornecedorPicker
              fornecedores={fornecedores}
              fornecedorId={fornecedorId}
              texto={fornecedorTexto}
              onTexto={setFornecedorTexto}
              onPick={(f) => setFornecedorId(f?.id ?? '')}
            />
          </div>
          <div>
            <label className={labelCls}>Valor (R$) *</label>
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onBlur={() => {
                // reescreve do jeito BR ("3.490,00") — o que você vê é o que entra
                if (valorNum != null && valorNum > 0) setValor(formatValorBr(valorNum));
              }}
              inputMode="decimal"
              placeholder="0,00"
              required
              className={`${inputCls} font-mono`}
            />
            {valor.trim() &&
              (valorNum != null && valorNum > 0 ? (
                <p className="mt-1 text-xs text-emerald-700">
                  Vai entrar como <b className="font-mono">{brl(valorNum)}</b>
                </p>
              ) : (
                <p className="mt-1 text-xs text-rose-700">
                  Não entendi esse valor — digite como{' '}
                  <span className="font-mono">3.490,00</span> ou{' '}
                  <span className="font-mono">3490</span>.
                </p>
              ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Datas e status</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={labelCls}>Data do lançamento</label>
            <input
              type="date"
              value={dataLancamento}
              onChange={(e) => setDataLancamento(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Vencimento *</label>
            <input
              type="date"
              value={dataVencimento}
              onChange={(e) => setDataVencimento(e.target.value)}
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'ABERTA' | 'PAGA')}
              className={inputCls}
            >
              <option value="ABERTA">Em aberto</option>
              <option value="PAGA">Já paga</option>
            </select>
          </div>
          {status === 'PAGA' && (
            <div>
              <label className={labelCls}>Data do pagamento</label>
              <input
                type="date"
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
                className={inputCls}
              />
            </div>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Pagou uma parte só? Lance <b>em aberto</b> e registre o pagamento parcial na
          página da conta — cada pagamento fica no histórico.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label className={labelCls}>Observação</label>
        <textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          rows={2}
          className={inputCls}
        />
      </div>

      {erro && <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</div>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/financeiro')}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={salvando}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {salvando ? 'Lançando...' : 'Lançar conta'}
        </button>
      </div>
    </form>
  );
}

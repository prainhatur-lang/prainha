'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseValorBr } from '@/lib/format';
import { EditPix } from '@/app/cadastros/fornecedores/edit-pix';
import { FornecedorPicker, type CategoriaPai, type Opcao } from '../../../nova/form';

const inputCls = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm';
const labelCls = 'block text-[11px] font-medium uppercase tracking-wide text-slate-500';

export interface ValoresConta {
  descricao: string;
  valor: string;
  dataLancamento: string;
  dataVencimento: string;
  paiId: string;
  subId: string;
  fornecedorId: string;
  fornecedorNome: string;
  forma: '' | 'boleto' | 'pix' | 'qr';
  observacao: string;
}

export function EditarContaForm({
  contaId,
  categorias,
  fornecedores,
  aberta,
  inicial,
}: {
  contaId: string;
  categorias: CategoriaPai[];
  fornecedores: Array<Opcao & { chavePix?: string | null; pixFavorecido?: string | null; doc?: string | null }>;
  /** Conta ainda em aberto: forma de pagamento obrigatória. */
  aberta?: boolean;
  inicial: ValoresConta;
}) {
  const router = useRouter();
  const [paiId, setPaiId] = useState(inicial.paiId);
  const [subId, setSubId] = useState(inicial.subId);
  const [fornecedorId, setFornecedorId] = useState(inicial.fornecedorId);
  const [fornecedorTexto, setFornecedorTexto] = useState(inicial.fornecedorNome);
  const [descricao, setDescricao] = useState(inicial.descricao);
  const [valor, setValor] = useState(inicial.valor);
  const [dataLancamento, setDataLancamento] = useState(inicial.dataLancamento);
  const [dataVencimento, setDataVencimento] = useState(inicial.dataVencimento);
  const [observacao, setObservacao] = useState(inicial.observacao);
  // Como se paga (dono 25/11/2026): toda conta em aberto tem forma.
  const [forma, setForma] = useState<'' | 'boleto' | 'pix' | 'qr'>(inicial.forma);
  const fornPix = fornecedores.find((f) => f.id === fornecedorId) ?? null;
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pai = useMemo(() => categorias.find((c) => c.id === paiId), [categorias, paiId]);
  const categoriaId = subId || paiId || null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const v = parseValorBr(valor);
    if (!descricao.trim() || descricao.trim().length < 2) return setErro('Informe o histórico.');
    if (v == null || v <= 0) return setErro('Valor inválido — digite como 3.490,00 ou 3490.');
    if (!fornecedorId && fornecedorTexto.trim()) {
      return setErro('Escolha o fornecedor na lista — ou apague o campo pra deixar sem fornecedor.');
    }
    if (aberta && !forma) return setErro('Informe como se paga: Boleto ou Pix.');
    if (forma === 'pix' && !fornecedorId) return setErro('Pix: escolha o fornecedor — a chave Pix fica no cadastro dele.');
    if (forma === 'pix' && !fornPix?.chavePix) {
      return setErro('Pix: informe a chave Pix do fornecedor (botão logo abaixo de "Como se paga?").');
    }
    setSalvando(true);
    try {
      const r = await fetch(`/api/financeiro/contas/${contaId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          descricao: descricao.trim(),
          valor: v,
          dataVencimento,
          dataLancamento: dataLancamento || undefined,
          fornecedorId: fornecedorId || null,
          categoriaId,
          observacao: observacao.trim() || null,
          ...(forma ? { formaPagamento: forma } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      router.push(`/financeiro/conta/${contaId}`);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={labelCls}>Histórico *</label>
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
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
              inputMode="decimal"
              required
              className={`${inputCls} font-mono`}
            />
            <p className="mt-1 text-[10px] text-slate-400">
              Não pode ficar menor que o total já pago — estorne baixas antes, se precisar.
            </p>
          </div>

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

          <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 md:col-span-2">
            <label className="block text-xs font-semibold text-amber-900">Como se paga?</label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {(
                [
                  ['boleto', '🧾 Boleto'],
                  ['pix', '⚡ Pix'],
                  // só aparece em conta que já nasceu QR (lançada em Nova conta)
                  ...(inicial.forma === 'qr' ? ([['qr', '🔳 QR / copia-e-cola']] as const) : []),
                ] as const
              ).map(([v, rot]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setForma(v)}
                  className={`rounded-lg border-2 px-5 py-2.5 text-sm font-semibold ${
                    forma === v
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-500'
                  }`}
                >
                  {rot}
                </button>
              ))}
              {!forma && (
                <span className="text-xs text-amber-800">
                  {aberta ? 'obrigatório — escolha um dos dois' : 'já paga: opcional'}
                </span>
              )}
            </div>
            {forma === 'boleto' && (
              <p className="mt-2 text-xs text-slate-700">
                Prazo do boleto: vence em{' '}
                <span className="font-semibold">{dataVencimento.split('-').reverse().join('/')}</span> — confira o campo
                Vencimento.
              </p>
            )}
            {forma === 'qr' && (
              <p className="mt-2 text-xs text-slate-700">
                Paga pelo Pix copia-e-cola que está na observação — em Financeiro → Pagar conta (código/QR), botão
                "Pagar esta".
              </p>
            )}
            {forma === 'pix' && (
              <div className="mt-2 text-xs text-slate-700">
                {!fornecedorId ? (
                  <p className="font-medium text-amber-800">Escolha o fornecedor acima — a chave Pix fica no cadastro dele.</p>
                ) : fornPix?.chavePix ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span>
                      Paga na chave{' '}
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono font-semibold text-emerald-900">
                        {fornPix.chavePix}
                      </span>
                      {fornPix.pixFavorecido ? <> — recebe: {fornPix.pixFavorecido}</> : null}
                    </span>
                    <span className="text-[11px] text-slate-500">chave errada?</span>
                    <EditPix
                      fornecedorId={fornecedorId}
                      chaveAtual={fornPix.chavePix}
                      favorecidoAtual={fornPix.pixFavorecido ?? null}
                      docFornecedor={fornPix.doc ?? null}
                    />
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-amber-800">
                      Este fornecedor não tem chave Pix. Informe a chave que ele passou:
                    </span>
                    <EditPix
                      fornecedorId={fornecedorId}
                      chaveAtual={null}
                      favorecidoAtual={fornPix?.pixFavorecido ?? null}
                      docFornecedor={fornPix?.doc ?? null}
                    />
                  </div>
                )}
                <p className="mt-1 text-[11px] text-slate-500">
                  Data do Pix: {dataVencimento.split('-').reverse().join('/')} (campo Vencimento).
                </p>
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>Observação</label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </div>
        </div>
      </div>

      {erro && <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</div>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push(`/financeiro/conta/${contaId}`)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={salvando}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </div>
    </form>
  );
}

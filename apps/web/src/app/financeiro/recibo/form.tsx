'use client';

// Fazer recibo (16/11/2026): quem recebeu não tem recibo. Dados de quem
// recebeu, valor, a que se refere e a pergunta: já foi pago? Sim → como
// (dinheiro, Pix...) e nasce paga. Não → entra no contas a pagar.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { hojeBr } from '@/lib/datas';
import { formatValorBr, parseValorBr } from '@/lib/format';
import { FORMAS_RECIBO, type FormaRecibo } from '@/lib/recibo-formas';

interface Opcao {
  id: string;
  nome: string;
}
interface CategoriaPai extends Opcao {
  filhas: Opcao[];
}

const inputCls = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
const labelCls = 'block text-[11px] font-medium uppercase tracking-wide text-slate-500';

function mascaraDoc(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11)
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function ReciboForm({
  filiais,
  filialId,
  categorias,
}: {
  filiais: Opcao[];
  filialId: string;
  categorias: CategoriaPai[];
}) {
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [telefone, setTelefone] = useState('');
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [pago, setPago] = useState<boolean | null>(null);
  const [forma, setForma] = useState<FormaRecibo | ''>('');
  const [dataPagamento, setDataPagamento] = useState(hojeBr());
  const [dataVencimento, setDataVencimento] = useState(hojeBr());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [podeForcar, setPodeForcar] = useState(false);

  async function salvar(forcar = false) {
    setErro(null);
    setPodeForcar(false);
    const valorNum = parseValorBr(valor);
    const digitos = documento.replace(/\D/g, '');
    if (nome.trim().length < 3) return setErro('Digite o nome de quem recebeu.');
    if (digitos.length !== 11 && digitos.length !== 14) return setErro('Informe o CPF (11 dígitos) ou o CNPJ (14).');
    if (valorNum == null || valorNum <= 0) return setErro('Informe o valor.');
    if (descricao.trim().length < 2) return setErro('Diga a que se refere o pagamento.');
    if (pago == null) return setErro('Responda: já foi pago?');
    if (pago && !forma) return setErro('Diga como foi pago.');

    setSalvando(true);
    try {
      const r = await fetch('/api/financeiro/recibo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId,
          nome: nome.trim(),
          documento: digitos,
          telefone: telefone.trim() || null,
          valor: valorNum,
          descricao: descricao.trim(),
          pago,
          ...(pago ? { forma, dataPagamento } : { dataVencimento }),
          categoriaId: categoriaId || null,
          forcar,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as { id?: string; error?: string; podeForcar?: boolean };
      if (!r.ok || !d.id) {
        setErro(d.error ?? `Erro ${r.status}`);
        setPodeForcar(!!d.podeForcar);
        return;
      }
      router.push(`/financeiro/recibo/${d.id}`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const botaoSimNao = (ativo: boolean) =>
    `flex-1 rounded-lg border px-4 py-3 text-sm font-semibold ${
      ativo ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
    }`;

  return (
    <form
      className="mt-4 space-y-5 rounded-xl border border-slate-200 bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      {filiais.length > 1 && (
        <label className="block">
          <span className={labelCls}>Casa que pagou</span>
          <select
            className={inputCls}
            value={filialId}
            onChange={(e) => router.push(`/financeiro/recibo?filialId=${e.target.value}`)}
          >
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Quem recebeu</legend>
        <label className="block sm:col-span-2">
          <span className={labelCls}>Nome completo</span>
          <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </label>
        <label className="block">
          <span className={labelCls}>CPF ou CNPJ</span>
          <input
            className={inputCls}
            inputMode="numeric"
            value={documento}
            onChange={(e) => setDocumento(mascaraDoc(e.target.value))}
            placeholder="000.000.000-00"
          />
        </label>
        <label className="block">
          <span className={labelCls}>WhatsApp (opcional, pra enviar o recibo)</span>
          <input
            className={inputCls}
            inputMode="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="79 9 9999-9999"
          />
        </label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold text-slate-900">O pagamento</legend>
        <label className="block">
          <span className={labelCls}>Valor (R$)</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onBlur={() => {
              const n = parseValorBr(valor);
              if (n != null && n > 0) setValor(formatValorBr(n));
            }}
            placeholder="0,00"
          />
        </label>
        <label className="block">
          <span className={labelCls}>Categoria (opcional)</span>
          <select className={inputCls} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">— sem categoria —</option>
            {categorias.map((p) =>
              p.filhas.length > 0 ? (
                <optgroup key={p.id} label={p.nome}>
                  {p.filhas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </optgroup>
              ) : (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={labelCls}>Referente a</span>
          <input
            className={inputCls}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex.: conserto do freezer, diária de 15/11, frete..."
          />
        </label>
      </fieldset>

      <div>
        <div className="mb-2 text-sm font-semibold text-slate-900">Já foi pago?</div>
        <div className="flex gap-3">
          <button type="button" className={botaoSimNao(pago === true)} onClick={() => setPago(true)}>
            ✓ Sim, já paguei
          </button>
          <button type="button" className={botaoSimNao(pago === false)} onClick={() => setPago(false)}>
            Ainda não
          </button>
        </div>

        {pago === true && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className={labelCls}>Como foi pago?</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {FORMAS_RECIBO.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setForma(f)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
                      forma === f
                        ? 'border-emerald-700 bg-emerald-700 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className={labelCls}>Data do pagamento</span>
              <input
                type="date"
                className={inputCls}
                value={dataPagamento}
                max={hojeBr()}
                onChange={(e) => setDataPagamento(e.target.value)}
              />
            </label>
            <p className="self-end text-xs text-slate-500">
              A conta entra no contas a pagar já baixada, e o recibo sai pra imprimir ou enviar.
            </p>
          </div>
        )}
        {pago === false && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>Pagar até (vencimento)</span>
              <input
                type="date"
                className={inputCls}
                value={dataVencimento}
                onChange={(e) => setDataVencimento(e.target.value)}
              />
            </label>
            <p className="self-end text-xs text-slate-500">
              Entra no contas a pagar em aberto. O recibo sai quando o pagamento for registrado.
            </p>
          </div>
        )}
      </div>

      {erro && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {erro}
          {podeForcar && (
            <button
              type="button"
              className="ml-2 font-semibold underline"
              disabled={salvando}
              onClick={() => void salvar(true)}
            >
              É outro pagamento — lançar assim mesmo
            </button>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={salvando}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {salvando ? 'Salvando…' : pago === false ? 'Lançar no contas a pagar' : 'Fazer recibo'}
      </button>
    </form>
  );
}

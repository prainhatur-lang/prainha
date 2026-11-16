'use client';

// Fazer recibo (16/11/2026): quem recebeu não tem recibo. Dados de quem
// recebeu, valor, a que se refere e a pergunta: já foi pago? Sim → como
// (dinheiro, Pix...) e nasce paga. Não → entra no contas a pagar.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hojeBr } from '@/lib/datas';
import { formatFone, formatValorBr, parseValorBr } from '@/lib/format';
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

function cpfConfere(c: string): boolean {
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const [len, pos] of [[9, 10], [10, 11]] as const) {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(c[i]) * (pos - i);
    if (((soma * 10) % 11) % 10 !== Number(c[len])) return false;
  }
  return true;
}

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
  // Puxa nome e WhatsApp pelo CPF/CNPJ (16/11/2026) — pra não pedir à pessoa.
  const [busca, setBusca] = useState<{ tipo: 'buscando' | 'achou' | 'nada'; texto: string } | null>(null);
  const buscado = useRef('');
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preenchido = useRef({ nome: '', telefone: '' });

  async function puxar(digitos: string) {
    if (buscado.current === digitos) return;
    buscado.current = digitos;
    setBusca({ tipo: 'buscando', texto: 'Buscando os dados…' });
    try {
      const r = await fetch('/api/financeiro/recibo/buscar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId, documento: digitos }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        fonte?: string; nome?: string | null; telefone?: string | null; onde?: string | null; aviso?: string; error?: string;
      };
      if (buscado.current !== digitos) return; // já digitou outro
      if (!r.ok) return setBusca({ tipo: 'nada', texto: d.error ?? 'Não consegui buscar — preencha à mão.' });
      // Só preenche campo vazio ou que a busca anterior preencheu: o que a
      // pessoa digitou não é trocado.
      if (d.nome) {
        setNome((v) => (!v.trim() || v === preenchido.current.nome ? d.nome! : v));
        preenchido.current.nome = d.nome;
      }
      if (d.telefone) {
        const fone = formatFone(d.telefone);
        setTelefone((v) => (!v.trim() || v === preenchido.current.telefone ? fone : v));
        preenchido.current.telefone = fone;
      }
      if (!d.nome) return setBusca({ tipo: 'nada', texto: d.aviso ? `${d.aviso} — preencha o nome à mão.` : 'Não achei esse documento — preencha o nome.' });
      const de =
        d.fonte === 'fornecedor' ? `no cadastro de fornecedores${d.onde ? ` (${d.onde})` : ''}`
        : d.fonte === 'cliente' ? 'no cadastro de clientes'
        : d.fonte === 'receita' ? 'na Receita'
        : 'no SPC';
      setBusca({ tipo: 'achou', texto: `✓ Achei ${de}${d.telefone ? '' : ' — sem telefone'}. Confira antes de salvar.` });
    } catch {
      if (buscado.current === digitos) setBusca({ tipo: 'nada', texto: 'Não consegui buscar — preencha à mão.' });
    }
  }

  function mudarDocumento(v: string) {
    const m = mascaraDoc(v);
    setDocumento(m);
    const d = m.replace(/\D/g, '');
    // CPF busca ao completar 11; CNPJ ao completar 14. Um CNPJ em digitação
    // passa pelos 11 dígitos, mas aí o dígito verificador de CPF quase nunca
    // fecha e a rota recusa sem gastar nada.
    // Nos 11 espera um instante: quem está digitando um CNPJ segue adiante e
    // não gasta consulta de CPF à toa.
    if (espera.current) clearTimeout(espera.current);
    if (d.length === 14) void puxar(d);
    else if (d.length === 11 && cpfConfere(d)) espera.current = setTimeout(() => void puxar(d), 900);
    else if (d.length < 11) {
      buscado.current = '';
      setBusca(null);
    }
  }

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
          <span className={labelCls}>CPF ou CNPJ — os dados vêm sozinhos</span>
          <input
            className={inputCls}
            inputMode="numeric"
            value={documento}
            onChange={(e) => mudarDocumento(e.target.value)}
            placeholder="000.000.000-00"
            autoFocus
          />
          {busca && (
            <span
              className={`mt-1 block text-xs ${
                busca.tipo === 'achou' ? 'text-emerald-700' : busca.tipo === 'nada' ? 'text-amber-700' : 'text-slate-500'
              }`}
            >
              {busca.texto}
            </span>
          )}
        </label>
        <label className="block">
          <span className={labelCls}>Nome completo</span>
          <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} />
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

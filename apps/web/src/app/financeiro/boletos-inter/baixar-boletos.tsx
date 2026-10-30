'use client';

// Baixa em Contas a pagar o boleto que o Inter já pagou. Usa a mesma rota da
// tela da conta (POST /api/financeiro/contas/[id]/baixas): data = dia em que o
// banco pagou, valor = saldo da conta, juros = o que o banco pagou a mais.
//  - sem `lote`: botão da linha;
//  - com `lote`: botão do topo, que baixa de uma vez as linhas conferidas.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface BoletoBaixa {
  contaId: string;
  data: string;
  valor: number;
  juros: number;
  observacao: string;
  rotulo: string;
}

async function baixar(b: BoletoBaixa): Promise<string | null> {
  try {
    const r = await fetch(`/api/financeiro/contas/${b.contaId}/baixas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        data: b.data,
        valor: b.valor,
        juros: b.juros > 0 ? b.juros : undefined,
        observacao: b.observacao,
      }),
    });
    if (r.ok) return null;
    return (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
  } catch (e) {
    return (e as Error).message;
  }
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function BaixarBoleto({ boleto }: { boleto: BoletoBaixa }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function clicar() {
    const juros = boleto.juros > 0 ? ` + ${brl(boleto.juros)} de juros` : '';
    if (!confirm(`Baixar ${boleto.rotulo}?\n${brl(boleto.valor)}${juros}, pago em ${boleto.data.split('-').reverse().join('/')}.`))
      return;
    setOcupado(true);
    setErro(null);
    const e = await baixar(boleto);
    setOcupado(false);
    if (e) setErro(e);
    else router.refresh();
  }

  return (
    <span className="ml-2 inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={clicar}
        disabled={ocupado}
        className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {ocupado ? 'Baixando…' : 'Baixar'}
      </button>
      {erro && <span className="text-[10px] text-rose-700">{erro}</span>}
    </span>
  );
}

export function BaixarBoletosLote({ boletos }: { boletos: BoletoBaixa[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [feitos, setFeitos] = useState(0);
  const [falhas, setFalhas] = useState<string[]>([]);

  if (boletos.length === 0) return null;
  const total = boletos.reduce((s, b) => s + b.valor + b.juros, 0);

  async function clicar() {
    if (
      !confirm(
        `Baixar ${boletos.length} ${boletos.length === 1 ? 'conta' : 'contas'} em Contas a pagar (${brl(total)}), cada uma com a data em que o Inter pagou?`,
      )
    )
      return;
    setOcupado(true);
    setFeitos(0);
    const erros: string[] = [];
    for (const b of boletos) {
      const e = await baixar(b);
      if (e) erros.push(`${b.rotulo}: ${e}`);
      setFeitos((n) => n + 1);
    }
    setFalhas(erros);
    setOcupado(false);
    router.refresh();
  }

  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={clicar}
          disabled={ocupado}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {ocupado
            ? `Baixando ${feitos}/${boletos.length}…`
            : `Baixar ${boletos.length === 1 ? 'a conta em aberto' : `as ${boletos.length} em aberto`} (${brl(total)})`}
        </button>
        <p className="text-xs text-amber-900">
          Marca como paga em Contas a pagar, com a data e os juros que o Inter pagou. Dá pra
          estornar depois na tela da conta.
        </p>
      </div>
      {falhas.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-rose-800">
          {falhas.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Boleto pago no Inter sem conta e sem nota em lugar nenhum (CRBS 434,02 da
// Tabuará, 30/10/2026): lança a conta do fornecedor com o valor e o vencimento
// do boleto e já dá a baixa — o texto da baixa cita o código do Inter, então
// o boleto fica casado com ela (passada 0). Se a NF-e aparecer depois, a
// trava de conta em dobro da tela da nota avisa.
export interface BoletoSemConta {
  filialId: string;
  fornecedorId: string;
  fornecedorNome: string;
  valor: number;
  juros: number;
  vencimento: string;
  data: string;
  codigo: string;
  codigoBarras: string | null;
}

export function LancarContaBoleto({ boleto }: { boleto: BoletoSemConta }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const dm = (ymd: string) => ymd.split('-').reverse().join('/');

  async function criar(forcar: boolean, forcarDuplicada: boolean): Promise<string | null> {
    const r = await fetch('/api/financeiro/contas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filialId: boleto.filialId,
        fornecedorId: boleto.fornecedorId,
        descricao: `Boleto ${boleto.fornecedorNome} pago no Inter (sem NF-e)`,
        valor: boleto.valor,
        dataVencimento: boleto.vencimento,
        observacao: `Lançada pela tela Boletos pagos no Inter — transação ${boleto.codigo}${boleto.codigoBarras ? `, código de barras ${boleto.codigoBarras}` : ''}`,
        forcar,
        forcarDuplicada,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j.id as string;
    if (r.status === 409 && (j.casaErrada || j.podeForcar)) {
      if (!confirm(`${j.error}\n\nLançar mesmo assim?`)) throw new Error('cancelado');
      return criar(forcar || !!j.casaErrada, forcarDuplicada || !!j.podeForcar);
    }
    throw new Error(j.error ?? `HTTP ${r.status}`);
  }

  async function clicar() {
    const juros = boleto.juros > 0 ? ` + ${brl(boleto.juros)} de juros` : '';
    if (
      !confirm(
        `Nenhuma conta e nenhuma nota de ${boleto.fornecedorNome} batem com este boleto.\n\nLançar conta de ${brl(boleto.valor)} (venc. ${dm(boleto.vencimento)}) e já baixar como paga em ${dm(boleto.data)}${juros}?\n\nSe a NF-e chegar depois, NÃO lance outra conta pra ela.`,
      )
    )
      return;
    setOcupado(true);
    setErro(null);
    try {
      const id = await criar(false, false);
      if (!id) throw new Error('conta não criada');
      const e = await baixar({
        contaId: id,
        data: boleto.data,
        valor: boleto.valor,
        juros: boleto.juros,
        observacao: `Boleto pago no Inter (${boleto.codigo})`,
        rotulo: boleto.fornecedorNome,
      });
      if (e) throw new Error(`conta lançada, mas a baixa falhou: ${e}`);
      router.refresh();
    } catch (e) {
      const m = (e as Error).message;
      if (m !== 'cancelado') setErro(m);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <span className="mt-1 inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={clicar}
        disabled={ocupado}
        title="Lança a conta deste fornecedor com o valor do boleto e já baixa com a data e os juros que o Inter pagou"
        className="rounded-md bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {ocupado ? 'Lançando…' : 'Lançar conta e baixar'}
      </button>
      {erro && <span className="text-[10px] text-rose-700">{erro}</span>}
    </span>
  );
}

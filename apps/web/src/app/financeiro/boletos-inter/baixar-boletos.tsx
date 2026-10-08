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

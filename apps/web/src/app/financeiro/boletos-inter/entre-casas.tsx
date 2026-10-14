'use client';

// Boleto lançado numa casa e pago pelo Inter desta: lança no encontro de
// contas do mês do pagamento (a casa da conta fica devendo pra esta). A conta
// continua na casa dela e é baixada lá, como sempre.
//  - LancarEncontro: botão da linha;
//  - LancarEncontroLote: botão da faixa roxa, lança todos de uma vez;
//  - DesfazerEncontro: tira de volta enquanto o encontro do mês não fechou.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface BoletoEncontro {
  codigo: string;
  contaId: string;
  valor: number;
  rotulo: string;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function lancar(
  filialId: string,
  dataIni: string,
  dataFim: string,
  boletos: BoletoEncontro[],
): Promise<{ lancados: number; erros: string[] }> {
  try {
    const r = await fetch('/api/financeiro/boletos-inter/entre-casas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filialId,
        dataIni,
        dataFim,
        itens: boletos.map((b) => ({ codigo: b.codigo, contaId: b.contaId })),
      }),
    });
    const j = await r.json().catch(() => ({}));
    const rotulo = new Map(boletos.map((b) => [b.codigo, b.rotulo]));
    const erros = ((j.recusados ?? []) as Array<{ codigo: string; motivo: string }>).map(
      (x) => `${rotulo.get(x.codigo) ?? x.codigo}: ${x.motivo}`,
    );
    if (!r.ok && !erros.length) erros.push(j.error ?? `HTTP ${r.status}`);
    return { lancados: (j.lancados ?? []).length, erros };
  } catch (e) {
    return { lancados: 0, erros: [(e as Error).message] };
  }
}

export function LancarEncontro({
  filialId,
  dataIni,
  dataFim,
  boleto,
  casaDaConta,
}: {
  filialId: string;
  dataIni: string;
  dataFim: string;
  boleto: BoletoEncontro;
  casaDaConta: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function clicar() {
    if (
      !confirm(
        `Lançar ${boleto.rotulo} (${brl(boleto.valor)}) no encontro de contas?\nA ${casaDaConta} fica devendo esse valor pra esta casa no mês do pagamento.`,
      )
    )
      return;
    setOcupado(true);
    setErro(null);
    const r = await lancar(filialId, dataIni, dataFim, [boleto]);
    setOcupado(false);
    if (r.erros.length) setErro(r.erros.join('; '));
    else router.refresh();
  }

  return (
    <span className="ml-2 inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={clicar}
        disabled={ocupado}
        className="rounded-md bg-violet-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-violet-800 disabled:opacity-50"
      >
        {ocupado ? 'Lançando…' : '⚖️ Lançar no encontro'}
      </button>
      {erro && <span className="text-[10px] text-rose-700">{erro}</span>}
    </span>
  );
}

export function LancarEncontroLote({
  filialId,
  dataIni,
  dataFim,
  boletos,
}: {
  filialId: string;
  dataIni: string;
  dataFim: string;
  boletos: BoletoEncontro[];
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [falhas, setFalhas] = useState<string[]>([]);

  if (boletos.length === 0) return null;
  const total = boletos.reduce((s, b) => s + b.valor, 0);

  async function clicar() {
    if (
      !confirm(
        `Lançar ${boletos.length} ${boletos.length === 1 ? 'boleto' : 'boletos'} (${brl(total)}) no encontro de contas?\nCada casa dona da conta fica devendo pra esta, no mês em que o Inter pagou.`,
      )
    )
      return;
    setOcupado(true);
    const r = await lancar(filialId, dataIni, dataFim, boletos);
    setFalhas(r.erros);
    setOcupado(false);
    router.refresh();
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={clicar}
        disabled={ocupado}
        className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-50"
      >
        {ocupado
          ? 'Lançando…'
          : `⚖️ Lançar ${boletos.length === 1 ? 'o boleto' : `os ${boletos.length}`} no encontro de contas (${brl(total)})`}
      </button>
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

export function DesfazerEncontro({ id, rotulo }: { id: string; rotulo: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function clicar() {
    if (!confirm(`Tirar ${rotulo} do encontro de contas?`)) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch('/api/financeiro/boletos-inter/entre-casas', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (r.ok) router.refresh();
      else setErro((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  }

  return (
    <span className="ml-1 inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={clicar}
        disabled={ocupado}
        className="text-[10px] text-slate-500 underline hover:text-slate-800 disabled:opacity-50"
      >
        {ocupado ? 'desfazendo…' : 'desfazer'}
      </button>
      {erro && <span className="text-[10px] text-rose-700">{erro}</span>}
    </span>
  );
}

'use client';

// Baixa de conta a pagar pelo Pix do extrato do Inter:
//  - BaixarPix: botão da linha (Pix casado, ou "mesmo valor" escolhido à mão);
//  - BaixarPixLote: baixa todos os casados de uma vez;
//  - DesfazerPix: tira a baixa (e o encontro de contas, se era de outra casa).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PixBaixa {
  pixId: string;
  contaId: string;
  valor: number;
  rotulo: string;
  /** casa da conta quando não é a casa que pagou (vai pro encontro de contas) */
  outraCasa: string | null;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function baixar(itens: PixBaixa[]): Promise<{ baixados: number; erros: string[] }> {
  try {
    const r = await fetch('/api/financeiro/pix-inter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itens: itens.map((i) => ({ pixId: i.pixId, contaId: i.contaId })) }),
    });
    const j = await r.json().catch(() => ({}));
    const rotulo = new Map(itens.map((i) => [i.pixId, i.rotulo]));
    const erros = ((j.recusados ?? []) as Array<{ pixId: string; motivo: string }>).map(
      (x) => `${rotulo.get(x.pixId) ?? x.pixId}: ${x.motivo}`,
    );
    if (!r.ok && !erros.length) erros.push(j.error ?? `HTTP ${r.status}`);
    return { baixados: (j.baixados ?? []).length, erros };
  } catch (e) {
    return { baixados: 0, erros: [(e as Error).message] };
  }
}

export function BaixarPix({ item, aviso, texto }: { item: PixBaixa; aviso?: string; texto?: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function clicar() {
    const linhas = [`Baixar ${item.rotulo} (${brl(item.valor)}) com este Pix?`];
    if (aviso) linhas.push(aviso);
    if (item.outraCasa) {
      linhas.push(`A conta é da ${item.outraCasa}: ela fica devendo esse valor pra esta casa no encontro de contas.`);
    }
    if (!confirm(linhas.join('\n'))) return;
    setOcupado(true);
    setErro(null);
    const r = await baixar([item]);
    setOcupado(false);
    if (r.erros.length) setErro(r.erros.join('; '));
    else router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={clicar}
        disabled={ocupado}
        className="rounded-md bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {ocupado ? 'Baixando…' : (texto ?? 'Baixar')}
      </button>
      {erro && <span className="text-[10px] text-rose-700">{erro}</span>}
    </span>
  );
}

export function BaixarPixLote({ itens }: { itens: PixBaixa[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [falhas, setFalhas] = useState<string[]>([]);

  if (itens.length === 0) return null;
  const total = itens.reduce((s, i) => s + i.valor, 0);
  const deFora = itens.filter((i) => i.outraCasa).length;

  async function clicar() {
    const linhas = [
      `Baixar ${itens.length} ${itens.length === 1 ? 'conta' : 'contas'} (${brl(total)}) com os Pix do extrato?`,
    ];
    if (deFora > 0) {
      linhas.push(`${deFora} ${deFora === 1 ? 'é' : 'são'} de outra casa e ${deFora === 1 ? 'entra' : 'entram'} também no encontro de contas.`);
    }
    if (!confirm(linhas.join('\n'))) return;
    setOcupado(true);
    const r = await baixar(itens);
    setFalhas(r.erros);
    setOcupado(false);
    router.refresh();
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={clicar}
        disabled={ocupado}
        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {ocupado
          ? 'Baixando…'
          : `✓ Baixar ${itens.length === 1 ? 'a conta' : `as ${itens.length} contas`} pelos Pix (${brl(total)})`}
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

export function DesfazerPix({ pixId, rotulo }: { pixId: string; rotulo: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function clicar() {
    if (!confirm(`Desfazer a baixa de ${rotulo}? A conta volta a ficar em aberto.`)) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch('/api/financeiro/pix-inter', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pixId }),
      });
      if (r.ok) router.refresh();
      else setErro((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  }

  return (
    <span className="ml-1.5 inline-flex items-center gap-1.5">
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

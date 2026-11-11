'use client';

// Formulários da tela de empréstimos (mútuo): lançar e cancelar. Só o Admin vê.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function chamar(body: Record<string, unknown>): Promise<{ numero?: number }> {
  const r = await fetch('/api/financeiro/mutuos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string; numero?: number };
  if (!r.ok) throw new Error(j.error || `erro ${r.status}`);
  return j;
}

const valorBr = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));
const campo = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

type E = { id: string; nome: string };

export function NovoMutuo({ empresas, hoje, devolucaoPadrao }: { empresas: E[]; hoje: string; devolucaoPadrao: string }) {
  const router = useRouter();
  const [credoraId, setCredoraId] = useState('');
  const [devedoraId, setDevedoraId] = useState('');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(hoje);
  const [dataDevolucao, setDataDevolucao] = useState(devolucaoPadrao);
  const [observacao, setObservacao] = useState('');
  const [jaSaiu, setJaSaiu] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ruim: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    const v = valorBr(valor);
    if (!credoraId || !devedoraId) return setMsg({ t: 'escolha quem empresta e quem recebe', ruim: true });
    if (!(v > 0)) return setMsg({ t: 'digite o valor', ruim: true });
    const de = empresas.find((e) => e.id === credoraId)?.nome;
    const para = empresas.find((e) => e.id === devedoraId)?.nome;
    const brl = v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (!window.confirm(`Lançar empréstimo de ${brl}\nde ${de}\npara ${para}?`)) return;
    setOcupado(true);
    setMsg(null);
    try {
      const j = await chamar({ acao: 'criar', credoraId, devedoraId, valor: v, data, dataDevolucao, observacao, jaSaiu });
      setValor('');
      setObservacao('');
      setMsg({ t: `✓ empréstimo nº ${j.numero ?? ''} lançado`, ruim: false });
      router.refresh();
    } catch (e) {
      setMsg({ t: (e as Error).message, ruim: true });
    } finally {
      setOcupado(false);
    }
  }

  const sel = (v: string, set: (x: string) => void, rot: string, fora: string) => (
    <label className="block text-xs text-slate-500">
      {rot}
      <select className={campo} value={v} onChange={(e) => set(e.target.value)}>
        <option value="">— escolha —</option>
        {empresas
          .filter((e) => e.id !== fora)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
      </select>
    </label>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Novo empréstimo</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sel(credoraId, setCredoraId, 'Quem empresta (de onde sai o dinheiro)', devedoraId)}
        {sel(devedoraId, setDevedoraId, 'Quem recebe (e devolve depois)', credoraId)}
        <label className="block text-xs text-slate-500">
          Valor (R$)
          <input className={campo} inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
        <label className="block text-xs text-slate-500">
          Data do empréstimo
          <input type="date" className={campo} value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <label className="block text-xs text-slate-500">
          Devolver até
          <input type="date" className={campo} value={dataDevolucao} onChange={(e) => setDataDevolucao(e.target.value)} />
        </label>
        <label className="block text-xs text-slate-500">
          Observação (pra quê)
          <input className={campo} placeholder="ex.: cobrir fornecedores da semana" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </label>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={jaSaiu} onChange={(e) => setJaSaiu(e.target.checked)} />
        <span>
          O dinheiro já foi transferido
          <span className="block text-xs text-slate-500">
            Marcado: a saída já entra como paga nessa data. Desmarcado: fica uma conta a pagar em quem empresta, pra pagar por
            Pix/transferência.
          </span>
        </span>
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={salvar}
          disabled={ocupado}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {ocupado ? 'Lançando…' : 'Lançar empréstimo'}
        </button>
        {msg && <span className={`text-sm ${msg.ruim ? 'text-red-700' : 'text-emerald-700'}`}>{msg.t}</span>}
      </div>
    </div>
  );
}

export function CancelarMutuo({ mutuoId, numero }: { mutuoId: string; numero: number }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  async function cancelar() {
    const motivo = window.prompt(`Cancelar o empréstimo nº ${numero}? Diga o motivo:`);
    if (!motivo || motivo.trim().length < 3) return;
    setOcupado(true);
    try {
      await chamar({ acao: 'cancelar', mutuoId, motivo });
      router.refresh();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <button onClick={cancelar} disabled={ocupado} className="text-red-700 hover:underline disabled:opacity-50">
      {ocupado ? 'cancelando…' : 'cancelar'}
    </button>
  );
}

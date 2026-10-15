'use client';

// Formulários da tela de portadores: lançar movimento, cadastrar/desativar
// portador e as ações da linha (atribuir sangria sem portador, excluir).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function chamar(body: Record<string, unknown>): Promise<void> {
  const r = await fetch('/api/financeiro/portadores', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(j.error || `erro ${r.status}`);
}

const valorBr = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));

type P = { id: string; nome: string };

const TIPOS = [
  { v: 'ENTREGA', l: 'Entregar a outro portador' },
  { v: 'DEPOSITO', l: 'Depósito no banco' },
  { v: 'PAGAMENTO', l: 'Pagamento em dinheiro' },
  { v: 'ENTRADA', l: 'Entrada (dinheiro de fora)' },
  { v: 'AJUSTE', l: 'Ajuste / saldo inicial' },
];

const campo = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

export function LancarMovimento({ filialId, portadores, hoje }: { filialId: string; portadores: P[]; hoje: string }) {
  const router = useRouter();
  const [tipo, setTipo] = useState('ENTREGA');
  const [de, setDe] = useState('');
  const [para, setPara] = useState('');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(hoje);
  const [descricao, setDescricao] = useState('');
  const [msg, setMsg] = useState<{ t: string; ruim: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const usaDe = tipo !== 'ENTRADA';
  const usaPara = tipo === 'ENTREGA' || tipo === 'ENTRADA';

  async function salvar() {
    setOcupado(true);
    setMsg(null);
    try {
      await chamar({ acao: 'lancar', filialId, tipo, de: usaDe ? de : undefined, para: usaPara ? para : undefined, valor: valorBr(valor), data, descricao });
      setValor('');
      setDescricao('');
      setMsg({ t: '✓ lançado', ruim: false });
      router.refresh();
    } catch (e) {
      setMsg({ t: (e as Error).message, ruim: true });
    } finally {
      setOcupado(false);
    }
  }

  const sel = (v: string, set: (x: string) => void, rot: string) => (
    <label className="block text-xs text-slate-500">
      {rot}
      <select className={campo} value={v} onChange={(e) => set(e.target.value)}>
        <option value="">— escolha —</option>
        {portadores.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Lançar</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-slate-500 sm:col-span-2">
          O que aconteceu
          <select className={campo} value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS.map((t) => (
              <option key={t.v} value={t.v}>
                {t.l}
              </option>
            ))}
          </select>
        </label>
        {usaDe && sel(de, setDe, tipo === 'AJUSTE' ? 'Portador' : 'Saiu de')}
        {usaPara && sel(para, setPara, tipo === 'ENTREGA' ? 'Pra quem' : 'Quem recebeu')}
        <label className="block text-xs text-slate-500">
          Valor (R$){tipo === 'AJUSTE' && ' — negativo tira'}
          <input className={campo} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
        </label>
        <label className="block text-xs text-slate-500">
          Data
          <input type="date" className={campo} value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <label className="block text-xs text-slate-500 sm:col-span-2">
          Descrição{tipo === 'PAGAMENTO' || tipo === 'ENTRADA' ? ' (obrigatória)' : ''}
          <input className={campo} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void salvar()}
          disabled={ocupado}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {ocupado ? 'salvando…' : 'Lançar'}
        </button>
        {msg && <span className={`text-sm ${msg.ruim ? 'text-red-600' : 'text-emerald-700'}`}>{msg.t}</span>}
      </div>
    </div>
  );
}

export function CadastroPortadores({
  filialId,
  portadores,
}: {
  filialId: string;
  portadores: Array<{ id: string; nome: string; tipo: string; ativo: boolean }>;
}) {
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('PESSOA');
  const [erro, setErro] = useState('');

  async function fazer(body: Record<string, unknown>) {
    setErro('');
    try {
      await chamar({ filialId, ...body });
      setNome('');
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Portadores desta casa</h2>
      <ul className="mb-3 space-y-1 text-sm">
        {portadores.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2">
            <span className={p.ativo ? 'text-slate-700' : 'text-slate-400 line-through'}>
              {p.tipo === 'COFRE' ? '🔒 ' : '👤 '}
              {p.nome}
            </span>
            <button
              onClick={() => void fazer({ acao: 'ativo', portadorId: p.id, ativo: !p.ativo })}
              className="text-xs text-slate-500 underline"
            >
              {p.ativo ? 'desativar' : 'reativar'}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className={campo} placeholder="novo portador" value={nome} onChange={(e) => setNome(e.target.value)} />
        <select className="rounded-lg border border-slate-300 px-2 text-sm" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="PESSOA">Pessoa</option>
          <option value="COFRE">Cofre</option>
        </select>
        <button
          onClick={() => void fazer({ acao: 'cadastrar', nome, tipo })}
          className="rounded-lg bg-slate-900 px-3 text-sm font-medium text-white"
        >
          +
        </button>
      </div>
      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
    </div>
  );
}

export function AcoesMovimento({
  filialId,
  movimentoId,
  semPortador,
  ehSangria,
  portadores,
}: {
  filialId: string;
  movimentoId: string;
  semPortador: boolean;
  ehSangria: boolean;
  portadores: P[];
}) {
  const router = useRouter();
  const [erro, setErro] = useState('');
  async function fazer(body: Record<string, unknown>) {
    setErro('');
    try {
      await chamar({ filialId, movimentoId, ...body });
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      {semPortador && (
        <select
          className="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-xs"
          defaultValue=""
          onChange={(e) => e.target.value && void fazer({ acao: 'atribuir', portadorId: e.target.value })}
        >
          <option value="">atribuir a…</option>
          {portadores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      )}
      {!ehSangria && (
        <button
          onClick={() => confirm('Excluir este lançamento?') && void fazer({ acao: 'excluir' })}
          className="text-xs text-slate-400 hover:text-red-600"
          title="excluir"
        >
          ✕
        </button>
      )}
      {erro && <span className="text-xs text-red-600">{erro}</span>}
    </span>
  );
}

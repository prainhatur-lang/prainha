'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Item = {
  id: string;
  nome: string;
  telefone: string | null;
  pessoas: number;
  status: string;
  area: string | null;
  observacao: string | null;
  criadoEm: string;
  chamadoEm: string | null;
};

type Filial = { id: string; nome: string };

function minutosDesde(iso: string, agora: number): number {
  const t = new Date(iso.replace(' ', 'T')).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((agora - t) / 60000));
}

function espera(min: number): string {
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `há ${h}h${m ? ` ${m}min` : ''}`;
}

export function ListaEsperaClient({
  filialId,
  filialNome,
  filiais,
  itens,
  whatsappOn,
}: {
  filialId: string;
  filialNome: string;
  filiais: Filial[];
  itens: Item[];
  whatsappOn: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [pessoas, setPessoas] = useState(2);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => 0);

  // Tick do tempo de espera (não roda no SSR pra não dar hydration mismatch).
  useEffect(() => {
    setAgora(Date.now());
    const id = setInterval(() => setAgora(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setMsg(null);
    if (!nome.trim()) {
      setErro('Informe o nome do cliente.');
      return;
    }
    const r = await fetch('/api/lista-espera', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filialId, nome, telefone, pessoas }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErro(d.error ?? `Erro ${r.status}`);
      return;
    }
    setNome('');
    setTelefone('');
    setPessoas(2);
    setMsg('Adicionado à espera.');
    start(() => router.refresh());
  }

  async function acao(id: string, tipo: 'chamar' | 'sentou' | 'desistiu') {
    setErro(null);
    setMsg(null);
    const r = await fetch(`/api/lista-espera/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: tipo }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(d.error ?? `Erro ${r.status}`);
      return;
    }
    if (tipo === 'chamar') {
      const z =
        d.zap === 'enviado'
          ? 'Cliente avisado no WhatsApp ✅'
          : d.zap === 'sem telefone'
            ? 'Chamado (sem telefone — avise na recepção).'
            : `Chamado. WhatsApp: ${d.zap ?? '—'}`;
      setMsg(z);
    } else {
      setMsg(tipo === 'sentou' ? 'Marcado como sentado.' : 'Removido da espera.');
    }
    start(() => router.refresh());
  }

  const totalPessoas = itens.reduce((s, i) => s + i.pessoas, 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Lista de espera</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          {filialNome} · {itens.length} grupo(s) · {totalPessoas} pessoa(s) na fila
        </p>
        {filiais.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/lista-espera?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === filialId
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}
        {!whatsappOn && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
            WhatsApp de espera não configurado — ao chamar, avise o cliente na recepção. (falta WHATSAPP_ESPERA_TEMPLATE)
          </p>
        )}
      </div>

      {/* Adicionar à espera */}
      <form
        onSubmit={adicionar}
        className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_180px_110px_auto] sm:items-end"
      >
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Nome do cliente</span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">WhatsApp</span>
          <input
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="(00) 00000-0000"
            inputMode="tel"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Pessoas</span>
          <input
            type="number"
            min={1}
            max={999}
            value={pessoas}
            onChange={(e) => setPessoas(Math.max(1, Number(e.target.value) || 1))}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Adicionar
        </button>
      </form>

      {erro && <p className="mb-3 text-sm text-rose-600">{erro}</p>}
      {msg && <p className="mb-3 text-sm text-emerald-700">{msg}</p>}

      {/* Fila */}
      {itens.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">Ninguém na espera agora.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {itens.map((i, idx) => {
            const min = minutosDesde(i.criadoEm, agora);
            const chamado = i.status === 'chamado';
            return (
              <li
                key={i.id}
                className={`flex flex-wrap items-center gap-3 rounded-xl border bg-white p-3 ${
                  chamado ? 'border-sky-300 bg-sky-50/40' : 'border-slate-200'
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-900">{i.nome}</span>
                    {chamado && (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
                        Chamado
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    👥 {i.pessoas} pessoa(s) · ⏱ {agora ? espera(min) : '—'}
                    {i.telefone ? '' : ' · sem telefone'}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {!chamado && (
                    <button
                      onClick={() => acao(i.id, 'chamar')}
                      disabled={pending}
                      className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                      title="Mesa pronta — avisar o cliente"
                    >
                      📲 Chamar
                    </button>
                  )}
                  {chamado && (
                    <button
                      onClick={() => acao(i.id, 'chamar')}
                      disabled={pending}
                      className="rounded-md border border-sky-300 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                    >
                      Chamar de novo
                    </button>
                  )}
                  <button
                    onClick={() => acao(i.id, 'sentou')}
                    disabled={pending}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Sentou
                  </button>
                  <button
                    onClick={() => acao(i.id, 'desistiu')}
                    disabled={pending}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Desistiu
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

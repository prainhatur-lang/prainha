'use client';

import { useState, useTransition, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { maskCnpj } from '@/lib/format';

interface FornecedorOpcao {
  id: string;
  nome: string;
  cnpjOuCpf: string | null;
}

export function VincularFornecedorBtn({
  notaId,
  filialId,
  fornecedoresDisponiveis,
  emitCnpj,
  emitNome,
  emitUf,
  emitCidade,
}: {
  notaId: string;
  filialId: string;
  fornecedoresDisponiveis: FornecedorOpcao[];
  emitCnpj: string | null;
  emitNome: string | null;
  emitUf: string | null;
  emitCidade: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<'buscar' | 'criar'>('buscar');
  const [busca, setBusca] = useState('');
  const [pending, start] = useTransition();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Form criar
  const [nomeForm, setNomeForm] = useState(emitNome ?? '');
  const [cnpjForm, setCnpjForm] = useState(emitCnpj ?? '');
  const [ufForm, setUfForm] = useState(emitUf ?? '');
  const [cidadeForm, setCidadeForm] = useState(emitCidade ?? '');

  const opcoes = useMemo(() => {
    const b = busca.trim().toLowerCase();
    if (!b) return fornecedoresDisponiveis.slice(0, 30);
    return fornecedoresDisponiveis
      .filter((f) => {
        const nome = f.nome.toLowerCase();
        const cnpj = (f.cnpjOuCpf ?? '').toLowerCase();
        return nome.includes(b) || cnpj.includes(b.replace(/\D/g, ''));
      })
      .slice(0, 50);
  }, [busca, fornecedoresDisponiveis]);

  async function vincular(fornecedorId: string) {
    flushSync(() => {
      setSalvando(true);
      setErro(null);
    });
    try {
      const r = await fetch(`/api/nota-compra/${notaId}/fornecedor`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fornecedorId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setAberto(false);
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function criarEVincular(e: React.FormEvent) {
    e.preventDefault();
    flushSync(() => {
      setSalvando(true);
      setErro(null);
    });
    try {
      const r = await fetch('/api/fornecedores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId,
          cnpjOuCpf: cnpjForm.replace(/\D/g, ''),
          nome: nomeForm.trim(),
          uf: ufForm || null,
          cidade: cidadeForm || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      // Vincula o recém-criado (ou o existente que voltou)
      await vincular(d.id);
    } catch (err) {
      setErro((err as Error).message);
      setSalvando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg border border-amber-700 bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
      >
        + Vincular fornecedor
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setAberto(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Vincular fornecedor</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Emitente da NFe:{' '}
                <span className="font-medium text-slate-700">{emitNome ?? '—'}</span>
                {emitCnpj && (
                  <span className="ml-1 font-mono text-[10px]">
                    {maskCnpj(emitCnpj)}
                  </span>
                )}
              </p>
            </div>

            <div className="flex gap-1 border-b border-slate-200">
              <button
                type="button"
                onClick={() => setAba('buscar')}
                className={`border-b-2 px-3 py-1.5 text-xs ${
                  aba === 'buscar'
                    ? 'border-slate-900 font-medium text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Buscar existente
              </button>
              <button
                type="button"
                onClick={() => setAba('criar')}
                className={`border-b-2 px-3 py-1.5 text-xs ${
                  aba === 'criar'
                    ? 'border-slate-900 font-medium text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Criar com dados da NFe
              </button>
            </div>

            {aba === 'buscar' ? (
              <>
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  autoFocus
                  placeholder="Buscar por nome ou CNPJ..."
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
                <div className="max-h-72 overflow-y-auto rounded-md border border-slate-200">
                  {opcoes.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-slate-500">
                      Nenhum fornecedor. Use a aba "Criar com dados da NFe".
                    </div>
                  ) : (
                    opcoes.map((f) => (
                      <button
                        type="button"
                        key={f.id}
                        disabled={salvando || pending}
                        onClick={() => vincular(f.id)}
                        className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <span className="truncate text-slate-800">{f.nome}</span>
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">
                          {f.cnpjOuCpf ? maskCnpj(f.cnpjOuCpf) : '—'}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : (
              <form onSubmit={criarEVincular} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Nome / Razão Social *
                  </label>
                  <input
                    type="text"
                    value={nomeForm}
                    onChange={(e) => setNomeForm(e.target.value)}
                    required
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    CNPJ *
                  </label>
                  <input
                    type="text"
                    value={cnpjForm}
                    onChange={(e) => setCnpjForm(e.target.value)}
                    required
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Cidade
                    </label>
                    <input
                      type="text"
                      value={cidadeForm}
                      onChange={(e) => setCidadeForm(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div className="w-20">
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      UF
                    </label>
                    <input
                      type="text"
                      value={ufForm}
                      onChange={(e) => setUfForm(e.target.value.toUpperCase().slice(0, 2))}
                      maxLength={2}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm uppercase"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-slate-500">
                  Quando o agente sincronizar do Consumer, vai fazer match por CNPJ
                  e atualizar este registro com o código original.
                </p>
                <button
                  type="submit"
                  disabled={salvando || !nomeForm.trim() || !cnpjForm.trim()}
                  className="w-full rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {salvando ? 'Criando...' : 'Criar e vincular'}
                </button>
              </form>
            )}

            {erro && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {erro}
              </div>
            )}

            <div className="flex justify-end border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

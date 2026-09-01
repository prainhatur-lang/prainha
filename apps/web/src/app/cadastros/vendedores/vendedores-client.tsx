'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { normalizaBusca } from '@/lib/texto';

export interface FornecedorOpt {
  id: string;
  nome: string;
  produtos: number;
}

export interface VendedorLinha {
  id: string;
  nome: string;
  whatsapp: string | null;
  observacao: string | null;
  ativo: boolean;
  fornecedores: Array<{
    id: string;
    nome: string;
    filial: string;
    principal: boolean;
    produtos: number;
  }>;
}

interface Props {
  filialId: string;
  filialNome: string;
  linhas: VendedorLinha[];
  semVendedor: FornecedorOpt[];
}

function zapBonito(v: string | null): string {
  if (!v) return '';
  const d = v.replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v;
}

export function VendedoresClient({ filialId, linhas, semVendedor }: Props) {
  const router = useRouter();
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<{ nome: string; whatsapp: string; observacao: string }>({
    nome: '', whatsapp: '', observacao: '',
  });
  const [novo, setNovo] = useState(false);
  const [pend, setPend] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);

  const filtradas = useMemo(() => {
    const q = normalizaBusca(busca.trim());
    if (!q) return linhas;
    return linhas.filter(
      (l) =>
        normalizaBusca(l.nome).includes(q) ||
        (l.whatsapp ?? '').includes(q.replace(/\D/g, '')) ||
        l.fornecedores.some((f) => normalizaBusca(f.nome).includes(q)),
    );
  }, [linhas, busca]);

  async function chamar(payload: Record<string, unknown>) {
    setPend(true);
    setErro(null);
    try {
      const r = await fetch('/api/vendedores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, ...payload }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErro(d.error ?? 'não deu pra salvar');
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setPend(false);
    }
  }

  const semZap = linhas.filter((l) => !l.whatsapp).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar vendedor, número ou fornecedor..."
          className="min-w-56 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <span className="text-xs text-slate-500">
          {linhas.length} vendedor(es)
          {semZap > 0 && <span className="ml-1 text-amber-700">· {semZap} sem número</span>}
        </span>
        <button
          type="button"
          onClick={() => { setNovo(true); setRascunho({ nome: '', whatsapp: '', observacao: '' }); }}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
        >
          + Novo vendedor
        </button>
      </div>

      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{erro}</p>}

      {novo && (
        <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/60 p-3">
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus
              value={rascunho.nome}
              onChange={(e) => setRascunho((r) => ({ ...r, nome: e.target.value }))}
              placeholder="Nome do vendedor (ex: Alex — Megga)"
              className="min-w-56 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <input
              value={rascunho.whatsapp}
              inputMode="tel"
              onChange={(e) => setRascunho((r) => ({ ...r, whatsapp: e.target.value }))}
              placeholder="(79) 99999-9999"
              className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <input
            value={rascunho.observacao}
            onChange={(e) => setRascunho((r) => ({ ...r, observacao: e.target.value }))}
            placeholder="observação (ex: só bebidas, atende de manhã)"
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <div className="flex gap-1">
            <button
              type="button"
              disabled={pend}
              onClick={async () => {
                if (await chamar({ acao: 'criar', ...rascunho })) setNovo(false);
              }}
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:bg-slate-400"
            >
              salvar
            </button>
            <button
              type="button"
              onClick={() => setNovo(false)}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600"
            >
              cancelar
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Vendedor</th>
              <th className="px-3 py-2 text-left font-medium">WhatsApp</th>
              <th className="px-3 py-2 text-left font-medium">Atende</th>
              <th className="px-3 py-2 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((v) => {
              const emEdicao = editando === v.id;
              return (
                <tr key={v.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={rascunho.nome}
                        onChange={(e) => setRascunho((r) => ({ ...r, nome: e.target.value }))}
                        className="w-full rounded border border-slate-300 px-1.5 py-1"
                      />
                    ) : (
                      <>
                        <div className="font-medium text-slate-900">{v.nome}</div>
                        {v.observacao && (
                          <div className="text-[10px] text-slate-500">{v.observacao}</div>
                        )}
                      </>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={rascunho.whatsapp}
                        inputMode="tel"
                        onChange={(e) => setRascunho((r) => ({ ...r, whatsapp: e.target.value }))}
                        placeholder="(79) 99999-9999"
                        className="w-36 rounded border border-slate-300 px-1.5 py-1"
                      />
                    ) : v.whatsapp ? (
                      <a
                        href={`https://wa.me/${v.whatsapp}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-emerald-700 hover:underline"
                      >
                        {zapBonito(v.whatsapp)}
                      </a>
                    ) : (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">
                        sem número
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {v.fornecedores.slice(0, abrindo === v.id ? 999 : 4).map((f) => (
                        <span
                          key={f.id}
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                            f.principal ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-600'
                          }`}
                          title={`${f.filial}${f.produtos ? ` · ${f.produtos} produtos` : ''}`}
                        >
                          {f.nome.slice(0, 26)}
                          {f.principal && ' ★'}
                          <button
                            type="button"
                            onClick={() => void chamar({ acao: 'desvincular', vendedorId: v.id, fornecedorId: f.id })}
                            className="text-slate-400 hover:text-rose-600"
                            title="tirar este fornecedor do vendedor"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {v.fornecedores.length > 4 && abrindo !== v.id && (
                        <button
                          type="button"
                          onClick={() => setAbrindo(v.id)}
                          className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500 underline"
                        >
                          +{v.fornecedores.length - 4}
                        </button>
                      )}
                      {v.fornecedores.length === 0 && (
                        <span className="text-[10px] text-slate-400">nenhum</span>
                      )}
                    </div>

                    {semVendedor.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            void chamar({ acao: 'vincular', vendedorId: v.id, fornecedorId: e.target.value });
                          }
                        }}
                        className="mt-1 rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-600"
                      >
                        <option value="">+ ligar a um fornecedor…</option>
                        {semVendedor.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.nome} {f.produtos ? `(${f.produtos})` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right">
                    {emEdicao ? (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          disabled={pend}
                          onClick={async () => {
                            if (await chamar({ acao: 'editar', vendedorId: v.id, ...rascunho })) {
                              setEditando(null);
                            }
                          }}
                          className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white"
                        >
                          salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditando(null)}
                          className="rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-600"
                        >
                          cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditando(v.id);
                          setRascunho({
                            nome: v.nome,
                            whatsapp: v.whatsapp ?? '',
                            observacao: v.observacao ?? '',
                          });
                        }}
                        className="text-[11px] text-sky-700 underline"
                      >
                        editar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {semVendedor.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900">
            {semVendedor.length} fornecedor(es) desta loja ainda sem vendedor
          </p>
          <p className="mt-0.5 text-[11px] text-amber-800">
            São os que vão continuar caindo no telefone da empresa (quase sempre fixo). Ligue cada um
            a um vendedor pelo seletor da linha, ou crie o vendedor novo.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {semVendedor.slice(0, 20).map((f) => (
              <span key={f.id} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600">
                {f.nome.slice(0, 28)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

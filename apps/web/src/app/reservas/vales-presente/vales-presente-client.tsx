'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

export interface ValeLinha {
  id: string;
  codigo: string;
  token: string;
  status: string;
  tipo?: string;
  compradorNome: string;
  compradorTelefone: string | null;
  presenteados: string | null;
  mensagem: string | null;
  observacao: string | null;
  dataUso: string | null;
  pessoas: number;
  itens: Array<{ nome: string; tamanho?: string; qtd: number; preco: number }>;
  total: number;
  criadoEm: string | null;
  pagoEm: string | null;
  usadoEm: string | null;
  usadoPor: string | null;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ROTULO: Record<string, { txt: string; cls: string }> = {
  pago: { txt: '✓ Pago — a usar', cls: 'bg-emerald-100 text-emerald-800' },
  aguardando: { txt: 'Aguardando Pix', cls: 'bg-amber-100 text-amber-800' },
  usado: { txt: 'Usado', cls: 'bg-slate-200 text-slate-700' },
  cancelado: { txt: 'Cancelado', cls: 'bg-red-100 text-red-700' },
  reembolsado: { txt: 'Reembolsado', cls: 'bg-red-100 text-red-700' },
};

const FILTROS = [
  { k: 'pago', txt: 'A usar' },
  { k: 'aguardando', txt: 'Aguardando Pix' },
  { k: 'usado', txt: 'Usados' },
  { k: 'todos', txt: 'Todos' },
];

/** Normaliza o que a pessoa digita: "vp 7k3qa", "7K3QA" → "VP-7K3QA". */
function normCodigo(s: string): string {
  const limpo = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return limpo.startsWith('VP') ? limpo.slice(2) : limpo;
}

export function ValesPresenteClient(p: {
  filialNome: string;
  filialId: string;
  filiais: Array<{ id: string; nome: string }>;
  vales: ValeLinha[];
  podeAtualizar: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('pago');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ id: string; txt: string; erro?: boolean } | null>(null);

  const visiveis = useMemo(() => {
    const b = busca.trim();
    if (b) {
      const cod = normCodigo(b);
      const txt = b.toLowerCase();
      // Busca ignora o filtro: achar o vale é o que importa.
      return p.vales.filter(
        (v) =>
          (cod.length >= 3 && v.codigo.replace('VP-', '').includes(cod)) ||
          v.compradorNome.toLowerCase().includes(txt) ||
          (v.presenteados ?? '').toLowerCase().includes(txt),
      );
    }
    return filtro === 'todos' ? p.vales : p.vales.filter((v) => v.status === filtro);
  }, [busca, filtro, p.vales]);

  const contagem = (k: string) => (k === 'todos' ? p.vales.length : p.vales.filter((v) => v.status === k).length);

  async function agir(v: ValeLinha, acao: 'usar' | 'conferir' | 'cancelar') {
    if (acao === 'usar' && !confirm(`Dar baixa no vale ${v.codigo}${v.presenteados ? ` (${v.presenteados})` : ''}? Não dá pra usar de novo.`)) return;
    if (acao === 'cancelar' && !confirm(`Cancelar o vale ${v.codigo}? O link para de aceitar o Pix.`)) return;
    setOcupado(v.id);
    setAviso(null);
    try {
      const r = await fetch(`/api/vales-presente/${v.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acao }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setAviso({ id: v.id, txt: d.error ?? 'falhou', erro: true });
      else if (acao === 'conferir' && d.status === 'aguardando') setAviso({ id: v.id, txt: 'Pix ainda não caiu.' });
      router.refresh();
    } catch {
      setAviso({ id: v.id, txt: 'sem conexão', erro: true });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/reservas" className="text-xs text-slate-500 hover:underline">
            ← Reservas
          </Link>
          <h1 className="text-xl font-semibold text-slate-900">🎁 Vales-presente · {p.filialNome}</h1>
          <p className="text-xs text-slate-500">
            Jantar de presente vendido pela Nina no WhatsApp e crédito comprado no site. Na chegada, procure o código e dê baixa.
          </p>
        </div>
        {p.filiais.length > 1 && (
          <select
            value={p.filialId}
            onChange={(e) => router.push(`/reservas/vales-presente?filialId=${e.target.value}`)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {p.filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        )}
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Código do vale (ex.: VP-7K3QA) ou nome"
        className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-lg uppercase tracking-wider placeholder:font-sans placeholder:text-sm placeholder:normal-case placeholder:tracking-normal"
        autoFocus
      />

      {!busca.trim() && (
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTROS.map((f) => (
            <button
              key={f.k}
              onClick={() => setFiltro(f.k)}
              className={`rounded-full px-3 py-1.5 text-sm ${
                filtro === f.k ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              {f.txt} ({contagem(f.k)})
            </button>
          ))}
        </div>
      )}

      {visiveis.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {busca.trim() ? 'Nenhum vale com esse código ou nome nesta casa.' : 'Nada aqui.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {visiveis.map((v) => {
            const r = ROTULO[v.status] ?? { txt: v.status, cls: 'bg-slate-100 text-slate-700' };
            return (
              <li key={v.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-lg font-bold tracking-wider text-slate-900">{v.codigo}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.cls}`}>{r.txt}</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-700">
                      {v.presenteados ? (
                        <>
                          Para <b>{v.presenteados}</b> ·{' '}
                        </>
                      ) : null}
                      De <b>{v.compradorNome}</b>
                      {v.compradorTelefone ? <span className="text-slate-500"> ({v.compradorTelefone})</span> : null}
                    </div>
                    <div className="text-xs text-slate-500">
                      {v.tipo === 'valor' ? (
                        <>💳 Crédito {brl(v.total)} (comprado no site)</>
                      ) : (
                        <>
                          {v.pessoas} pessoa{v.pessoas === 1 ? '' : 's'}
                          {v.dataUso ? ` · dia ${v.dataUso}` : ' · dia em aberto'} · {brl(v.total)} com 10%
                        </>
                      )}
                      {v.criadoEm ? ` · criado ${v.criadoEm}` : ''}
                      {v.pagoEm ? ` · pago ${v.pagoEm}` : ''}
                    </div>
                    {v.status === 'usado' && (
                      <div className="text-xs text-slate-500">
                        Baixa {v.usadoEm}
                        {v.usadoPor ? ` por ${v.usadoPor}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {p.podeAtualizar && v.status === 'pago' && (
                      <button
                        disabled={ocupado === v.id}
                        onClick={() => agir(v, 'usar')}
                        className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        ✓ Dar baixa (usado)
                      </button>
                    )}
                    {p.podeAtualizar && v.status === 'aguardando' && (
                      <>
                        <button
                          disabled={ocupado === v.id}
                          onClick={() => agir(v, 'conferir')}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
                        >
                          🔄 Conferir Pix
                        </button>
                        <button
                          disabled={ocupado === v.id}
                          onClick={() => agir(v, 'cancelar')}
                          className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                    <a
                      href={`/presente/${v.token}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                    >
                      Ver voucher
                    </a>
                  </div>
                </div>

                {v.itens.length > 0 && (
                <ul className="mt-3 border-t border-slate-100 pt-2 text-sm text-slate-700">
                  {v.itens.map((i, k) => (
                    <li key={k}>
                      {i.qtd}× {i.nome}
                      {i.tamanho ? <span className="text-slate-400"> ({i.tamanho})</span> : null}
                    </li>
                  ))}
                </ul>
                )}
                {v.mensagem && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm italic text-slate-700 whitespace-pre-line">
                    🖨 Cartão: {v.mensagem}
                  </p>
                )}
                {v.observacao && (
                  <p className="mt-2 text-xs text-slate-500 whitespace-pre-line">Obs.: {v.observacao}</p>
                )}
                {aviso?.id === v.id && (
                  <p className={`mt-2 text-sm ${aviso.erro ? 'text-red-600' : 'text-slate-600'}`}>{aviso.txt}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

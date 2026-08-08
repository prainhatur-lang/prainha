'use client';

// Leads de evento coletados pela Nina — fila com status. A equipe usa esses
// dados pra montar o orçamento na tela de Orçamentos de eventos.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface Lead {
  id: string;
  filialNome: string;
  conversaId: string | null;
  nome: string | null;
  telefone: string | null;
  tipoEvento: string | null;
  dataEvento: string | null;
  hora: string | null;
  pessoas: number | null;
  espaco: string | null;
  observacoes: string | null;
  status: string;
  criadoEm: string;
}

const STATUS_OPCOES = [
  { valor: 'novo', label: 'Novo', cls: 'bg-emerald-100 text-emerald-700' },
  { valor: 'em_contato', label: 'Em contato', cls: 'bg-sky-100 text-sky-700' },
  { valor: 'fechado', label: 'Fechado', cls: 'bg-slate-800 text-white' },
  { valor: 'perdido', label: 'Perdido', cls: 'bg-slate-100 text-slate-500' },
];

function dataBr(s: string | null): string {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function EventosLeadsClient(props: { podeResponder: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/atendimento/eventos', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      setLeads(d.leads ?? []);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 15000);
    return () => clearInterval(t);
  }, [carregar]);

  async function mudarStatus(id: string, status: string) {
    const r = await fetch(`/api/atendimento/eventos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (r.ok) carregar();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Leads de evento — Nina</h1>
          <p className="text-xs text-slate-500">
            Interesses de evento coletados no WhatsApp. Pra fechar, monte o orçamento em{' '}
            <Link href="/orcamentos" className="text-emerald-700 underline">Orçamentos de eventos</Link>.
          </p>
        </div>
        <Link href="/atendimento" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
          ← Conversas
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-3 py-2">Quando pediu</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Evento</th>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Pessoas</th>
              <th className="px-3 py-2">Espaço</th>
              <th className="px-3 py-2">Observações</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-slate-400">Carregando…</td></tr>
            )}
            {!carregando && leads.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-xs text-slate-400">
                  Nenhum lead ainda. Quando a Nina coletar um pedido de evento, aparece aqui.
                </td>
              </tr>
            )}
            {leads.map((l) => {
              const st = STATUS_OPCOES.find((s) => s.valor === l.status) ?? STATUS_OPCOES[0];
              return (
                <tr key={l.id} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                    {new Date(l.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Maceio' })}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800">{l.nome || 'Sem nome'}</p>
                    <p className="text-xs text-slate-500">{l.telefone}</p>
                    {l.conversaId && (
                      <Link href={`/atendimento?conversa=${l.conversaId}`} className="text-xs text-emerald-700 underline">
                        ver conversa
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2">{l.tipoEvento || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {dataBr(l.dataEvento)}
                    {l.hora ? <span className="text-xs text-slate-500"> {l.hora}</span> : null}
                  </td>
                  <td className="px-3 py-2">{l.pessoas ?? '—'}</td>
                  <td className="px-3 py-2">{l.espaco || '—'}</td>
                  <td className="max-w-[260px] px-3 py-2 text-xs text-slate-600">{l.observacoes || '—'}</td>
                  <td className="px-3 py-2">
                    {props.podeResponder ? (
                      <select
                        value={l.status}
                        onChange={(e) => mudarStatus(l.id, e.target.value)}
                        className={`rounded-md border-0 px-2 py-1 text-xs font-medium ${st.cls}`}
                      >
                        {STATUS_OPCOES.map((s) => (
                          <option key={s.valor} value={s.valor}>{s.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`rounded px-2 py-1 text-xs font-medium ${st.cls}`}>{st.label}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

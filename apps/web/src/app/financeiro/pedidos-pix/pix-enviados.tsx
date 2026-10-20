'use client';

// Lista "Pix enviados pelo sistema" (20/10/2026): o que saiu pela API do Inter
// nesta casa, com o status e os botões pra conferir no banco. Pix sem código do
// Inter (resposta perdida) não tem como consultar: o dono confere no app e
// marca "Saiu" (dá a baixa) ou "Não saiu" (libera as contas).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PixEnviado {
  id: string;
  quando: string;
  favorecido: string | null;
  chave: string;
  valor: number;
  status: string;
  statusInter: string | null;
  codigo: string | null;
  erro: string | null;
  quem: string | null;
  baixado: boolean;
  qtdContas: number;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ROTULO: Record<string, { txt: string; cls: string }> = {
  ENVIANDO: { txt: 'Sem confirmação', cls: 'bg-amber-50 text-amber-800' },
  APROVACAO: { txt: 'Esperando aprovar no Inter', cls: 'bg-amber-50 text-amber-800' },
  AGENDADO: { txt: 'Agendado', cls: 'bg-sky-50 text-sky-800' },
  PAGO: { txt: 'Pago e baixado', cls: 'bg-emerald-50 text-emerald-700' },
  ERRO: { txt: 'Não saiu', cls: 'bg-rose-50 text-rose-700' },
};

export function PixEnviados({ itens, podeMexer }: { itens: PixEnviado[]; podeMexer: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function agir(p: PixEnviado, acao: 'conferir' | 'saiu' | 'liberar') {
    if (acao === 'saiu' && !window.confirm(`Você conferiu no app do Inter que o Pix de ${brl(p.valor)} SAIU? Vai dar baixa nas contas.`)) return;
    if (acao === 'liberar' && !window.confirm(`Você conferiu no app do Inter que o Pix de ${brl(p.valor)} NÃO saiu? As contas voltam a ficar em aberto.`)) return;
    setOcupado(p.id);
    setMsg(null);
    const r = await fetch('/api/financeiro/pedidos-pix/conferir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: p.id, acao }),
    }).catch(() => null);
    const d = r ? ((await r.json().catch(() => ({}))) as { error?: string; mensagem?: string }) : {};
    setOcupado(null);
    setMsg({ id: p.id, tipo: r?.ok ? 'ok' : 'erro', texto: r?.ok ? (d.mensagem ?? 'ok') : (d.error ?? 'falha de rede') });
    router.refresh();
  }

  if (itens.length === 0) return null;
  return (
    <div className="mt-6 rounded-xl border border-violet-200 bg-white shadow-sm">
      <div className="border-b border-violet-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-violet-900">💸 Pix enviados pelo sistema</h2>
        <p className="text-[11px] text-slate-500">Últimos 30 dias e os que ainda não terminaram.</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {itens.map((p) => {
          const r = p.baixado ? ROTULO.PAGO! : (ROTULO[p.status] ?? { txt: p.status, cls: 'bg-slate-100 text-slate-700' });
          const aberto = !p.baixado && p.status !== 'ERRO';
          return (
            <li key={p.id} className="px-4 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-24 shrink-0 font-mono text-xs text-slate-600">{p.quando}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800" title={p.chave}>
                  {p.favorecido ?? p.chave}{' '}
                  <span className="text-[11px] text-slate-400">· {p.qtdContas} conta(s){p.quem ? ` · por ${p.quem}` : ''}</span>
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${r.cls}`}>
                  {r.txt}
                  {p.statusInter && !p.baixado ? ` (${p.statusInter})` : ''}
                </span>
                <span className="w-24 shrink-0 text-right font-medium text-slate-900">{brl(p.valor)}</span>
              </div>
              {(p.erro || p.codigo) && (
                <div className="pl-[7.5rem] text-[11px] text-slate-500">
                  {p.codigo && <span className="font-mono">cód. Inter {p.codigo}</span>}
                  {p.erro && <span className={p.codigo ? 'ml-2' : ''}>{p.erro}</span>}
                </div>
              )}
              {podeMexer && aberto && (
                <div className="mt-1 flex flex-wrap justify-end gap-2">
                  {p.codigo ? (
                    <button
                      type="button"
                      disabled={ocupado === p.id}
                      onClick={() => void agir(p, 'conferir')}
                      className="rounded-md border border-violet-300 bg-white px-2 py-1 text-xs font-medium text-violet-800 hover:bg-violet-50 disabled:opacity-50"
                    >
                      {ocupado === p.id ? 'Conferindo…' : '🔎 Conferir no Inter'}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={ocupado === p.id}
                        onClick={() => void agir(p, 'saiu')}
                        className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        ✓ Saiu (vi no app do Inter)
                      </button>
                      <button
                        type="button"
                        disabled={ocupado === p.id}
                        onClick={() => void agir(p, 'liberar')}
                        className="rounded-md border border-rose-300 bg-white px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        ✗ Não saiu: liberar contas
                      </button>
                    </>
                  )}
                </div>
              )}
              {msg?.id === p.id && (
                <div className={`mt-1 text-right text-xs ${msg.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.texto}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

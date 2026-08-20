'use client';

import { useCallback, useEffect, useState } from 'react';

interface FormaTot {
  codigo: number;
  nome: string;
  valor: number;
  n: number;
}
interface CaixaFormaBreak {
  nome: string;
  valor: number;
  n: number;
}
interface CaixaLinha {
  codigo: number;
  quem: string | null;
  aberto_em: string | null;
  fechado_em: string | null;
  fundo: number;
  esperado: number | null;
  contado: number | null;
  recebido?: number;
  formas?: CaixaFormaBreak[];
  /** 'maquininha' = nasceu sozinho no terminal (só cartão/Pix) · 'sistema' = aberto por gente (gaveta) */
  tipo?: string;
}
interface Mov {
  caixa: number;
  entrada: number;
  saida: number;
  obs: string;
}
interface Relatorio {
  ok: boolean;
  erro?: string;
  formas: FormaTot[];
  caixas: CaixaLinha[];
  movs: Mov[];
}
interface Pagamento {
  pedido: number | null;
  forma: string;
  valor: number;
  nsu: string | null;
  quando: string;
}
interface Detalhe {
  ok: boolean;
  erro?: string;
  caixa: { codigo: number; quem: string | null; fundo: number; esperado: number | null; fechado_em: string | null };
  pagamentos: Pagamento[];
}

function brl(v: number): string {
  return 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function hojeBr(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function diaMais(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return dt.toISOString().slice(0, 10);
}
function hora(q: string | null): string {
  return q ? q.slice(11, 16) : '';
}

export function ConferenciaCaixaClient({
  filialId,
  filiais,
}: {
  filialId: string;
  filiais: { id: string; nome: string }[];
}) {
  const [fil, setFil] = useState(filialId);
  const [data, setData] = useState(hojeBr());
  const [rel, setRel] = useState<Relatorio | null>(null);
  const [loading, setLoading] = useState(false);
  const [aberto, setAberto] = useState<number | null>(null);
  const [det, setDet] = useState<Detalhe | null>(null);
  const [detLoading, setDetLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fechando, setFechando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setRel(null);
    setAberto(null);
    setDet(null);
    try {
      const r = await fetch(`/api/financeiro/caixa/relatorio?filial=${fil}&data=${data}`, {
        cache: 'no-store',
      });
      setRel((await r.json()) as Relatorio);
    } catch {
      setRel({ ok: false, erro: 'Falha ao carregar', formas: [], caixas: [], movs: [] });
    }
    setLoading(false);
  }, [fil, data]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function verDetalhe(cod: number) {
    if (aberto === cod) {
      setAberto(null);
      setDet(null);
      return;
    }
    setAberto(cod);
    setDet(null);
    setDetLoading(true);
    try {
      const r = await fetch(`/api/financeiro/caixa/detalhe?filial=${fil}&caixa=${cod}`, {
        cache: 'no-store',
      });
      const j = (await r.json()) as Detalhe;
      setDet(j.ok ? j : null);
    } catch {
      setDet(null);
    }
    setDetLoading(false);
  }

  async function fechar(codigo: number | null, todos = false) {
    const alvo = todos ? 'TODOS os caixas abertos' : `o caixa ${codigo}`;
    if (!confirm(`Fechar ${alvo} agora (pelo esperado)? Organização — cartão/Pix já concilia por NSU.`)) return;
    setFechando(true);
    setMsg('Fechando…');
    try {
      const r = await fetch('/api/financeiro/caixa/fechar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: fil, codigo, todos }),
      });
      const j = (await r.json()) as { ok: boolean; erro?: string; total?: number };
      if (!j.ok) {
        setMsg('Erro: ' + (j.erro ?? 'falhou'));
      } else {
        setMsg(todos ? `✓ ${j.total ?? 0} caixa(s) fechado(s).` : `✓ Caixa ${codigo} fechado.`);
        await carregar();
      }
    } catch {
      setMsg('Erro de rede ao fechar.');
    }
    setFechando(false);
  }

  const abertos = (rel?.caixas ?? []).filter((c) => !c.fechado_em);
  const totGeral = (rel?.formas ?? []).reduce((s, f) => s + f.valor, 0);
  const maq = (rel?.caixas ?? []).filter((c) => c.tipo === 'maquininha');
  const sis = (rel?.caixas ?? []).filter((c) => c.tipo !== 'maquininha');

  const caixaRow = (c: CaixaLinha) => (
    <div key={c.codigo} className="border-b border-slate-100 py-2 last:border-0">
      <div className="flex items-center justify-between">
        <b className="text-slate-800">
          {c.quem ?? `caixa ${c.codigo}`}
          <span className="ml-1 text-xs font-normal text-slate-400">· caixa {c.codigo}</span>
        </b>
        <b>{brl(c.recebido ?? 0)}</b>
      </div>
      <div className="mt-0.5 text-xs text-slate-500">
        {(c.formas ?? []).map((f) => `${f.nome} ${brl(f.valor)} (${f.n}×)`).join(' · ') || 'sem recebimentos'}
      </div>
      <div className="text-xs text-slate-400">
        {c.fechado_em ? (
          <>fechado · esperado {brl(c.esperado ?? 0)} · contado {brl(c.contado ?? 0)}</>
        ) : (
          <span className="font-semibold text-emerald-600">ABERTO · fundo {brl(c.fundo)}</span>
        )}
      </div>
      <div className="mt-1 flex gap-3 text-xs">
        <button onClick={() => void verDetalhe(c.codigo)} className="text-sky-600 underline">
          {aberto === c.codigo ? 'ocultar' : '🔎 analítico'}
        </button>
        {!c.fechado_em && (
          <button
            onClick={() => void fechar(c.codigo)}
            disabled={fechando}
            className="text-red-600 underline disabled:opacity-50"
          >
            🔒 fechar este
          </button>
        )}
      </div>
      {aberto === c.codigo && (
        <div className="mt-2 rounded-md bg-slate-50 p-2">
          {detLoading && <div className="text-xs text-slate-400">carregando…</div>}
          {!detLoading && det && (
            <>
              {det.pagamentos.length === 0 ? (
                <div className="text-xs text-slate-400">sem recebimentos</div>
              ) : (
                det.pagamentos.map((p, i) => (
                  <div key={i} className="flex justify-between border-b border-slate-100 py-1 text-xs last:border-0">
                    <span className="text-slate-600">
                      {hora(p.quando)} · {p.forma}
                      {p.nsu ? ` · NSU ${p.nsu}` : ''}
                      {p.pedido ? ` · ped ${p.pedido}` : ''}
                    </span>
                    <b>{brl(p.valor)}</b>
                  </div>
                ))
              )}
            </>
          )}
          {!detLoading && !det && <div className="text-xs text-red-500">não deu pra carregar o detalhe</div>}
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Conferência de caixa</h1>
          <p className="text-sm text-slate-500">Sintético e analítico, e fechamento individual — em tempo real da loja.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        {filiais.length > 1 && (
          <select
            value={fil}
            onChange={(e) => setFil(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => setData(diaMais(data, -1))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          ◂
        </button>
        <input
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => setData(diaMais(data, 1))}
          disabled={data >= hojeBr()}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-40"
        >
          ▸
        </button>
        {data !== hojeBr() && (
          <button onClick={() => setData(hojeBr())} className="text-sm text-sky-600 underline">
            hoje
          </button>
        )}
        <button onClick={() => void carregar()} className="ml-auto rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          ↻ atualizar
        </button>
      </div>

      {msg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div>
      )}

      {loading && <div className="p-6 text-center text-slate-400">montando o movimento…</div>}

      {rel && !rel.ok && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {rel.erro ?? 'sem dados'}
        </div>
      )}

      {rel && rel.ok && (
        <>
          {/* SINTÉTICO — por forma */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 font-semibold text-slate-700">📊 Por forma de pagamento</div>
            {rel.formas.length === 0 ? (
              <div className="text-sm text-slate-400">nenhum pagamento nesse dia</div>
            ) : (
              rel.formas.map((f) => (
                <div key={f.codigo} className="flex justify-between border-b border-slate-100 py-1 text-sm last:border-0">
                  <span className="text-slate-600">
                    {f.nome} <span className="text-slate-400">({f.n}×)</span>
                  </span>
                  <b>{brl(f.valor)}</b>
                </div>
              ))
            )}
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-bold">
              <span>Total</span>
              <span>{brl(totGeral)}</span>
            </div>
          </div>

          {/* ABERTOS + fechar todos */}
          {abertos.length > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <span className="text-sm text-amber-800">
                <b>{abertos.length}</b> caixa(s) ainda aberto(s)
              </span>
              <button
                onClick={() => void fechar(null, true)}
                disabled={fechando}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                🔒 Fechar todos
              </button>
            </div>
          )}

          {/* SEPARADO: caixa da MAQUININHA × caixa do SISTEMA (pedido do dono) */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 font-semibold text-slate-700">
              💳 Caixas da maquininha{' '}
              <span className="text-xs font-normal text-slate-400">
                só cartão/Pix — fecham sozinhos às 04:00 quando BATEM (NSU a NSU); não bateu, fica aberto aqui
              </span>
            </div>
            {maq.length === 0 ? (
              <div className="text-sm text-slate-400">nenhum caixa da maquininha nesse dia</div>
            ) : (
              maq.map(caixaRow)
            )}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 font-semibold text-slate-700">
              🧰 Caixas do sistema{' '}
              <span className="text-xs font-normal text-slate-400">
                gaveta/dinheiro — fechamento com conferência humana
              </span>
            </div>
            {sis.length === 0 ? (
              <div className="text-sm text-slate-400">nenhum caixa do sistema nesse dia</div>
            ) : (
              sis.map(caixaRow)
            )}
          </div>

          {/* Entradas/saídas da gaveta */}
          {rel.movs.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-2 font-semibold text-slate-700">↕ Entradas/saídas da gaveta</div>
              {rel.movs.map((m, i) => (
                <div key={i} className="flex justify-between border-b border-slate-100 py-1 text-sm last:border-0">
                  <span className="text-slate-600">{m.obs || '—'}</span>
                  <b>{m.saida ? `− ${brl(m.saida)}` : `+ ${brl(m.entrada)}`}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

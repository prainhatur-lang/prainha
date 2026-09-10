'use client';

import { useCallback, useEffect, useState } from 'react';

interface Pausa { id: string; descricao: string; inicio: string; fim: string; ativa: boolean }

interface CasaIfood {
  filialId: string;
  nome: string;
  merchantId: string;
  ativo: boolean;
  sabe: boolean;
  semModulo: boolean;
  aberta: boolean | null;
  pausada: boolean;
  titulo: string;
  detalhe: string;
  motivos: string[];
  pausas: Pausa[];
}

interface GrupoMerchants { clientId: string; lojas: Array<{ id: string; nome: string; razao: string }>; erro?: string }

const MINUTOS = [15, 30, 60, 120];

function hora(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  // O iFood devolve a interrupção no fuso da loja; mostrar em BRT.
  return new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

export function LojaIfoodClient({ podeAgir }: { podeAgir: boolean }) {
  const [casas, setCasas] = useState<CasaIfood[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [grupos, setGrupos] = useState<GrupoMerchants[] | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/ifood/loja', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.error ?? `Erro ${r.status}`); return; }
      setCasas(d.filiais ?? []);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    carregar();
    // Meio minuto: pausa criada no celular do gerente aparece aqui sozinha,
    // e é barato — uma chamada por casa.
    const t = setInterval(carregar, 30000);
    return () => clearInterval(t);
  }, [carregar]);

  async function agir(filialId: string, acao: 'pausar' | 'retomar', minutos?: number) {
    const casa = casas?.find((c) => c.filialId === filialId);
    if (acao === 'pausar' && !confirm(`Pausar o iFood de ${casa?.nome} por ${minutos} minutos?\n\nA casa para de receber pedidos até lá.`)) return;
    setOcupada(filialId);
    try {
      const r = await fetch('/api/ifood/loja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, acao, minutos, motivo: acao === 'pausar' ? 'Pausa pelo Concilia' : undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error ?? `Erro ${r.status}`); return; }
      await carregar();
    } finally {
      setOcupada(null);
    }
  }

  async function descobrir() {
    setGrupos([]);
    const r = await fetch('/api/ifood/loja?merchants=1', { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { alert(d.error ?? `Erro ${r.status}`); setGrupos(null); return; }
    setGrupos(d.grupos ?? []);
  }

  if (erro) return <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{erro}</p>;
  if (!casas) return <p className="mt-6 text-sm text-slate-500">carregando…</p>;
  if (casas.length === 0) {
    return (
      <p className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Nenhuma casa com credencial do iFood. Cadastre em <b>Configurações → iFood</b>.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {casas.map((c) => (
        <div key={c.filialId} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex-1 text-base font-semibold text-slate-900">{c.nome}</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                !c.sabe ? 'bg-slate-100 text-slate-600'
                  : c.pausada ? 'bg-amber-100 text-amber-800'
                  : c.aberta ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
              }`}
            >
              {c.titulo}
            </span>
          </div>

          {c.detalhe && <p className="mt-2 text-sm text-slate-600">{c.detalhe}</p>}

          {c.motivos.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
              {c.motivos.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}

          {c.pausas.filter((p) => p.ativa).map((p) => (
            <p key={p.id} className="mt-2 text-sm text-amber-800">
              Pausada até <b>{hora(p.fim)}</b>{p.descricao ? ` — ${p.descricao}` : ''}
            </p>
          ))}

          {!c.ativo && (
            <p className="mt-2 text-xs text-slate-500">
              A integração desta casa está <b>desligada</b> no Concilia — quem recebe os pedidos é o Consumer.
            </p>
          )}

          {c.sabe && podeAgir && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {c.pausada ? (
                <button
                  onClick={() => agir(c.filialId, 'retomar')}
                  disabled={ocupada === c.filialId}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {ocupada === c.filialId ? '…' : 'Voltar a receber'}
                </button>
              ) : (
                <>
                  <span className="text-sm text-slate-600">Pausar por</span>
                  {MINUTOS.map((m) => (
                    <button
                      key={m}
                      onClick={() => agir(c.filialId, 'pausar', m)}
                      disabled={ocupada === c.filialId}
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 disabled:opacity-40"
                    >
                      {m >= 60 ? `${m / 60}h` : `${m}min`}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          <p className="mt-3 text-xs text-slate-400">
            loja no iFood: {c.merchantId || '— não apontada —'}
          </p>
        </div>
      ))}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <button onClick={descobrir} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
          Descobrir lojas no iFood
        </button>
        <p className="mt-2 text-xs text-slate-500">
          Lista os merchants que a credencial enxerga. É daqui que sai o <b>merchant_id</b> de uma
          casa recém-autorizada no Portal do Parceiro — copie e cole em Configurações → iFood.
        </p>
        {grupos?.map((g) => (
          <div key={g.clientId} className="mt-3 text-sm">
            <p className="text-slate-500">app {g.clientId.slice(0, 8)}…</p>
            {g.erro && <p className="text-rose-700">{g.erro}</p>}
            <ul className="mt-1 space-y-1">
              {g.lojas.map((l) => (
                <li key={l.id} className="text-slate-700">
                  <b>{l.nome}</b> {l.razao ? `(${l.razao})` : ''} — <code className="text-xs">{l.id}</code>
                </li>
              ))}
            </ul>
            {!g.erro && g.lojas.length === 0 && <p className="text-slate-500">nenhuma loja autorizada ainda</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

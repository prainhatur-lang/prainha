'use client';

// Painel da IA + decisão do mês (estudo de equipe, 10/11/2026).

import { useState } from 'react';
import { Texto } from './texto-md';

export function PainelIa(props: {
  filialId: string;
  mes: string;
  meta: number | null;
  metaCoz: number | null;
  min: number | null;
  analise: string | null;
  analiseEm: string | null;
  decisao: string | null;
  decisaoEm: string | null;
  decisaoPor: string | null;
}) {
  const [analise, setAnalise] = useState(props.analise);
  const [analiseEm, setAnaliseEm] = useState(props.analiseEm);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [decisao, setDecisao] = useState(props.decisao ?? '');
  const [salvo, setSalvo] = useState<string | null>(props.decisaoEm);
  const [salvando, setSalvando] = useState(false);

  const quando = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '';

  async function pedir() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch('/api/rh/estudo-equipe/analise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: props.filialId, mes: props.mes, meta: props.meta, metaCoz: props.metaCoz, min: props.min }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || `erro ${r.status}`);
      setAnalise(j.analise);
      setAnaliseEm(j.analiseEm);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/rh/estudo-equipe/decisao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: props.filialId, mes: props.mes, decisao }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || `erro ${r.status}`);
      setSalvo(j.decisaoEm);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="mb-8 rounded-lg border border-violet-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Análise da IA</h2>
          <p className="text-xs text-slate-500">
            Lê os números desta tela e pesa manter, reduzir, aumentar, mudar escala ou regime. É base pro gerente, não decisão.
          </p>
        </div>
        <button
          type="button"
          onClick={pedir}
          disabled={carregando}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {carregando ? 'Analisando… (até 1 min)' : analise ? 'Pedir de novo' : 'Pedir análise da IA'}
        </button>
      </div>
      {erro && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {analise ? (
        <div className="rounded-md bg-violet-50/40 p-3">
          {analiseEm && <p className="mb-2 text-xs text-slate-400">Gerada em {quando(analiseEm)}</p>}
          <Texto md={analise} />
        </div>
      ) : (
        !carregando && <p className="text-sm text-slate-400">Ainda sem análise neste mês.</p>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <label className="mb-1 block text-sm font-semibold text-slate-800">Decisão do mês</label>
        <p className="mb-2 text-xs text-slate-500">
          O que ficou combinado (ex.: &quot;tirar 1 do salão na terça à tarde; Fulano passa a CLT em dez&quot;). Fica no histórico e a IA confere o efeito no mês seguinte.
        </p>
        <textarea
          value={decisao}
          onChange={(e) => {
            setDecisao(e.target.value);
            setSalvo(null);
          }}
          rows={4}
          className="w-full rounded-md border border-slate-300 p-2 text-sm"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="rounded-md bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-60"
          >
            {salvando ? 'Salvando…' : 'Salvar decisão'}
          </button>
          {salvo && (
            <span className="text-xs text-emerald-700">
              Salva em {quando(salvo)}
              {props.decisaoPor && salvo === props.decisaoEm ? ` por ${props.decisaoPor}` : ''}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

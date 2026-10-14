'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LerPeloCelular } from './ler-pelo-celular';
import { marcarPainel, painelLigado } from './sessao-celular';

interface Resp {
  ok?: boolean;
  error?: string;
  status?: 'COMPLETA' | 'RESUMO' | 'JA_EXISTE' | 'NAO_ENCONTRADA' | 'BLOQUEIO';
  motivo?: string;
}

/** Nota que está no papel (DANFE) mas não apareceu: busca na SEFAZ pela chave.
 *  Aceita a chave digitada ou lida pelo leitor de código de barras. */
export function TrazerPorChaveForm({ filialId }: { filialId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chave, setChave] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const digitos = chave.replace(/\D/g, '');
  const [celular, setCelular] = useState(false);

  // voltou da nota que o celular abriu: o painel do QR reabre sozinho
  useEffect(() => {
    if (painelLigado(filialId)) setCelular(true);
  }, [filialId]);
  useEffect(() => {
    if (celular) marcarPainel(filialId, true);
  }, [celular, filialId]);

  async function trazer(e: React.FormEvent) {
    e.preventDefault();
    if (digitos.length !== 44) return;
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/notas/buscar-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, chaveNova: digitos }),
      });
      const d = (await r.json().catch(() => ({}))) as Resp;
      if (!r.ok || !d.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      const ok = d.status === 'COMPLETA' || d.status === 'RESUMO' || d.status === 'JA_EXISTE';
      setMsg({ tipo: ok ? 'ok' : 'erro', texto: `${ok ? '✓ ' : ''}${d.motivo ?? d.status}` });
      if (ok) {
        setChave('');
        start(() => router.refresh());
      }
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={trazer}
      className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700"
    >
      <p className="font-semibold text-slate-900">Nota no papel que não apareceu aqui?</p>
      <p className="mt-0.5 text-slate-500">
        Digite ou passe o leitor na chave de acesso do DANFE (44 números). Busca direto na SEFAZ
        (até 90 dias da emissão) e, se ainda estiver no prazo, já dá ciência.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={chave}
          onChange={(e) => setChave(e.target.value)}
          inputMode="numeric"
          placeholder="Chave de acesso"
          className="w-full max-w-[420px] rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs"
        />
        <button
          type="submit"
          disabled={loading || pending || digitos.length !== 44}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? 'Buscando...' : 'Trazer nota'}
        </button>
        <span className="text-[11px] text-slate-400">{digitos.length}/44</span>
        <button
          type="button"
          onClick={() => {
            if (celular) marcarPainel(filialId, false);
            setCelular((v) => !v);
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          📱 Ler pelo celular
        </button>
      </div>
      {celular && (
        <LerPeloCelular
          filialId={filialId}
          onFechar={() => {
            marcarPainel(filialId, false);
            setCelular(false);
          }}
        />
      )}
      {msg && (
        <p className={`mt-1 text-[11px] ${msg.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>
          {msg.texto}
        </p>
      )}
    </form>
  );
}

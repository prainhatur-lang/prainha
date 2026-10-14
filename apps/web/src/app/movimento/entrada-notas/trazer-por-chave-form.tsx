'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { lerCodigoDeBarras, reduzirFoto } from './ler-chave-foto';

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
  // Câmera: foto do DANFE → chave → envia o form sozinho
  const formRef = useRef<HTMLFormElement>(null);
  const [lendoFoto, setLendoFoto] = useState<string | null>(null);
  const [autoEnviar, setAutoEnviar] = useState(false);
  useEffect(() => {
    if (!autoEnviar || digitos.length !== 44) return;
    setAutoEnviar(false);
    formRef.current?.requestSubmit();
  }, [autoEnviar, digitos]);

  async function lerFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const foto = e.target.files?.[0];
    e.target.value = '';
    if (!foto) return;
    setMsg(null);
    try {
      setLendoFoto('Lendo o código de barras...');
      let lida = await lerCodigoDeBarras(foto).catch(() => null);
      if (!lida) {
        // código de barras não saiu → a IA lê os números impressos
        setLendoFoto('Código de barras não saiu — lendo os números da chave...');
        const fd = new FormData();
        fd.append('filialId', filialId);
        fd.append('foto', await reduzirFoto(foto), 'chave.jpg');
        const r = await fetch('/api/notas/ler-chave-foto', { method: 'POST', body: fd });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; chave?: string; lida?: string; error?: string };
        if (!d.ok || !d.chave) {
          if (d.lida) setChave(d.lida); // confere na mão o número que não bateu
          setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
          return;
        }
        lida = d.chave;
      }
      setChave(lida);
      setAutoEnviar(true);
    } catch (err) {
      setMsg({ tipo: 'erro', texto: `não deu pra ler a foto: ${(err as Error).message}` });
    } finally {
      setLendoFoto(null);
    }
  }

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
      ref={formRef}
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
        <label
          className={`cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 ${
            lendoFoto || loading ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          📷 Foto da chave
          <input type="file" accept="image/*" capture="environment" onChange={lerFoto} className="hidden" />
        </label>
      </div>
      {lendoFoto && <p className="mt-1 text-[11px] text-slate-500">{lendoFoto}</p>}
      {msg && (
        <p className={`mt-1 text-[11px] ${msg.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>
          {msg.texto}
        </p>
      )}
    </form>
  );
}

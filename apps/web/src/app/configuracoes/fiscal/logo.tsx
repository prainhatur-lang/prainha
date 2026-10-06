'use client';

// Logo da casa que sai no cabeçalho das notas (DANFE): mostra a atual e troca.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoFilial({
  filialId,
  atual,
  enviada,
}: {
  filialId: string;
  /** A que vale hoje (enviada ou a padrão da casa). */
  atual: string | null;
  /** true quando a atual foi enviada por aqui (dá pra tirar). */
  enviada: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(arquivo: File) {
    setOcupado(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      const r = await fetch(`/api/filial/${filialId}/fiscal/logo`, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErro(j.error ?? 'não consegui enviar');
      else router.refresh();
    } catch {
      setErro('sem resposta do servidor');
    } finally {
      setOcupado(false);
      if (input.current) input.current.value = '';
    }
  }

  async function tirar() {
    if (!window.confirm('Tirar a logo enviada desta casa?')) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch(`/api/filial/${filialId}/fiscal/logo`, { method: 'DELETE' });
      if (!r.ok) setErro('não consegui tirar');
      else router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white">
        {atual ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={atual} alt="logo da casa" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[10px] text-slate-400">sem logo</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-800">Logo da casa nas notas</div>
        <p className="text-xs text-slate-500">
          Sai no cabeçalho da nota (DANFE) desta casa. PNG, JPG ou WEBP, até 2 MB — de preferência quadrada e de
          fundo claro.
        </p>
        {erro && <p className="mt-1 text-xs text-rose-700">{erro}</p>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && enviar(e.target.files[0])}
      />
      <button
        type="button"
        disabled={ocupado}
        onClick={() => input.current?.click()}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
      >
        {ocupado ? 'enviando…' : atual ? 'trocar logo' : 'enviar logo'}
      </button>
      {enviada && (
        <button type="button" disabled={ocupado} onClick={tirar} className="text-xs text-slate-500 underline disabled:opacity-40">
          tirar
        </button>
      )}
    </div>
  );
}

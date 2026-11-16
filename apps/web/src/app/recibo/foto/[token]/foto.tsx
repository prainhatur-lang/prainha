'use client';

import { useRef, useState } from 'react';

export function FotoReciboCelular({ token }: { token: string }) {
  const [enviando, setEnviando] = useState(false);
  const [enviadas, setEnviadas] = useState(0);
  const [erro, setErro] = useState('');
  const camera = useRef<HTMLInputElement>(null);
  const arquivos = useRef<HTMLInputElement>(null);

  async function subir(lista: FileList | null) {
    if (!lista?.length) return;
    setEnviando(true);
    setErro('');
    try {
      for (const arquivo of Array.from(lista)) {
        const fd = new FormData();
        fd.append('arquivo', arquivo);
        const r = await fetch(`/api/recibo-foto/${encodeURIComponent(token)}`, { method: 'POST', body: fd });
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) {
          setErro(d.error ?? 'Não consegui enviar.');
          break;
        }
        setEnviadas((n) => n + 1);
      }
    } catch {
      setErro('Não consegui enviar — confira a internet e tente de novo.');
    } finally {
      setEnviando(false);
      if (camera.current) camera.current.value = '';
      if (arquivos.current) arquivos.current.value = '';
    }
  }

  return (
    <div className="mt-5 space-y-3">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void subir(e.target.files)} />
      <input ref={arquivos} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => void subir(e.target.files)} />
      {enviadas > 0 && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          ✓ {enviadas} {enviadas > 1 ? 'arquivos guardados' : 'foto guardada'} — já aparece na tela do computador.
        </p>
      )}
      {erro && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      <button
        onClick={() => camera.current?.click()}
        disabled={enviando}
        className="w-full rounded-xl bg-slate-900 px-4 py-4 text-base font-semibold text-white disabled:opacity-60"
      >
        {enviando ? 'Enviando…' : enviadas > 0 ? '📷 Tirar outra foto' : '📷 Tirar foto do recibo'}
      </button>
      <button
        onClick={() => arquivos.current?.click()}
        disabled={enviando}
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-60"
      >
        Escolher da galeria ou arquivo
      </button>
      <p className="text-center text-xs text-slate-500">Pegue o papel inteiro, com a assinatura legível.</p>
    </div>
  );
}

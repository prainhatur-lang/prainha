'use client';

import { useState } from 'react';

export function UploadBoletoCliente({ token }: { token: string }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<{ url: string; tamanho: number } | null>(null);

  async function enviar(file: File) {
    setEnviando(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append('arquivo', file);
      const r = await fetch(`/api/nota-boleto/${token}/upload`, {
        method: 'POST',
        body: fd,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setEnviado({ url: d.url, tamanho: d.tamanhoBytes });
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void enviar(f);
  }

  if (enviado) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
        <p className="text-2xl">✓</p>
        <p className="mt-1 text-sm font-medium text-emerald-900">Boleto enviado!</p>
        <p className="mt-0.5 text-[10px] text-emerald-800">
          {(enviado.tamanho / 1024).toFixed(0)} KB. Já está vinculado às parcelas
          desta nota.
        </p>
        <button
          type="button"
          onClick={() => setEnviado(null)}
          className="mt-3 text-[11px] text-emerald-700 hover:underline"
        >
          Enviar outro
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <label className="block">
        <span className="block text-xs font-medium text-slate-700">📷 Tirar foto agora</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleChange}
          disabled={enviando}
          className="mt-1 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-white disabled:opacity-50"
        />
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-slate-700">📎 Ou anexar arquivo (PDF/imagem)</span>
        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={handleChange}
          disabled={enviando}
          className="mt-1 block w-full text-xs file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-4 file:py-2.5 file:text-sm file:text-slate-700 disabled:opacity-50"
        />
      </label>

      {enviando && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
          ⏳ Enviando...
        </p>
      )}
      {erro && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</p>
      )}
    </div>
  );
}

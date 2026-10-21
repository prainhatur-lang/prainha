'use client';

// Botão embaixo de cada post do Instagram: manda pro RASCUNHO do TikTok da
// mesma casa (/api/marketing/rascunho-tiktok). Vídeo vai sem legenda (o TikTok
// não aceita legenda na caixa de entrada) — copia a legenda pra colar ao postar.

import { useState } from 'react';

export function MandarTiktok({ filialId, postId }: { filialId: string; postId: string }) {
  const [estado, setEstado] = useState<'parado' | 'indo' | 'ok' | 'erro'>('parado');
  const [texto, setTexto] = useState('');

  async function mandar() {
    if (!window.confirm('Mandar este post pro rascunho do TikTok desta casa? Ele NÃO é publicado: aparece no app do TikTok pra você editar e postar.')) return;
    setEstado('indo');
    setTexto('');
    try {
      const r = await fetch('/api/marketing/rascunho-tiktok', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, postId }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string; tipo?: string; legenda?: string } | null;
      if (!r.ok || !j || j.error) {
        setEstado('erro');
        setTexto(j?.error ?? `Falhou (HTTP ${r.status}).`);
        return;
      }
      let copiada = false;
      if (j.tipo === 'video' && j.legenda) {
        try {
          await navigator.clipboard.writeText(j.legenda);
          copiada = true;
        } catch {
          // navegador não deixou copiar
        }
      }
      setEstado('ok');
      setTexto(
        j.tipo === 'video'
          ? `Foi pra caixa de entrada do TikTok (chega notificação no app).${copiada ? ' Legenda copiada: cole ao postar.' : ''}`
          : 'Foi pro rascunho do TikTok com a legenda. Abra o app pra postar.',
      );
    } catch {
      setEstado('erro');
      setTexto('Sem conexão com o sistema.');
    }
  }

  return (
    <div className="border-t border-slate-100 px-2 py-1.5">
      <button
        type="button"
        onClick={mandar}
        disabled={estado === 'indo'}
        className="w-full rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-black disabled:opacity-50"
      >
        {estado === 'indo' ? 'Mandando…' : estado === 'ok' ? '✓ Mandar de novo pro TikTok' : '🎵 Mandar pro TikTok'}
      </button>
      {texto && (
        <p className={`mt-1 text-[11px] ${estado === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{texto}</p>
      )}
    </div>
  );
}

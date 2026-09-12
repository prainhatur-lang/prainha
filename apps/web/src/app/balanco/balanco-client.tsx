'use client';

// Recarrega a página sozinha (a loja manda foto nova a cada 10 min) e o botão
// "Atualizar agora" pede a foto direto pra loja antes de recarregar.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function AutoRefresh({ segundos }: { segundos: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, segundos * 1000);
    return () => window.clearInterval(t);
  }, [router, segundos]);
  return null;
}

export function BotaoAtualizar({ filialId }: { filialId?: string }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function atualizar() {
    setRodando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/balanco/atualizar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId }),
      });
      const j = (await r.json().catch(() => null)) as
        | { ok: boolean; erro?: string; resultados?: { nome: string; ok: boolean; erro?: string }[] }
        | null;
      if (!j) setMsg('sem resposta');
      else if (j.resultados) {
        const ruins = j.resultados.filter((x) => !x.ok);
        setMsg(ruins.length ? ruins.map((x) => `${x.nome}: ${x.erro}`).join(' · ') : 'atualizado');
      } else setMsg(j.erro ?? 'erro');
      router.refresh();
    } catch {
      setMsg('falhou');
    } finally {
      setRodando(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={atualizar}
        disabled={rodando}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
      >
        {rodando ? 'Pedindo à loja…' : 'Atualizar agora'}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </span>
  );
}

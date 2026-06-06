'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function EnviarTodosButton({ cotacaoId }: { cotacaoId: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function enviar() {
    if (!confirm('Disparar a cotação automaticamente no WhatsApp pra todos os fornecedores com telefone?')) return;
    setEnviando(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/cotacao/${cotacaoId}/enviar-todos`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error ?? `Erro ${r.status}`);
        return;
      }
      const partes = [`${d.enviados} enviado(s)`];
      if (d.semTelefone) partes.push(`${d.semTelefone} sem telefone`);
      if (d.falhas?.length) partes.push(`${d.falhas.length} falha(s)`);
      setMsg(`✓ ${partes.join(' · ')}`);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={enviar}
        disabled={enviando}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : '🚀 Enviar pra todos no WhatsApp'}
      </button>
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
    </div>
  );
}

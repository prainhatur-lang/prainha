'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function EnviarTodosButton({ cotacaoId }: { cotacaoId: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [falhas, setFalhas] = useState<string[]>([]);

  async function enviar() {
    if (!confirm('Disparar a cotação automaticamente no WhatsApp pra todos os fornecedores com telefone?')) return;
    setEnviando(true);
    setMsg(null);
    setFalhas([]);
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
      setFalhas(Array.isArray(d.falhas) ? d.falhas : []);
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
      {falhas.length > 0 && (
        <div className="mt-1 w-full rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
          {falhas.map((f, i) => (
            <div key={i} className="break-all">⚠ {f}</div>
          ))}
        </div>
      )}
    </div>
  );
}

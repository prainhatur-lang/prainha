'use client';

// Recibo assinado: depois de imprimir e a pessoa assinar, sobe a foto ou o
// PDF do papel. No celular o botão abre a câmera ou os arquivos.

import { useRef, useState } from 'react';
import type { ReciboAssinado } from '@/lib/recibo-assinado';

export function ReciboAssinadoBox({ contaId, iniciais }: { contaId: string; iniciais: ReciboAssinado[] }) {
  const [arquivos, setArquivos] = useState(iniciais);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function subir(lista: FileList | null) {
    if (!lista?.length) return;
    setEnviando(true);
    setErro('');
    try {
      for (const arquivo of Array.from(lista)) {
        const fd = new FormData();
        fd.append('arquivo', arquivo);
        const r = await fetch(`/api/financeiro/recibo/${contaId}/assinado`, { method: 'POST', body: fd });
        const d = (await r.json().catch(() => ({}))) as { arquivos?: ReciboAssinado[]; error?: string };
        if (!r.ok) {
          setErro(d.error ?? 'Não consegui enviar o arquivo.');
          break;
        }
        if (d.arquivos) setArquivos(d.arquivos);
      }
    } catch {
      setErro('Não consegui enviar o arquivo — confira a internet.');
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            Recibo assinado {arquivos.length > 0 ? `· ${arquivos.length} guardado${arquivos.length > 1 ? 's' : ''}` : ''}
          </p>
          <p className="text-xs text-slate-500">
            Imprimiu e a pessoa assinou? Suba a foto ou o PDF do papel — fica guardado junto da conta.
          </p>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => void subir(e.target.files)}
        />
        <button
          onClick={() => input.current?.click()}
          disabled={enviando}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {enviando ? 'Enviando…' : arquivos.length > 0 ? '📎 Subir outro' : '📎 Subir recibo assinado'}
        </button>
      </div>
      {erro && <p className="mt-2 text-xs text-red-700">{erro}</p>}
      {arquivos.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
          {arquivos.map((a) => (
            <li key={a.nome}>
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
                ✓ {a.nome.endsWith('.pdf') ? 'PDF' : 'Foto'} assinado
                {a.em ? ` — enviado em ${new Date(a.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}` : ''}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

'use client';

// Kit do perfil da casa: bio do Instagram/TikTok e nome de exibição escritos
// pela IA (botões de copiar) + logo pra baixar. Não mexe na conta: a troca da
// bio e da foto é feita pela casa no app (Instagram → Editar perfil; TikTok →
// Editar perfil), porque as APIs não deixam mudar bio nem foto.

import { useState } from 'react';

function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard
          .writeText(texto)
          .then(() => {
            setOk(true);
            setTimeout(() => setOk(false), 1500);
          })
          .catch(() => undefined)
      }
      className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
    >
      {ok ? '✓ copiado' : '📋 Copiar'}
    </button>
  );
}

export function KitPerfil({ filialId, casa, logo }: { filialId: string; casa: string; logo: string | null }) {
  const [ideia, setIdeia] = useState('');
  const [bios, setBios] = useState<{ instagram: string; tiktok: string; nome: string; atual: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function gerar() {
    setOcupado(true);
    setErro('');
    try {
      const r = await fetch('/api/marketing/bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, ideia }),
      });
      const j = (await r.json().catch(() => null)) as Record<string, string> | null;
      if (!r.ok || !j || j.error) throw new Error(j?.error ?? `Falhou (HTTP ${r.status}).`);
      setBios({ instagram: j.instagram ?? '', tiktok: j.tiktok ?? '', nome: j.nome ?? '', atual: j.atual ?? '' });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const linha = (rotulo: string, texto: string, max: number) => (
    <div className="rounded-md bg-slate-50 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {rotulo} <span className="normal-case text-slate-400">({texto.length}/{max})</span>
        </p>
        <Copiar texto={texto} />
      </div>
      <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{texto || '—'}</p>
    </div>
  );

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">🪪 Perfil — {casa}</h2>
      <p className="text-xs text-slate-500">
        Bio e nome escritos pela IA e o logo pra baixar. A troca é no app: Instagram ou TikTok → Editar perfil → cole.
        (As redes não deixam sistema de fora mudar bio nem foto.)
      </p>
      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              value={ideia}
              onChange={(e) => setIdeia(e.target.value)}
              placeholder="o que destacar (opcional): ex. pé na areia, eventos no Terraço"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={gerar}
              disabled={ocupado}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {ocupado ? 'Escrevendo…' : bios ? '✨ Outra versão' : '✨ Escrever bio com IA'}
            </button>
          </div>
          {erro && <p className="text-sm text-rose-700">{erro}</p>}
          {bios && (
            <div className="space-y-2">
              {bios.atual && (
                <p className="text-xs text-slate-500">
                  Bio atual do Instagram: <span className="whitespace-pre-line text-slate-700">{bios.atual}</span>
                </p>
              )}
              {linha('Bio do Instagram', bios.instagram, 150)}
              {linha('Bio do TikTok', bios.tiktok, 80)}
              {linha('Nome de exibição', bios.nome, 30)}
            </div>
          )}
        </div>
        {logo && (
          <div className="text-center">
            <img src={logo} alt="logo" className="mx-auto h-28 w-28 rounded-full border border-slate-200 object-cover" />
            <a href={logo} download className="mt-2 inline-block rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
              ⬇ Baixar logo (1024 px)
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

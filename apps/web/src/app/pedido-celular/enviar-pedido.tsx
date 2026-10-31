'use client';

// Celular: tira a foto do pedido sem nota (uma ou várias folhas do mesmo
// pedido), sobe direto pro bucket e marca "pronto". O computador que mostrou
// o QR pega as fotos e lê o pedido.

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { comprimirImagem } from '@/lib/comprimir-imagem';

function novoGrupo(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.replace(/[^a-z0-9]/g, '').slice(0, 32);
}

export function EnviarPedido({
  f,
  u,
  k,
  e,
  s,
  casa,
}: {
  f: string;
  u: string;
  k: string;
  e: number;
  s: string;
  casa: string;
}) {
  const [fotos, setFotos] = useState<File[]>([]);
  const [previas, setPrevias] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviados, setEnviados] = useState(0);
  const [acabou, setAcabou] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const arqRef = useRef<HTMLInputElement>(null);

  // Solta as prévias só ao sair da página — soltar a cada folha nova apagava a miniatura das anteriores
  const previasRef = useRef<string[]>([]);
  previasRef.current = previas;
  useEffect(() => () => previasRef.current.forEach((p) => p && URL.revokeObjectURL(p)), []);

  async function api(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch('/api/pedido-celular', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ f, u, k, e, s, ...body }),
    });
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) throw new Error(String(j?.error ?? 'Não deu certo'));
    return j ?? {};
  }

  async function escolheu(lista: FileList | null) {
    const arqs = Array.from(lista ?? []);
    if (camRef.current) camRef.current.value = '';
    if (arqRef.current) arqRef.current.value = '';
    if (!arqs.length) return;
    setErro(null);
    setAcabou(false);
    setOcupado('Preparando a foto…');
    try {
      const novos: File[] = [];
      for (const a of arqs) {
        const ehPdf = a.type === 'application/pdf' || /\.pdf$/i.test(a.name);
        novos.push(ehPdf ? a : (await comprimirImagem(a, { maxLado: 2200, qualidade: 0.85 })).arquivo);
      }
      setFotos((ant) => [...ant, ...novos].slice(0, 10));
      setPrevias((ant) =>
        [...ant, ...novos.map((n) => (n.type.startsWith('image/') ? URL.createObjectURL(n) : ''))].slice(0, 10),
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não deu certo');
    } finally {
      setOcupado(null);
    }
  }

  async function enviar() {
    if (!fotos.length) return;
    setErro(null);
    const grupo = novoGrupo();
    try {
      const supa = createClient();
      for (let i = 0; i < fotos.length; i++) {
        const foto = fotos[i]!;
        setOcupado(fotos.length > 1 ? `Enviando foto ${i + 1} de ${fotos.length}…` : 'Enviando…');
        const tipo = foto.type === 'application/pdf' ? 'application/pdf' : foto.type || 'image/jpeg';
        const p = await api({ acao: 'upload_url', grupo, n: i + 1, tipo });
        const up = await supa.storage
          .from(String(p.bucket))
          .uploadToSignedUrl(String(p.path), String(p.token), foto, { contentType: tipo });
        if (up.error) throw new Error(`não consegui guardar a foto: ${up.error.message}`);
      }
      await api({ acao: 'pronto', grupo });
      navigator.vibrate?.(80);
      setEnviados((n) => n + 1);
      setAcabou(true);
      setFotos([]);
      setPrevias([]);
    } catch (err) {
      navigator.vibrate?.([60, 60, 60]);
      setErro(err instanceof Error ? err.message : 'Não deu certo');
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">📸 Pedido sem nota</h1>
        {casa && <p className="text-xs text-slate-500">{casa}</p>}
      </div>

      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(ev) => void escolheu(ev.target.files)}
      />
      <input
        ref={arqRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(ev) => void escolheu(ev.target.files)}
      />

      {erro && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{erro}</p>}

      {acabou && !fotos.length && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="text-base font-semibold">✓ Enviado pro computador</div>
          <p className="mt-1">O computador está lendo o pedido — o resultado aparece lá.</p>
          {enviados > 1 && <p className="mt-1 text-xs">{enviados} pedidos enviados por este QR.</p>}
        </div>
      )}

      {ocupado ? (
        <div className="rounded-xl bg-slate-200 px-4 py-5 text-center text-base font-semibold text-slate-600">
          {ocupado}
        </div>
      ) : fotos.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Fotografe o pedido ou romaneio inteiro, com boa luz. A foto vai pro computador, que lê os itens e os
            valores.
          </p>
          <button
            type="button"
            onClick={() => camRef.current?.click()}
            className="w-full rounded-xl bg-emerald-600 px-4 py-5 text-base font-semibold text-white shadow active:bg-emerald-700"
          >
            📷 {acabou ? 'Fotografar o próximo pedido' : 'Tirar foto do pedido'}
          </button>
          <button
            type="button"
            onClick={() => arqRef.current?.click()}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700"
          >
            escolher da galeria (foto ou PDF)
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {fotos.map((foto, i) => (
              <div key={i} className="relative rounded-lg border border-slate-200 bg-white p-1">
                {previas[i] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previas[i]} alt={`folha ${i + 1}`} className="h-24 w-full rounded object-cover" />
                ) : (
                  <div className="flex h-24 items-center justify-center text-xs text-slate-500">PDF</div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setFotos((ant) => ant.filter((_, j) => j !== i));
                    setPrevias((ant) => ant.filter((_, j) => j !== i));
                  }}
                  className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-xs text-rose-700"
                  aria-label={`tirar a folha ${i + 1}`}
                >
                  ×
                </button>
                <div className="mt-0.5 truncate text-[10px] text-slate-500">
                  folha {i + 1}
                  {foto.type === 'application/pdf' ? ' (PDF)' : ''}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void enviar()}
            className="w-full rounded-xl bg-emerald-600 px-4 py-5 text-base font-semibold text-white shadow active:bg-emerald-700"
          >
            ✅ {fotos.length === 1 ? 'Enviar pro computador' : `Enviar as ${fotos.length} folhas como um pedido só`}
          </button>
          {fotos.length < 10 && (
            <button
              type="button"
              onClick={() => camRef.current?.click()}
              className="w-full rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800"
            >
              ➕ Mais uma folha deste mesmo pedido
            </button>
          )}
        </div>
      )}
    </div>
  );
}

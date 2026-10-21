'use client';

// Botão embaixo de cada post do Instagram: salva a(s) foto(s) (ou o vídeo) no
// celular, já no tamanho do TikTok, e copia a legenda — pra casa postar pelo
// "+" do TikTok sem depender da caixa de entrada. Não fala com o TikTok.
// Dois toques de propósito: o celular só deixa compartilhar/copiar logo depois
// de um toque, e baixar as fotos leva alguns segundos.

import { useState } from 'react';

type Pronto = { arquivos: File[]; legenda: string; videoOriginal?: string };

async function baixar(url: string, nome: string): Promise<File> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const b = await r.blob();
  return new File([b], nome, { type: b.type || (nome.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg') });
}

export function BaixarTiktok({ filialId, postId }: { filialId: string; postId: string }) {
  const [estado, setEstado] = useState<'parado' | 'preparando' | 'pronto' | 'ok' | 'erro'>('parado');
  const [texto, setTexto] = useState('');
  const [pronto, setPronto] = useState<Pronto | null>(null);

  async function preparar() {
    setEstado('preparando');
    setTexto('');
    try {
      const r = await fetch(`/api/marketing/baixar-tiktok?filialId=${encodeURIComponent(filialId)}&postId=${encodeURIComponent(postId)}`, {
        cache: 'no-store',
      });
      const j = (await r.json().catch(() => null)) as {
        error?: string;
        tipo?: 'fotos' | 'video';
        fotos?: string[];
        video?: string;
        videoOriginal?: string;
        legenda?: string;
      } | null;
      if (!r.ok || !j || j.error) {
        setEstado('erro');
        setTexto(j?.error ?? `Falhou (HTTP ${r.status}).`);
        return;
      }
      const arquivos: File[] = [];
      if (j.tipo === 'fotos') {
        const fotos = j.fotos ?? [];
        for (let i = 0; i < fotos.length; i++) arquivos.push(await baixar(fotos[i]!, `prainha-${postId}-${i + 1}.jpg`));
      } else if (j.video) {
        try {
          arquivos.push(await baixar(j.video, `prainha-${postId}.mp4`));
        } catch {
          // vídeo grande pode não passar pelo sistema: tenta direto do Instagram
          if (j.videoOriginal) {
            try {
              arquivos.push(await baixar(j.videoOriginal, `prainha-${postId}.mp4`));
            } catch {
              // sem o arquivo: o botão abre o vídeo pra salvar na mão
            }
          }
        }
      }
      setPronto({ arquivos, legenda: j.legenda ?? '', videoOriginal: j.videoOriginal });
      setEstado('pronto');
    } catch {
      setEstado('erro');
      setTexto('Não consegui baixar. Confira a internet e tente de novo.');
    }
  }

  async function salvar() {
    if (!pronto) return;
    // copia antes de abrir o compartilhar (os dois precisam do toque)
    const copia = pronto.legenda
      ? navigator.clipboard?.writeText(pronto.legenda).then(
          () => true,
          () => false,
        ) ?? Promise.resolve(false)
      : Promise.resolve(false);
    const passo = 'No TikTok: toque em +, escolha da galeria, cole a legenda e publique.';

    if (!pronto.arquivos.length) {
      if (pronto.videoOriginal) window.open(pronto.videoOriginal, '_blank', 'noopener');
      const copiada = await copia;
      setEstado('ok');
      setTexto(`Abri o vídeo: segure em cima e salve.${copiada ? ' Legenda copiada.' : ''} ${passo}`);
      return;
    }

    let compartilhou = false;
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: pronto.arquivos })) {
      try {
        await navigator.share({ files: pronto.arquivos });
        compartilhou = true;
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          setTexto('Cancelado. Toque de novo pra salvar.');
          return;
        }
        // compartilhar falhou: baixa normal abaixo
      }
    }
    if (!compartilhou) {
      for (const f of pronto.arquivos) {
        const url = URL.createObjectURL(f);
        const a = document.createElement('a');
        a.href = url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        await new Promise((ok) => setTimeout(ok, 400));
      }
    }
    const copiada = await copia;
    const n = pronto.arquivos.length;
    const oque = pronto.arquivos[0]!.type.startsWith('video/') ? 'Vídeo' : n > 1 ? `${n} fotos` : 'Foto';
    setEstado('ok');
    setTexto(
      `${compartilhou ? `${oque}: no menu que abriu, escolha "Salvar" (galeria) ou o próprio TikTok.` : `${oque}: baixado.`}` +
        `${copiada ? ' Legenda copiada.' : pronto.legenda ? ' Copie a legenda abaixo.' : ''} ${passo}`,
    );
  }

  async function copiarLegenda() {
    if (!pronto?.legenda) return;
    try {
      await navigator.clipboard.writeText(pronto.legenda);
      setTexto('Legenda copiada.');
    } catch {
      setTexto('O navegador não deixou copiar: segure no texto e copie.');
    }
  }

  return (
    <div className="border-t border-slate-100 px-2 py-1.5">
      {estado === 'pronto' || estado === 'ok' ? (
        <button
          type="button"
          onClick={salvar}
          className="w-full rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
        >
          {estado === 'ok' ? '✓ Salvar de novo + copiar legenda' : '💾 Salvar no celular + copiar legenda'}
        </button>
      ) : (
        <button
          type="button"
          onClick={preparar}
          disabled={estado === 'preparando'}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          {estado === 'preparando' ? 'Preparando…' : '📲 Baixar pro TikTok'}
        </button>
      )}
      {texto && (
        <p className={`mt-1 text-[11px] ${estado === 'erro' ? 'text-rose-700' : 'text-emerald-700'}`}>{texto}</p>
      )}
      {(estado === 'pronto' || estado === 'ok') && pronto?.legenda && (
        <div className="mt-1">
          <textarea
            readOnly
            value={pronto.legenda}
            rows={3}
            className="w-full rounded border border-slate-200 p-1 text-[11px] text-slate-700"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" onClick={copiarLegenda} className="text-[11px] text-slate-600 underline">
            Copiar só a legenda
          </button>
        </div>
      )}
    </div>
  );
}

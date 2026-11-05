// Câmera frontal nas telas do celular (admissão, assinatura, ponto).
// iPhone (Safari e o navegador do WhatsApp) às vezes deixa o <video> PRETO:
// o stream chega, mas o vídeo não liga — o srcObject entrava antes do <video>
// existir, ou o play() era recusado e ninguém tentava de novo. Aqui o vídeo
// é ligado depois de montado, com as marcas que o iOS exige (muted +
// playsinline + autoplay), o play é repetido até aparecer imagem e, se ficar
// preto, a câmera é reaberta uma vez sozinha. Ainda preto → `preta` = true pra
// tela oferecer "Tentar de novo" (e, onde cabe, a câmera do próprio celular).

import { useCallback, useEffect, useState, type MutableRefObject, type RefObject } from 'react';

export async function abrirCameraFrontal(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch (e) {
    // Permissão negada não adianta repetir; o resto (câmera ocupada, tamanho
    // que o aparelho não aceita) tenta de novo do jeito mais simples.
    if ((e as { name?: string })?.name === 'NotAllowedError') throw e;
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  }
}

export function pararStream(s: MediaStream | null | undefined) {
  s?.getTracks().forEach((t) => t.stop());
}

function prepararVideo(v: HTMLVideoElement) {
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.autoplay = true;
  v.setAttribute('muted', '');
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.setAttribute('autoplay', '');
}

/** Liga o stream no vídeo e espera aparecer imagem. true = tem imagem. */
export async function ligarVideo(v: HTMLVideoElement, s: MediaStream, ms = 4000): Promise<boolean> {
  prepararVideo(v);
  if (v.srcObject !== s) v.srcObject = s;
  const tocar = () => {
    v.play().catch(() => {});
  };
  v.onloadedmetadata = tocar;
  v.oncanplay = tocar;
  tocar();
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (s.getVideoTracks().every((t) => t.readyState === 'ended')) return false;
    if (v.videoWidth > 0 && !v.paused) return true;
    await new Promise((r) => setTimeout(r, 250));
    if (v.paused) tocar();
  }
  return v.videoWidth > 0;
}

/**
 * Enquanto `ativa`, mantém o stream de `stream` tocando no `video`.
 * Reabre a câmera uma vez se ficar preta; continuando preta, `preta` = true.
 */
export function useCameraLigada(
  ativa: boolean,
  video: RefObject<HTMLVideoElement | null>,
  stream: MutableRefObject<MediaStream | null>,
) {
  const [preta, setPreta] = useState(false);
  const [rodada, setRodada] = useState(0);

  useEffect(() => {
    setPreta(false);
    if (!ativa) return;
    const v = video.current;
    const s = stream.current;
    if (!v || !s) return;
    let vivo = true;
    (async () => {
      if (await ligarVideo(v, s)) return;
      if (!vivo || stream.current !== s) return;
      pararStream(s);
      try {
        const s2 = await abrirCameraFrontal();
        if (!vivo || stream.current !== s) {
          pararStream(s2);
          return;
        }
        stream.current = s2;
        if (await ligarVideo(v, s2)) return;
      } catch {
        /* cai no aviso abaixo */
      }
      if (vivo) setPreta(true);
    })();
    return () => {
      vivo = false;
    };
  }, [ativa, rodada, video, stream]);

  const tentarDeNovo = useCallback(async () => {
    setPreta(false);
    pararStream(stream.current);
    stream.current = null;
    try {
      stream.current = await abrirCameraFrontal();
      setRodada((r) => r + 1);
    } catch {
      setPreta(true);
    }
  }, [stream]);

  return { preta, tentarDeNovo };
}

/** Foto tirada pela câmera do próprio celular (input capture) → <img> pronta. */
export function carregarImagem(arquivo: File): Promise<HTMLImageElement> {
  return new Promise((ok, erro) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      ok(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      erro(new Error('Não consegui ler a foto. Tente de novo.'));
    };
    img.src = url;
  });
}

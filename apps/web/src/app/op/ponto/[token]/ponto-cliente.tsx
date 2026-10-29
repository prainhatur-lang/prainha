'use client';

// Ponto pelo celular: pega o GPS e uma selfie, calcula o descritor do rosto
// com o mesmo motor do tablet (face-api + wasm, /agente-release/facelib/) e
// manda pro servidor. A foto não sai do celular — só os 128 números.

import { useCallback, useEffect, useRef, useState } from 'react';

const FACELIB = '/agente-release/facelib/';

interface Estado {
  nome: string;
  temRosto: boolean;
  casas: { nome: string; raioM: number }[];
  batidas: { quando: string; tipo: string; casa: string | null }[];
}

type Geo = { lat: number; lng: number; precisao: number };

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    faceapi?: any;
  }
}

let motorPronto: Promise<any> | null = null;
function carregarMotor(): Promise<any> {
  if (motorPronto) return motorPronto;
  motorPronto = (async () => {
    if (!window.faceapi) {
      await new Promise<void>((ok, erro) => {
        const s = document.createElement('script');
        s.src = FACELIB + 'face-api.js';
        s.onload = () => ok();
        s.onerror = () => erro(new Error('não carregou o reconhecimento facial'));
        document.head.appendChild(s);
      });
    }
    const faceapi = window.faceapi;
    let ok = false;
    try {
      try {
        faceapi.tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false);
      } catch {}
      faceapi.tf.setWasmPaths(FACELIB);
      ok = await faceapi.tf.setBackend('wasm');
    } catch {}
    if (!ok) {
      try {
        await faceapi.tf.setBackend('cpu');
      } catch {}
    }
    await faceapi.tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(FACELIB + 'models'),
      faceapi.nets.faceLandmark68Net.loadFromUri(FACELIB + 'models'),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACELIB + 'models'),
    ]);
    return faceapi;
  })();
  motorPronto.catch(() => {
    motorPronto = null;
  });
  return motorPronto;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function pegarGps(): Promise<Geo> {
  return new Promise((ok, erro) => {
    if (!navigator.geolocation) return erro(new Error('Este celular não dá a localização.'));
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy }),
      (e) =>
        erro(
          new Error(
            e.code === 1
              ? 'Você não deixou o site ver a localização. Libere a localização pro navegador e tente de novo.'
              : 'Não consegui a localização. Ligue o GPS (localização precisa) e tente de novo.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 },
    );
  });
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}

export function PontoCelularCliente({ token }: { token: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erroLink, setErroLink] = useState<string | null>(null);
  const [fase, setFase] = useState<'inicio' | 'camera' | 'enviando'>('inicio');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [status, setStatus] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const gps = useRef<Promise<Geo> | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/ponto-celular?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      setErroLink(j.erro ?? 'Link inválido.');
      return;
    }
    setEstado(j);
  }, [token]);

  useEffect(() => {
    carregar();
    // Começa a baixar o motor do rosto já (≈ 8 MB, fica no cache depois).
    carregarMotor().catch(() => {});
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, [carregar]);

  // Tela aberta há tempo fica velha: o gerente pode ter lançado uma batida à
  // mão (correção) e o botão continuava "Bater entrada" (Roberto, 29/10).
  // Recarrega ao voltar pra aba e a cada 30 s. O tipo gravado quem decide é
  // o servidor; isto só deixa o botão igual ao que vai ser gravado.
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') carregar().catch(() => {});
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    const t = window.setInterval(aoVoltar, 30_000);
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
      window.clearInterval(t);
    };
  }, [carregar]);

  function pararCamera() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  async function abrirCamera() {
    setAviso(null);
    carregar().catch(() => {});
    setStatus('Pegando a localização…');
    gps.current = pegarGps();
    gps.current.catch(() => {});
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      stream.current = s;
      setFase('camera');
      setStatus('Olhe de frente pra câmera e toque em “Bater ponto”.');
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
      });
    } catch {
      setStatus('');
      setAviso({ ok: false, texto: 'Não consegui abrir a câmera. Libere a câmera pro navegador e tente de novo.' });
    }
  }

  async function bater() {
    if (!video.current) return;
    setFase('enviando');
    setAviso(null);
    try {
      setStatus('Conferindo o rosto…');
      const faceapi = await carregarMotor();
      let det = null;
      for (let i = 0; i < 6 && !det; i++) {
        det = await faceapi
          .detectSingleFace(video.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (!det) await new Promise((r) => setTimeout(r, 300));
      }
      if (!det) {
        setFase('camera');
        setStatus('');
        setAviso({ ok: false, texto: 'Não achei seu rosto. Fique de frente, com luz no rosto, e tente de novo.' });
        return;
      }
      // Selfie pequena pro gerente conferir quem bateu (não decide nada aqui).
      let selfie: string | undefined;
      try {
        const v = video.current;
        if (v && v.videoWidth) {
          const w = 320;
          const h = Math.round((v.videoHeight / v.videoWidth) * w);
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const ctx = cv.getContext('2d');
          if (ctx) {
            // espelhada, igual a pessoa vê na tela
            ctx.translate(w, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(v, 0, 0, w, h);
            selfie = cv.toDataURL('image/jpeg', 0.7);
          }
        }
      } catch {
        selfie = undefined;
      }
      setStatus('Conferindo a localização…');
      const g = await gps.current!;
      setStatus('Enviando…');
      const r = await fetch('/api/ponto-celular', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, lat: g.lat, lng: g.lng, precisao: g.precisao, descriptor: Array.from(det.descriptor as Float32Array), selfie }),
      });
      const j = await r.json().catch(() => ({}));
      pararCamera();
      setFase('inicio');
      setStatus('');
      if (j.ok) {
        setAviso({ ok: true, texto: `${j.tipo === 'entrada' ? 'Entrada' : 'Saída'} registrada às ${hora(j.quando)} — ${j.casa}.` });
        carregar();
      } else {
        setAviso({ ok: false, texto: j.erro ?? 'Não deu certo. Tente de novo ou bata no tablet.' });
      }
    } catch (e) {
      pararCamera();
      setFase('inicio');
      setStatus('');
      setAviso({ ok: false, texto: e instanceof Error ? e.message : 'Não deu certo. Tente de novo.' });
    }
  }

  if (erroLink) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <p className="max-w-sm text-center text-slate-700">{erroLink}</p>
      </main>
    );
  }
  if (!estado) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-500">Carregando…</p>
      </main>
    );
  }

  const ultima = estado.batidas[estado.batidas.length - 1];
  const dentro = ultima?.tipo === 'entrada';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Olá, {estado.nome}</h1>
          <p className="text-sm text-slate-600">
            Ponto pelo celular — só vale dentro da casa
            {estado.casas.length > 0 && ` (${estado.casas.map((c) => c.nome).join(', ')})`}.
          </p>
        </div>

        {!estado.temRosto && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Seu rosto ainda não está cadastrado. Bata uma vez no tablet da casa pra cadastrar — depois o celular funciona.
          </p>
        )}
        {estado.casas.length === 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            A sua casa ainda não ligou o ponto pelo celular. Bata no tablet.
          </p>
        )}

        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="font-medium text-slate-700">Hoje</div>
          {estado.batidas.length === 0 ? (
            <p className="text-slate-500">Nenhuma batida ainda.</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {estado.batidas.map((b, i) => (
                <li key={i} className="flex justify-between">
                  <span>{b.tipo === 'entrada' ? 'Entrada' : 'Saída'}</span>
                  <span className="font-mono">
                    {hora(b.quando)}
                    {b.casa ? ` · ${b.casa}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {aviso && (
          <p className={`rounded-md px-3 py-3 text-sm font-medium ${aviso.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
            {aviso.texto}
          </p>
        )}

        {fase !== 'inicio' && (
          <div className="overflow-hidden rounded-lg bg-black">
            <video ref={video} playsInline muted className="w-full -scale-x-100" />
          </div>
        )}
        {status && <p className="text-center text-sm text-slate-600">{status}</p>}

        {fase === 'inicio' && (
          <button
            type="button"
            onClick={abrirCamera}
            className="w-full rounded-lg bg-blue-600 py-4 text-lg font-semibold text-white active:bg-blue-700"
          >
            {dentro ? 'Bater saída' : 'Bater entrada'}
          </button>
        )}
        {fase === 'camera' && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                pararCamera();
                setFase('inicio');
                setStatus('');
              }}
              className="flex-1 rounded-lg border border-slate-300 bg-white py-4 text-slate-700"
            >
              Cancelar
            </button>
            <button type="button" onClick={bater} className="flex-[2] rounded-lg bg-blue-600 py-4 text-lg font-semibold text-white active:bg-blue-700">
              Bater ponto
            </button>
          </div>
        )}

        <p className="text-center text-xs text-slate-400">
          A selfie não é guardada: o celular manda só a conferência do rosto e a localização.
        </p>
      </div>
    </main>
  );
}

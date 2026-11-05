'use client';

// Assinatura eletrônica pelo celular: a pessoa vê o documento, confirma o
// CPF, marca "li e concordo", tira uma selfie e assina. O rosto é comparado
// com o do ponto só como registro (quem tem rosto cadastrado); quem não tem
// assina do mesmo jeito.

import { useCallback, useEffect, useRef, useState } from 'react';
import { abrirCameraFrontal, carregarImagem, pararStream, useCameraLigada } from '@/lib/camera-celular';

const FACELIB = '/agente-release/facelib/';

interface Estado {
  nome: string;
  casa: string;
  documento: string;
  ehPdf: boolean;
  /** TRCT gerado pelo sistema (04/11/2026): página HTML e rubrica com o dedo. */
  ehHtml?: boolean;
  exigeRubrica?: boolean;
  status: string;
  assinadoEm: string | null;
  pedeCpf: boolean;
  texto: string;
}

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

function dataHora(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mascaraCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

export function AssinarCliente({ token }: { token: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erroLink, setErroLink] = useState<string | null>(null);
  const [cpf, setCpf] = useState('');
  const [leu, setLeu] = useState(false);
  const [abriuDoc, setAbriuDoc] = useState(false);
  const [fase, setFase] = useState<'form' | 'camera' | 'enviando' | 'feito'>('form');
  const [selfie, setSelfie] = useState<string | null>(null);
  const [rubrica, setRubrica] = useState<string | null>(null);
  const [descritor, setDescritor] = useState<number[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [assinadoEm, setAssinadoEm] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const camera = useCameraLigada(fase === 'camera', video, stream);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/assinatura-publica?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      setErroLink(j.erro ?? 'Link inválido.');
      return;
    }
    setEstado(j);
    if (j.status === 'assinado') {
      setAssinadoEm(j.assinadoEm);
      setFase('feito');
    }
  }, [token]);

  useEffect(() => {
    carregar();
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, [carregar]);

  const urlArquivo = `/api/assinatura-publica?token=${encodeURIComponent(token)}&arquivo=1`;

  function pararCamera() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  async function abrirCamera() {
    setAviso(null);
    carregarMotor().catch(() => {});
    try {
      pararStream(stream.current);
      stream.current = await abrirCameraFrontal();
      // o vídeo liga no useCameraLigada, depois do <video> montado (iPhone ficava preto)
      setFase('camera');
    } catch {
      setAviso('Não consegui abrir a câmera. Libere a câmera para o navegador e tente de novo.');
    }
  }

  async function tirarFoto() {
    const v = video.current;
    if (!v || !v.videoWidth) {
      setAviso('A câmera ainda não abriu. Toque em “Tentar de novo” ou tire pela câmera do celular.');
      return;
    }
    await guardarFoto(v, v.videoWidth, v.videoHeight, true);
  }

  // Câmera do próprio celular (quando a do navegador fica preta no iPhone).
  async function fotoDoCelular(arquivos: FileList | null) {
    const f = arquivos?.[0];
    if (!f) return;
    setAviso(null);
    try {
      const img = await carregarImagem(f);
      await guardarFoto(img, img.naturalWidth, img.naturalHeight, false);
    } catch (e) {
      setStatus('');
      setAviso((e as Error).message || 'Não consegui ler a foto. Tente de novo.');
    }
  }

  async function guardarFoto(fonte: HTMLVideoElement | HTMLImageElement, fw: number, fh: number, espelhar: boolean) {
    if (!fw || !fh) return;
    setStatus('Conferindo o rosto…');
    let descr: number[] | null = null;
    try {
      const faceapi = await carregarMotor();
      let det = null;
      for (let i = 0; i < (espelhar ? 6 : 1) && !det; i++) {
        det = await faceapi
          .detectSingleFace(fonte, new faceapi.TinyFaceDetectorOptions({ inputSize: espelhar ? 224 : 416, scoreThreshold: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (!det && espelhar) await new Promise((r) => setTimeout(r, 300));
      }
      if (!det) {
        setStatus('');
        setAviso('Não achei seu rosto. Fique de frente, com luz no rosto, e tente de novo.');
        return;
      }
      descr = Array.from(det.descriptor as Float32Array);
    } catch {
      // motor não carregou (celular antigo): a selfie vale do mesmo jeito
      descr = null;
    }
    const w = 480;
    const h = Math.round((fh / fw) * w);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    if (espelhar) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(fonte, 0, 0, w, h);
    setSelfie(cv.toDataURL('image/jpeg', 0.75));
    setDescritor(descr);
    setStatus('');
    setAviso(null);
    pararCamera();
    setFase('form');
  }

  async function assinar() {
    setAviso(null);
    setFase('enviando');
    try {
      const r = await fetch('/api/assinatura-publica', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, cpf, aceite: leu, selfie, descriptor: descritor, rubrica: rubrica ?? undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        setAssinadoEm(j.assinadoEm ?? new Date().toISOString());
        setFase('feito');
      } else {
        setFase('form');
        setAviso(j.erro ?? 'Não deu certo. Tente de novo.');
      }
    } catch {
      setFase('form');
      setAviso('Sem conexão. Tente de novo.');
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

  const cpfOk = !estado.pedeCpf || cpf.replace(/\D/g, '').length === 11;
  const cpfDigitado = cpf.replace(/\D/g, '').length === 11;
  const faltaRubrica = !!estado.exigeRubrica && !rubrica;
  const pode = leu && cpfDigitado && cpfOk && !!selfie && !faltaRubrica && fase === 'form';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <header>
          <p className="text-xs uppercase tracking-wide text-slate-500">{estado.casa}</p>
          <h1 className="text-xl font-semibold text-slate-900">Assinar documento</h1>
          <p className="mt-1 text-sm text-slate-600">
            {estado.nome} · <b>{estado.documento}</b>
          </p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-sm font-medium text-slate-800">1. Leia o documento</p>
          {estado.ehHtml ? (
            <iframe
              src={urlArquivo}
              sandbox=""
              title="Documento"
              className="mb-2 h-[70vh] w-full rounded border border-slate-200 bg-white"
            />
          ) : estado.ehPdf ? null : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urlArquivo} alt="Documento" className="mb-2 w-full rounded border border-slate-200" />
          )}
          <a
            href={urlArquivo}
            target="_blank"
            rel="noreferrer"
            onClick={() => setAbriuDoc(true)}
            className="block rounded-md bg-slate-800 px-4 py-3 text-center text-sm font-medium text-white"
          >
            📄 Abrir o documento {estado.ehPdf ? '(PDF)' : 'inteiro'}
          </a>
          {abriuDoc ? <p className="mt-1 text-xs text-slate-500">Depois de ler, volte para esta tela.</p> : null}
        </section>

        {fase === 'feito' ? (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
            <p className="text-lg font-semibold text-emerald-800">✅ Documento assinado</p>
            {assinadoEm ? <p className="mt-1 text-sm text-emerald-700">em {dataHora(assinadoEm)}</p> : null}
            <p className="mt-2 text-xs text-emerald-700">A empresa já recebeu a sua assinatura. Pode fechar esta tela.</p>
          </section>
        ) : (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-3">
              <label className="mb-1 block text-sm font-medium text-slate-800" htmlFor="cpf">
                2. Seu CPF
              </label>
              <input
                id="cpf"
                inputMode="numeric"
                autoComplete="off"
                value={mascaraCpf(cpf)}
                onChange={(e) => setCpf(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="000.000.000-00"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-base"
              />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="mb-2 text-sm font-medium text-slate-800">3. Sua foto (selfie)</p>
              {fase === 'camera' ? (
                <div className="space-y-2">
                  <video
                    ref={video}
                    playsInline
                    muted
                    autoPlay
                    className="w-full rounded-md bg-black"
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  {camera.preta ? (
                    <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      A câmera ficou preta. Toque em “Tentar de novo” ou tire pela câmera do celular.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={tirarFoto}
                    className="w-full rounded-md bg-sky-600 px-4 py-3 text-sm font-medium text-white"
                  >
                    📸 Tirar a foto
                  </button>
                  {status ? <p className="text-center text-xs text-slate-500">{status}</p> : null}
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <button type="button" onClick={() => camera.tentarDeNovo()} className="text-sky-700 underline">
                      🔄 Tentar de novo
                    </button>
                    <label className="cursor-pointer text-sky-700 underline">
                      📱 Tirar pela câmera do celular
                      <input
                        type="file"
                        accept="image/*"
                        capture="user"
                        className="hidden"
                        onChange={(e) => {
                          fotoDoCelular(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>
              ) : selfie ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={selfie} alt="Sua selfie" className="h-20 w-20 rounded-md object-cover" />
                  <button type="button" onClick={abrirCamera} className="text-sm text-sky-700 underline">
                    tirar de novo
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={abrirCamera}
                  className="w-full rounded-md border border-sky-600 px-4 py-3 text-sm font-medium text-sky-700"
                >
                  📷 Abrir a câmera
                </button>
              )}
            </section>

            {estado.exigeRubrica ? (
              <section className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="mb-2 text-sm font-medium text-slate-800">4. Sua rubrica (assine com o dedo)</p>
                <QuadroRubrica onChange={setRubrica} />
              </section>
            ) : null}

            <section className="rounded-lg border border-slate-200 bg-white p-3">
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={leu} onChange={(e) => setLeu(e.target.checked)} className="mt-1 h-5 w-5" />
                <span>{estado.texto}</span>
              </label>
            </section>

            {aviso ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{aviso}</p> : null}

            <button
              type="button"
              disabled={!pode}
              onClick={assinar}
              className="w-full rounded-md bg-emerald-600 px-4 py-4 text-base font-semibold text-white disabled:opacity-40"
            >
              {fase === 'enviando' ? 'Assinando…' : '✍️ Assinar'}
            </button>
            {!pode && fase === 'form' ? (
              <p className="text-center text-xs text-slate-500">
                Falta: {[!cpfDigitado && 'CPF', !selfie && 'selfie', faltaRubrica && 'rubrica', !leu && 'marcar que leu e concorda'].filter(Boolean).join(', ')}
              </p>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

/** Quadro pra rubrica com o dedo (ou mouse). Devolve PNG em data URL, ou null se vazio. */
function QuadroRubrica({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const tracos = useRef(0);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
  }, []);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <canvas
        ref={ref}
        className="h-40 w-full touch-none rounded-md border border-dashed border-slate-400 bg-slate-50"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          const p = ponto(e);
          desenhando.current = true;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!desenhando.current) return;
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          const p = ponto(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          tracos.current += 1;
        }}
        onPointerUp={(e) => {
          if (!desenhando.current) return;
          desenhando.current = false;
          onChange(tracos.current >= 8 ? e.currentTarget.toDataURL('image/png') : null);
        }}
      />
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>Assine dentro do quadro.</span>
        <button
          type="button"
          className="text-sky-700 underline"
          onClick={() => {
            const cv = ref.current;
            const ctx = cv?.getContext('2d');
            if (cv && ctx) {
              ctx.save();
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.clearRect(0, 0, cv.width, cv.height);
              ctx.restore();
            }
            tracos.current = 0;
            onChange(null);
          }}
        >
          limpar
        </button>
      </div>
    </div>
  );
}

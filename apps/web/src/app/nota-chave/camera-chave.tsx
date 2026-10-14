'use client';

// Câmera ao vivo do celular lendo o código de barras do DANFE. Achou a chave
// (dígito verificador conferido) → vibra e já manda trazer a nota da SEFAZ;
// continua lendo a próxima. Se o código de barras não sair, "Tirar foto" manda
// o quadro pra IA ler os 44 números impressos.

import { useEffect, useRef, useState } from 'react';
import { brl } from '@/lib/format';
import {
  lerChaveDaImagem,
  lerCodigoDeBarras,
  prepararLeitor,
  reduzirFoto,
} from '../movimento/entrada-notas/ler-chave-foto';

type Estado = 'enviando' | 'ok' | 'aviso' | 'erro';
interface Nota {
  numero: string | null;
  emitNome: string | null;
  valorTotal: string | null;
}
interface Item {
  chave: string;
  estado: Estado;
  texto: string;
  nota?: Nota | null;
}
interface RespEnviar {
  ok?: boolean;
  error?: string;
  status?: 'COMPLETA' | 'RESUMO' | 'JA_EXISTE' | 'NAO_ENCONTRADA' | 'BLOQUEIO';
  motivo?: string;
  nota?: Nota | null;
}

const PAUSA_SEFAZ_MS = 60 * 60 * 1000; // 656: a SEFAZ bloqueia o CNPJ por 1 h

function chaveEmGrupos(c: string) {
  return c.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function CameraChave({ f, e, s, casa }: { f: string; e: number; s: string; casa: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const lidasRef = useRef(new Set<string>());
  const ocupadoRef = useRef(false);
  const pausaAteRef = useRef(0);
  const [tentativa, setTentativa] = useState(0);
  const [fase, setFase] = useState<'abrindo' | 'camera' | 'sem-camera'>('abrindo');
  const [erroCamera, setErroCamera] = useState('');
  const [leitorPronto, setLeitorPronto] = useState(false);
  const [itens, setItens] = useState<Item[]>([]);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [lanterna, setLanterna] = useState<boolean | null>(null); // null = celular sem lanterna
  const [leu, setLeu] = useState(false); // moldura verde por um instante

  function atualizar(chave: string, p: Partial<Item>) {
    setItens((l) => l.map((i) => (i.chave === chave ? { ...i, ...p } : i)));
  }

  async function enviar(chave: string) {
    setItens((l) => [
      { chave, estado: 'enviando', texto: 'Buscando na SEFAZ...' },
      ...l.filter((i) => i.chave !== chave),
    ]);
    if (Date.now() < pausaAteRef.current) {
      const hora = new Date(pausaAteRef.current).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      atualizar(chave, {
        estado: 'erro',
        texto: `A SEFAZ pediu pausa por excesso de consultas. Toque em "Tentar de novo" depois das ${hora}.`,
      });
      return;
    }
    try {
      const r = await fetch('/api/nota-chave/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ f, e, s, chave }),
      });
      const d = (await r.json().catch(() => ({}))) as RespEnviar;
      if (!r.ok || !d.ok) {
        atualizar(chave, { estado: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      if (d.status === 'BLOQUEIO') pausaAteRef.current = Date.now() + PAUSA_SEFAZ_MS;
      const estado: Estado =
        d.status === 'COMPLETA' || d.status === 'JA_EXISTE' ? 'ok' : d.status === 'RESUMO' ? 'aviso' : 'erro';
      const texto =
        d.status === 'COMPLETA'
          ? 'Nota trazida com o XML completo'
          : d.status === 'JA_EXISTE'
            ? 'Essa nota já estava no sistema'
            : d.status === 'BLOQUEIO'
              ? 'A SEFAZ pediu pausa de 1 hora por excesso de consultas — tente de novo depois'
              : (d.motivo ?? d.status ?? '');
      atualizar(chave, { estado, texto, nota: d.nota });
    } catch (err) {
      atualizar(chave, { estado: 'erro', texto: `Sem internet? ${(err as Error).message}` });
    }
  }

  function achou(chave: string, deNovo = false) {
    if (lidasRef.current.has(chave) && !deNovo) return;
    lidasRef.current.add(chave);
    navigator.vibrate?.(120);
    setLeu(true);
    setTimeout(() => setLeu(false), 700);
    void enviar(chave);
  }
  // o laço da câmera roda fora do render: sempre chama a versão atual
  const achouRef = useRef(achou);
  useEffect(() => {
    achouRef.current = achou;
  });

  useEffect(() => {
    let vivo = true;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const faixa = document.createElement('canvas');

    prepararLeitor()
      .then(() => vivo && setLeitorPronto(true))
      .catch(() => vivo && setAviso({ texto: 'O leitor de código de barras não carregou — use "Tirar foto".', erro: true }));

    // lê só a faixa do meio do quadro (a moldura na tela), 4x por segundo
    async function quadro() {
      if (!vivo) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && v.videoWidth && !ocupadoRef.current && !document.hidden) {
        ocupadoRef.current = true;
        try {
          const w = v.videoWidth;
          const h = v.videoHeight;
          const y0 = Math.round(h * 0.3);
          const hh = Math.round(h * 0.4);
          faixa.width = w;
          faixa.height = hh;
          faixa.getContext('2d')?.drawImage(v, 0, y0, w, hh, 0, 0, w, hh);
          const chave = await lerChaveDaImagem(faixa, true);
          if (chave && vivo) achouRef.current(chave);
        } catch {
          // quadro ruim — vai o próximo
        } finally {
          ocupadoRef.current = false;
        }
      }
      timer = setTimeout(quadro, 250);
    }

    (async () => {
      setFase('abrindo');
      if (!navigator.mediaDevices?.getUserMedia) {
        setErroCamera('Este navegador não deixa abrir a câmera aqui.');
        setFase('sem-camera');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (!vivo) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        track.addEventListener('ended', () => {
          if (!vivo) return;
          setErroCamera('A câmera fechou.');
          setFase('sem-camera');
        });
        const cap = (track.getCapabilities?.() ?? {}) as { torch?: boolean; focusMode?: string[] };
        if (cap.torch) setLanterna(false);
        if (cap.focusMode?.includes('continuous')) {
          track
            .applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
            .catch(() => {});
        }
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setFase('camera');
        void quadro();
      } catch (err) {
        const nome = (err as { name?: string }).name;
        setErroCamera(
          nome === 'NotAllowedError'
            ? 'A câmera foi bloqueada. Libere a câmera pra este site (no cadeado/“aA” da barra de endereço) e toque em "Abrir a câmera de novo".'
            : `Não deu pra abrir a câmera: ${(err as Error).message}`,
        );
        setFase('sem-camera');
      }
    })();

    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
  }, [tentativa]);

  async function alternarLanterna() {
    const t = trackRef.current;
    if (!t || lanterna === null) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !lanterna } as MediaTrackConstraintSet] });
      setLanterna(!lanterna);
    } catch {
      setLanterna(null);
    }
  }

  // Foto (quadro da câmera ou foto da câmera do celular): código de barras
  // primeiro; se não sair, a IA lê os 44 números impressos.
  async function lerFoto(foto: Blob | HTMLCanvasElement) {
    setAviso({ texto: 'Lendo a foto...' });
    try {
      let chave =
        foto instanceof Blob
          ? await lerCodigoDeBarras(foto).catch(() => null)
          : await lerChaveDaImagem(foto).catch(() => null);
      if (!chave) {
        setAviso({ texto: 'Código de barras não saiu — lendo os números da chave...' });
        const fd = new FormData();
        fd.append('f', f);
        fd.append('e', String(e));
        fd.append('s', s);
        fd.append('foto', await reduzirFoto(foto), 'chave.jpg');
        const r = await fetch('/api/notas/ler-chave-foto', { method: 'POST', body: fd });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; chave?: string; error?: string };
        if (!d.ok || !d.chave) {
          setAviso({ texto: d.error ?? `HTTP ${r.status}`, erro: true });
          return;
        }
        chave = d.chave;
      }
      setAviso(null);
      achou(chave, true);
    } catch (err) {
      setAviso({ texto: `Não deu pra ler a foto: ${(err as Error).message}`, erro: true });
    }
  }

  function tirarFoto() {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    void lerFoto(c);
  }

  const lendoFoto = aviso !== null && !aviso.erro;

  return (
    <div className="pb-8">
      <header className="px-4 pb-3 pt-4">
        <h1 className="text-base font-semibold">📷 Chave de acesso da nota</h1>
        <p className="mt-0.5 text-xs text-slate-400">
          {casa ? `${casa} · ` : ''}aponte pro código de barras do DANFE — a nota entra sozinha
        </p>
      </header>

      <div className="relative bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`block h-auto w-full ${fase === 'camera' ? '' : 'min-h-[240px] opacity-0'}`}
        />
        {fase === 'camera' && (
          <div
            className={`pointer-events-none absolute inset-x-[4%] top-[30%] h-[40%] rounded-xl border-2 transition-colors ${
              leu ? 'border-emerald-400 bg-emerald-400/20' : 'border-white/80'
            }`}
          >
            <div className="absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2 bg-rose-500/80" />
          </div>
        )}
        {fase === 'abrindo' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
            Abrindo a câmera...
          </p>
        )}
        {fase === 'sem-camera' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
            <p className="text-sm text-slate-200">{erroCamera}</p>
            <button
              type="button"
              onClick={() => setTentativa((t) => t + 1)}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900"
            >
              Abrir a câmera de novo
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3 px-4 pt-3">
        {fase === 'camera' && (
          <p className="text-center text-xs text-slate-400">
            {leitorPronto
              ? 'Deixe o código de barras dentro da moldura, deitado e sem tremer.'
              : 'Preparando o leitor...'}
          </p>
        )}

        <div className="flex gap-2">
          {fase === 'camera' ? (
            <button
              type="button"
              onClick={tirarFoto}
              disabled={lendoFoto}
              className="flex-1 rounded-xl bg-white py-3 text-sm font-semibold text-slate-900 disabled:opacity-50"
            >
              📸 Tirar foto
            </button>
          ) : (
            // sem a câmera ao vivo: a câmera do próprio celular tira a foto
            <label
              className={`flex-1 cursor-pointer rounded-xl bg-white py-3 text-center text-sm font-semibold text-slate-900 ${
                lendoFoto ? 'pointer-events-none opacity-50' : ''
              }`}
            >
              📸 Tirar foto da chave
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(ev) => {
                  const foto = ev.target.files?.[0];
                  ev.target.value = '';
                  if (foto) void lerFoto(foto);
                }}
              />
            </label>
          )}
          {fase === 'camera' && lanterna !== null && (
            <button
              type="button"
              onClick={alternarLanterna}
              className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                lanterna ? 'bg-amber-300 text-slate-900' : 'bg-slate-800 text-white'
              }`}
            >
              🔦
            </button>
          )}
        </div>
        {fase === 'camera' && (
          <p className="text-center text-[11px] text-slate-500">
            Se o código de barras estiver ruim, chegue perto dos números da chave e toque em Tirar foto.
          </p>
        )}

        {aviso && (
          <p className={`rounded-lg px-3 py-2 text-xs ${aviso.erro ? 'bg-rose-950 text-rose-200' : 'bg-slate-800 text-slate-200'}`}>
            {aviso.texto}
          </p>
        )}

        {itens.length > 0 && (
          <ul className="space-y-2">
            {itens.map((i) => (
              <li
                key={i.chave}
                className={`rounded-xl p-3 text-xs ${
                  i.estado === 'ok'
                    ? 'bg-emerald-950 text-emerald-100'
                    : i.estado === 'aviso'
                      ? 'bg-amber-950 text-amber-100'
                      : i.estado === 'erro'
                        ? 'bg-rose-950 text-rose-100'
                        : 'bg-slate-800 text-slate-200'
                }`}
              >
                <p className="font-semibold">
                  {i.estado === 'enviando' ? '⏳' : i.estado === 'ok' ? '✓' : i.estado === 'aviso' ? '⚠' : '✗'}{' '}
                  {i.nota?.emitNome ?? 'Nota'}
                  {i.nota?.numero ? ` · NF ${i.nota.numero}` : ''}
                  {i.nota?.valorTotal ? ` · ${brl(i.nota.valorTotal)}` : ''}
                </p>
                <p className="mt-0.5">{i.texto}</p>
                <p className="mt-1 font-mono text-[10px] opacity-60">{chaveEmGrupos(i.chave)}</p>
                {i.estado === 'erro' && (
                  <button
                    type="button"
                    onClick={() => void enviar(i.chave)}
                    className="mt-2 rounded-lg bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-900"
                  >
                    Tentar de novo
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="pt-2 text-center text-[11px] text-slate-500">
          Pode ler várias notas seguidas. No computador, a Entrada de notas atualiza sozinha.
        </p>
      </div>
    </div>
  );
}

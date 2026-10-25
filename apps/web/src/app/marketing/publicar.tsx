'use client';

// Bloco "Publicar" do /marketing (pedido do dono 21/10/2026): põe fotos ou um
// vídeo, a IA escreve a legenda, escolhe Instagram e/ou TikTok, publica agora
// ou agenda. O arquivo sobe direto do navegador pro bucket (até 50 MB); quem
// publica é /api/marketing/posts (agora) ou o cron de 5 em 5 min (agendado).

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export interface PostVisto {
  id: string;
  status: string;
  legenda: string;
  redes: string[];
  midias: Array<{ tipo: 'foto' | 'video'; nome?: string }>;
  capa: string | null;
  agendadoPara: string | null;
  criadoEm: string;
  publicadoEm: string | null;
  erro: string | null;
  resultado: Record<string, { estado: string; link?: string; erro?: string; obs?: string }>;
}

interface Redes {
  igLigado: boolean;
  igPodePublicar: boolean;
  ttLigado: boolean;
  ttRascunho: boolean;
}

interface Arquivo {
  chave: string;
  nome: string;
  tipo: 'foto' | 'video';
  previa: string; // data URL pequena (tela + IA)
  situacao: 'enviando' | 'ok' | 'erro';
  path?: string;
  erro?: string;
}

const MAX = 50 * 1024 * 1024;
const NOME_REDE: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok' };
const STATUS: Record<string, { txt: string; cor: string }> = {
  RASCUNHO: { txt: 'Rascunho', cor: 'bg-slate-100 text-slate-700' },
  AGENDADO: { txt: 'Agendado', cor: 'bg-sky-100 text-sky-800' },
  PUBLICANDO: { txt: 'Saindo…', cor: 'bg-amber-100 text-amber-800' },
  PUBLICADO: { txt: 'Publicado', cor: 'bg-emerald-100 text-emerald-800' },
  PARCIAL: { txt: 'Saiu em parte', cor: 'bg-amber-100 text-amber-800' },
  ERRO: { txt: 'Não saiu', cor: 'bg-rose-100 text-rose-800' },
  AGUARDANDO: { txt: 'Esperando aprovação', cor: 'bg-violet-100 text-violet-800' },
  RECUSADO: { txt: 'Recusado', cor: 'bg-slate-200 text-slate-600' },
};

export const quandoBr = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/** Foto → JPEG (o Instagram só aceita JPEG), cortada no meio pra caber entre
 *  4:5 e 1,91:1 (foto de celular em pé, 3:4, seria recusada) e com no máximo
 *  1440 px de largura. Devolve o arquivo e uma prévia pequena. */
export async function prepararFoto(f: File): Promise<{ blob: Blob; previa: string }> {
  const bmp = await createImageBitmap(f);
  let sx = 0;
  let sy = 0;
  let sw = bmp.width;
  let sh = bmp.height;
  const r = sw / sh;
  if (r < 0.8) {
    sh = Math.round(sw / 0.8);
    sy = Math.round((bmp.height - sh) / 2);
  } else if (r > 1.91) {
    sw = Math.round(sh * 1.91);
    sx = Math.round((bmp.width - sw) / 2);
  }
  const escala = Math.min(1, 1440 / sw);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * escala);
  c.height = Math.round(sh * escala);
  c.getContext('2d')!.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((ok, falha) =>
    c.toBlob((b) => (b ? ok(b) : falha(new Error('não converti a foto'))), 'image/jpeg', 0.9),
  );
  return { blob, previa: miniatura(c) };
}

function miniatura(origem: HTMLCanvasElement | HTMLVideoElement): string {
  const w = origem instanceof HTMLVideoElement ? origem.videoWidth : origem.width;
  const h = origem instanceof HTMLVideoElement ? origem.videoHeight : origem.height;
  const e = Math.min(1, 512 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * e));
  c.height = Math.max(1, Math.round(h * e));
  c.getContext('2d')!.drawImage(origem, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}

/** Um quadro do vídeo (1 s) pra mostrar e pra IA ver. */
export function quadroDoVideo(f: File): Promise<string> {
  return new Promise((ok) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(f);
    const fim = (s: string) => {
      URL.revokeObjectURL(url);
      ok(s);
    };
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
    };
    v.onseeked = () => {
      try {
        fim(miniatura(v));
      } catch {
        fim('');
      }
    };
    v.onerror = () => fim('');
    setTimeout(() => fim(''), 15000);
    v.src = url;
  });
}

export async function chamar(url: string, metodo: string, corpo: unknown) {
  const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!r.ok || !j || j.error) throw new Error(String(j?.error ?? `Falhou (HTTP ${r.status}).`));
  return j;
}

export function Publicar({
  filialId,
  casa,
  redes,
  posts,
}: {
  filialId: string;
  casa: string;
  redes: Redes;
  posts: PostVisto[];
}) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivos, setArquivos] = useState<Arquivo[]>([]);
  const [ideia, setIdeia] = useState('');
  const [legenda, setLegenda] = useState('');
  const [escolhidas, setEscolhidas] = useState<string[]>(() => [
    ...(redes.igLigado ? ['instagram'] : []),
    ...(redes.ttLigado ? ['tiktok'] : []),
  ]);
  const [modo, setModo] = useState<'agora' | 'agendar'>('agora');
  const [quando, setQuando] = useState('');
  const [ocupado, setOcupado] = useState<'' | 'ia' | 'publicando'>('');
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [mexendo, setMexendo] = useState('');

  const temVideo = arquivos.some((a) => a.tipo === 'video');
  const enviando = arquivos.some((a) => a.situacao === 'enviando');
  const prontos = arquivos.filter((a) => a.situacao === 'ok');

  const atualizar = (chave: string, mudar: Partial<Arquivo>) =>
    setArquivos((l) => l.map((a) => (a.chave === chave ? { ...a, ...mudar } : a)));

  async function adicionar(lista: FileList | File[]) {
    setMsg(null);
    const novos = [...lista];
    if (!novos.length) return;
    const videos = novos.filter((f) => f.type.startsWith('video/'));
    const fotos = novos.filter((f) => f.type.startsWith('image/'));
    if (videos.length && (fotos.length || videos.length > 1 || arquivos.length)) {
      setMsg({ ok: false, txt: 'Vídeo vai sozinho: um vídeo por post. Para várias fotos, até 10 de uma vez.' });
      return;
    }
    if (temVideo && fotos.length) {
      setMsg({ ok: false, txt: 'Este post já tem um vídeo. Tire o vídeo para pôr fotos.' });
      return;
    }
    if (arquivos.length + fotos.length > 10) {
      setMsg({ ok: false, txt: 'No máximo 10 fotos por post.' });
      return;
    }
    for (const f of [...videos, ...fotos]) {
      const chave = `${Date.now()}-${Math.random()}`;
      const video = f.type.startsWith('video/');
      if (video && f.size > MAX) {
        setMsg({ ok: false, txt: `${f.name}: vídeo maior que 50 MB. Exporte em 1080p ou corte um pouco.` });
        continue;
      }
      setArquivos((l) => [...l, { chave, nome: f.name, tipo: video ? 'video' : 'foto', previa: '', situacao: 'enviando' }]);
      try {
        let corpo: Blob = f;
        let nome = f.name;
        let tipo = f.type;
        let previa = '';
        if (video) {
          previa = await quadroDoVideo(f);
          if (tipo !== 'video/mp4' && tipo !== 'video/quicktime') tipo = 'video/mp4';
        } else {
          const p = await prepararFoto(f);
          corpo = p.blob;
          previa = p.previa;
          nome = f.name.replace(/\.[^.]+$/, '') + '.jpg';
          tipo = 'image/jpeg';
        }
        atualizar(chave, { previa });
        const passo1 = await chamar('/api/marketing/upload-url', 'POST', { filialId, nome, tamanho: corpo.size, tipo });
        const up = await createClient()
          .storage.from(String(passo1.bucket))
          .uploadToSignedUrl(String(passo1.path), String(passo1.token), corpo, { contentType: tipo });
        if (up.error) throw new Error(up.error.message);
        atualizar(chave, { situacao: 'ok', path: String(passo1.path) });
      } catch (e) {
        atualizar(chave, {
          situacao: 'erro',
          erro: video ? (e as Error).message : `Não consegui abrir/enviar a foto (${(e as Error).message}).`,
        });
      }
    }
  }

  async function escreverComIa() {
    setOcupado('ia');
    setMsg(null);
    try {
      const imagens = arquivos
        .map((a) => a.previa)
        .filter(Boolean)
        .slice(0, 4)
        .map((d) => d.split(',')[1] ?? '');
      const j = await chamar('/api/marketing/legenda', 'POST', {
        filialId,
        ideia,
        imagens,
        video: temVideo,
        redes: escolhidas,
      });
      setLegenda(String(j.legenda ?? ''));
    } catch (e) {
      setMsg({ ok: false, txt: (e as Error).message });
    } finally {
      setOcupado('');
    }
  }

  async function publicar() {
    setMsg(null);
    if (!prontos.length) return setMsg({ ok: false, txt: 'Ponha pelo menos uma foto ou um vídeo.' });
    if (enviando) return setMsg({ ok: false, txt: 'Espere os arquivos terminarem de subir.' });
    if (!escolhidas.length) return setMsg({ ok: false, txt: 'Escolha Instagram, TikTok ou os dois.' });
    let agendadoPara: string | null = null;
    if (modo === 'agendar') {
      if (!quando) return setMsg({ ok: false, txt: 'Escolha o dia e a hora.' });
      agendadoPara = new Date(`${quando}:00-03:00`).toISOString(); // hora de Aracaju
    }
    setOcupado('publicando');
    try {
      const j = await chamar('/api/marketing/posts', 'POST', {
        filialId,
        midias: prontos.map((a) => ({ path: a.path, tipo: a.tipo, nome: a.nome })),
        legenda,
        redes: escolhidas,
        agendadoPara,
      });
      const p = j.post as { status?: string; erro?: string | null } | undefined;
      const st = String(p?.status ?? '');
      setMsg(
        st === 'AGENDADO'
          ? { ok: true, txt: `Agendado para ${quandoBr(agendadoPara)}. Sai sozinho.` }
          : st === 'PUBLICADO'
            ? { ok: true, txt: 'Publicado! Veja o resultado logo abaixo.' }
            : st === 'PUBLICANDO'
              ? { ok: true, txt: 'Enviado. O Instagram ainda está processando o vídeo; sai sozinho em alguns minutos.' }
              : { ok: false, txt: p?.erro || 'Não saiu. Veja o motivo no histórico abaixo.' },
      );
      if (st === 'AGENDADO' || st === 'PUBLICADO' || st === 'PUBLICANDO' || st === 'PARCIAL') {
        setArquivos([]);
        setIdeia('');
        setLegenda('');
      }
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, txt: (e as Error).message });
    } finally {
      setOcupado('');
    }
  }

  async function acao(id: string, qual: 'refazer' | 'excluir' | 'publicar') {
    if (qual === 'excluir' && !window.confirm('Apagar este post (e os arquivos dele)?')) return;
    setMexendo(id);
    try {
      await chamar('/api/marketing/posts', 'PATCH', { filialId, id, acao: qual });
      router.refresh();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setMexendo('');
    }
  }

  const alternar = (r: string) => setEscolhidas((l) => (l.includes(r) ? l.filter((x) => x !== r) : [...l, r]));

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">📤 Publicar — {casa}</h2>
      <p className="text-xs text-slate-500">Fotos (até 10) ou um vídeo, legenda pela IA, e escolhe onde e quando sai.</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setArrastando(true);
            }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastando(false);
              void adicionar(e.dataTransfer.files);
            }}
            onClick={() => entrada.current?.click()}
            className={`flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center text-sm ${
              arrastando ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <p className="font-medium text-slate-700">📷 Toque para escolher fotos ou um vídeo</p>
            <p className="mt-1 text-xs text-slate-500">ou arraste aqui · vídeo MP4/MOV até 50 MB</p>
            <input
              ref={entrada}
              type="file"
              multiple
              accept="image/*,video/mp4,video/quicktime"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void adicionar(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {arquivos.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {arquivos.map((a) => (
                <div key={a.chave} className="relative overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                  {a.previa ? (
                    <img src={a.previa} alt="" className="aspect-[4/5] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[4/5] w-full items-center justify-center text-2xl">{a.tipo === 'video' ? '🎬' : '🖼'}</div>
                  )}
                  <span
                    className={`absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[10px] ${
                      a.situacao === 'ok' ? 'bg-emerald-600 text-white' : a.situacao === 'erro' ? 'bg-rose-600 text-white' : 'bg-black/60 text-white'
                    }`}
                    title={a.erro}
                  >
                    {a.situacao === 'ok' ? `✓ ${a.tipo === 'video' ? 'vídeo' : 'foto'}` : a.situacao === 'erro' ? `✗ ${a.erro ?? 'erro'}` : 'subindo…'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setArquivos((l) => l.filter((x) => x.chave !== a.chave))}
                    className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white hover:bg-black"
                    aria-label="tirar"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {arquivos.some((a) => a.tipo === 'foto') && (
            <p className="mt-2 text-[11px] text-slate-500">
              Foto em pé de celular é cortada no meio para 4:5 (o tamanho máximo que o Instagram aceita no feed).
            </p>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Ideia do post (opcional)</label>
            <input
              value={ideia}
              onChange={(e) => setIdeia(e.target.value)}
              placeholder="ex.: moqueca nova de camarão, sábado com música ao vivo"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={escreverComIa}
              disabled={ocupado !== '' || (!arquivos.some((a) => a.previa) && !ideia.trim())}
              className="mt-2 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {ocupado === 'ia' ? 'Escrevendo…' : legenda ? '✨ Escrever outra legenda' : '✨ Escrever legenda com IA'}
            </button>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Legenda</label>
            <textarea
              value={legenda}
              onChange={(e) => setLegenda(e.target.value)}
              rows={7}
              maxLength={2200}
              placeholder="Escreva aqui ou peça pra IA"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <p className="text-right text-[11px] text-slate-400">{legenda.length}/2200</p>
          </div>

          <div className="space-y-1 text-sm">
            <label className={`flex items-start gap-2 ${redes.igLigado ? '' : 'opacity-50'}`}>
              <input
                type="checkbox"
                checked={escolhidas.includes('instagram')}
                disabled={!redes.igLigado}
                onChange={() => alternar('instagram')}
                className="mt-1"
              />
              <span>
                Instagram {temVideo ? '(Reels, também no feed)' : ''}
                {!redes.igLigado ? (
                  <span className="block text-[11px] text-slate-500">não conectado</span>
                ) : !redes.igPodePublicar ? (
                  <span className="block text-[11px] text-amber-700">
                    falta liberar a permissão de publicar no app da Meta — por enquanto dá pra salvar e agendar, mas não sai
                  </span>
                ) : null}
              </span>
            </label>
            <label className={`flex items-start gap-2 ${redes.ttLigado ? '' : 'opacity-50'}`}>
              <input
                type="checkbox"
                checked={escolhidas.includes('tiktok')}
                disabled={!redes.ttLigado}
                onChange={() => alternar('tiktok')}
                className="mt-1"
              />
              <span>
                TikTok
                <span className="block text-[11px] text-slate-500">
                  {!redes.ttLigado
                    ? 'não conectado'
                    : !redes.ttRascunho
                      ? 'a ligação não tem a permissão de rascunho (video.upload) — conecte o TikTok de novo'
                      : 'vai pra caixa de entrada do app do TikTok — lá você põe a música e toca em Publicar'}
                </span>
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" checked={modo === 'agora'} onChange={() => setModo('agora')} /> Agora
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={modo === 'agendar'} onChange={() => setModo('agendar')} /> Agendar
            </label>
            {modo === 'agendar' && (
              <input
                type="datetime-local"
                value={quando}
                onChange={(e) => setQuando(e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            )}
          </div>

          <button
            type="button"
            onClick={publicar}
            disabled={ocupado !== '' || enviando}
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
          >
            {ocupado === 'publicando'
              ? 'Publicando… (vídeo pode levar 1 a 3 min)'
              : enviando
                ? 'Esperando os arquivos subirem…'
                : modo === 'agendar'
                  ? '🗓 Agendar'
                  : '🚀 Publicar agora'}
          </button>
          {msg && (
            <p className={`rounded-md px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
              {msg.txt}
            </p>
          )}
        </div>
      </div>

      {posts.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-800">Feitos por aqui</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {posts.map((p) => {
              const st = STATUS[p.status] ?? { txt: p.status, cor: 'bg-slate-100 text-slate-700' };
              return (
                <li key={p.id} className="flex gap-3 py-3">
                  <div className="h-16 w-14 shrink-0 overflow-hidden rounded bg-slate-100">
                    {p.capa ? (
                      <img src={p.capa} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xl">{p.midias[0]?.tipo === 'video' ? '🎬' : '🖼'}</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 font-medium ${st.cor}`}>{st.txt}</span>
                      <span className="text-slate-500">
                        {p.status === 'AGENDADO'
                          ? `sai ${quandoBr(p.agendadoPara)}`
                          : p.publicadoEm
                            ? `saiu ${quandoBr(p.publicadoEm)}`
                            : `criado ${quandoBr(p.criadoEm)}`}
                        {' · '}
                        {p.midias.length > 1 ? `${p.midias.length} fotos` : p.midias[0]?.tipo === 'video' ? 'vídeo' : 'foto'}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-slate-700">{p.legenda || '(sem legenda)'}</p>
                    <div className="mt-1 space-y-0.5">
                      {p.redes.map((r) => {
                        const res = p.resultado[r];
                        return (
                          <p key={r} className="text-slate-600">
                            <b>{NOME_REDE[r] ?? r}:</b>{' '}
                            {!res ? (
                              <span className="text-slate-400">ainda não</span>
                            ) : res.estado === 'ok' ? (
                              <>
                                <span className="text-emerald-700">✓</span>{' '}
                                {res.link ? (
                                  <a href={res.link} target="_blank" rel="noreferrer" className="text-sky-700 underline">
                                    ver post
                                  </a>
                                ) : null}{' '}
                                {res.obs}
                              </>
                            ) : res.estado === 'aguardando' ? (
                              <span className="text-amber-700">⏳ {res.obs}</span>
                            ) : (
                              <span className="text-rose-700">✗ {res.erro}</span>
                            )}
                          </p>
                        );
                      })}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {p.status === 'AGUARDANDO' && (
                        <a
                          href={`#fila-${p.id}`}
                          className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 hover:bg-emerald-100"
                        >
                          ✅ Aprovar / publicar ↑
                        </a>
                      )}
                      {(p.status === 'ERRO' || p.status === 'PARCIAL') && (
                        <button
                          type="button"
                          disabled={mexendo === p.id}
                          onClick={() => acao(p.id, 'refazer')}
                          className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {mexendo === p.id ? 'Tentando…' : '↻ Tentar de novo'}
                        </button>
                      )}
                      {(p.status === 'AGENDADO' || p.status === 'RASCUNHO') && (
                        <button
                          type="button"
                          disabled={mexendo === p.id}
                          onClick={() => acao(p.id, 'publicar')}
                          className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {mexendo === p.id ? 'Publicando…' : '🚀 Publicar agora'}
                        </button>
                      )}
                      {p.legenda && (
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(p.legenda).catch(() => undefined)}
                          className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                        >
                          📋 Copiar legenda
                        </button>
                      )}
                      {(p.status === 'AGENDADO' || p.status === 'RASCUNHO' || p.status === 'ERRO' || p.status === 'RECUSADO') && (
                        <button
                          type="button"
                          disabled={mexendo === p.id}
                          onClick={() => acao(p.id, 'excluir')}
                          className="rounded border border-rose-200 px-2 py-0.5 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        >
                          Apagar
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

'use client';

// Fila de aprovação do /marketing (pedido do dono 25/10/2026): o Claude monta o
// post (legenda, hashtags, legenda do TikTok, música sugerida, roteiro do que
// filmar e as fotos que já tem); o dono confere, põe o vídeo quando falta,
// mexe no que quiser e aprova ou recusa. Aprovado sai sozinho na hora marcada
// pelo mesmo motor do bloco Publicar (cron de 5 em 5 min).

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { chamar, prepararFoto, quadroDoVideo, quandoBr } from './publicar';

export interface MidiaFila {
  path: string;
  tipo: 'foto' | 'video';
  nome?: string;
  url: string | null;
}

export interface PostFila {
  id: string;
  titulo: string | null;
  roteiro: string | null;
  legenda: string;
  legendaTiktok: string | null;
  musica: string | null;
  redes: string[];
  midias: MidiaFila[];
  agendadoPara: string | null;
}

const MAX = 50 * 1024 * 1024;
const NOME_REDE: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok' };
/** Instagram mostra a foto em 1080 px: abaixo disso ela é esticada e borra. */
const FOTO_MIN_PX = 1080;

/** ISO → valor do campo datetime-local na hora de Aracaju (UTC−3, sem horário de verão). */
const paraCampo = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 16) : '';
const doCampo = (v: string) => (v ? new Date(`${v}:00-03:00`).toISOString() : null);


interface ItemIg {
  id: string;
  tipo: string;
  legenda: string;
  capa: string | null;
  link: string;
  quando: string;
  arquivos: number;
}

/** Galeria do Instagram de uma casa (pedido do dono 25/10: "pega fotos no Instagram do Prainha Bar"). */
function DoInstagram({
  filialId,
  postId,
  casas,
  onPronto,
  onFechar,
}: {
  filialId: string;
  postId: string;
  casas: Array<{ id: string; nome: string }>;
  onPronto: (m: MidiaFila[]) => void;
  onFechar: () => void;
}) {
  const padrao = casas.find((c) => /prainha bar/i.test(c.nome))?.id ?? filialId;
  const [deCasa, setDeCasa] = useState(padrao);
  const [itens, setItens] = useState<ItemIg[]>([]);
  const [proximo, setProximo] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [copiando, setCopiando] = useState('');
  const [erro, setErro] = useState('');

  async function carregar(casa: string, depois: string | null) {
    setCarregando(true);
    setErro('');
    try {
      const q = new URLSearchParams({ filialId, deCasa: casa });
      if (depois) q.set('depois', depois);
      const r = await fetch(`/api/marketing/fila/instagram?${q}`, { cache: 'no-store' });
      const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (!r.ok || !j || j.error) throw new Error(String(j?.error ?? `Falhou (HTTP ${r.status}).`));
      const novos = (j.itens as ItemIg[]) ?? [];
      setItens((l) => (depois ? [...l, ...novos] : novos));
      setProximo((j.proximo as string | null) ?? null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => {
    setItens([]);
    setProximo(null);
    void carregar(deCasa, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deCasa]);

  async function pegar(it: ItemIg) {
    setCopiando(it.id);
    setErro('');
    try {
      const j = await chamar('/api/marketing/fila/instagram', 'POST', { filialId, id: postId, deCasa, igId: it.id });
      onPronto(j.midias as MidiaFila[]);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCopiando('');
    }
  }

  return (
    <div className="mt-2 rounded-md border border-pink-200 bg-pink-50/40 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs text-slate-700">
          📷 Instagram da{' '}
          <select
            value={deCasa}
            onChange={(e) => setDeCasa(e.target.value)}
            className="rounded border border-slate-300 px-1 py-0.5 text-xs text-slate-900"
          >
            {casas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onFechar} className="text-xs text-slate-500 hover:text-slate-800">
          fechar
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Toque num post pra pôr no card. Carrossel entra com todas as fotos; vídeo entra sozinho (troca o que tiver).
      </p>
      {erro && <p className="mt-1 text-xs text-rose-700">{erro}</p>}
      <div className="mt-2 grid max-h-96 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4">
        {itens.map((it) => (
          <button
            key={it.id}
            type="button"
            disabled={!!copiando}
            onClick={() => void pegar(it)}
            title={it.legenda}
            className="relative aspect-[4/5] overflow-hidden rounded bg-slate-100 text-left disabled:opacity-60"
          >
            {it.capa ? (
              <img src={it.capa} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-xl">🖼</span>
            )}
            <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
              {it.tipo === 'VIDEO' ? 'vídeo' : it.tipo === 'CAROUSEL_ALBUM' ? `${it.arquivos || ''} fotos` : 'foto'}
            </span>
            <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-black/50 px-1 text-[10px] leading-tight text-white">
              {copiando === it.id ? 'copiando…' : it.legenda || ' '}
            </span>
          </button>
        ))}
      </div>
      {carregando && <p className="mt-1 text-xs text-slate-500">carregando…</p>}
      {!carregando && proximo && (
        <button
          type="button"
          onClick={() => void carregar(deCasa, proximo)}
          className="mt-2 text-xs text-violet-700 hover:underline"
        >
          carregar mais
        </button>
      )}
    </div>
  );
}

function Card({ filialId, p, casas }: { filialId: string; p: PostFila; casas: Array<{ id: string; nome: string }> }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [legenda, setLegenda] = useState(p.legenda);
  const [legendaTt, setLegendaTt] = useState(p.legendaTiktok ?? '');
  const [quando, setQuando] = useState(paraCampo(p.agendadoPara));
  const [redes, setRedes] = useState<string[]>(p.redes);
  const [midias, setMidias] = useState<MidiaFila[]>(p.midias);
  const [subindo, setSubindo] = useState(0);
  const [ocupado, setOcupado] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  const [aberto, setAberto] = useState(false);
  const [doIg, setDoIg] = useState(false);
  // Largura real de cada foto do card: abaixo de 1080 px o Instagram estica e borra (26/10: posts da Mar com miniatura do cardápio).
  const [larguras, setLarguras] = useState<Record<string, number>>({});

  const mudouTexto =
    legenda !== p.legenda || legendaTt !== (p.legendaTiktok ?? '') || quando !== paraCampo(p.agendadoPara) ||
    redes.join() !== p.redes.join();
  const corpoMidias = (l: MidiaFila[]) => l.map(({ path, tipo, nome }) => ({ path, tipo, nome }));

  async function salvarMidias(l: MidiaFila[]) {
    await chamar('/api/marketing/fila', 'PATCH', { filialId, id: p.id, acao: 'salvar', midias: corpoMidias(l) });
    setMidias(l);
  }

  async function adicionar(lista: FileList | null) {
    setMsg(null);
    const novos = [...(lista ?? [])];
    if (!novos.length) return;
    const videos = novos.filter((f) => f.type.startsWith('video/'));
    const fotos = novos.filter((f) => f.type.startsWith('image/'));
    const temVideo = midias.some((m) => m.tipo === 'video');
    if (videos.length && (fotos.length || videos.length > 1 || midias.length)) {
      return setMsg({ ok: false, txt: 'Vídeo vai sozinho: tire as fotos do card antes de pôr o vídeo.' });
    }
    if (temVideo && fotos.length) return setMsg({ ok: false, txt: 'Este post já tem um vídeo. Tire o vídeo para pôr fotos.' });
    if (midias.length + fotos.length > 10) return setMsg({ ok: false, txt: 'No máximo 10 fotos por post.' });
    let atual = midias;
    for (const f of [...videos, ...fotos]) {
      const video = f.type.startsWith('video/');
      if (video && f.size > MAX) {
        setMsg({ ok: false, txt: `${f.name}: vídeo maior que 50 MB. Exporte em 1080p ou corte um pouco.` });
        continue;
      }
      setSubindo((n) => n + 1);
      try {
        let corpo: Blob = f;
        let nome = f.name;
        let tipo = f.type;
        let previa = '';
        if (video) {
          previa = await quadroDoVideo(f);
          if (tipo !== 'video/mp4' && tipo !== 'video/quicktime') tipo = 'video/mp4';
        } else {
          const r = await prepararFoto(f);
          corpo = r.blob;
          previa = r.previa;
          nome = f.name.replace(/\.[^.]+$/, '') + '.jpg';
          tipo = 'image/jpeg';
        }
        const passo1 = await chamar('/api/marketing/upload-url', 'POST', { filialId, nome, tamanho: corpo.size, tipo });
        const up = await createClient()
          .storage.from(String(passo1.bucket))
          .uploadToSignedUrl(String(passo1.path), String(passo1.token), corpo, { contentType: tipo });
        if (up.error) throw new Error(up.error.message);
        atual = [...atual, { path: String(passo1.path), tipo: video ? 'video' : 'foto', nome, url: previa || null }];
        await salvarMidias(atual);
      } catch (e) {
        setMsg({ ok: false, txt: `${f.name}: ${(e as Error).message}` });
      } finally {
        setSubindo((n) => n - 1);
      }
    }
  }

  async function tirar(path: string) {
    setOcupado('midia');
    try {
      await salvarMidias(midias.filter((m) => m.path !== path));
    } catch (e) {
      setMsg({ ok: false, txt: (e as Error).message });
    } finally {
      setOcupado('');
    }
  }

  async function acao(qual: 'salvar' | 'aprovar' | 'recusar' | 'excluir') {
    setMsg(null);
    const campos = { legenda, legendaTiktok: legendaTt, agendadoPara: doCampo(quando), redes };
    if (qual === 'aprovar') {
      if (!midias.length) return setMsg({ ok: false, txt: 'Falta a foto ou o vídeo. Ponha o arquivo antes de aprovar.' });
      if (!redes.length) return setMsg({ ok: false, txt: 'Escolha Instagram, TikTok ou os dois.' });
      if (
        pequenas.length &&
        !window.confirm(
          `${pequenas.length === 1 ? 'Uma foto é pequena' : `${pequenas.length} fotos são pequenas`} (menos de ${FOTO_MIN_PX} px de largura) e vai sair borrada no Instagram. Aprovar mesmo assim?`,
        )
      ) {
        return;
      }
      const iso = doCampo(quando);
      if ((!iso || new Date(iso).getTime() <= Date.now() + 60_000) && !window.confirm('O horário já passou (ou está vazio). Publicar agora?')) {
        return;
      }
    }
    let corpo: Record<string, unknown> = { filialId, id: p.id, acao: qual, ...campos };
    if (qual === 'recusar') {
      const motivo = window.prompt('Por que recusar? (ajuda a acertar os próximos)', '');
      if (motivo === null) return;
      corpo = { filialId, id: p.id, acao: qual, motivo };
    }
    if (qual === 'excluir') {
      if (!window.confirm('Apagar este post da fila (e os arquivos dele)?')) return;
      corpo = { filialId, id: p.id, acao: qual };
    }
    setOcupado(qual);
    try {
      const j = await chamar('/api/marketing/fila', 'PATCH', corpo);
      const st = String((j.post as { status?: string } | undefined)?.status ?? '');
      if (qual === 'salvar') setMsg({ ok: true, txt: 'Salvo.' });
      else if (qual === 'aprovar')
        setMsg({
          ok: st !== 'ERRO',
          txt:
            st === 'AGENDADO'
              ? `Aprovado. Sai sozinho em ${quandoBr(doCampo(quando))}.`
              : st === 'PUBLICADO'
                ? 'Aprovado e publicado.'
                : st === 'ERRO'
                  ? 'Aprovado, mas não saiu: veja o motivo no histórico do Publicar.'
                  : 'Aprovado; está saindo.',
        });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, txt: (e as Error).message });
    } finally {
      setOcupado('');
    }
  }

  const alternar = (r: string) => setRedes((l) => (l.includes(r) ? l.filter((x) => x !== r) : [...l, r]));
  const semMidia = !midias.length;
  const pequenas = midias.filter((m) => m.tipo !== 'video' && (larguras[m.path] ?? FOTO_MIN_PX) < FOTO_MIN_PX);

  return (
    <div id={`fila-${p.id}`} className="scroll-mt-4 rounded-lg border border-violet-200 bg-white p-3 target:ring-2 target:ring-emerald-400">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">{p.titulo || 'Post'}</p>
          <p className="text-xs text-slate-500">
            {p.agendadoPara ? `📅 ${quandoBr(p.agendadoPara)}` : 'sem horário'} ·{' '}
            {p.redes.map((r) => NOME_REDE[r] ?? r).join(' + ')}
          </p>
        </div>
        {semMidia ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">falta foto/vídeo</span>
        ) : pequenas.length ? (
          <span className="rounded bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800">foto pequena: vai sair borrada</span>
        ) : (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">pronto pra aprovar</span>
        )}
      </div>

      {p.roteiro && (
        <div className="mt-2 rounded-md bg-violet-50 p-2 text-xs text-violet-900">
          <p className="font-medium">🎬 O que filmar / fotografar</p>
          <p className="mt-0.5 whitespace-pre-line">{p.roteiro}</p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {midias.map((m) => (
          <div key={m.path} className="relative">
            {m.url ? (
              <img
                src={m.url}
                alt=""
                className="h-20 w-16 rounded object-cover"
                onLoad={(e) => {
                  const w = e.currentTarget.naturalWidth;
                  setLarguras((l) => (l[m.path] === w ? l : { ...l, [m.path]: w }));
                }}
              />
            ) : (
              <div className="flex h-20 w-16 items-center justify-center rounded bg-slate-100 text-xl">
                {m.tipo === 'video' ? '🎞' : '🖼'}
              </div>
            )}
            {m.tipo === 'video' && <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] text-white">vídeo</span>}
            {m.tipo !== 'video' && (larguras[m.path] ?? FOTO_MIN_PX) < FOTO_MIN_PX && (
              <span className="absolute bottom-0.5 left-0.5 rounded bg-rose-600 px-1 text-[10px] text-white">{larguras[m.path]} px</span>
            )}
            <button
              type="button"
              disabled={!!ocupado}
              onClick={() => void tirar(m.path)}
              className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-white text-xs text-rose-700 shadow"
              title="Tirar"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => entrada.current?.click()}
          disabled={subindo > 0}
          className="flex h-20 w-16 flex-col items-center justify-center rounded border border-dashed border-slate-300 text-[11px] text-slate-600 hover:bg-slate-50"
        >
          {subindo > 0 ? 'subindo…' : <>＋<br />foto/vídeo</>}
        </button>
        <button
          type="button"
          onClick={() => setDoIg((x) => !x)}
          className="flex h-20 w-16 flex-col items-center justify-center rounded border border-dashed border-pink-300 text-[11px] text-pink-700 hover:bg-pink-50"
        >
          📷<br />do Instagram
        </button>
        <input
          ref={entrada}
          type="file"
          accept="image/*,video/mp4,video/quicktime"
          multiple
          className="hidden"
          onChange={(e) => {
            void adicionar(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {pequenas.length > 0 && (
        <p className="mt-1 text-xs text-rose-700">
          ⚠ Foto com menos de {FOTO_MIN_PX} px de largura fica borrada no Instagram. Troque por uma foto do celular ou pelo 📷 do Instagram
          (a miniatura do cardápio do QR não serve pra post).
        </p>
      )}
      {doIg && (
        <DoInstagram
          filialId={filialId}
          postId={p.id}
          casas={casas}
          onPronto={(m) => {
            setMidias(m);
            setMsg({ ok: true, txt: 'Mídia do Instagram posta no card.' });
          }}
          onFechar={() => setDoIg(false)}
        />
      )}

      {p.musica && (
        <p className="mt-2 text-xs text-slate-700">
          🎵 <span className="font-medium">Música:</span> {p.musica}
        </p>
      )}

      <button type="button" onClick={() => setAberto((x) => !x)} className="mt-2 text-xs text-violet-700 hover:underline">
        {aberto ? '▾ esconder legendas' : '▸ ver e mexer nas legendas, horário e redes'}
      </button>
      {!aberto && <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-slate-600">{legenda}</p>}
      {aberto && (
        <div className="mt-2 space-y-2">
          <label className="block text-xs text-slate-600">
            Legenda do Instagram (com hashtags)
            <textarea
              value={legenda}
              onChange={(e) => setLegenda(e.target.value)}
              rows={8}
              className="mt-0.5 w-full rounded border border-slate-300 p-2 text-sm text-slate-900"
            />
            <span className="text-[11px] text-slate-400">{legenda.length}/2200</span>
          </label>
          <label className="block text-xs text-slate-600">
            Legenda do TikTok (vazia = usa a do Instagram)
            <textarea
              value={legendaTt}
              onChange={(e) => setLegendaTt(e.target.value)}
              rows={4}
              className="mt-0.5 w-full rounded border border-slate-300 p-2 text-sm text-slate-900"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <label>
              Quando sai{' '}
              <input
                type="datetime-local"
                value={quando}
                onChange={(e) => setQuando(e.target.value)}
                className="rounded border border-slate-300 px-1 py-0.5 text-sm text-slate-900"
              />
            </label>
            {['instagram', 'tiktok'].map((r) => (
              <label key={r} className="flex items-center gap-1">
                <input type="checkbox" checked={redes.includes(r)} onChange={() => alternar(r)} /> {NOME_REDE[r]}
              </label>
            ))}
          </div>
        </div>
      )}

      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.txt}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!!ocupado || subindo > 0 || semMidia}
          onClick={() => void acao('aprovar')}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          title={semMidia ? 'Ponha a foto ou o vídeo primeiro' : ''}
        >
          {ocupado === 'aprovar' ? 'Aprovando…' : '✅ Aprovar'}
        </button>
        {mudouTexto && (
          <button
            type="button"
            disabled={!!ocupado}
            onClick={() => void acao('salvar')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            {ocupado === 'salvar' ? 'Salvando…' : '💾 Salvar mudanças'}
          </button>
        )}
        <button
          type="button"
          disabled={!!ocupado}
          onClick={() => void acao('recusar')}
          className="rounded-md border border-rose-300 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50"
        >
          ❌ Recusar
        </button>
        <button
          type="button"
          disabled={!!ocupado}
          onClick={() => void acao('excluir')}
          className="rounded-md px-2 py-1.5 text-sm text-slate-400 hover:text-rose-700"
          title="Apagar da fila"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

export function FilaAprovacao({
  filialId,
  casa,
  posts,
  casas = [],
}: {
  filialId: string;
  casa: string;
  posts: PostFila[];
  casas?: Array<{ id: string; nome: string }>;
}) {
  const lista = casas.length ? casas : [{ id: filialId, nome: casa }];
  const faltam = posts.filter((p) => !p.midias.length).length;
  return (
    <div className="mt-6 rounded-xl border border-violet-300 bg-violet-50/40 p-4">
      <h2 className="text-base font-semibold text-slate-900">
        🗂 Esperando sua aprovação — {casa} ({posts.length})
      </h2>
      <p className="text-xs text-slate-600">
        Posts montados pelo Claude. Confira, ponha o vídeo onde falta, mexa no que quiser e aprove: sai sozinho na hora
        marcada (Instagram publica; TikTok vai pra caixa de entrada do app, onde você escolhe a música e posta).
        {faltam > 0 && ` ${faltam} ainda sem foto/vídeo.`}
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {posts.map((p) => (
          <Card key={p.id} filialId={filialId} p={p} casas={lista} />
        ))}
      </div>
    </div>
  );
}

'use client';

// Opções do post DIRETO no TikTok (pedido do dono 01/11/2026), dentro do
// bloco Publicar. Segue as regras de tela que o TikTok cobra na auditoria:
// mostra a conta que vai postar, quem pode ver vem SEM escolha, comentário /
// dueto / stitch desmarcados (e travados se a conta desligou), aviso de
// conteúdo comercial e o aceite da política de música.

import { useEffect, useState } from 'react';

export interface EscolhaDireto {
  privacidade: string;
  comentarios: boolean;
  dueto: boolean;
  stitch: boolean;
  comercial: boolean;
  marcaPropria: boolean;
  conteudoPago: boolean;
}

export const DIRETO_VAZIO: EscolhaDireto = {
  privacidade: '',
  comentarios: false,
  dueto: false,
  stitch: false,
  comercial: false,
  marcaPropria: false,
  conteudoPago: false,
};

interface Criador {
  foto: string | null;
  usuario: string;
  nome: string;
  privacidades: string[];
  semComentario: boolean;
  semDueto: boolean;
  semStitch: boolean;
  maxSegundos: number | null;
}

const NOME_PRIV: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Todo mundo',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos (quem se segue)',
  FOLLOWER_OF_CREATOR: 'Seguidores',
  SELF_ONLY: 'Só eu (privado)',
};

/** Erro em português se falta escolher algo; null = pode publicar. */
export function faltaNoDireto(e: EscolhaDireto): string | null {
  if (!e.privacidade) return 'TikTok direto: escolha quem pode ver o post.';
  if (e.comercial && !e.marcaPropria && !e.conteudoPago) {
    return 'TikTok direto: diga se o conteúdo comercial é da própria casa, parceria paga ou os dois.';
  }
  return null;
}

export function TiktokDireto({
  filialId,
  temVideo,
  valor,
  mudar,
}: {
  filialId: string;
  temVideo: boolean;
  valor: EscolhaDireto;
  mudar: (e: EscolhaDireto) => void;
}) {
  const [criador, setCriador] = useState<Criador | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    fetch(`/api/marketing/tiktok-criador?filialId=${encodeURIComponent(filialId)}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { criador?: Criador; error?: string } | null;
        if (!vivo) return;
        if (!r.ok || !j?.criador) setErro(j?.error ?? 'Não consegui ler a conta do TikTok.');
        else setCriador(j.criador);
      })
      .catch(() => vivo && setErro('Não consegui ler a conta do TikTok.'));
    return () => {
      vivo = false;
    };
  }, [filialId]);

  const m = (x: Partial<EscolhaDireto>) => mudar({ ...valor, ...x });

  if (erro) return <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-800">{erro}</p>;
  if (!criador) return <p className="mt-2 text-[11px] text-slate-500">Lendo a conta do TikTok…</p>;

  const soPrivado = criador.privacidades.length === 1 && criador.privacidades[0] === 'SELF_ONLY';

  return (
    <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
      <div className="flex items-center gap-2">
        {criador.foto ? <img src={criador.foto} alt="" className="h-7 w-7 rounded-full" /> : <span>🎵</span>}
        <span>
          Vai sair em <b>{criador.nome || criador.usuario}</b>
          {criador.usuario ? <span className="text-slate-500"> @{criador.usuario}</span> : null}
        </span>
      </div>

      <label className="block">
        <span className="font-medium text-slate-700">Quem pode ver</span>
        <select
          value={valor.privacidade}
          onChange={(e) => m({ privacidade: e.target.value })}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        >
          <option value="" disabled>
            Escolha…
          </option>
          {criador.privacidades.map((p) => (
            <option key={p} value={p} disabled={p === 'SELF_ONLY' && valor.conteudoPago}>
              {NOME_PRIV[p] ?? p}
              {p === 'SELF_ONLY' && valor.conteudoPago ? ' — não vale pra parceria paga' : ''}
            </option>
          ))}
        </select>
      </label>
      {soPrivado && (
        <p className="text-[11px] text-amber-700">
          Enquanto o TikTok não aprova o app, o post direto só sai como “Só eu”. Depois de publicado, dá pra abrir pra todos no app do TikTok.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <label className={`flex items-center gap-1 ${criador.semComentario ? 'opacity-50' : ''}`}>
          <input
            type="checkbox"
            checked={valor.comentarios && !criador.semComentario}
            disabled={criador.semComentario}
            onChange={(e) => m({ comentarios: e.target.checked })}
          />
          Permitir comentários
        </label>
        {temVideo && (
          <>
            <label className={`flex items-center gap-1 ${criador.semDueto ? 'opacity-50' : ''}`}>
              <input
                type="checkbox"
                checked={valor.dueto && !criador.semDueto}
                disabled={criador.semDueto}
                onChange={(e) => m({ dueto: e.target.checked })}
              />
              Dueto
            </label>
            <label className={`flex items-center gap-1 ${criador.semStitch ? 'opacity-50' : ''}`}>
              <input
                type="checkbox"
                checked={valor.stitch && !criador.semStitch}
                disabled={criador.semStitch}
                onChange={(e) => m({ stitch: e.target.checked })}
              />
              Stitch
            </label>
          </>
        )}
      </div>
      {temVideo && criador.maxSegundos ? (
        <p className="text-[11px] text-slate-500">Esta conta aceita vídeo de até {criador.maxSegundos} s.</p>
      ) : null}

      <div>
        <label className="flex items-center gap-1 font-medium text-slate-700">
          <input
            type="checkbox"
            checked={valor.comercial}
            onChange={(e) =>
              m(e.target.checked ? { comercial: true } : { comercial: false, marcaPropria: false, conteudoPago: false })
            }
          />
          Conteúdo comercial (divulga marca, produto ou serviço)
        </label>
        {valor.comercial && (
          <div className="ml-5 mt-1 space-y-1">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={valor.marcaPropria} onChange={(e) => m({ marcaPropria: e.target.checked })} />
              A própria casa
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={valor.conteudoPago}
                onChange={(e) =>
                  m({
                    conteudoPago: e.target.checked,
                    ...(e.target.checked && valor.privacidade === 'SELF_ONLY' ? { privacidade: '' } : {}),
                  })
                }
              />
              Parceria paga com outra marca
            </label>
            {(valor.marcaPropria || valor.conteudoPago) && (
              <p className="text-[11px] text-slate-500">
                O post vai aparecer marcado como “{valor.conteudoPago ? 'Parceria paga' : 'Conteúdo promocional'}”.
              </p>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-500">
        Ao publicar, você concorda com a{' '}
        {valor.conteudoPago && (
          <>
            <a href="https://www.tiktok.com/legal/page/global/bc-policy/pt-BR" target="_blank" rel="noreferrer" className="underline">
              Política de Conteúdo de Marca
            </a>{' '}
            e a{' '}
          </>
        )}
        <a
          href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/pt-BR"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Confirmação de Uso de Música
        </a>{' '}
        do TikTok. Depois de publicado, pode levar alguns minutos pra aparecer no perfil.
      </p>
    </div>
  );
}

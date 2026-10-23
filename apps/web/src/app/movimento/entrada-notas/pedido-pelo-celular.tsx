'use client';

// "📷 Escanear pedido agora" no computador: QR na tela, o celular abre
// /pedido-celular, tira a foto (uma ou várias folhas) e ela volta pra cá,
// onde é lida pela rota de sempre (/api/notas/pedido-foto) com o login daqui.

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode-svg';

interface LinkCel {
  f: string;
  u: string;
  k: string;
  e: number;
  s: string;
}

const CHAVE = (filialId: string) => `pedido-celular:${filialId}`;

function linkGuardado(filialId: string): LinkCel | null {
  try {
    const j = JSON.parse(sessionStorage.getItem(CHAVE(filialId)) ?? 'null') as LinkCel | null;
    if (j && j.e * 1000 > Date.now() + 30 * 60_000) return j; // ainda vale mais de 30 min
  } catch {}
  return null;
}

export function PedidoPeloCelular({
  filialId,
  ocupado,
  onFotos,
  onFechar,
  onArquivoAqui,
}: {
  filialId: string;
  ocupado: boolean;
  onFotos: (fotos: File[]) => Promise<void>;
  onFechar: () => void;
  onArquivoAqui: () => void;
}) {
  const [link, setLink] = useState<LinkCel | null>(null);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [recebidos, setRecebidos] = useState(0);
  const vistos = useRef(new Set<string>());
  const ocupadoRef = useRef(ocupado);
  ocupadoRef.current = ocupado;
  const onFotosRef = useRef(onFotos);
  onFotosRef.current = onFotos;

  useEffect(() => {
    let vivo = true;
    const guardado = linkGuardado(filialId);
    if (guardado) {
      setLink(guardado);
      return;
    }
    (async () => {
      try {
        const r = await fetch('/api/pedido-celular/link', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filialId }),
        });
        const d = (await r.json().catch(() => ({}))) as Partial<LinkCel> & { ok?: boolean; error?: string };
        if (!vivo) return;
        if (!r.ok || !d.ok || !d.f || !d.u || !d.k || !d.e || !d.s) {
          setErro(d.error ?? `HTTP ${r.status}`);
          return;
        }
        const l = { f: d.f, u: d.u, k: d.k, e: d.e, s: d.s };
        setLink(l);
        try {
          sessionStorage.setItem(CHAVE(filialId), JSON.stringify(l));
        } catch {}
      } catch (err) {
        if (vivo) setErro((err as Error).message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [filialId]);

  const url = useMemo(() => {
    if (!link || typeof window === 'undefined') return '';
    const q = new URLSearchParams({ f: link.f, u: link.u, k: link.k, e: String(link.e), s: link.s });
    return `${window.location.origin}/pedido-celular?${q}`;
  }, [link]);

  const svg = useMemo(
    () =>
      url
        ? new QRCode({
            content: url,
            padding: 2,
            width: 168,
            height: 168,
            color: '#0f172a',
            background: '#ffffff',
            ecl: 'M',
            join: true,
          }).svg()
        : '',
    [url],
  );

  // Pega o que o celular mandou, a cada 3 s
  useEffect(() => {
    if (!link) return;
    let vivo = true;
    let rodando = false;
    async function checar() {
      if (!vivo || rodando || document.hidden || ocupadoRef.current) return;
      rodando = true;
      try {
        const r = await fetch('/api/pedido-celular/chegaram', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(link),
        });
        if (r.status === 401) {
          try {
            sessionStorage.removeItem(CHAVE(filialId));
          } catch {}
        }
        const d = (await r.json().catch(() => ({}))) as {
          prontos?: Array<{ grupo: string; fotos: Array<{ nome: string; url: string }> }>;
        };
        for (const p of d.prontos ?? []) {
          if (!vivo) break;
          if (vistos.current.has(p.grupo)) continue;
          vistos.current.add(p.grupo);
          const arquivos: File[] = [];
          for (const foto of p.fotos) {
            const b = await fetch(foto.url).then((x) => x.blob());
            const tipo = b.type || (foto.nome.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
            arquivos.push(new File([b], `celular-${p.grupo}-${foto.nome}`, { type: tipo }));
          }
          if (arquivos.length) {
            await onFotosRef.current(arquivos);
            setRecebidos((n) => n + 1);
          }
          await fetch('/api/pedido-celular/chegaram', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...link, apagar: p.grupo }),
          }).catch(() => {});
        }
      } catch {
        // rede caiu — tenta de novo no próximo ciclo
      } finally {
        rodando = false;
      }
    }
    void checar();
    const t = setInterval(() => void checar(), 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [link, filialId]);

  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-emerald-900">📱 Aponte a câmera do celular pro QR</div>
        <button
          type="button"
          onClick={onFechar}
          className="rounded px-1.5 text-base leading-none text-slate-500 hover:bg-white"
          aria-label="fechar"
        >
          ×
        </button>
      </div>
      {erro ? (
        <p className="mt-2 rounded bg-rose-50 px-2 py-1.5 text-xs text-rose-800">Não consegui gerar o QR: {erro}</p>
      ) : !svg ? (
        <p className="mt-2 text-xs text-slate-500">gerando o QR…</p>
      ) : (
        <div className="mt-2 flex flex-col items-center gap-2 sm:flex-row sm:items-start">
          <div className="shrink-0 rounded-lg bg-white p-1 shadow-sm" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="min-w-0 flex-1 space-y-1.5 text-xs text-emerald-900">
            <p>No celular: tire a foto do pedido (pode ser mais de uma folha) e toque em <b>Enviar pro computador</b>.</p>
            <p>A foto aparece aqui sozinha e é lida como se você tivesse escaneado neste computador.</p>
            <p className="text-slate-500">Deixe esta caixa aberta enquanto fotografa. O link vale 24 horas.</p>
            {recebidos > 0 && <p className="font-semibold">✓ {recebidos} pedido(s) recebido(s) do celular</p>}
            <div className="flex gap-1">
              <input
                readOnly
                value={url}
                onFocus={(ev) => ev.target.select()}
                className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600"
              />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(url).then(() => {
                    setCopiado(true);
                    setTimeout(() => setCopiado(false), 1500);
                  });
                }}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700"
              >
                {copiado ? 'copiado' : 'copiar'}
              </button>
            </div>
            <button type="button" onClick={onArquivoAqui} className="text-[11px] text-emerald-800 underline">
              ou escolher a foto/scanner neste computador
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

// Entrada já lançada (pedido sem nota que entrou direto pela foto, ou nota
// lançada sem boleto): o mesmo QR do "📱 Foto pelo celular" da janela de
// Lançar. O celular abre /nota-boleto/[token], tira a foto do recibo/boleto e
// ela é pendurada na conta a pagar que está "sem boleto anexado".

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode-svg';

export function ReciboPeloCelular({ notaId }: { notaId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [copiado, setCopiado] = useState(false);
  const rodando = useRef(false);

  async function abrir() {
    setAberto(true);
    setErro('');
    if (token) return;
    try {
      const r = await fetch(`/api/nota-compra/${notaId}/token-boleto`, { method: 'POST' });
      const d = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!r.ok || !d.token) throw new Error(d.error ?? `HTTP ${r.status}`);
      setToken(d.token);
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  const url = token && typeof window !== 'undefined' ? `${window.location.origin}/nota-boleto/${token}` : '';
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

  // A cada 4 s: chegou foto do celular? pendura na conta e atualiza a tela.
  useEffect(() => {
    if (!aberto || !token) return;
    let vivo = true;
    async function checar() {
      if (!vivo || rodando.current || document.hidden) return;
      rodando.current = true;
      try {
        const r = await fetch(`/api/nota-compra/${notaId}/boletos-pendentes`);
        const d = (await r.json().catch(() => ({}))) as { boletos?: unknown[] };
        if ((d.boletos?.length ?? 0) > 0) {
          const a = await fetch(`/api/nota-compra/${notaId}/anexar-pendentes`, { method: 'POST' });
          const ad = (await a.json().catch(() => ({}))) as { anexados?: number; sobraram?: number; error?: string };
          if (!a.ok) setErro(ad.error ?? `HTTP ${a.status}`);
          else if ((ad.anexados ?? 0) > 0) {
            setAviso(`✓ ${ad.anexados} foto(s) anexada(s) na conta a pagar`);
            router.refresh();
          } else if ((ad.sobraram ?? 0) > 0) {
            setAviso('A foto chegou, mas todas as contas desta nota já têm boleto/recibo anexado.');
          }
        }
      } catch {
        // rede caiu — tenta no próximo ciclo
      } finally {
        rodando.current = false;
      }
    }
    void checar();
    const t = setInterval(() => void checar(), 4000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [aberto, token, notaId, router]);

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => void abrir()}
        className="mt-2 rounded-md border border-emerald-400 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
      >
        📱 Foto do recibo/boleto pelo celular
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold text-emerald-900">📱 Aponte a câmera do celular pro QR</div>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="rounded px-1.5 text-base leading-none text-slate-500 hover:bg-white"
          aria-label="fechar"
        >
          ×
        </button>
      </div>
      {erro ? (
        <p className="mt-2 rounded bg-rose-50 px-2 py-1.5 text-xs text-rose-800">Não deu: {erro}</p>
      ) : !svg ? (
        <p className="mt-2 text-xs text-slate-500">gerando o QR…</p>
      ) : (
        <div className="mt-2 flex flex-col items-center gap-2 sm:flex-row sm:items-start">
          <div className="shrink-0 rounded-lg bg-white p-1 shadow-sm" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="min-w-0 flex-1 space-y-1.5 text-xs text-emerald-900">
            <p>No celular: tire a foto do recibo (ou boleto) e envie.</p>
            <p>Ela aparece aqui sozinha, anexada na conta a pagar desta entrada.</p>
            {aviso && <p className="font-semibold">{aviso}</p>}
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
          </div>
        </div>
      )}
    </div>
  );
}

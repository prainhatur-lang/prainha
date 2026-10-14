'use client';

// "📱 Ler pelo celular" da Entrada de notas: igual à foto do boleto — QR na
// tela, o celular abre a câmera (/nota-chave) e cada chave lida já traz a nota
// da SEFAZ. Aqui a lista vai atualizando sozinha enquanto as notas chegam.
// Aberto no próprio celular, vai direto pra câmera.

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode-svg';
import { brl } from '@/lib/format';

interface Chegou {
  id: string;
  numero: string | null;
  emitNome: string | null;
  valorTotal: string | null;
  origem: string | null;
}

export function LerPeloCelular({ filialId, onFechar }: { filialId: string; onFechar: () => void }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [url, setUrl] = useState('');
  const [desde, setDesde] = useState('');
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [chegaram, setChegaram] = useState<Chegou[]>([]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch('/api/nota-chave/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filialId }),
        });
        const d = (await r.json().catch(() => ({}))) as {
          ok?: boolean; error?: string; f?: string; e?: number; s?: string; agora?: string;
        };
        if (!vivo) return;
        if (!r.ok || !d.ok || !d.f || !d.e || !d.s) {
          setErro(d.error ?? `HTTP ${r.status}`);
          return;
        }
        const u = `${window.location.origin}/nota-chave?${new URLSearchParams({ f: d.f, e: String(d.e), s: d.s })}`;
        const noCelular = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;
        if (noCelular) {
          window.location.href = u;
          return;
        }
        setUrl(u);
        setDesde(d.agora ?? new Date().toISOString());
      } catch (err) {
        if (vivo) setErro((err as Error).message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [filialId]);

  // pergunta a cada 5 s o que entrou desde que o QR abriu
  useEffect(() => {
    if (!desde) return;
    let vivo = true;
    let visto = '';
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(
          `/api/nota-chave/chegaram?${new URLSearchParams({ filialId, desde })}`,
          { cache: 'no-store' },
        );
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; notas?: Chegou[] };
        if (!vivo || !d.ok || !d.notas) return;
        const assinatura = d.notas.map((n) => `${n.id}:${n.origem}`).join(',');
        if (assinatura === visto) return;
        visto = assinatura;
        setChegaram(d.notas);
        start(() => router.refresh());
      } catch {
        // sem rede agora — tenta no próximo
      }
    }, 5000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [desde, filialId, router]);

  const qrSvg = useMemo(() => {
    if (!url) return '';
    return new QRCode({
      content: url,
      padding: 2,
      width: 168,
      height: 168,
      color: '#0f172a',
      background: '#ffffff',
      ecl: 'M',
      join: true,
    }).svg();
  }, [url]);

  async function copiar() {
    await navigator.clipboard.writeText(url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium text-slate-700">
          📱 Aponte a câmera do celular pro QR — abre a câmera que lê o código de barras do DANFE.
          Cada nota lida entra sozinha aqui.
        </p>
        <button
          type="button"
          onClick={onFechar}
          className="rounded px-1.5 text-sm leading-none text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          aria-label="Fechar"
        >
          ×
        </button>
      </div>

      {erro && <p className="mt-2 text-[11px] text-rose-600">{erro}</p>}
      {!erro && !url && <p className="mt-2 text-[11px] text-slate-500">Gerando o QR...</p>}

      {url && (
        <div className="mt-2 flex flex-wrap items-start gap-4">
          <div
            className="w-[168px] shrink-0 rounded-lg border border-slate-200 bg-white p-1"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <div className="min-w-[220px] flex-1 space-y-2">
            <div>
              <p className="text-[10px] text-slate-400">Se o QR não funcionar, mande o link pro celular:</p>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={url}
                  className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 font-mono text-[10px]"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={copiar}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] hover:bg-slate-50"
                >
                  {copiado ? '✓' : 'Copiar'}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-slate-400">O link vale 24 horas.</p>
            </div>

            {chegaram.length === 0 ? (
              <p className="text-[11px] text-slate-500">Esperando o celular ler a primeira nota...</p>
            ) : (
              <div>
                <p className="text-[11px] font-semibold text-slate-800">Chegaram agora ({chegaram.length}):</p>
                <ul className="mt-1 space-y-0.5">
                  {chegaram.map((n) => {
                    const resumo = (n.origem ?? '').startsWith('SEFAZ_DFE_RESUMO');
                    return (
                      <li key={n.id} className={`text-[11px] ${resumo ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {resumo ? '⚠' : '✓'} {n.emitNome ?? 'Nota'}
                        {n.numero ? ` · NF ${n.numero}` : ''}
                        {n.valorTotal ? ` · ${brl(n.valorTotal)}` : ''}
                        {resumo ? ' — resumo, o XML vem na próxima consulta' : ''}{' '}
                        <Link
                          href={`/movimento/entrada-notas/${n.id}`}
                          className="font-semibold text-sky-700 underline hover:text-sky-900"
                        >
                          Abrir →
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

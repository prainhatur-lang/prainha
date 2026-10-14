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
interface Lida {
  id: string;
  notaId: string | null;
  status: string | null;
  numero: string | null;
  emitNome: string | null;
  valorTotal: string | null;
  origem: string | null;
}

// o mesmo QR vale pra várias notas: guardado aqui, quem volta da nota aberta
// continua com o mesmo link (o celular não precisa ler outro QR)
const CHAVE_SESSAO = 'nota-chave-sessao:';
const SOBRA_MIN_MS = 30 * 60 * 1000;

function sessaoGuardada(filialId: string): { url: string; e: number } | null {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE_SESSAO + filialId) ?? 'null') as { url?: string; e?: number } | null;
    if (s?.url && s.e && s.e * 1000 - Date.now() > SOBRA_MIN_MS) return { url: s.url, e: s.e };
  } catch {
    // sem localStorage — gera outro
  }
  return null;
}

export function LerPeloCelular({ filialId, onFechar }: { filialId: string; onFechar: () => void }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [url, setUrl] = useState('');
  const [desde, setDesde] = useState('');
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [chegaram, setChegaram] = useState<Chegou[]>([]);
  const [linkE, setLinkE] = useState(0);
  const [lidas, setLidas] = useState<Lida[]>([]);
  const [abrindo, setAbrindo] = useState('');

  useEffect(() => {
    let vivo = true;
    (async () => {
      const guardada = sessaoGuardada(filialId);
      const noCelularJa = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;
      if (guardada && !noCelularJa) {
        setUrl(guardada.url);
        setLinkE(guardada.e);
        setDesde(new Date().toISOString());
        return;
      }
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
        setLinkE(d.e);
        setDesde(d.agora ?? new Date().toISOString());
        try {
          localStorage.setItem(CHAVE_SESSAO + filialId, JSON.stringify({ url: u, e: d.e }));
        } catch {
          // sem localStorage — só não reaproveita o QR
        }
      } catch (err) {
        if (vivo) setErro((err as Error).message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [filialId]);

  // pergunta a cada 3 s o que entrou desde que o QR abriu; a nota que o
  // celular acabou de ler abre sozinha (nova ou que já estava no sistema)
  useEffect(() => {
    if (!desde) return;
    let vivo = true;
    let visto = '';
    let base: Set<string> | null = null; // leituras que já existiam quando o painel abriu
    async function verificar() {
      if (document.hidden) return;
      try {
        const q = new URLSearchParams({ filialId, desde });
        if (linkE) q.set('e', String(linkE));
        const r = await fetch(`/api/nota-chave/chegaram?${q}`, { cache: 'no-store' });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; notas?: Chegou[]; lidas?: Lida[] };
        if (!vivo || !d.ok || !d.notas) return;
        const ls = d.lidas ?? [];
        if (base === null) {
          base = new Set(ls.map((l) => l.id));
        } else {
          const vistas = base;
          const nova = ls.find((l) => !vistas.has(l.id) && l.notaId);
          ls.forEach((l) => vistas.add(l.id));
          if (nova?.notaId) {
            setAbrindo(nova.emitNome ?? 'nota');
            router.push(`/movimento/entrada-notas/${nova.notaId}`);
            return;
          }
        }
        setLidas(ls);
        const assinatura = d.notas.map((n) => `${n.id}:${n.origem}`).join(',');
        if (assinatura === visto) return;
        visto = assinatura;
        setChegaram(d.notas);
        start(() => router.refresh());
      } catch {
        // sem rede agora — tenta no próximo
      }
    }
    void verificar();
    const t = setInterval(verificar, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [desde, filialId, linkE, router]);

  // o que o celular leu (inclusive nota que já existia) + o que entrou de novo
  const lista = useMemo(() => {
    const vistos = new Set<string>();
    const out: Array<Chegou & { jaExistia?: boolean }> = [];
    for (const l of lidas) {
      if (!l.notaId || vistos.has(l.notaId)) continue;
      vistos.add(l.notaId);
      out.push({
        id: l.notaId,
        numero: l.numero,
        emitNome: l.emitNome,
        valorTotal: l.valorTotal,
        origem: l.origem,
        jaExistia: l.status === 'JA_EXISTE',
      });
    }
    for (const n of chegaram) {
      if (vistos.has(n.id)) continue;
      vistos.add(n.id);
      out.push(n);
    }
    return out;
  }, [lidas, chegaram]);

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

            {abrindo && (
              <p className="rounded bg-emerald-100 px-2 py-1 text-[12px] font-semibold text-emerald-800">
                ✓ O celular leu — abrindo a nota de {abrindo}...
              </p>
            )}
            {lista.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                Esperando o celular ler a primeira nota... quando ler, a nota abre sozinha aqui.
              </p>
            ) : (
              <div>
                <p className="text-[11px] font-semibold text-slate-800">Chegaram agora ({lista.length}):</p>
                <ul className="mt-1 space-y-0.5">
                  {lista.map((n) => {
                    const resumo = (n.origem ?? '').startsWith('SEFAZ_DFE_RESUMO');
                    return (
                      <li key={n.id} className={`text-[11px] ${resumo ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {resumo ? '⚠' : '✓'} {n.emitNome ?? 'Nota'}
                        {n.numero ? ` · NF ${n.numero}` : ''}
                        {n.valorTotal ? ` · ${brl(n.valorTotal)}` : ''}
                        {resumo ? ' — resumo, o XML vem na próxima consulta' : ''}
                        {'jaExistia' in n && n.jaExistia ? ' — já estava no sistema' : ''}{' '}
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

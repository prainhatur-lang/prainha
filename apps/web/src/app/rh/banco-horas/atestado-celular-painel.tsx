'use client';

// "📱 Pelo celular" do quadro de atestados: QR na tela, o celular tira a foto
// (/atestado-celular), a IA lê quem é e os dias, e quem estiver com a foto —
// no celular ou aqui — confirma se abona. Aberto no próprio celular, vai direto.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode-svg';
import type { LeituraVista, PessoaCasa } from '@/lib/rh/atestado-ler';
import { CartaoLeitura, type Confirmacao } from './cartao-leitura';

const CHAVE = (filialId: string) => `atestado-celular:${filialId}`;

function guardada(filialId: string): { url: string; e: number } | null {
  try {
    const g = JSON.parse(sessionStorage.getItem(CHAVE(filialId)) ?? 'null') as { url: string; e: number } | null;
    // sobra 1 h de folga antes de vencer
    return g && g.e * 1000 - Date.now() > 3600_000 ? g : null;
  } catch {
    return null;
  }
}

export function AtestadoCelularPainel({ filialId, onFechar }: { filialId: string; onFechar: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [linkE, setLinkE] = useState(0);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [leituras, setLeituras] = useState<LeituraVista[]>([]);
  const [pessoas, setPessoas] = useState<PessoaCasa[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erroCartao, setErroCartao] = useState<Record<string, string>>({});

  useEffect(() => {
    let vivo = true;
    (async () => {
      const noCelular = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;
      const g = guardada(filialId);
      if (g && !noCelular) {
        setUrl(g.url);
        setLinkE(g.e);
        return;
      }
      try {
        const r = await fetch('/api/rh/atestado/link', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filialId }),
        });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; f?: string; u?: string; e?: number; s?: string };
        if (!vivo) return;
        if (!r.ok || !d.ok || !d.f || !d.u || !d.e || !d.s) return setErro(d.error ?? `HTTP ${r.status}`);
        const u = `${window.location.origin}/atestado-celular?${new URLSearchParams({ f: d.f, u: d.u, e: String(d.e), s: d.s })}`;
        if (noCelular) {
          window.location.href = u;
          return;
        }
        setUrl(u);
        setLinkE(d.e);
        try {
          sessionStorage.setItem(CHAVE(filialId), JSON.stringify({ url: u, e: d.e }));
        } catch {
          /* sem storage, gera de novo da próxima vez */
        }
      } catch (err) {
        if (vivo) setErro((err as Error).message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [filialId]);

  // a cada 3 s: o que o celular mandou por esse QR
  useEffect(() => {
    if (!linkE) return;
    let vivo = true;
    let visto = '';
    async function verificar() {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/rh/atestado/leituras?${new URLSearchParams({ filialId, e: String(linkE) })}`, {
          cache: 'no-store',
        });
        const d = (await r.json().catch(() => ({}))) as { leituras?: LeituraVista[]; pessoas?: PessoaCasa[] };
        if (!vivo || !d.leituras) return;
        const assinatura = d.leituras.map((l) => `${l.id}:${l.status}`).join(',');
        if (assinatura === visto) return;
        const lancouAgora = visto !== '' && d.leituras.some((l) => l.status === 'lancado' && !visto.includes(`${l.id}:lancado`));
        visto = assinatura;
        setLeituras(d.leituras);
        if (d.pessoas) setPessoas(d.pessoas);
        if (lancouAgora) router.refresh();
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
  }, [filialId, linkE, router]);

  const qrSvg = useMemo(
    () =>
      url
        ? new QRCode({ content: url, padding: 2, width: 168, height: 168, color: '#0f172a', background: '#ffffff', ecl: 'M', join: true }).svg()
        : '',
    [url],
  );

  async function chamar(body: Record<string, unknown>, id: string): Promise<boolean> {
    setOcupado(id);
    setErroCartao((m) => ({ ...m, [id]: '' }));
    const r = await fetch('/api/rh/atestado/leituras', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filialId, leituraId: id, ...body }),
    });
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    setOcupado(null);
    if (!r.ok) {
      setErroCartao((m) => ({ ...m, [id]: j?.error ?? 'Não deu certo' }));
      return false;
    }
    return true;
  }

  async function confirmar(l: LeituraVista, c: Confirmacao) {
    if (await chamar({ acao: 'confirmar', ...c }, l.id)) {
      setLeituras((ls) => ls.map((x) => (x.id === l.id ? { ...x, status: 'lancado' } : x)));
      router.refresh();
    }
  }

  async function descartar(l: LeituraVista) {
    if (!window.confirm('Descartar esta foto? Ela não entra como atestado.')) return;
    if (await chamar({ acao: 'descartar' }, l.id)) {
      setLeituras((ls) => ls.map((x) => (x.id === l.id ? { ...x, status: 'descartado' } : x)));
    }
  }

  async function copiar() {
    await navigator.clipboard.writeText(url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  const pendentes = leituras.filter((l) => l.status === 'pendente');
  const resolvidas = leituras.filter((l) => l.status !== 'pendente');

  return (
    <div className="border-b border-sky-100 bg-sky-50/40 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-700">
          📱 Aponte a câmera do celular pro QR e tire a foto do atestado (ou mande o PDF). O sistema lê o nome e os dias e
          pergunta se abona — dá pra confirmar no celular ou aqui.
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
      {erro && <p className="mt-2 text-xs text-rose-600">{erro}</p>}
      {!erro && !url && <p className="mt-2 text-xs text-slate-500">Gerando o QR...</p>}
      {url && (
        <div className="mt-2 flex flex-wrap items-start gap-4">
          <div className="w-[168px] shrink-0 rounded-lg border border-slate-200 bg-white p-1" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className="min-w-[240px] flex-1 space-y-3">
            <div>
              <p className="text-[10px] text-slate-400">Se o QR não funcionar, mande o link pro celular (vale 24 horas):</p>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={url}
                  className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 font-mono text-[10px]"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button type="button" onClick={copiar} className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] hover:bg-slate-50">
                  {copiado ? '✓' : 'Copiar'}
                </button>
              </div>
            </div>
            {leituras.length === 0 && (
              <p className="text-xs text-slate-500">Esperando a foto... quando o celular mandar, ela aparece aqui.</p>
            )}
            {pendentes.map((l) => (
              <CartaoLeitura
                key={l.id}
                leitura={l}
                pessoas={pessoas}
                ocupado={ocupado === l.id}
                erro={erroCartao[l.id]}
                fotoUrl={`/api/rh/atestado/leituras?${new URLSearchParams({ filialId, foto: l.id })}`}
                onConfirmar={(c) => void confirmar(l, c)}
                onDescartar={() => void descartar(l)}
              />
            ))}
            {resolvidas.length > 0 && (
              <ul className="space-y-0.5 text-xs">
                {resolvidas.map((l) => (
                  <li key={l.id} className={l.status === 'lancado' ? 'text-emerald-700' : 'text-slate-400'}>
                    {l.status === 'lancado' ? '✓ lançado' : '× descartado'} — {l.lido?.paciente ?? l.arquivoNome ?? 'foto'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

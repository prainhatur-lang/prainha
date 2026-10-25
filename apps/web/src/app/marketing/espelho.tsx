'use client';

// Interruptor "Instagram → TikTok automático" da casa (pedido do dono
// 25/10/2026). Ligado, todo post novo do Instagram vai sozinho pra caixa de
// entrada do TikTok (a cada 10 min). Rota /api/marketing/espelho.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface EnvioEspelho {
  igPostId: string;
  igLink: string | null;
  igQuando: string | null;
  status: string;
  tipo: string | null;
  erro: string | null;
}

const ROTULO: Record<string, { txt: string; cor: string }> = {
  OK: { txt: '✓ no TikTok', cor: 'text-emerald-700' },
  ENVIANDO: { txt: 'mandando…', cor: 'text-slate-500' },
  ERRO: { txt: 'falhou, tenta de novo', cor: 'text-amber-700' },
  DESISTIU: { txt: 'não deu', cor: 'text-rose-700' },
  PULADO: { txt: 'já foi pelo Publicar', cor: 'text-slate-500' },
};

const quando = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Maceio', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

export function Espelho({
  filialId,
  ativo: ativo0,
  desde,
  pronto,
  envios,
}: {
  filialId: string;
  ativo: boolean;
  desde: string | null;
  /** Instagram e TikTok (com video.upload) ligados */
  pronto: string | null;
  envios: EnvioEspelho[];
}) {
  const router = useRouter();
  const [ativo, setAtivo] = useState(ativo0);
  const [indo, setIndo] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);

  async function chamar(corpo: Record<string, unknown>) {
    setIndo(true);
    setMsg(null);
    try {
      const r = await fetch('/api/marketing/espelho', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, ...corpo }),
      });
      const j = (await r.json().catch(() => null)) as
        | { error?: string; ativo?: boolean; enviados?: Array<{ status: string }> }
        | null;
      if (!r.ok || !j || j.error) {
        setMsg({ ok: false, txt: j?.error ?? `Falhou (HTTP ${r.status}).` });
        return;
      }
      if (typeof j.ativo === 'boolean') {
        setAtivo(j.ativo);
        setMsg({
          ok: true,
          txt: j.ativo
            ? 'Ligado. Daqui pra frente, todo post novo do Instagram vai pro TikTok em até 10 minutos.'
            : 'Desligado. Os posts do Instagram não vão mais sozinhos pro TikTok.',
        });
      } else if (j.enviados) {
        const ok = j.enviados.filter((e) => e.status === 'OK').length;
        setMsg({ ok: true, txt: j.enviados.length ? `${ok} de ${j.enviados.length} post(s) mandados agora.` : 'Nenhum post novo pra mandar.' });
      }
      router.refresh();
    } catch {
      setMsg({ ok: false, txt: 'Sem conexão com o sistema.' });
    } finally {
      setIndo(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">🔁 Instagram → TikTok automático</h2>
          <p className="text-xs text-slate-500">
            Postou no Instagram (pelo sistema ou pelo app), vai sozinho pra caixa de entrada do TikTok desta casa. Lá é só
            escolher a música e tocar em Publicar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ativo && (
            <button
              type="button"
              onClick={() => chamar({ agora: true })}
              disabled={indo}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Conferir agora
            </button>
          )}
          <button
            type="button"
            onClick={() => chamar({ ativo: !ativo })}
            disabled={indo || (!ativo && !!pronto)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              ativo ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-900 text-white hover:bg-black'
            }`}
          >
            {indo ? '…' : ativo ? '✓ Ligado — desligar' : 'Ligar'}
          </button>
        </div>
      </div>
      {!ativo && pronto && <p className="mt-2 text-xs text-amber-700">{pronto}</p>}
      {ativo && desde && <p className="mt-2 text-xs text-slate-500">Vale pros posts feitos desde {quando(desde)}.</p>}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.txt}</p>}
      {envios.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-xs">
          {envios.map((e) => {
            const r = ROTULO[e.status] ?? { txt: e.status, cor: 'text-slate-500' };
            return (
              <li key={e.igPostId} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                <span className="text-slate-700">
                  {e.igLink ? (
                    <a href={e.igLink} target="_blank" rel="noreferrer" className="underline">
                      post de {quando(e.igQuando)}
                    </a>
                  ) : (
                    `post de ${quando(e.igQuando)}`
                  )}
                  {e.tipo ? ` · ${e.tipo === 'video' ? 'vídeo' : 'fotos'}` : ''}
                </span>
                <span className={r.cor}>
                  {r.txt}
                  {e.erro && e.status !== 'OK' && e.status !== 'PULADO' ? ` — ${e.erro}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

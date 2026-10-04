'use client';

// Aviso de "cliente esperando atendente": quando a Nina passa a conversa pra
// equipe, aparece um cartão no canto de QUALQUER tela do app, toca um bipe e
// (se o navegador deixar) solta uma notificação. Antes disso a transferência
// só aparecia pra quem estivesse olhando a tela de conversas — o cliente
// ficava esperando e ninguém sabia.
//
// Só aparece pra quem tem acesso às conversas (a rota devolve 401/403 pros
// demais e o componente para de consultar).

import { useEffect, useRef, useState } from 'react';

interface Pendente {
  id: string;
  nome: string;
  motivo: string | null;
  desde: string | null;
  filialNome: string;
}

const INTERVALO_MS = 20_000;
/** Enquanto houver alguém esperando, repete o bipe a cada 3 min. */
const REPETIR_MS = 3 * 60_000;

function tocarBeep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1046, 1318].forEach((freq, i) => {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      }, i * 220);
    });
  } catch {
    /* navegador sem áudio ou bloqueado — fica só o cartão */
  }
}

function esperaTxt(desde: string | null): string {
  if (!desde) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60_000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

export function AvisoNina() {
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [antigas, setAntigas] = useState(0);
  const [recolhido, setRecolhido] = useState(false);
  const [notif, setNotif] = useState<'default' | 'granted' | 'denied' | 'sem'>('sem');
  const vistosRef = useRef<Set<string>>(new Set());
  const ultimoBeepRef = useRef(0);
  const tituloRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof Notification !== 'undefined') setNotif(Notification.permission);
  }, []);

  useEffect(() => {
    let cancel = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function poll() {
      try {
        const r = await fetch('/api/atendimento/pendentes', { cache: 'no-store' });
        if (r.status === 401 || r.status === 403) {
          // sem acesso às conversas: não é pra essa pessoa
          if (timer) clearInterval(timer);
          return;
        }
        if (!r.ok) return;
        const d = await r.json();
        if (cancel) return;
        const lista: Pendente[] = Array.isArray(d?.pendentes) ? d.pendentes : [];
        setPendentes(lista);
        setAntigas(Number(d?.antigas) || 0);

        const novos = lista.filter((p) => !vistosRef.current.has(p.id));
        vistosRef.current = new Set(lista.map((p) => p.id));
        const agora = Date.now();
        if (novos.length > 0) {
          setRecolhido(false);
          tocarBeep();
          ultimoBeepRef.current = agora;
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            for (const p of novos) {
              try {
                const n = new Notification(`${p.nome} está esperando atendente`, {
                  body: [p.filialNome, p.motivo].filter(Boolean).join(' · ').slice(0, 180),
                  tag: `nina-${p.id}`,
                });
                n.onclick = () => {
                  window.focus();
                  window.location.href = `/atendimento?conversa=${p.id}`;
                };
              } catch {
                /* alguns navegadores só notificam via service worker */
              }
            }
          }
        } else if (lista.length > 0 && agora - ultimoBeepRef.current > REPETIR_MS) {
          tocarBeep();
          ultimoBeepRef.current = agora;
        }
      } catch {
        /* consulta silenciosa */
      }
    }
    poll();
    timer = setInterval(poll, INTERVALO_MS);
    return () => {
      cancel = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  // Contador no título da aba — dá pra ver mesmo com o app em segundo plano.
  useEffect(() => {
    if (tituloRef.current === null) tituloRef.current = document.title.replace(/^\(\d+\) /, '');
    document.title = pendentes.length > 0 ? `(${pendentes.length}) ${tituloRef.current}` : tituloRef.current;
  }, [pendentes.length]);

  // Só conversa parada há mais de 1 dia: sem bipe, só um lembrete discreto.
  if (pendentes.length === 0) {
    if (antigas === 0) return null;
    return (
      <a
        href="/atendimento"
        className="fixed bottom-4 right-4 z-50 rounded-full border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 shadow-lg hover:bg-rose-50"
      >
        ⚠ {antigas === 1 ? '1 conversa sem resposta há mais de 1 dia' : `${antigas} conversas sem resposta há mais de 1 dia`}
      </a>
    );
  }

  if (recolhido) {
    return (
      <button
        type="button"
        onClick={() => setRecolhido(false)}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-amber-600"
      >
        🙋 {pendentes.length} esperando atendente
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-amber-300 bg-white shadow-xl">
      <div className="flex items-center justify-between rounded-t-xl bg-amber-500 px-3 py-2 text-white">
        <span className="text-sm font-semibold">
          🙋 {pendentes.length === 1 ? '1 cliente esperando atendente' : `${pendentes.length} clientes esperando atendente`}
        </span>
        <button type="button" onClick={() => setRecolhido(true)} aria-label="Recolher aviso" className="rounded px-1.5 text-white/90 hover:bg-white/20">
          –
        </button>
      </div>
      <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
        {pendentes.map((p) => (
          <li key={p.id}>
            <a href={`/atendimento?conversa=${p.id}`} className="block px-3 py-2 hover:bg-amber-50">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-900">{p.nome}</span>
                <span className="shrink-0 text-xs text-slate-500">{esperaTxt(p.desde)}</span>
              </div>
              <div className="truncate text-xs text-slate-500">
                {[p.filialNome, p.motivo].filter(Boolean).join(' · ') || 'A Nina passou pra equipe'}
              </div>
            </a>
          </li>
        ))}
      </ul>
      {antigas > 0 && (
        <a href="/atendimento" className="block border-t border-slate-100 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50">
          ⚠ Mais {antigas} sem resposta há mais de 1 dia — ver todas
        </a>
      )}
      {notif === 'default' && (
        <button
          type="button"
          onClick={() => Notification.requestPermission().then((p) => setNotif(p)).catch(() => {})}
          className="w-full rounded-b-xl border-t border-slate-100 px-3 py-2 text-left text-xs font-medium text-amber-700 hover:bg-amber-50"
        >
          🔔 Avisar também com notificação neste aparelho
        </button>
      )}
    </div>
  );
}

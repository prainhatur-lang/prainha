'use client';

// Emitir a NFC-e de VÁRIOS pedidos sem nota de uma vez — fica acima da lista
// de "pedidos sem nota". É o mesmo caminho do botão "🧾 Emitir" de cada linha
// (POST /api/nfce/emitir-pedido, montado do espelho Postgres), chamado um
// pedido por vez, na ordem. O botão de cada linha continua igual.
//
// Em lote a nota sai SEM CPF/CNPJ (não dá pra perguntar em cada uma); quem
// precisa de nota identificada desmarca aqui e emite pela linha.
//
// Emitir NFC-e é IRREVERSÍVEL (cancelar só até 30min na SEFAZ-SE): confirma
// antes com a quantidade e o total, dá pra parar no meio, e três falhas
// seguidas param sozinhas (sinal de problema geral — certificado, SEFAZ fora).

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PedidoLote {
  filialId: string;
  codigoExterno: number;
  rotulo: string;
  valor: number;
}

type Situacao = { ok: true; texto: string } | { ok: false; texto: string };

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const chaveDe = (p: PedidoLote) => `${p.filialId}:${p.codigoExterno}`;

export function EmitirLote({ pedidos }: { pedidos: PedidoLote[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(pedidos.map(chaveDe)));
  const [situacao, setSituacao] = useState<Record<string, Situacao>>({});
  const [rodando, setRodando] = useState(false);
  const [atual, setAtual] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const parar = useRef(false);

  if (pedidos.length < 2) return null;

  // o que ainda dá pra emitir: marcado e sem nota autorizada nesta rodada
  const fila = pedidos.filter((p) => marcados.has(chaveDe(p)) && !situacao[chaveDe(p)]?.ok);
  const total = fila.reduce((s, p) => s + p.valor, 0);
  const feitas = Object.values(situacao).filter((s) => s.ok).length;
  const falhas = Object.values(situacao).filter((s) => !s.ok).length;

  function alternar(k: string) {
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  async function emitirTodas() {
    if (!fila.length) return;
    const ok = window.confirm(
      `Emitir ${fila.length} NFC-e — total ${brl(total)}?\n\n` +
        'ATENÇÃO: cada nota é enviada à SEFAZ e só pode ser cancelada em até 30 MINUTOS.\n' +
        'Em lote as notas saem SEM CPF/CNPJ do consumidor.',
    );
    if (!ok) return;

    parar.current = false;
    setRodando(true);
    setAviso(null);
    let seguidas = 0;
    for (const p of fila) {
      if (parar.current) {
        setAviso('Parado. O que já saiu está marcado com ✓; o resto não foi enviado.');
        break;
      }
      const k = chaveDe(p);
      setAtual(k);
      let s: Situacao;
      try {
        const r = await fetch('/api/nfce/emitir-pedido', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filialId: p.filialId, codigoExterno: p.codigoExterno, documento: null }),
        });
        const j = await r.json();
        s = j.ok
          ? { ok: true, texto: j.nota?.numero ? `nota ${j.nota.numero}` : 'autorizada' }
          : { ok: false, texto: j.erro ?? 'falhou' };
      } catch (e) {
        s = { ok: false, texto: (e as Error).message };
      }
      setSituacao((m) => ({ ...m, [k]: s }));
      seguidas = s.ok ? 0 : seguidas + 1;
      if (seguidas >= 3) {
        setAviso('Parei: três falhas seguidas. Veja o motivo nas linhas em vermelho antes de tentar de novo.');
        break;
      }
    }
    setAtual(null);
    setRodando(false);
    router.refresh();
  }

  if (!aberto) {
    return (
      <div className="mt-3">
        <button
          onClick={() => setAberto(true)}
          className="rounded-md border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
        >
          🧾 Emitir em lote ({pedidos.length} pedidos desta lista)…
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-900">Emitir em lote</span>
        <button
          onClick={() => setMarcados(new Set(pedidos.map(chaveDe)))}
          disabled={rodando}
          className="text-[11px] text-slate-600 underline disabled:opacity-50"
        >
          marcar todos
        </button>
        <button
          onClick={() => setMarcados(new Set())}
          disabled={rodando}
          className="text-[11px] text-slate-600 underline disabled:opacity-50"
        >
          desmarcar todos
        </button>
        <span className="ml-auto text-[11px] text-slate-600">
          {fila.length} pra emitir · {brl(total)}
          {feitas > 0 ? ` · ✓ ${feitas} emitida(s)` : ''}
          {falhas > 0 ? ` · ${falhas} com erro` : ''}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-600">
        As notas saem <b>sem CPF/CNPJ</b>, uma por vez. Pedido que precisa de nota identificada: desmarque aqui e use o
        Emitir da linha dele, mais abaixo.
      </p>

      <div className="mt-2 max-h-72 overflow-y-auto rounded border border-slate-200 bg-white">
        {pedidos.map((p) => {
          const k = chaveDe(p);
          const s = situacao[k];
          return (
            <label key={k} className="flex items-center gap-2 border-b border-slate-100 px-2 py-1 text-xs last:border-b-0">
              <input
                type="checkbox"
                checked={marcados.has(k)}
                disabled={rodando || !!s?.ok}
                onChange={() => alternar(k)}
              />
              <span className="min-w-0 flex-1 truncate text-slate-700">{p.rotulo}</span>
              {atual === k && <span className="text-[11px] text-sky-700">emitindo…</span>}
              {s && (
                <span
                  className={`max-w-[260px] truncate text-[11px] ${s.ok ? 'font-medium text-emerald-700' : 'text-rose-700'}`}
                  title={s.texto}
                >
                  {s.ok ? '✓ ' : ''}
                  {s.texto}
                </span>
              )}
              <span className="shrink-0 font-mono text-slate-900">{brl(p.valor)}</span>
            </label>
          );
        })}
      </div>

      {aviso && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900">{aviso}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={emitirTodas}
          disabled={rodando || fila.length === 0}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {rodando ? `emitindo… faltam ${fila.length}` : `🧾 Emitir ${fila.length} nota(s)`}
        </button>
        {rodando ? (
          <button
            onClick={() => {
              parar.current = true;
            }}
            className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
          >
            Parar
          </button>
        ) : (
          <button onClick={() => setAberto(false)} className="text-[11px] text-slate-600 underline">
            fechar
          </button>
        )}
      </div>
    </div>
  );
}

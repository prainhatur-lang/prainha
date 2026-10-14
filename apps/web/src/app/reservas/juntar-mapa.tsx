'use client';

import { useMemo } from 'react';
import { ligadasAPrincipal, mesasDoLado, plantaDoEspaco } from '@/lib/reservas/vizinhas';
import type { Mesa } from './reservas-client';

// Juntar mesas em cima do mapa do espaço (dono, 14/10/2026): marcou a mesa,
// aparecem em verde só as encostadas nela (do lado, na frente, atrás) — mesa
// longe fica apagada e não dá pra marcar. Juntando a 2ª, a 3ª pode ser
// vizinha de qualquer uma das já marcadas. Desmarcar uma do meio solta as que
// ficaram sem ligação com a principal.
export function JuntarNoMapa({ filialId, area, mesas, principal, selecionadas, onChange, statusMesa, compacto, onVerLista }: {
  filialId: string;
  area: string;
  mesas: Mesa[];
  principal: string;
  selecionadas: string[];
  onChange: (v: string[]) => void;
  statusMesa: (numero: string) => { sufixo: string; bloqueada: boolean };
  compacto?: boolean;
  onVerLista: () => void;
}) {
  const planta = useMemo(() => plantaDoEspaco(filialId, area, mesas.map((m) => m.numero)), [filialId, area, mesas]);
  const porNumero = new Map(mesas.map((m) => [m.numero, m]));
  const doLado = mesasDoLado(planta.vizinhas, [principal, ...selecionadas]);
  const livresDoLado = [...doLado].filter((n) => !statusMesa(n).bloqueada);

  function tocar(numero: string) {
    if (numero === principal) return;
    if (selecionadas.includes(numero)) {
      // Solta só quem perdeu a ligação agora — junção antiga já fora do
      // desenho (feita pela lista) continua como estava.
      const antes = new Set(ligadasAPrincipal(planta.vizinhas, principal, selecionadas));
      const resto = selecionadas.filter((n) => n !== numero);
      const depois = new Set(ligadasAPrincipal(planta.vizinhas, principal, resto));
      onChange(resto.filter((n) => depois.has(n) || !antes.has(n)));
    } else if (doLado.has(numero) && !statusMesa(numero).bloqueada) {
      onChange([...selecionadas, numero]);
    }
  }

  const lado = compacto ? 30 : 38;
  const gap = 4;
  return (
    <span className="block w-full max-w-full">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={compacto ? 'text-[11px] text-slate-600' : 'text-xs text-slate-600'}>
          {livresDoLado.length > 0 ? (
            <>Toque nas mesas <b className="text-emerald-700">verdes</b> — são as encostadas{selecionadas.length ? ' nas marcadas' : ` na ${principal}`}:</>
          ) : (
            <>Nenhuma mesa livre encostada{selecionadas.length ? ' nas marcadas' : ` na ${principal}`}.</>
          )}
        </span>
        <button
          type="button"
          onClick={onVerLista}
          className="text-[10px] text-slate-400 underline hover:text-slate-600"
          title="Volta pra lista de antes, com todas as mesas do espaço"
        >
          ver em lista
        </button>
      </span>
      <span className="mt-1 block overflow-x-auto rounded-lg border border-slate-200 bg-gradient-to-b from-sky-50 to-white p-1.5">
        {planta.topo && <span className="mb-1 block text-center text-[10px] font-medium text-sky-500">{planta.topo}</span>}
        <span className="flex gap-3">
          {planta.blocos.map((b, bi) => (
            <span key={bi} className={`flex shrink-0 flex-col ${bi > 0 ? 'border-l border-sky-100 pl-3' : ''}`}>
              {b.titulo && <span className="mb-0.5 block text-[9px] font-medium text-slate-400">{b.titulo}</span>}
              <span className="flex flex-col" style={{ gap }}>
                {b.linhas.map((linha, li) => (
                  <span key={li} className="flex" style={{ gap }}>
                    {linha.map((c, ci) => {
                      const w = (c?.span ?? 1) * lado + ((c?.span ?? 1) - 1) * gap;
                      if (!c) return <span key={`v${ci}`} style={{ width: w, height: lado }} />;
                      const m = porNumero.get(c.numero);
                      const st = statusMesa(c.numero);
                      const ehPrincipal = c.numero === principal;
                      const marcada = selecionadas.includes(c.numero);
                      const pode = doLado.has(c.numero) && !st.bloqueada;
                      const cls = ehPrincipal
                        ? 'border-amber-700 bg-amber-600 font-bold text-white'
                        : marcada
                          ? 'border-amber-500 bg-amber-200 font-semibold text-amber-900 hover:bg-amber-300'
                          : pode
                            ? 'border-2 border-dashed border-emerald-500 bg-white font-semibold text-emerald-800 hover:bg-emerald-50'
                            : st.bloqueada
                              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-300 line-through'
                              : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300';
                      const titulo = `Mesa ${c.numero} · ${m?.lugares ?? '?'} lugares${st.sufixo}${
                        ehPrincipal ? ' · principal' : marcada ? ' · juntada (toque pra tirar)' : pode ? ' · encostada — toque pra juntar' : st.bloqueada ? '' : ' · longe — só junta mesa encostada'
                      }`;
                      return (
                        <button
                          key={c.numero}
                          type="button"
                          title={titulo}
                          onClick={() => tocar(c.numero)}
                          disabled={!ehPrincipal && !marcada && !pode}
                          style={{ width: w, height: lado }}
                          className={`flex shrink-0 flex-col items-center justify-center rounded-md border leading-none ${compacto ? 'text-[11px]' : 'text-xs'} ${cls}`}
                        >
                          <span>{c.numero}</span>
                          {!compacto && m && <span className="mt-0.5 text-[8px] font-normal opacity-70">{m.lugares}p</span>}
                        </button>
                      );
                    })}
                  </span>
                ))}
              </span>
            </span>
          ))}
        </span>
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-600" /> principal</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-200 ring-1 ring-amber-500" /> juntada</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-emerald-500" /> encostada (pode juntar)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-100 ring-1 ring-slate-200" /> longe ou ocupada</span>
      </span>
    </span>
  );
}

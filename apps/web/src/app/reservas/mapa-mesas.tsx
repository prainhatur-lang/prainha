'use client';

import type { FilialOpt, Mesa } from './reservas-client';

// Mapa visual de mesas por espaco. 1a versao: colunas de 4 (rio na frente/topo),
// cores por ocupacao no dia. Base pro mapa de selecao do cliente.

function corLugares(n: number): string {
  if (n >= 12) return 'bg-violet-100 border-violet-300 text-violet-800';
  if (n >= 8) return 'bg-sky-100 border-sky-300 text-sky-800';
  if (n >= 6) return 'bg-amber-100 border-amber-300 text-amber-800';
  return 'bg-slate-100 border-slate-300 text-slate-700';
}

interface ReservaInfo { nome: string; hora: string; pessoas: number }

function MesaCard({ mesa, info, noConsumer, larguraPx }: { mesa: Mesa; info?: ReservaInfo; noConsumer: boolean; larguraPx?: number }) {
  const ocupada = !!info;
  // Ocupada no Consumer mas SEM reserva vinculada = walk-in (cliente sentou
  // sem passar pela recepção/reserva).
  const walkIn = !ocupada && noConsumer;
  const primeiro = info ? info.nome.split(' ')[0] : '';
  return (
    <div
      title={
        ocupada
          ? `Mesa ${mesa.numero} · ${info!.nome} · ${info!.hora} · ${info!.pessoas} pessoa(s)`
          : walkIn
            ? `Mesa ${mesa.numero} · ocupada no sistema (sem reserva)`
            : `Mesa ${mesa.numero} · ${mesa.lugares} lugares${mesa.juntavel ? ' · juntável' : ''} · livre`
      }
      style={larguraPx ? { width: larguraPx } : undefined}
      className={`relative flex h-16 ${larguraPx ? '' : 'w-16'} flex-col items-center justify-center rounded-lg border px-0.5 text-center ${
        ocupada
          ? 'border-rose-300 bg-rose-100 text-rose-700'
          : walkIn
            ? 'border-orange-300 bg-orange-100 text-orange-700'
            : corLugares(mesa.lugares)
      }`}
    >
      <span className="text-sm font-bold leading-none">{mesa.numero}</span>
      {ocupada ? (
        <>
          <span className="mt-0.5 max-w-full truncate text-[9px] font-semibold leading-tight">{primeiro}</span>
          <span className="text-[8px] leading-none opacity-80">{info!.hora}</span>
        </>
      ) : walkIn ? (
        <span className="mt-0.5 text-[9px] font-semibold leading-tight">ocupada</span>
      ) : (
        <span className="mt-0.5 text-[9px] leading-none opacity-70">{mesa.lugares} lug</span>
      )}
      {mesa.juntavel && <span className="absolute right-0.5 top-0.5 text-[8px]">🔗</span>}
    </div>
  );
}

/**
 * Agrupa mesas em N "raias" indo do rio (frente) pra trás — cada bloco de 4
 * mesas consecutivas do array é uma fatia de profundidade; a fatia i cai na
 * raia (i % largura). Com largura=5 e um bloco de 20 mesas (1 fatia por
 * raia, sem repetir), dá raia0=[4,3,2,1] (frente=4), raia1=[8,7,6,5]
 * (frente=8), raia2 frente=12, raia3 frente=16, raia4 frente=20.
 */
function agruparEmRaias<T>(itens: T[], largura: number): T[][] {
  const fatias: T[][] = [];
  for (let i = 0; i < itens.length; i += 4) fatias.push(itens.slice(i, i + 4).reverse());
  const raias: T[][] = Array.from({ length: largura }, () => []);
  fatias.forEach((fatia, i) => raias[i % largura]!.push(...fatia));
  return raias;
}

/**
 * Areia não é 1 raia de 12 mesas de fundo — são 3 BLOCOS de 20 mesas lado a
 * lado (1-20, 21-40, 41-60), cada um com suas próprias 5 raias de 4 de
 * profundidade. O bloco 2 (frente=24,28,32,36,40) fica do lado do bloco 1
 * (frente=4,8,12,16,20), não empilhado atrás dele na mesma raia — mesma
 * lógica pro bloco 3 (frente=44,48,52,56,60).
 */
function blocosDeAreia<T>(mesas: T[]): T[][][] {
  const blocos: T[][][] = [];
  for (let i = 0; i < mesas.length; i += 20) blocos.push(agruparEmRaias(mesas.slice(i, i + 20), 5));
  return blocos;
}

function AreiaGrid({ mesas, ocupadas, ocupadasConsumer, reservasPorMesa, filialId }: { mesas: Mesa[]; ocupadas: Set<string>; ocupadasConsumer: Set<string>; reservasPorMesa: Record<string, ReservaInfo>; filialId: string }) {
  const blocos = blocosDeAreia(mesas);
  const livres = mesas.filter(
    (m) => !ocupadas.has(`${filialId}:${m.numero}`) && !ocupadasConsumer.has(`${filialId}:${m.numero}`),
  ).length;

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-slate-800">Areia</h4>
        <span className="text-xs text-slate-500">{livres}/{mesas.length} livres</span>
      </div>
      <p className="mt-0.5 text-[10px] text-slate-400">mesas 4, 8, 12, 16, 20 encostam no rio — os próximos 3 blocos de 20 ficam do lado, um depois do outro</p>
      <div className="mt-1 rounded-lg bg-gradient-to-b from-sky-50 to-white p-2">
        <div className="mb-1 text-center text-[10px] font-medium text-sky-500">🌊 rio (frente)</div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {blocos.map((raias, bi) => (
            <div key={bi} className={`flex gap-1.5 ${bi > 0 ? 'border-l border-sky-100 pl-3' : ''}`}>
              {raias.map((raia, ri) => (
                <div key={ri} className="flex flex-col gap-1.5">
                  {raia.map((m) => (
                    <MesaCard
                      key={m.numero}
                      mesa={m}
                      info={reservasPorMesa[`${filialId}:${m.numero}`]}
                      noConsumer={ocupadasConsumer.has(`${filialId}:${m.numero}`)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Espaco({ nome, mesas, ocupadas, ocupadasConsumer, reservasPorMesa, filialId }: { nome: string; mesas: Mesa[]; ocupadas: Set<string>; ocupadasConsumer: Set<string>; reservasPorMesa: Record<string, ReservaInfo>; filialId: string }) {
  // colunas de 4 (rio em cima → mesa "da frente" no topo de cada coluna)
  const colunas: Mesa[][] = [];
  for (let i = 0; i < mesas.length; i += 4) colunas.push(mesas.slice(i, i + 4).reverse());

  const livres = mesas.filter(
    (m) => !ocupadas.has(`${filialId}:${m.numero}`) && !ocupadasConsumer.has(`${filialId}:${m.numero}`),
  ).length;

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-slate-800">{nome}</h4>
        <span className="text-xs text-slate-500">{livres}/{mesas.length} livres</span>
      </div>
      <div className="mt-1 rounded-lg bg-gradient-to-b from-sky-50 to-white p-2">
        <div className="mb-1 text-center text-[10px] font-medium text-sky-500">🌊 rio (frente)</div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {colunas.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-1.5">
              {col.map((m) => (
                <MesaCard
                  key={m.numero}
                  mesa={m}
                  info={reservasPorMesa[`${filialId}:${m.numero}`]}
                  noConsumer={ocupadasConsumer.has(`${filialId}:${m.numero}`)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Deck Superior + Lounges tratados como UM bloco só — fica atrás das mesas
 * 1-20 da Areia (não é um espaço genérico em colunas de 4, é a planta real
 * descrita pelo dono): linha da frente 101 | 128 | 129 | 130 (viradas pro
 * rio); atrás de 101 vêm 102+103, atrás dessas 104+105, e atrás dessas
 * 106+107 (4 fileiras de profundidade); atrás de 128+metade de 129 vêm
 * 108+109 (deck); atrás do outro lado (130) vêm 110+111.
 */
function DeckELounges({
  deck,
  lounges,
  ocupadas,
  ocupadasConsumer,
  reservasPorMesa,
  filialId,
}: {
  deck: Mesa[];
  lounges: Mesa[];
  ocupadas: Set<string>;
  ocupadasConsumer: Set<string>;
  reservasPorMesa: Record<string, ReservaInfo>;
  filialId: string;
}) {
  const todas = [...deck, ...lounges];
  const m = (numero: string) => todas.find((x) => x.numero === numero);
  const card = (numero: string, larguraPx?: number) => {
    const mesa = m(numero);
    if (!mesa) return null;
    return (
      <MesaCard
        key={numero}
        mesa={mesa}
        info={reservasPorMesa[`${filialId}:${numero}`]}
        noConsumer={ocupadasConsumer.has(`${filialId}:${numero}`)}
        larguraPx={larguraPx}
      />
    );
  };
  const livres = todas.filter(
    (mm) => !ocupadas.has(`${filialId}:${mm.numero}`) && !ocupadasConsumer.has(`${filialId}:${mm.numero}`),
  ).length;

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-slate-800">Deck Superior + Lounges</h4>
        <span className="text-xs text-slate-500">{livres}/{todas.length} livres</span>
      </div>
      <p className="mt-0.5 text-[10px] text-slate-400">atrás das mesas 1-20 da Areia · virado pro rio na linha da frente</p>
      <div className="mt-1 rounded-lg bg-gradient-to-b from-sky-50 to-white p-2">
        <div className="mb-1.5 text-center text-[10px] font-medium text-sky-500">🌊 Areia / rio (frente)</div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {/* Lado 101: mesa grande (larga igual 102+103 juntas) → 102+103 → 104+105 → 106+107 */}
          <div className="flex flex-col items-start gap-1.5">
            <div className="flex gap-1.5">{card('101', 134)}</div>
            <div className="flex gap-1.5">{card('102')}{card('103')}</div>
            <div className="flex gap-1.5">{card('104')}{card('105')}</div>
            <div className="flex gap-1.5">{card('106')}{card('107')}</div>
          </div>
          {/* Lado Lounges: mesas grandes, esticadas pra ocupar a largura das
              4 de trás (108-111) → 108,109 (atrás de 128+meio de 129) e
              110,111 (atrás de 130) */}
          <div className="flex flex-col items-start gap-1.5 border-l border-sky-100 pl-3">
            <div className="flex gap-1.5">{card('128', 87)}{card('129', 87)}{card('130', 87)}</div>
            <div className="flex gap-1.5">
              <div className="flex gap-1.5">{card('108')}{card('109')}</div>
              <div className="ml-1.5 flex gap-1.5">{card('110')}{card('111')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MapaMesas({ filiais, ocupadas, ocupadasConsumer, reservasPorMesa }: { filiais: FilialOpt[]; ocupadas: Set<string>; ocupadasConsumer: Set<string>; reservasPorMesa: Record<string, ReservaInfo> }) {
  const comMesas = filiais.filter((f) => (f.areas ?? []).some((a) => (a.mesas?.length ?? 0) > 0));
  if (comMesas.length === 0) {
    return <p className="mt-3 text-sm text-slate-400">Nenhuma mesa cadastrada ainda.</p>;
  }
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3 text-[11px] text-slate-500">
        <span>Legenda:</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-slate-100 ring-1 ring-slate-300" /> livre</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-rose-100 ring-1 ring-rose-300" /> ocupada (reserva)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-orange-100 ring-1 ring-orange-300" /> ocupada no sistema (sem reserva)</span>
        <span>🔗 juntável</span>
      </div>
      {comMesas.map((f) => {
        const areasComMesa = (f.areas ?? []).filter((a) => (a.mesas?.length ?? 0) > 0);
        const deckArea = areasComMesa.find((a) => a.nome === 'Deck Superior');
        const loungesArea = areasComMesa.find((a) => a.nome === 'Lounges');
        // Grade de 5 raias (4/8/12/16/20 na frente) só faz sentido pra ESSA
        // planta específica (60 mesas, múltiplo de 20) — se o número mudar
        // de novo, cai pro genérico em vez de desenhar raia errada.
        const areiaArea = areasComMesa.find((a) => a.nome === 'Areia' && (a.mesas?.length ?? 0) % 20 === 0);
        const outras = areasComMesa.filter((a) => a.nome !== 'Deck Superior' && a.nome !== 'Lounges' && a !== areiaArea);
        return (
          <div key={f.id} className="mt-3">
            {filiais.length > 1 && <div className="text-xs font-semibold text-slate-600">{f.nome}</div>}
            {areiaArea && (
              <AreiaGrid mesas={areiaArea.mesas!} ocupadas={ocupadas} ocupadasConsumer={ocupadasConsumer} reservasPorMesa={reservasPorMesa} filialId={f.id} />
            )}
            {outras.map((a) => (
              <Espaco key={a.nome} nome={a.nome} mesas={a.mesas!} ocupadas={ocupadas} ocupadasConsumer={ocupadasConsumer} reservasPorMesa={reservasPorMesa} filialId={f.id} />
            ))}
            {deckArea && loungesArea ? (
              <DeckELounges
                deck={deckArea.mesas!}
                lounges={loungesArea.mesas!}
                ocupadas={ocupadas}
                ocupadasConsumer={ocupadasConsumer}
                reservasPorMesa={reservasPorMesa}
                filialId={f.id}
              />
            ) : (
              <>
                {deckArea && <Espaco nome="Deck Superior" mesas={deckArea.mesas!} ocupadas={ocupadas} ocupadasConsumer={ocupadasConsumer} reservasPorMesa={reservasPorMesa} filialId={f.id} />}
                {loungesArea && <Espaco nome="Lounges" mesas={loungesArea.mesas!} ocupadas={ocupadas} ocupadasConsumer={ocupadasConsumer} reservasPorMesa={reservasPorMesa} filialId={f.id} />}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

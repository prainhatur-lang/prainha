'use client';

export interface MesaPublica {
  numero: string;
  lugares: number;
  juntavel: boolean;
  livre: boolean;
}

// Mapa clicável de mesas na reserva pública — cliente escolhe a mesa que
// quer (opcional; se não escolher, o servidor aloca a menor mesa livre que
// couber, como já fazia). Nunca mostra nome de outro cliente — só
// livre/ocupada, sem detalhe (privacidade).

function MesaBotao({
  mesa,
  pessoas,
  selecionada,
  onSelecionar,
  contexto,
  larguraPx,
}: {
  mesa: MesaPublica;
  pessoas: number;
  selecionada: string;
  onSelecionar: (numero: string) => void;
  /** Mesa de outro espaço, só pra mostrar a planta — não clicável aqui
   *  (o cliente precisa trocar o "Espaço" pra reservar ela, taxa diferente). */
  contexto?: boolean;
  larguraPx?: number;
}) {
  const cabe = mesa.lugares >= pessoas;
  const clicavel = !contexto && mesa.livre && cabe;
  const sel = !contexto && selecionada === mesa.numero;
  return (
    <button
      type="button"
      disabled={!clicavel}
      onClick={() => onSelecionar(sel ? '' : mesa.numero)}
      title={
        contexto
          ? `Mesa ${mesa.numero} · outro espaço`
          : !mesa.livre
            ? `Mesa ${mesa.numero} · ocupada`
            : !cabe
              ? `Mesa ${mesa.numero} · ${mesa.lugares} lugares — não cabe ${pessoas} pessoa(s)`
              : `Mesa ${mesa.numero} · ${mesa.lugares} lugares`
      }
      style={larguraPx ? { width: larguraPx } : undefined}
      className={`flex h-14 ${larguraPx ? '' : 'w-14'} flex-col items-center justify-center rounded-lg border text-center transition ${
        sel
          ? 'border-[var(--rsv-mesa-sel)] bg-[var(--rsv-mesa-sel)] text-[var(--rsv-mesa-sel-ink)] shadow-md'
          : contexto
            ? 'cursor-not-allowed border-dashed border-[var(--rsv-mesa-line)] bg-transparent text-[var(--rsv-mesa-dim-ink)] opacity-50'
            : !mesa.livre
              ? 'cursor-not-allowed border-[var(--rsv-mesa-ocupada-line)] bg-[var(--rsv-mesa-ocupada)] text-[var(--rsv-mesa-ocupada-ink)] opacity-60'
              : !cabe
                ? 'cursor-not-allowed border-[var(--rsv-mesa-line)] bg-[var(--rsv-mesa-off)] text-[var(--rsv-mesa-off-ink)] opacity-50'
                : 'border-[var(--rsv-mesa-line)] bg-[var(--rsv-mesa-livre)] text-[var(--rsv-mesa-livre-ink)] active:bg-[var(--rsv-welcome-bg)] hover:border-[var(--rsv-gold)]'
      }`}
    >
      <span className="text-sm font-bold leading-none">{mesa.numero}</span>
      <span className="mt-0.5 text-[9px] leading-none opacity-80">{mesa.lugares} lug</span>
    </button>
  );
}

function Legenda({ comContexto }: { comContexto?: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[10px] text-[var(--rsv-muted)]">
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[var(--rsv-mesa-livre)] ring-1 ring-[var(--rsv-mesa-line)]" /> livre</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[var(--rsv-mesa-ocupada)] ring-1 ring-[var(--rsv-mesa-ocupada-line)]" /> ocupada</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[var(--rsv-mesa-off)] ring-1 ring-[var(--rsv-mesa-line)]" /> não cabe</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[var(--rsv-mesa-sel)]" /> escolhida</span>
      {comContexto && (
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded border border-dashed border-[var(--rsv-mesa-line)]" /> outro espaço</span>
      )}
    </div>
  );
}

export function MapaMesasPublico({
  mesas,
  pessoas,
  selecionada,
  onSelecionar,
}: {
  mesas: MesaPublica[];
  pessoas: number;
  selecionada: string;
  onSelecionar: (numero: string) => void;
}) {
  if (mesas.length === 0) return null;

  return (
    <div className="mt-1.5 rounded-xl border border-[var(--rsv-mesa-line)] bg-[var(--rsv-mesa-panel)] p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--rsv-muted)]">
        Escolher mesa <span className="font-normal normal-case">(opcional — se não escolher, a gente escolhe pra você)</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {mesas.map((m) => (
          <MesaBotao key={m.numero} mesa={m} pessoas={pessoas} selecionada={selecionada} onSelecionar={onSelecionar} />
        ))}
      </div>
      <Legenda />
    </div>
  );
}

/**
 * Agrupa mesas em N "raias" indo do rio (frente) pra trás — mesma lógica de
 * `agruparEmRaias` em mapa-mesas.tsx (admin). Duplicado aqui de propósito
 * (arquivos client-side separados, sem util compartilhado ainda) — se mexer
 * numa cópia, mexer na outra.
 */
function agruparEmRaias<T>(itens: T[], largura: number): T[][] {
  const fatias: T[][] = [];
  for (let i = 0; i < itens.length; i += 4) fatias.push(itens.slice(i, i + 4).reverse());
  const raias: T[][] = Array.from({ length: largura }, () => []);
  fatias.forEach((fatia, i) => raias[i % largura]!.push(...fatia));
  return raias;
}

/** Areia = 3 blocos de 20 mesas lado a lado (1-20, 21-40, 41-60), cada um
 *  com 5 raias de 4 de profundidade — mesma lógica de `blocosDeAreia` no
 *  mapa-mesas.tsx (admin). */
function blocosDeAreia<T>(mesas: T[]): T[][][] {
  const blocos: T[][][] = [];
  for (let i = 0; i < mesas.length; i += 20) blocos.push(agruparEmRaias(mesas.slice(i, i + 20), 5));
  return blocos;
}

/**
 * Areia como planta real (mesma lógica do mapa do admin, ver mapa-mesas.tsx
 * `AreiaGrid`) — só as mesas 4, 8, 12, 16, 20 encostam no rio; os próximos 2
 * blocos de 20 (frente 24-40, frente 44-60) ficam do lado, um depois do
 * outro. Só renderiza se vierem exatamente 60 mesas (múltiplo de 20) —
 * senão cai pro grid flat.
 */
export function MapaAreiaPublico({
  mesas,
  pessoas,
  selecionada,
  onSelecionar,
}: {
  mesas: MesaPublica[];
  pessoas: number;
  selecionada: string;
  onSelecionar: (numero: string) => void;
}) {
  if (mesas.length === 0) return null;
  const blocos = blocosDeAreia(mesas);

  return (
    <div className="mt-1.5 rounded-xl border border-[var(--rsv-mesa-line)] bg-[var(--rsv-mesa-panel)] p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--rsv-muted)]">
        Escolher mesa <span className="font-normal normal-case">(opcional — se não escolher, a gente escolhe pra você)</span>
      </p>
      <p className="mt-0.5 text-[10px] text-[var(--rsv-mesa-off-ink)]">mesas 4, 8, 12, 16, 20 encostam no rio — os próximos 3 blocos de 20 ficam do lado, um depois do outro</p>
      <div className="mt-2 rounded-lg bg-gradient-to-b from-[var(--rsv-agua)] to-transparent p-2">
        <div className="mb-1.5 text-center text-[10px] font-medium text-[var(--rsv-agua-ink)]">🌊 rio (frente)</div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {blocos.map((raias, bi) => (
            <div key={bi} className={`flex gap-1.5 ${bi > 0 ? 'border-l border-[var(--rsv-agua-line)] pl-3' : ''}`}>
              {raias.map((raia, ri) => (
                <div key={ri} className="flex flex-col gap-1.5">
                  {raia.map((m) => (
                    <MesaBotao key={m.numero} mesa={m} pessoas={pessoas} selecionada={selecionada} onSelecionar={onSelecionar} />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <Legenda />
    </div>
  );
}

/**
 * Deck Superior + Lounges como planta real (mesma lógica do mapa do admin,
 * ver mapa-mesas.tsx `DeckELounges`) — linha da frente 101 | 128 | 129 | 130
 * virada pro rio; atrás de 101 vêm 102+103, atrás dessas 104+105, e atrás
 * dessas 106+107; atrás de 128+metade de 129 vêm 108+109; atrás do outro
 * lado (130) vêm 110+111.
 * `areaAtual` decide qual lado é clicável — o outro é só contexto visual
 * (mesa de outro espaço, taxa diferente, cliente troca o "Espaço" pra
 * reservar lá).
 */
export function MapaDeckLoungesPublico({
  areaAtual,
  deck,
  lounges,
  pessoas,
  selecionada,
  onSelecionar,
}: {
  areaAtual: 'Deck Superior' | 'Lounges';
  deck: MesaPublica[];
  lounges: MesaPublica[];
  pessoas: number;
  selecionada: string;
  onSelecionar: (numero: string) => void;
}) {
  const todas = [...deck, ...lounges];
  if (todas.length === 0) return null;
  const m = (numero: string) => todas.find((x) => x.numero === numero);
  const botao = (numero: string, larguraPx?: number) => {
    const mesa = m(numero);
    if (!mesa) return null;
    const doLadoDeck = deck.some((x) => x.numero === numero);
    const contexto = (doLadoDeck && areaAtual !== 'Deck Superior') || (!doLadoDeck && areaAtual !== 'Lounges');
    return <MesaBotao key={numero} mesa={mesa} pessoas={pessoas} selecionada={selecionada} onSelecionar={onSelecionar} contexto={contexto} larguraPx={larguraPx} />;
  };

  return (
    <div className="mt-1.5 rounded-xl border border-[var(--rsv-mesa-line)] bg-[var(--rsv-mesa-panel)] p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--rsv-muted)]">
        Escolher mesa <span className="font-normal normal-case">(opcional — se não escolher, a gente escolhe pra você)</span>
      </p>
      <p className="mt-0.5 text-[10px] text-[var(--rsv-mesa-off-ink)]">atrás das mesas da Areia · virado pro rio na linha da frente</p>
      <div className="mt-2 rounded-lg bg-gradient-to-b from-[var(--rsv-agua)] to-transparent p-2">
        <div className="mb-1.5 text-center text-[10px] font-medium text-[var(--rsv-agua-ink)]">🌊 Areia / rio (frente)</div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          <div className="flex flex-col items-start gap-1.5">
            <div className="flex gap-1.5">{botao('101', 118)}</div>
            <div className="flex gap-1.5">{botao('102')}{botao('103')}</div>
            <div className="flex gap-1.5">{botao('104')}{botao('105')}</div>
            <div className="flex gap-1.5">{botao('106')}{botao('107')}</div>
          </div>
          <div className="flex flex-col items-start gap-1.5 border-l border-[var(--rsv-agua-line)] pl-3">
            <div className="flex gap-1.5">{botao('128', 77)}{botao('129', 77)}{botao('130', 77)}</div>
            <div className="flex gap-1.5">
              <div className="flex gap-1.5">{botao('108')}{botao('109')}</div>
              <div className="ml-1.5 flex gap-1.5">{botao('110')}{botao('111')}</div>
            </div>
          </div>
        </div>
      </div>
      <Legenda comContexto />
    </div>
  );
}

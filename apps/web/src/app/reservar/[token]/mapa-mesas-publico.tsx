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
          ? 'border-[#b3411c] bg-[#b3411c] text-white shadow-md'
          : contexto
            ? 'cursor-not-allowed border-dashed border-[#e7dcc9] bg-transparent text-[#c2b8a3] opacity-50'
            : !mesa.livre
              ? 'cursor-not-allowed border-[#e8d5d0] bg-[#f7ecea] text-[#c79a94] opacity-60'
              : !cabe
                ? 'cursor-not-allowed border-[#e7dcc9] bg-[#f2ede2] text-[#b3a686] opacity-50'
                : 'border-[#e7dcc9] bg-white text-[#5a4a38] active:bg-[#fff4e6] hover:border-[#f4b454]'
      }`}
    >
      <span className="text-sm font-bold leading-none">{mesa.numero}</span>
      <span className="mt-0.5 text-[9px] leading-none opacity-80">{mesa.lugares} lug</span>
    </button>
  );
}

function Legenda({ comContexto }: { comContexto?: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[10px] text-[#8a7a64]">
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-white ring-1 ring-[#e7dcc9]" /> livre</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[#f7ecea] ring-1 ring-[#e8d5d0]" /> ocupada</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[#f2ede2] ring-1 ring-[#e7dcc9]" /> não cabe</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[#b3411c]" /> escolhida</span>
      {comContexto && (
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded border border-dashed border-[#e7dcc9]" /> outro espaço</span>
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
    <div className="mt-1.5 rounded-xl border border-[#e7dcc9] bg-[#fdfaf4] p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[#8a7a64]">
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
    <div className="mt-1.5 rounded-xl border border-[#e7dcc9] bg-[#fdfaf4] p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[#8a7a64]">
        Escolher mesa <span className="font-normal normal-case">(opcional — se não escolher, a gente escolhe pra você)</span>
      </p>
      <p className="mt-0.5 text-[10px] text-[#b3a686]">atrás das mesas da Areia · virado pro rio na linha da frente</p>
      <div className="mt-2 rounded-lg bg-gradient-to-b from-[#eef6fb] to-transparent p-2">
        <div className="mb-1.5 text-center text-[10px] font-medium text-[#7fb0cf]">🌊 Areia / rio (frente)</div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          <div className="flex flex-col items-start gap-1.5">
            <div className="flex gap-1.5">{botao('101', 118)}</div>
            <div className="flex gap-1.5">{botao('102')}{botao('103')}</div>
            <div className="flex gap-1.5">{botao('104')}{botao('105')}</div>
            <div className="flex gap-1.5">{botao('106')}{botao('107')}</div>
          </div>
          <div className="flex flex-col items-start gap-1.5 border-l border-[#dde9f0] pl-3">
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

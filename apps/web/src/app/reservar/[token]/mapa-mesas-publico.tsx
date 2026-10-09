'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PLANTA_MAR, PLANTA_MAR_DESENHO, PLANTA_MAR_MESAS, PLANTA_MAR_REDONDAS } from '@/lib/planta-mar';

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
  redonda,
}: {
  mesa: MesaPublica;
  pessoas: number;
  selecionada: string;
  onSelecionar: (numero: string) => void;
  /** Mesa de outro espaço, só pra mostrar a planta — não clicável aqui
   *  (o cliente precisa trocar o "Espaço" pra reservar ela, taxa diferente). */
  contexto?: boolean;
  larguraPx?: number;
  /** Mesa redonda na planta (ex: as duas grandes do salão da Tabuará). */
  redonda?: boolean;
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
      className={`flex ${redonda ? 'h-[4.5rem] w-[4.5rem] rounded-full' : `h-14 ${larguraPx ? '' : 'w-14'} rounded-lg`} flex-col items-center justify-center border text-center transition ${
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

/**
 * Planta da Tabuará (do desenho da casa). Duas áreas encostadas, separadas
 * por uma linha: em cima o Salão, embaixo a Varanda.
 *
 *   SALÃO      ( 13 )   9  5  1
 *              ( 14 )  10  6  2
 *                      11  7  3
 *                      12  8  4
 *   ─────────────────────────────
 *   VARANDA    29  27  25  23  21
 *              30  28  26  24  22
 *
 * 13 e 14 são as redondas. A área que o cliente escolheu no seletor é a
 * clicável; a outra aparece apagada, só pra ele se situar na planta.
 * Mesa que não estiver nesta planta ainda assim aparece (linha "outras"),
 * pra cadastro novo não sumir da tela.
 */
const TAB_SALAO_REDONDAS = ['13', '14'];
const TAB_SALAO_COLUNAS = [
  ['9', '10', '11', '12'],
  ['5', '6', '7', '8'],
  ['1', '2', '3', '4'],
];
const TAB_VARANDA_LINHAS = [
  ['29', '27', '25', '23', '21'],
  ['30', '28', '26', '24', '22'],
];

export function MapaTabuaraPublico({
  areaAtual,
  salao,
  varanda,
  pessoas,
  selecionada,
  onSelecionar,
}: {
  areaAtual: string;
  salao: MesaPublica[];
  varanda: MesaPublica[];
  pessoas: number;
  selecionada: string;
  onSelecionar: (numero: string) => void;
}) {
  const todas = [...salao, ...varanda];
  if (todas.length === 0) return null;

  const naPlanta = new Set([
    ...TAB_SALAO_REDONDAS,
    ...TAB_SALAO_COLUNAS.flat(),
    ...TAB_VARANDA_LINHAS.flat(),
  ]);
  const foraDaPlanta = todas.filter((m) => !naPlanta.has(m.numero));

  const botao = (numero: string, redonda?: boolean) => {
    const mesa = todas.find((x) => x.numero === numero);
    if (!mesa) return null;
    const doSalao = salao.some((x) => x.numero === numero);
    const contexto = doSalao ? areaAtual !== 'Salão' : areaAtual !== 'Varanda';
    return (
      <MesaBotao
        key={numero}
        mesa={mesa}
        pessoas={pessoas}
        selecionada={selecionada}
        onSelecionar={onSelecionar}
        contexto={contexto}
        redonda={redonda}
      />
    );
  };

  return (
    <div className="mt-1.5 rounded-xl border border-[var(--rsv-mesa-line)] bg-[var(--rsv-mesa-panel)] p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--rsv-muted)]">
        Escolher mesa <span className="font-normal normal-case">(opcional — se não escolher, a gente escolhe pra você)</span>
      </p>
      <p className="mt-0.5 text-[10px] text-[var(--rsv-mesa-off-ink)]">
        salão em cima, varanda embaixo · 13 e 14 são as mesas redondas
      </p>

      <div className="mt-2 overflow-x-auto pb-1">
        {/* SALÃO */}
        <div className="flex gap-4">
          <div className="flex flex-col justify-center gap-2">
            {TAB_SALAO_REDONDAS.map((n) => botao(n, true))}
          </div>
          <div className="flex gap-1.5">
            {TAB_SALAO_COLUNAS.map((coluna, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                {coluna.map((n) => botao(n))}
              </div>
            ))}
          </div>
        </div>

        {/* VARANDA */}
        <div className="mt-3 border-t border-[var(--rsv-mesa-line)] pt-3">
          <div className="flex flex-col gap-1.5">
            {TAB_VARANDA_LINHAS.map((linha, i) => (
              <div key={i} className="flex gap-1.5">
                {linha.map((n) => botao(n))}
              </div>
            ))}
          </div>
        </div>

        {foraDaPlanta.length > 0 && (
          <div className="mt-3 border-t border-dashed border-[var(--rsv-mesa-line)] pt-3">
            <p className="mb-1.5 text-[10px] text-[var(--rsv-mesa-off-ink)]">outras mesas</p>
            <div className="flex flex-wrap gap-1.5">{foraDaPlanta.map((m) => botao(m.numero))}</div>
          </div>
        )}
      </div>
      <Legenda comContexto />
    </div>
  );
}

/**
 * Prainha Mar (Shopping Praia Sul) como planta real — numeração do dono em
 * 04/10/2026 (mapa 0410), olhando da entrada:
 *
 *   ENTRADA / SALÃO          MEIO (em frente ao bar)     CORREDOR (banco)
 *      10  11  12  13          (19)  (20)  21            22 23 24 25 26 27
 *   (6)  7   8   9             14  15  16  17  18
 *    1   2   3   4   5         └ banco da janela
 *    └ banco do fundo
 *
 *   VARANDA (depois do corredor, ao lado do Espaço Kids)
 *      58  59  60  61
 *      55  56  57  (54)
 *      50  51  52  53       ← mureta da calçada (a antiga 50 saiu: 51 virou 50)
 *
 * Redondas: 6 e 20 (8 lugares), 19 e 54 (12 lugares). A área escolhida no
 * seletor é a clicável; a outra aparece apagada, só pra situar. Mesa fora
 * desta planta (cadastro antigo/novo) aparece em "outras mesas".
 */
const MAR_REDONDAS = new Set(['6', '19', '20', '54']);
const MAR_ENTRADA = [
  ['10', '11', '12', '13'],
  ['6', '7', '8', '9'],
  ['1', '2', '3', '4', '5'],
];
const MAR_MEIO = [
  ['19', '20', '21'],
  ['14', '15', '16', '17', '18'],
];
const MAR_CORREDOR = ['22', '23', '24', '25', '26', '27'];
const MAR_VARANDA = [
  ['58', '59', '60', '61'],
  ['55', '56', '57', '54'],
  ['50', '51', '52', '53'],
];

type ZonaMarId = 'entrada' | 'bar' | 'corredor' | 'varanda';
/**
 * Partes da casa que a planta amplia, da entrada pro fundo. `quadro` =
 * [x, y, lado] em px da planta (2400×1256): um quadrado que pega as mesas da
 * parte inteiras e não corta a mesa vizinha pela metade.
 */
const MAR_ZONAS: {
  id: ZonaMarId;
  nome: string;
  espaco: 'Salão' | 'Varanda';
  mesas: string[];
  quadro: [number, number, number];
}[] = [
  { id: 'entrada', nome: 'Entrada', espaco: 'Salão', mesas: MAR_ENTRADA.flat(), quadro: [226, 742, 522] },
  { id: 'bar', nome: 'Bar', espaco: 'Salão', mesas: MAR_MEIO.flat(), quadro: [740, 645, 530] },
  { id: 'corredor', nome: 'Corredor', espaco: 'Salão', mesas: MAR_CORREDOR, quadro: [1408, 367, 470] },
  { id: 'varanda', nome: 'Varanda', espaco: 'Varanda', mesas: MAR_VARANDA.flat(), quadro: [1883, -16, 470] },
];
/** Inclinação do corredor e da varanda na planta — os nomes acompanham a parede. */
const MAR_GIRO = -32.25;

type EstadoMesaMar = 'sel' | 'contexto' | 'ocupada' | 'naoCabe' | 'livre';

/**
 * A casa desenhada (piso, paredes, bancos, bar, cozinha, Espaço Kids) em
 * coordenadas da planta. `detalhe` = vista ampliada (traço e letra menores,
 * porque a ampliação já aumenta tudo).
 */
function DesenhoMar({ detalhe = false }: { detalhe?: boolean }) {
  const d = PLANTA_MAR_DESENHO;
  const nome = (t: string, x: number, y: number, giro = 0, ancora: 'middle' | 'start' = 'middle') => (
    <text
      key={t}
      x={x}
      y={y}
      textAnchor={ancora}
      transform={giro ? `rotate(${giro} ${x} ${y})` : undefined}
      fontSize={detalhe ? 19 : 70}
      fontWeight={600}
      letterSpacing={detalhe ? 1.5 : 4}
      fill="var(--rsv-muted)"
    >
      {t}
    </text>
  );
  return (
    <>
      <polygon points={d.piso} fill="var(--rsv-mesa-panel)" />
      {[d.fechado, d.bar, d.servico, d.kids, d.escada].map((p) => (
        <polygon key={p} points={p} fill="var(--rsv-mesa-line)" opacity={0.6} />
      ))}
      {[d.bancoFundo, d.bancoJanela, d.bancoCorredor].map((p) => (
        <polygon key={p} points={p} fill="var(--rsv-mesa-line)" />
      ))}
      <path d={d.vidro} fill="none" stroke="var(--rsv-text)" strokeWidth={detalhe ? 3 : 5} opacity={0.4} />
      <path
        d={d.mureta}
        fill="none"
        stroke="var(--rsv-text)"
        strokeWidth={detalhe ? 4 : 7}
        strokeDasharray={detalhe ? '16 12' : '26 20'}
        opacity={0.5}
      />
      <path
        d={d.paredes}
        fill="none"
        stroke="var(--rsv-text)"
        strokeWidth={detalhe ? 7 : 11}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* porta: seta entrando pela parede da esquerda */}
      <path
        d={detalhe ? 'M236 1100h46m-16 -13l17 13l-17 13' : 'M64 1022h124m-44 -36l46 36l-46 36'}
        fill="none"
        stroke="var(--rsv-gold)"
        strokeWidth={detalhe ? 5 : 15}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {detalhe
        ? [
            nome('ENTRADA', 236, 1082, 0, 'start'),
            nome('BAR', 900, 723),
            nome('COZINHA', 1195, 716, MAR_GIRO),
            nome('BANHEIROS', 1474, 508, MAR_GIRO),
            nome('ESPAÇO KIDS', 1716, 430, MAR_GIRO),
            nome('CALÇADA', 2290, 345, -33.2),
          ]
        : [
            nome('BAR', 900, 740),
            nome('COZINHA', 1291, 641, MAR_GIRO),
            nome('WC', 1541, 481, MAR_GIRO),
            nome('KIDS', 1752, 348, MAR_GIRO),
          ]}
    </>
  );
}

/**
 * Planta da Prainha Mar na reserva pública. Em cima, a casa inteira (pra se
 * situar: onde é a entrada, o bar, o Kids); embaixo, a parte escolhida
 * ampliada, com as mesas no tamanho do dedo. Troca de parte tocando na casa,
 * no nome ou deslizando a ampliação pro lado.
 */
function PlantaMarPublica({
  areaAtual,
  salao,
  varanda,
  pessoas,
  selecionada,
  onSelecionar,
  onTrocarEspaco,
}: {
  areaAtual: string;
  salao: MesaPublica[];
  varanda: MesaPublica[];
  pessoas: number;
  selecionada: string;
  onSelecionar: (numero: string) => void;
  onTrocarEspaco?: () => void;
}) {
  // Parte que o cliente abriu na mão — vale enquanto o Espaço for o mesmo.
  const [escolha, setEscolha] = useState<{ area: string; id: ZonaMarId } | null>(null);
  const janela = useRef<HTMLDivElement>(null);
  const [larg, setLarg] = useState(0);
  const [animar, setAnimar] = useState(false);
  const toque = useRef<{ x: number; y: number } | null>(null);

  const mesaDe = new Map<string, { mesa: MesaPublica; doSalao: boolean }>();
  for (const m of varanda) if (PLANTA_MAR_MESAS[m.numero]) mesaDe.set(m.numero, { mesa: m, doSalao: false });
  for (const m of salao) if (PLANTA_MAR_MESAS[m.numero]) mesaDe.set(m.numero, { mesa: m, doSalao: true });

  const estadoDe = ({ mesa, doSalao }: { mesa: MesaPublica; doSalao: boolean }): EstadoMesaMar => {
    const contexto = doSalao ? areaAtual !== 'Salão' : areaAtual !== 'Varanda';
    if (contexto) return 'contexto';
    if (selecionada === mesa.numero) return 'sel';
    if (!mesa.livre) return 'ocupada';
    if (mesa.lugares < pessoas) return 'naoCabe';
    return 'livre';
  };

  const zonas = MAR_ZONAS.filter((z) => z.mesas.some((n) => mesaDe.has(n)));
  const temZonas = zonas.length > 0;
  const temLivre = (z: (typeof MAR_ZONAS)[number]) =>
    z.mesas.some((n) => {
      const x = mesaDe.get(n);
      if (!x) return false;
      const e = estadoDe(x);
      return e === 'livre' || e === 'sel';
    });

  // Sem escolha na mão, abre onde está a mesa escolhida; senão, na primeira
  // parte do Espaço que ainda tem mesa livre pro grupo.
  const doEspaco = zonas.filter((z) => z.espaco === areaAtual);
  const zonaAuto =
    (selecionada ? zonas.find((z) => z.mesas.includes(selecionada)) : undefined) ??
    doEspaco.find(temLivre) ??
    doEspaco[0] ??
    zonas[0];
  const zona = (escolha && escolha.area === areaAtual && zonas.find((z) => z.id === escolha.id)) || zonaAuto;

  // A ampliação é a planta inteira (2400×1256) com escala: mede a janela pra
  // saber quanto ampliar. Só anima depois da primeira medida.
  useLayoutEffect(() => {
    const el = janela.current;
    if (!el) return;
    setLarg(el.clientWidth);
    const ro = new ResizeObserver(() => setLarg(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [temZonas]);
  useEffect(() => {
    if (larg > 0) setAnimar(true);
  }, [larg]);

  if (!zona) return null;

  const abrir = (id: ZonaMarId) => setEscolha({ area: areaAtual, id });
  const vizinha = (passo: number) => {
    const i = zonas.findIndex((z) => z.id === zona.id) + passo;
    if (i >= 0 && i < zonas.length) abrir(zonas[i].id);
  };

  const [fx, fy, lado] = zona.quadro;
  const escala = larg > 0 ? larg / lado : 0;
  const noQuadro = (numero: string) => {
    const pos = PLANTA_MAR_MESAS[numero];
    const x = (pos[0] / 100) * PLANTA_MAR.largura;
    const y = (pos[1] / 100) * PLANTA_MAR.altura;
    return x >= fx && x <= fx + lado && y >= fy && y <= fy + lado;
  };

  const pino = ({ mesa, doSalao }: { mesa: MesaPublica; doSalao: boolean }) => {
    const pos = PLANTA_MAR_MESAS[mesa.numero];
    const estado = estadoDe({ mesa, doSalao });
    const contexto = estado === 'contexto';
    const redonda = PLANTA_MAR_REDONDAS.has(mesa.numero);
    const ladoMesa = (PLANTA_MAR.largura * (redonda ? PLANTA_MAR.ladoRedondaPct : PLANTA_MAR.ladoPct)) / 100;
    const cabe = mesa.lugares >= pessoas;
    const clicavel = !contexto && mesa.livre && cabe;
    const sel = estado === 'sel';
    return (
      <button
        key={mesa.numero}
        type="button"
        disabled={!clicavel}
        tabIndex={noQuadro(mesa.numero) ? 0 : -1}
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
        style={{
          left: (pos[0] / 100) * PLANTA_MAR.largura,
          top: (pos[1] / 100) * PLANTA_MAR.altura,
          width: ladoMesa,
          height: ladoMesa,
          borderWidth: 3,
          borderRadius: redonda ? '50%' : 14,
        }}
        className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center text-center transition-colors ${
          sel
            ? 'z-10 border-[var(--rsv-mesa-sel)] bg-[var(--rsv-mesa-sel)] text-[var(--rsv-mesa-sel-ink)] shadow-md'
            : contexto
              ? 'cursor-not-allowed border-dashed border-[var(--rsv-mesa-line)] bg-[var(--rsv-mesa-panel)] text-[var(--rsv-mesa-dim-ink)]'
              : !mesa.livre
                ? 'cursor-not-allowed border-[var(--rsv-mesa-ocupada-line)] bg-[var(--rsv-mesa-ocupada)] text-[var(--rsv-mesa-ocupada-ink)]'
                : !cabe
                  ? 'cursor-not-allowed border-[var(--rsv-mesa-line)] bg-[var(--rsv-mesa-off)] text-[var(--rsv-mesa-off-ink)]'
                  : 'border-[var(--rsv-gold)] bg-[var(--rsv-mesa-livre)] text-[var(--rsv-mesa-livre-ink)] shadow-sm active:bg-[var(--rsv-welcome-bg)]'
        }`}
      >
        <span className="font-bold leading-none" style={{ fontSize: redonda ? 30 : 27 }}>
          {mesa.numero}
        </span>
        {redonda && (
          <span className="leading-none opacity-80" style={{ fontSize: 15, marginTop: 4 }}>
            {mesa.lugares} lug
          </span>
        )}
      </button>
    );
  };

  // Mesa na vista da casa inteira: só a marca, na cor do estado.
  const marca = ({ mesa, doSalao }: { mesa: MesaPublica; doSalao: boolean }) => {
    const pos = PLANTA_MAR_MESAS[mesa.numero];
    const x = (pos[0] / 100) * PLANTA_MAR.largura;
    const y = (pos[1] / 100) * PLANTA_MAR.altura;
    const estado = estadoDe({ mesa, doSalao });
    const redonda = PLANTA_MAR_REDONDAS.has(mesa.numero);
    const l = (PLANTA_MAR.largura * (redonda ? PLANTA_MAR.ladoRedondaPct : PLANTA_MAR.ladoPct)) / 100;
    const cor = {
      sel: ['var(--rsv-mesa-sel)', 'var(--rsv-mesa-sel)'],
      contexto: ['var(--rsv-mesa-panel)', 'var(--rsv-mesa-line)'],
      ocupada: ['var(--rsv-mesa-ocupada)', 'var(--rsv-mesa-ocupada-line)'],
      naoCabe: ['var(--rsv-mesa-off)', 'var(--rsv-mesa-line)'],
      livre: ['var(--rsv-mesa-livre)', 'var(--rsv-gold)'],
    }[estado];
    return (
      <rect
        key={mesa.numero}
        x={x - l / 2}
        y={y - l / 2}
        width={l}
        height={l}
        rx={redonda ? l / 2 : 12}
        fill={cor[0]}
        stroke={cor[1]}
        strokeWidth={9}
        strokeDasharray={estado === 'contexto' ? '14 10' : undefined}
      />
    );
  };

  const mesas = [...mesaDe.values()];
  const escolhida = [...salao, ...varanda].find((m) => m.numero === selecionada);
  const outroEspaco = zona.espaco !== areaAtual;

  return (
    <>
      {/* a casa inteira */}
      <div className="relative mt-2 overflow-hidden rounded-lg border border-[var(--rsv-mesa-line)] bg-[var(--rsv-surface)]">
        <svg
          viewBox={`0 0 ${PLANTA_MAR.largura} ${PLANTA_MAR.altura}`}
          className="block h-auto w-full"
          role="img"
          aria-label="Planta da Prainha Mar com as mesas"
        >
          <DesenhoMar />
          {mesas.map(marca)}
          {zonas.map((z) => {
            const ativa = z.id === zona.id;
            // o quadro pode passar um pouco da borda da planta: apara
            const y = Math.max(z.quadro[1], 6);
            const yFim = Math.min(z.quadro[1] + z.quadro[2], PLANTA_MAR.altura - 6);
            return (
              <rect
                key={z.id}
                x={z.quadro[0]}
                y={y}
                width={z.quadro[2]}
                height={yFim - y}
                rx={34}
                fill={ativa ? 'var(--rsv-gold)' : 'transparent'}
                fillOpacity={ativa ? 0.1 : 1}
                stroke={ativa ? 'var(--rsv-gold)' : 'none'}
                strokeWidth={12}
                className={ativa ? undefined : 'cursor-pointer'}
                onClick={() => abrir(z.id)}
              />
            );
          })}
        </svg>
        <p className="pointer-events-none absolute left-2 top-1.5 text-[10px] leading-tight text-[var(--rsv-muted)]">
          a casa inteira
          <br />
          toque numa parte pra ampliar
        </p>
      </div>

      {/* partes da casa, da entrada pro fundo */}
      <div className="mt-1.5 flex gap-1">
        {zonas.map((z) => {
          const ativa = z.id === zona.id;
          return (
            <button
              key={z.id}
              type="button"
              aria-pressed={ativa}
              onClick={() => abrir(z.id)}
              className={`min-w-0 flex-1 truncate rounded-full border px-1.5 py-1.5 text-[11px] font-medium leading-none transition-colors ${
                ativa
                  ? 'border-[var(--rsv-mesa-sel)] bg-[var(--rsv-mesa-sel)] text-[var(--rsv-mesa-sel-ink)]'
                  : z.espaco !== areaAtual
                    ? 'border-dashed border-[var(--rsv-mesa-line)] text-[var(--rsv-mesa-dim-ink)]'
                    : temLivre(z)
                      ? 'border-[var(--rsv-gold)] bg-[var(--rsv-mesa-livre)] text-[var(--rsv-mesa-livre-ink)]'
                      : 'border-[var(--rsv-mesa-line)] bg-[var(--rsv-mesa-off)] text-[var(--rsv-mesa-off-ink)]'
              }`}
            >
              {z.nome}
            </button>
          );
        })}
      </div>

      {/* a parte escolhida, ampliada */}
      <div
        ref={janela}
        className="relative mt-1.5 aspect-square w-full touch-pan-y overflow-hidden rounded-lg border border-[var(--rsv-mesa-line)] bg-[var(--rsv-surface)]"
        // Quem enquadra é o transform, nunca a rolagem: sem isto, o foco numa
        // mesa da beirada faz o navegador rolar a janela por dentro (mesmo com
        // overflow-hidden) e as mesas saem do lugar. `clip` proíbe a rolagem;
        // onde ele não existe (Safari antigo) fica o hidden da classe + o onScroll.
        style={{ overflow: 'clip' }}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollLeft !== 0 || el.scrollTop !== 0) el.scrollTo(0, 0);
        }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          toque.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const de = toque.current;
          const t = e.changedTouches[0];
          toque.current = null;
          if (!de || !t) return;
          const dx = t.clientX - de.x;
          const dy = t.clientY - de.y;
          if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          vizinha(dx < 0 ? 1 : -1);
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: PLANTA_MAR.largura,
            height: PLANTA_MAR.altura,
            transform: `translate(${-fx * escala}px, ${-fy * escala}px) scale(${escala})`,
            transition: animar ? 'transform 380ms cubic-bezier(0.4, 0, 0.2, 1)' : undefined,
            visibility: escala > 0 ? 'visible' : 'hidden',
          }}
        >
          <svg
            width={PLANTA_MAR.largura}
            height={PLANTA_MAR.altura}
            viewBox={`0 0 ${PLANTA_MAR.largura} ${PLANTA_MAR.altura}`}
            className="absolute left-0 top-0"
            aria-hidden="true"
          >
            <DesenhoMar detalhe />
          </svg>
          {mesas.map(pino)}
        </div>
      </div>

      {outroEspaco && (
        <p className="mt-1.5 text-[11px] text-[var(--rsv-muted)]">
          Estas mesas são {zona.espaco === 'Varanda' ? 'da Varanda' : 'do Salão'}.
          {onTrocarEspaco && (
            <>
              {' '}
              <button type="button" onClick={onTrocarEspaco} className="font-semibold text-[var(--rsv-gold)] underline">
                Trocar o espaço pra {zona.espaco}
              </button>
            </>
          )}
        </p>
      )}
      {escolhida && (
        <p className="mt-1 text-[10px] text-[var(--rsv-mesa-off-ink)]">
          escolhida: mesa {escolhida.numero} ({escolhida.lugares} lugares)
        </p>
      )}
    </>
  );
}

export function MapaMarPublico({
  areaAtual,
  salao,
  varanda,
  pessoas,
  selecionada,
  onSelecionar,
  onTrocarEspaco,
}: {
  areaAtual: string;
  salao: MesaPublica[];
  varanda: MesaPublica[];
  pessoas: number;
  selecionada: string;
  onSelecionar: (numero: string) => void;
  /** Troca o "Espaço" do formulário pro outro (Salão ↔ Varanda) — vira o
   *  atalho que aparece quando o cliente amplia uma parte do outro espaço. */
  onTrocarEspaco?: () => void;
}) {
  // 'planta' = a planta física (a casa desenhada, do mapa do dono); 'lista' =
  // os blocos de antes.
  const [modo, setModo] = useState<'planta' | 'lista'>('planta');
  const todas = [...salao, ...varanda];
  if (todas.length === 0) return null;

  const naPlanta = new Set([...MAR_ENTRADA.flat(), ...MAR_MEIO.flat(), ...MAR_CORREDOR, ...MAR_VARANDA.flat()]);
  const foraDaPlanta = todas.filter((m) => !naPlanta.has(m.numero));

  const botao = (numero: string) => {
    const mesa = todas.find((x) => x.numero === numero);
    if (!mesa) return null;
    const doSalao = salao.some((x) => x.numero === numero);
    const contexto = doSalao ? areaAtual !== 'Salão' : areaAtual !== 'Varanda';
    return (
      <MesaBotao
        key={numero}
        mesa={mesa}
        pessoas={pessoas}
        selecionada={selecionada}
        onSelecionar={onSelecionar}
        contexto={contexto}
        redonda={MAR_REDONDAS.has(numero)}
      />
    );
  };
  const linhas = (ls: string[][]) => (
    <div className="flex flex-col gap-1.5">
      {ls.map((linha, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {linha.map((n) => botao(n))}
        </div>
      ))}
    </div>
  );
  const titulo = (t: string) => <p className="mb-1.5 text-[10px] text-[var(--rsv-mesa-off-ink)]">{t}</p>;
  const bloco = 'mt-3 border-t border-[var(--rsv-mesa-line)] pt-3';

  return (
    <div className="mt-1.5 rounded-xl border border-[var(--rsv-mesa-line)] bg-[var(--rsv-mesa-panel)] p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--rsv-muted)]">
        Escolher mesa <span className="font-normal normal-case">(opcional — se não escolher, a gente escolhe pra você)</span>
      </p>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <p className="text-[10px] text-[var(--rsv-mesa-off-ink)]">
          da entrada pro fundo: salão, corredor e varanda · as redondas são as mesas grandes
        </p>
        <button
          type="button"
          onClick={() => setModo(modo === 'planta' ? 'lista' : 'planta')}
          className="shrink-0 rounded-full border border-[var(--rsv-mesa-line)] px-2 py-0.5 text-[10px] text-[var(--rsv-muted)]"
        >
          {modo === 'planta' ? 'ver em lista' : 'ver na planta'}
        </button>
      </div>

      {modo === 'planta' && (
        <>
          <PlantaMarPublica
            areaAtual={areaAtual}
            salao={salao}
            varanda={varanda}
            pessoas={pessoas}
            selecionada={selecionada}
            onSelecionar={onSelecionar}
            onTrocarEspaco={onTrocarEspaco}
          />
          {foraDaPlanta.length > 0 && (
            <div className="mt-2 border-t border-dashed border-[var(--rsv-mesa-line)] pt-2">
              <p className="mb-1.5 text-[10px] text-[var(--rsv-mesa-off-ink)]">outras mesas</p>
              <div className="flex flex-wrap gap-1.5">{foraDaPlanta.map((m) => botao(m.numero))}</div>
            </div>
          )}
        </>
      )}

      <div className={`mt-2 overflow-x-auto pb-1 ${modo === 'planta' ? 'hidden' : ''}`}>
        <div>
          {titulo('salão · entrada (1 a 5 no banco)')}
          {linhas(MAR_ENTRADA)}
        </div>
        <div className={bloco}>
          {titulo('salão · em frente ao bar (14 a 18 no banco da janela)')}
          {linhas(MAR_MEIO)}
        </div>
        <div className={bloco}>
          {titulo('salão · corredor (banco)')}
          {linhas([MAR_CORREDOR])}
        </div>
        <div className={bloco}>
          {titulo('varanda (50 a 54 na mureta da calçada)')}
          {linhas(MAR_VARANDA)}
        </div>

        {foraDaPlanta.length > 0 && (
          <div className="mt-3 border-t border-dashed border-[var(--rsv-mesa-line)] pt-3">
            <p className="mb-1.5 text-[10px] text-[var(--rsv-mesa-off-ink)]">outras mesas</p>
            <div className="flex flex-wrap gap-1.5">{foraDaPlanta.map((m) => botao(m.numero))}</div>
          </div>
        )}
      </div>
      <Legenda comContexto />
    </div>
  );
}

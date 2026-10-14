// Planta "de juntar mesa": onde cada mesa fica no espaço e quem é vizinha de
// quem (do lado, na frente, atrás). Regra do dono (14/10/2026): só se junta
// mesa que está encostada — não dá pra juntar a 1 com a 20.
//
// A disposição é a MESMA do mapa de Reservas (/reservas → Mapa):
// - genérico: colunas de 4 mesas seguidas, a de número maior na frente
//   (Areia do Prainha Bar: 4, 8, 12… encostam no rio — dono, set/2026);
// - Deck Superior + Lounges do Prainha Bar: a planta descrita pelo dono;
// - Prainha Mar (Salão e Varanda): a planta do arquiteto (mapa 0410), com as
//   vizinhas tiradas da distância entre as mesas em `lib/planta-mar.ts`.
// Puro (sem banco) — usado na tela e na Nina.

const FILIAL_BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const FILIAL_MAR = 'e899dae2-38bf-4f3f-9149-7effd059fab8';

/** Uma mesa na grade; `span` = quantas casas de largura (a 101 do Deck vale 2). */
export interface CelulaMesa {
  numero: string;
  span?: number;
}

export interface BlocoPlanta {
  titulo?: string;
  /** Linhas de cima pra baixo; null = vão. */
  linhas: (CelulaMesa | null)[][];
}

export interface PlantaEspaco {
  /** O que fica em cima no desenho (ex.: "🌊 rio (frente)"). */
  topo?: string;
  blocos: BlocoPlanta[];
  /** numero → vizinhas. */
  vizinhas: Map<string, Set<string>>;
}

// ── Prainha Mar ────────────────────────────────────────────────────────────
// Linhas = a "grade em blocos" do mapa (mesma de MAR_BLOCOS em mapa-mesas.tsx).
const MAR_SALAO: BlocoPlanta[] = [
  { titulo: 'Entrada', linhas: [['10', '11', '12', '13'], ['6', '7', '8', '9'], ['1', '2', '3', '4', '5']].map(cel) },
  { titulo: 'Em frente ao bar', linhas: [['19', '20', '21'], ['14', '15', '16', '17', '18']].map(cel) },
  { titulo: 'Corredor', linhas: [['22', '23', '24', '25', '26', '27']].map(cel) },
];
const MAR_VARANDA: BlocoPlanta[] = [
  { titulo: 'Varanda (50 a 53 na mureta)', linhas: [['58', '59', '60', '61'], ['55', '56', '57', '54'], ['50', '51', '52', '53']].map(cel) },
];
// Encostadas na planta (centro a centro até ~1,5 mesa, ou a redonda grande
// logo em frente). O corredor (22–27) fica longe do bar — não emenda no 18/21.
const MAR_PARES: [string, string][] = [
  // entrada · banco do fundo, fileira 6–9 e fileira 10–13
  ['1', '2'], ['2', '3'], ['3', '4'], ['4', '5'],
  ['6', '7'], ['7', '8'], ['8', '9'],
  ['10', '11'], ['11', '12'], ['12', '13'],
  ['1', '6'], ['2', '6'], ['3', '7'], ['4', '7'], ['4', '8'], ['5', '8'], ['5', '9'],
  ['6', '10'], ['7', '11'], ['8', '11'], ['8', '12'], ['9', '13'],
  // entrada ↔ janela/bar
  ['5', '14'], ['9', '14'], ['13', '19'],
  // banco da janela e em frente ao bar
  ['14', '15'], ['15', '16'], ['16', '17'], ['17', '18'],
  ['19', '20'], ['20', '21'],
  ['15', '19'], ['16', '19'], ['16', '20'], ['17', '20'], ['17', '21'], ['18', '21'],
  // corredor
  ['22', '23'], ['23', '24'], ['24', '25'], ['25', '26'], ['26', '27'],
  // varanda
  ['50', '51'], ['51', '52'], ['52', '53'], ['53', '54'],
  ['55', '56'], ['56', '57'], ['57', '54'],
  ['58', '59'], ['59', '60'], ['60', '61'],
  ['50', '55'], ['51', '55'], ['51', '56'], ['52', '56'], ['52', '57'], ['53', '57'],
  ['55', '58'], ['56', '59'], ['57', '60'], ['57', '61'], ['54', '61'],
];

// ── Prainha Bar · Deck Superior + Lounges ──────────────────────────────────
const BAR_DECK: BlocoPlanta[] = [
  {
    titulo: 'Lado da 101',
    linhas: [[{ numero: '101', span: 2 }], cel(['102', '103']), cel(['104', '105']), cel(['106', '107'])],
  },
  { titulo: 'Atrás dos Lounges', linhas: [cel(['108', '109', '110', '111'])] },
];
const BAR_LOUNGES: BlocoPlanta[] = [{ linhas: [cel(['128', '129', '130'])] }];

function cel(nums: string[]): CelulaMesa[] {
  return nums.map((numero) => ({ numero }));
}

/** Colunas de 4 seguidas, a maior na frente (topo) — igual ao mapa. */
function blocoGenerico(numeros: string[], titulo?: string): BlocoPlanta {
  const colunas: string[][] = [];
  for (let i = 0; i < numeros.length; i += 4) colunas.push(numeros.slice(i, i + 4).reverse());
  const linhas: (CelulaMesa | null)[][] = [];
  for (let r = 0; r < 4; r++) {
    const linha = colunas.map((c) => (c[r] ? { numero: c[r]! } : null));
    if (linha.some(Boolean)) linhas.push(linha);
  }
  return { titulo, linhas };
}

/** Vizinhas pela grade: mesma linha encostada, ou linha de cima/baixo cobrindo a mesma coluna. */
function vizinhasDaGrade(blocos: BlocoPlanta[], viz: Map<string, Set<string>>) {
  for (const b of blocos) {
    const pos: { numero: string; linha: number; ini: number; fim: number }[] = [];
    b.linhas.forEach((linha, li) => {
      let col = 0;
      for (const c of linha) {
        const w = c?.span ?? 1;
        if (c) pos.push({ numero: c.numero, linha: li, ini: col, fim: col + w });
        col += w;
      }
    });
    for (const a of pos) {
      for (const o of pos) {
        if (a === o) continue;
        const lado = a.linha === o.linha && (a.fim === o.ini || o.fim === a.ini);
        const frente = Math.abs(a.linha - o.linha) === 1 && a.ini < o.fim && o.ini < a.fim;
        if (lado || frente) ligar(viz, a.numero, o.numero);
      }
    }
  }
}

function ligar(viz: Map<string, Set<string>>, a: string, b: string) {
  if (!viz.has(a)) viz.set(a, new Set());
  if (!viz.has(b)) viz.set(b, new Set());
  viz.get(a)!.add(b);
  viz.get(b)!.add(a);
}

/** Tira da planta fixa as mesas que não estão no cadastro do espaço. */
function filtrarBlocos(blocos: BlocoPlanta[], existe: Set<string>): BlocoPlanta[] {
  return blocos
    .map((b) => ({ ...b, linhas: b.linhas.map((l) => l.map((c) => (c && existe.has(c.numero) ? c : null))) }))
    .map((b) => ({ ...b, linhas: b.linhas.filter((l) => l.some(Boolean)) }))
    .filter((b) => b.linhas.length > 0);
}

/**
 * Planta do espaço pra juntar mesa. `numeros` = as mesas do cadastro, na
 * ordem gravada. Mesa do cadastro que não está na planta fixa entra num bloco
 * "Outras mesas" com a regra genérica.
 */
export function plantaDoEspaco(filialId: string, area: string, numeros: string[]): PlantaEspaco {
  const existe = new Set(numeros);
  const viz = new Map<string, Set<string>>();
  for (const n of numeros) viz.set(n, new Set());

  let fixos: BlocoPlanta[] = [];
  let pares: [string, string][] | null = null;
  let topo: string | undefined;
  if (filialId === FILIAL_MAR && area === 'Salão') {
    fixos = MAR_SALAO;
    pares = MAR_PARES;
  } else if (filialId === FILIAL_MAR && area === 'Varanda') {
    fixos = MAR_VARANDA;
    pares = MAR_PARES;
  } else if (filialId === FILIAL_BAR && area === 'Deck Superior') {
    fixos = BAR_DECK;
    topo = '🌊 Areia / rio (frente)';
  } else if (filialId === FILIAL_BAR && area === 'Lounges') {
    fixos = BAR_LOUNGES;
    topo = '🌊 Areia / rio (frente)';
  } else if (filialId === FILIAL_BAR) {
    topo = '🌊 rio (frente)';
  }

  const blocos = filtrarBlocos(fixos, existe);
  const naPlanta = new Set(blocos.flatMap((b) => b.linhas.flat().filter((c): c is CelulaMesa => !!c).map((c) => c.numero)));
  if (pares) {
    for (const [a, b] of pares) if (existe.has(a) && existe.has(b)) ligar(viz, a, b);
  } else {
    vizinhasDaGrade(blocos, viz);
  }
  const resto = numeros.filter((n) => !naPlanta.has(n));
  if (resto.length) {
    const g = blocoGenerico(resto, blocos.length ? 'Outras mesas' : undefined);
    vizinhasDaGrade([g], viz);
    blocos.push(g);
  }
  return { topo, blocos, vizinhas: viz };
}

/** Mesas encostadas em qualquer mesa do grupo (fora do próprio grupo). */
export function mesasDoLado(vizinhas: Map<string, Set<string>>, grupo: string[]): Set<string> {
  const g = new Set(grupo);
  const out = new Set<string>();
  for (const m of grupo) for (const v of vizinhas.get(m) ?? []) if (!g.has(v)) out.add(v);
  return out;
}

/** Só as mesas do grupo que continuam ligadas à principal (uma encostada na outra). */
export function ligadasAPrincipal(vizinhas: Map<string, Set<string>>, principal: string, extras: string[]): string[] {
  const resto = new Set(extras);
  const visto = new Set([principal]);
  const fila = [principal];
  while (fila.length) {
    const m = fila.shift()!;
    for (const v of vizinhas.get(m) ?? []) {
      if (resto.has(v) && !visto.has(v)) {
        visto.add(v);
        fila.push(v);
      }
    }
  }
  return extras.filter((n) => visto.has(n));
}

/** As duas mesas estão encostadas? */
export function saoVizinhas(vizinhas: Map<string, Set<string>>, a: string, b: string): boolean {
  return vizinhas.get(a)?.has(b) ?? false;
}

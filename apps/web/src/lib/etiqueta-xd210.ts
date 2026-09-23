// Etiqueta de validade na XD-210 (Bluetooth "PT-260_…"), só no navegador.
// Mesma lógica da tela /etiqueta do KDS (vendas-local/server.mjs, ETIQUETA_HTML):
// desenha num canvas a 8 pontos/mm e manda TSPL (BITMAP modo 0) pelo Web
// Bluetooth. Funciona no Chrome do Android; iPhone não tem Web Bluetooth.
//
// Rolos da casa, [largura na cabeça, comprimento no avanço]: 50×50 e o
// "30×50", que na impressora é 50 de largura × 30 no avanço (paisagem).
// Imprime 2mm a menos que a etiqueta: na borda a XD-210 corta a moldura.

export type EtqConservacao = 'refrigerado' | 'congelado' | 'ambiente';

export interface EtqCfg {
  w: number;
  h: number;
  gap: number;
  dens: number;
  dx: number;
  inv: boolean;
}

export interface EtqDados {
  loja: string;
  nome: string;
  validade: string; // YYYY-MM-DD
  cons: EtqConservacao;
  resp: string;
}

export const ETQ_TAMS: [number, number][] = [
  [50, 50],
  [50, 30],
];

export const ETQ_CONS: [EtqConservacao, string][] = [
  ['refrigerado', '❄ Refrigerado'],
  ['congelado', '🧊 Congelado'],
  ['ambiente', '🌡 Ambiente'],
];

const CFG_KEY = 'etq_cfg_op';

export function etqCfg(): EtqCfg {
  const c: EtqCfg = { w: 50, h: 50, gap: 2, dens: 6, dx: 0, inv: false };
  try {
    const x = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
    if (x) Object.assign(c, x);
  } catch {}
  if (!ETQ_TAMS.some((t) => t[0] === c.w && t[1] === c.h)) {
    c.w = 50;
    c.h = 50;
  }
  c.dx = Math.max(0, Math.min(20, Math.floor(Number(c.dx) || 0)));
  c.inv = Boolean(c.inv);
  return c;
}

export function etqCfgSalva(p: Partial<EtqCfg>): EtqCfg {
  const c = { ...etqCfg(), ...p };
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
  } catch {}
  return c;
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function maisDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function br(v: string): string {
  const p = v.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0].slice(2)}` : v;
}

const CONS_TXT: Record<EtqConservacao, string> = {
  refrigerado: 'REFRIGERADO 0 a 5°C',
  congelado: 'CONGELADO -18°C',
  ambiente: 'TEMP. AMBIENTE',
};

/** desenha a etiqueta: cada linha encolhe até caber na largura */
export function etqDesenha(d: EtqDados, c: EtqCfg = etqCfg()): HTMLCanvasElement {
  const W = Math.min(c.w - 2, 48) * 8;
  const H = (c.h - 2) * 8;
  const m = 8;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#000';
  g.textBaseline = 'top';

  const agora = new Date();
  const hm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  const nome = (d.nome || 'INSUMO').toUpperCase();
  // quebra o nome em até 2 linhas pelo espaço do meio se for longo
  let nl = [nome];
  if (nome.length > 14 && nome.indexOf(' ') > 0) {
    const meio = nome.length / 2;
    let cut = -1;
    for (let i = 0; i < nome.length; i++)
      if (nome[i] === ' ' && (cut < 0 || Math.abs(i - meio) < Math.abs(cut - meio))) cut = i;
    nl = [nome.slice(0, cut), nome.slice(cut + 1)];
  }
  type L = { t: string; p: number; b: boolean; nm?: boolean; box?: boolean; fs?: number };
  const linhas: L[] = [{ t: d.loja.toUpperCase(), p: 0.8, b: false }];
  nl.forEach((x) => linhas.push({ t: x, p: 1.6, b: true, nm: true }));
  linhas.push({ t: `MANIP: ${br(ymd(agora))} ${hm}`, p: 1, b: false });
  linhas.push({ t: `VAL: ${br(d.validade)}`, p: 1.7, b: true, box: true });
  linhas.push({ t: CONS_TXT[d.cons], p: 0.9, b: true });
  linhas.push({ t: `RESP: ${d.resp.trim().toUpperCase()}`, p: 0.9, b: false });

  const soma = linhas.reduce((s, l) => s + l.p, 0);
  const un = (H - 2 * m) / (soma * 1.22);
  const util = W - 2 * m;
  const fonte = (l: L, fs: number) => `${l.b ? '800' : '500'} ${fs}px Arial, Helvetica, sans-serif`;
  for (const l of linhas) {
    let fs = Math.floor(un * l.p);
    g.font = fonte(l, fs);
    while (fs > 8 && g.measureText(l.t).width > util - (l.box ? 8 : 0)) g.font = fonte(l, --fs);
    l.fs = fs;
  }
  // as linhas do nome saem do MESMO tamanho (a menor das duas)
  const fsNome = Math.min(...linhas.filter((l) => l.nm).map((l) => l.fs!));
  let y = m;
  for (const l of linhas) {
    const fs = l.nm ? fsNome : l.fs!;
    g.font = fonte(l, fs);
    const x = Math.round((W - g.measureText(l.t).width) / 2);
    const alt = Math.round(un * l.p * 1.22);
    // validade só com MOLDURA: faixa preta cheia esquenta e a etiqueta gruda
    if (l.box) {
      g.lineWidth = 4;
      g.strokeRect(m + 2, y + 2, util - 4, alt - 4);
    }
    g.fillText(l.t, x, y + Math.round((alt - fs) / 2));
    y += alt;
  }
  return cv;
}

function ascii(s: string): Uint8Array {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255;
  return a;
}

function junta(partes: Uint8Array[]): Uint8Array {
  const o = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of partes) {
    o.set(p, k);
    k += p.length;
  }
  return o;
}

/** TSPL: no BITMAP modo 0, bit 0 = preto */
export function etqTspl(cv: HTMLCanvasElement, qtd: number, c: EtqCfg = etqCfg()): Uint8Array {
  const W = cv.width;
  const H = cv.height;
  const wb = W / 8;
  const px = cv.getContext('2d')!.getImageData(0, 0, W, H).data;
  const bits = new Uint8Array(wb * H);
  for (let y = 0; y < H; y++)
    for (let xb = 0; xb < wb; xb++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        const i = (y * W + xb * 8 + b) * 4;
        if (px[i] + px[i + 1] + px[i + 2] >= 384) byte |= 128 >> b;
      }
      bits[y * wb + xb] = byte;
    }
  const NL = '\r\n';
  return junta([
    ascii(
      `SIZE ${c.w} mm,${c.h} mm${NL}GAP ${c.gap} mm,0 mm${NL}DENSITY ${c.dens}${NL}SPEED 3${NL}` +
        `DIRECTION ${c.inv ? 0 : 1}${NL}CLS${NL}BITMAP ${(c.w >= 50 ? 0 : 8) + c.dx * 8},8,${wb},${H},0,`,
    ),
    bits,
    ascii(`${NL}PRINT 1,${qtd}${NL}`),
  ]);
}

export function etqComando(o: 'calibrar' | 'avancar', c: EtqCfg = etqCfg()): Uint8Array {
  const NL = '\r\n';
  return ascii(
    `SIZE ${c.w} mm,${c.h} mm${NL}GAP ${c.gap} mm,0 mm${NL}${o === 'calibrar' ? 'GAPDETECT' : 'FORMFEED'}${NL}`,
  );
}

// ---- Web Bluetooth (tipos mínimos: o lib.dom do TS não traz a API) ----
interface BtCh {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValue(v: BufferSource): Promise<void>;
  writeValueWithoutResponse(v: BufferSource): Promise<void>;
}
interface BtDev {
  name?: string;
  gatt: {
    connected: boolean;
    connect(): Promise<{ getPrimaryServices(): Promise<{ getCharacteristics(): Promise<BtCh[]> }[]> }>;
  };
}
interface BtNav {
  requestDevice(o: unknown): Promise<BtDev>;
  getDevices?: () => Promise<BtDev[]>;
}

const SERVICOS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ae00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000fff0-0000-1000-8000-00805f9b34fb',
];

let dev: BtDev | null = null;
let canal: BtCh | null = null;

export function temBluetooth(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

async function abreCanal(): Promise<BtCh> {
  if (canal && dev?.gatt.connected) return canal;
  const bt = (navigator as unknown as { bluetooth: BtNav }).bluetooth;
  if (!dev && bt.getDevices) {
    try {
      const ds = await bt.getDevices();
      if (ds.length) dev = ds[0];
    } catch {}
  }
  if (!dev) dev = await bt.requestDevice({ acceptAllDevices: true, optionalServices: SERVICOS });
  const srv = await dev.gatt.connect();
  for (const s of await srv.getPrimaryServices()) {
    let cs: BtCh[];
    try {
      cs = await s.getCharacteristics();
    } catch {
      continue;
    }
    const ch = cs.find((x) => x.properties.write || x.properties.writeWithoutResponse);
    if (ch) return (canal = ch);
  }
  throw new Error('a impressora conectou mas não aceita dados (serviço desconhecido)');
}

/** manda os bytes em pedaços; devolve o nome da impressora */
export async function etqEnvia(bytes: Uint8Array): Promise<string> {
  try {
    const ch = await abreCanal();
    let pedaco = 180;
    for (let i = 0; i < bytes.length; i += pedaco) {
      const s = bytes.slice(i, i + pedaco);
      try {
        if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(s);
        else await ch.writeValue(s);
      } catch (e) {
        if (pedaco > 20) {
          // reenvia este mesmo pedaço, agora de 20 em 20
          pedaco = 20;
          i -= pedaco;
          continue;
        }
        throw e;
      }
      if (ch.properties.writeWithoutResponse) await new Promise((r) => setTimeout(r, 12));
    }
    return dev?.name || 'impressora';
  } catch (e) {
    canal = null;
    throw e;
  }
}

export function etqEsquecer() {
  dev = null;
  canal = null;
}

// Leitura do QR (Pix) e do código de barras ITF da conta de consumo, no
// navegador, a partir da foto ou do PDF. Mesmo esquema de /movimento/
// entrada-notas/ler-chave-foto.ts: leitor nativo (Android) ou ZXing em
// WebAssembly servido daqui (public/zxing).

const WASM_ZXING = '/zxing/zxing_reader-3.1.3.wasm';
const FORMATOS = ['qr_code', 'itf'];

interface Detector {
  detect(img: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}
interface DetectorCtor {
  new (o: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

let nativo: Detector | null | undefined;
let zxing: Promise<Detector> | null = null;

async function detectorNativo(): Promise<Detector | null> {
  if (nativo !== undefined) return nativo;
  nativo = null;
  const N = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (N) {
    try {
      const sup = await N.getSupportedFormats();
      if (FORMATOS.every((f) => sup.includes(f))) nativo = new N({ formats: FORMATOS });
    } catch {
      // → ZXing
    }
  }
  return nativo;
}

function detectorZxing(): Promise<Detector> {
  zxing ??= (async () => {
    const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
    await prepareZXingModule({
      overrides: {
        locateFile: (caminho: string, prefixo: string) => (caminho.endsWith('.wasm') ? WASM_ZXING : prefixo + caminho),
      },
      fireImmediately: true,
    });
    return new BarcodeDetector({ formats: FORMATOS as never });
  })().catch((e) => {
    zxing = null;
    throw e;
  });
  return zxing;
}

async function lerImagem(img: ImageBitmap): Promise<string[]> {
  const textos = new Set<string>();
  const n = await detectorNativo();
  if (n) {
    try {
      for (const l of await n.detect(img)) if (l.rawValue) textos.add(l.rawValue);
    } catch {
      // segue pro ZXing
    }
  }
  try {
    for (const l of await (await detectorZxing()).detect(img)) if (l.rawValue) textos.add(l.rawValue);
  } catch {
    // sem ZXing: fica com o que o nativo achou
  }
  return [...textos];
}

/** Imagens JPEG embutidas no PDF (conta escaneada). */
function jpegsDoPdf(buf: Uint8Array): Blob[] {
  const out: Blob[] = [];
  let i = 0;
  while (i < buf.length - 3) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      let j = i + 3;
      while (j < buf.length - 1 && !(buf[j] === 0xff && buf[j + 1] === 0xd9)) j++;
      if (j - i > 20_000) out.push(new Blob([buf.slice(i, j + 2)], { type: 'image/jpeg' }));
      i = j + 2;
    } else i++;
  }
  return out;
}

/** Todos os códigos achados no arquivo (foto ou PDF). */
export async function lerCodigosDoArquivo(arquivo: File): Promise<string[]> {
  const imagens: Blob[] =
    arquivo.type === 'application/pdf' || /\.pdf$/i.test(arquivo.name)
      ? jpegsDoPdf(new Uint8Array(await arquivo.arrayBuffer()))
      : [arquivo];
  const achados = new Set<string>();
  for (const b of imagens) {
    let img: ImageBitmap;
    try {
      img = await createImageBitmap(b);
    } catch {
      continue;
    }
    try {
      for (const t of await lerImagem(img)) achados.add(t);
      // conta grande: tenta também reduzida (QR pequeno em foto de 4000 px)
      if (achados.size === 0 && Math.max(img.width, img.height) > 1600) {
        const esc = 1600 / Math.max(img.width, img.height);
        const menor = await createImageBitmap(img, { resizeWidth: Math.round(img.width * esc), resizeHeight: Math.round(img.height * esc) });
        try {
          for (const t of await lerImagem(menor)) achados.add(t);
        } finally {
          menor.close();
        }
      }
    } finally {
      img.close();
    }
  }
  return [...achados];
}

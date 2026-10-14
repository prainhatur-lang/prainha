// Leitura da chave de acesso a partir da foto do DANFE (no navegador).
// O código de barras do DANFE é um CODE-128 com os 44 números da chave.
// Android (Chrome) tem leitor nativo; iPhone não — aí entra o ZXing em
// WebAssembly, servido daqui mesmo (public/zxing), sem CDN de fora.
// Serve tanto pra foto inteira quanto pros quadros da câmera ao vivo
// (/nota-chave), por isso os leitores ficam guardados entre uma leitura e outra.

const WASM_ZXING = '/zxing/zxing_reader-3.1.3.wasm';

/** Dígito verificador da chave (módulo 11, pesos 2..9) — mesma conta de lib/nfe-distribuicao. */
export function chaveComDvOk(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(chave[43]);
}

function acharChave(lidos: Array<{ rawValue: string }>): string | null {
  for (const l of lidos) {
    const d = (l.rawValue ?? '').replace(/\D/g, '');
    if (chaveComDvOk(d)) return d;
  }
  return null;
}

interface DetectorNativo {
  detect(img: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}
interface DetectorNativoCtor {
  new (o: { formats: string[] }): DetectorNativo;
  getSupportedFormats(): Promise<string[]>;
}

let nativo: DetectorNativo | null | undefined; // undefined = ainda não testou
let zxing: Promise<DetectorNativo> | null = null;

async function detectorNativo(): Promise<DetectorNativo | null> {
  if (nativo !== undefined) return nativo;
  nativo = null;
  const Nativo = (globalThis as { BarcodeDetector?: DetectorNativoCtor }).BarcodeDetector;
  if (Nativo) {
    try {
      if ((await Nativo.getSupportedFormats()).includes('code_128')) nativo = new Nativo({ formats: ['code_128'] });
    } catch {
      // sem leitor nativo → ZXing
    }
  }
  return nativo;
}

function detectorZxing(): Promise<DetectorNativo> {
  zxing ??= (async () => {
    const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
    await prepareZXingModule({
      overrides: {
        locateFile: (caminho: string, prefixo: string) =>
          caminho.endsWith('.wasm') ? WASM_ZXING : prefixo + caminho,
      },
      fireImmediately: true,
    });
    return new BarcodeDetector({ formats: ['code_128'] });
  })().catch((e) => {
    zxing = null; // deixa tentar de novo
    throw e;
  });
  return zxing;
}

/** Carrega o leitor antes da primeira leitura (o ZXing baixa ~1 MB). */
export async function prepararLeitor(): Promise<'nativo' | 'zxing'> {
  if (await detectorNativo()) return 'nativo';
  await detectorZxing();
  return 'zxing';
}

/**
 * Procura a chave numa imagem (foto, canvas com o quadro da câmera...).
 * rapido = só o leitor nativo quando existe (câmera ao vivo no Android);
 * senão, se o nativo não achar, tenta também o ZXing.
 */
export async function lerChaveDaImagem(img: ImageBitmapSource, rapido = false): Promise<string | null> {
  const n = await detectorNativo();
  if (n) {
    try {
      const achou = acharChave(await n.detect(img));
      if (achou || rapido) return achou;
    } catch {
      // leitor nativo falhou → tenta o ZXing
    }
  }
  return acharChave(await (await detectorZxing()).detect(img));
}

/** Procura o código de barras da chave na foto. null = não achou. */
export async function lerCodigoDeBarras(foto: Blob): Promise<string | null> {
  const img = await createImageBitmap(foto);
  try {
    return await lerChaveDaImagem(img);
  } finally {
    img.close();
  }
}

/** Foto do celular (4000 px, 5 MB) reduzida pra mandar pra IA ler os números.
 *  Aceita também o canvas com o quadro da câmera ao vivo. */
export async function reduzirFoto(foto: Blob | HTMLCanvasElement, lado = 2000): Promise<Blob> {
  const img = foto instanceof Blob ? await createImageBitmap(foto) : foto;
  try {
    const escala = Math.min(1, lado / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((ok, falha) =>
      canvas.toBlob((b) => (b ? ok(b) : falha(new Error('não deu pra preparar a foto'))), 'image/jpeg', 0.9),
    );
  } finally {
    if (foto instanceof Blob && img instanceof ImageBitmap) img.close();
  }
}

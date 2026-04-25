// Compressão de imagem no client antes do upload.
// Reduz fotos do celular (5-10MB típicos) pra ~300-500KB sem perda
// visual significativa pra fins de auditoria.
//
// Estratégia:
//  1. createImageBitmap respeitando EXIF orientation (foto do celular
//     normalmente vem com Orientation=6 — sem isso fica deitada)
//  2. Reduz pra max 1600px no maior lado (mantém aspect ratio)
//  3. Re-encoda como JPEG quality 0.85
//  4. Se imagem original já estiver pequena, ainda re-encoda pra
//     normalizar formato (HEIC do iPhone vira JPEG, por ex)
//
// Fallback: se createImageBitmap falhar (raro — HEIC em browsers
// antigos), retorna o file original sem compressão.

export interface ResultadoCompressao {
  blob: Blob;
  arquivo: File;
  originalBytes: number;
  novosBytes: number;
  largura: number;
  altura: number;
  tipoOriginal: string;
  comprimido: boolean;
}

export interface OpcoesCompressao {
  /** Maior lado em pixels após redimensionar (default 1600) */
  maxLado?: number;
  /** Qualidade JPEG/WebP de 0 a 1 (default 0.85) */
  qualidade?: number;
  /** Mime alvo (default image/jpeg — mais compatível) */
  mimeAlvo?: 'image/jpeg' | 'image/webp';
}

export async function comprimirImagem(
  file: File,
  opts: OpcoesCompressao = {},
): Promise<ResultadoCompressao> {
  const maxLado = opts.maxLado ?? 1600;
  const qualidade = opts.qualidade ?? 0.85;
  const mimeAlvo = opts.mimeAlvo ?? 'image/jpeg';
  const tipoOriginal = file.type;

  try {
    // createImageBitmap respeita EXIF orientation
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    });

    let { width, height } = bitmap;
    const maior = Math.max(width, height);
    if (maior > maxLado) {
      const escala = maxLado / maior;
      width = Math.round(width * escala);
      height = Math.round(height * escala);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context indisponível');

    // Fundo branco pra evitar transparência ficar preta no JPEG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob(resolve, mimeAlvo, qualidade);
    });
    if (!blob) throw new Error('canvas.toBlob retornou null');

    // Se o resultado ficou MAIOR que o original (raro com fotos muito
    // já comprimidas), prefere o original
    if (blob.size >= file.size && tipoOriginal.startsWith('image/jpeg')) {
      return {
        blob: file,
        arquivo: file,
        originalBytes: file.size,
        novosBytes: file.size,
        largura: width,
        altura: height,
        tipoOriginal,
        comprimido: false,
      };
    }

    const ext = mimeAlvo === 'image/webp' ? 'webp' : 'jpg';
    const nomeBase = file.name.replace(/\.[^.]+$/, '') || 'foto';
    const arquivo = new File([blob], `${nomeBase}.${ext}`, { type: mimeAlvo });

    return {
      blob,
      arquivo,
      originalBytes: file.size,
      novosBytes: blob.size,
      largura: width,
      altura: height,
      tipoOriginal,
      comprimido: true,
    };
  } catch (e) {
    // Fallback: retorna original (HEIC em browsers antigos, navegador
    // sem createImageBitmap, etc)
    console.warn('[comprimirImagem] fallback pro original:', e);
    return {
      blob: file,
      arquivo: file,
      originalBytes: file.size,
      novosBytes: file.size,
      largura: 0,
      altura: 0,
      tipoOriginal,
      comprimido: false,
    };
  }
}

/** Formata bytes pra display (1234567 → "1.2 MB") */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
